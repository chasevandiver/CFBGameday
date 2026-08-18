import { NextResponse, type NextRequest } from "next/server";
import {
  GTG_MAX_ATTEMPTS,
  gtgMarks,
  gtgPayload,
  pickDailyGame,
  type GtgAnswerCtx,
  type GtgRowState,
} from "../../../lib/guess-game";
import { gtgStanding, type GtgDayResult, type GtgStats } from "../../../lib/gtg-stats";
import { answerFor, cfbDeck, recordFor, resolveTeam, teamRegion } from "../../../lib/guess-game-data";
import { productDate } from "../../../lib/streak";
import { createClient } from "../../../lib/supabase/server";
import { createServiceClient } from "../../../lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * The daily puzzle's play surface (R2-C3). Server-authoritative on purpose:
 * a page that ships the answer for client-side checking is spoiled by
 * view-source, so GET returns ONLY the hints your attempt count has earned
 * and POST verdicts a guess server-side. The anti-spoiler proof is the route
 * test asserting an unsolved GET payload never contains the answer.
 *
 * Writes run on the service client (gtg_guesses revokes member writes —
 * 0059); identity comes from the session, so the service write is always
 * scoped to the caller's own row.
 *
 * **This is the only place the feature writes.** Practice mode next door
 * shares every read through `guess-game-data.ts` and has no write at all,
 * which is what makes "practice does not touch your score" a property of the
 * code rather than a promise in a comment.
 */

type GtgRow = GtgRowState;

async function dayAnswer(db: ReturnType<typeof createServiceClient>, day: string) {
  const gameId = pickDailyGame(day, await cfbDeck(db, day));
  return gameId === null ? null : answerFor(db, gameId);
}

/**
 * The caller's own history, folded into a standing (GTG-10).
 *
 * Every row belongs to the session's user — the same scoping the day's row
 * already uses — so this needs no migration and no definer function: it is
 * one more read on a query path that was always the caller's own data. A year
 * of play is 365 rows of three columns.
 *
 * The fold itself is `gtgStanding`, pure and tested, so the streak rule lives
 * in one place rather than in SQL where it cannot be exercised.
 */
async function standingFor(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<GtgStats> {
  const { data } = await service
    .from("gtg_guesses")
    .select("day, attempts, solved_at")
    .eq("user_id", userId);
  const rows = ((data ?? []) as Array<{ day: string; attempts: number; solved_at: string | null }>)
    /* An unfinished day is not a result yet: counting today's two wrong
       guesses as a bust would zero the streak of anyone who opened the puzzle
       and walked away. */
    .filter((r) => r.solved_at !== null || r.attempts >= GTG_MAX_ATTEMPTS)
    .map<GtgDayResult>((r) => ({
      day: r.day,
      attempts: r.attempts,
      solved: r.solved_at !== null,
    }));
  return gtgStanding(rows);
}

async function userAndRow(day: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, row: null as GtgRow | null };
  const service = createServiceClient();
  const { data } = await service
    .from("gtg_guesses")
    .select("guesses, attempts, solved_at")
    .eq("user_id", user.id)
    .eq("day", day)
    .maybeSingle();
  const row = (data as GtgRow | null) ?? { guesses: [], attempts: 0, solved_at: null };
  return { user, row };
}

/**
 * A guess, scored on all three axes (GTG-9).
 *
 * The two extra reads happen only on POST and only for a guess that already
 * resolved to a team, so the cost is bounded by six guesses a day. Region is
 * cached per instance; the record query is the same bounded one the clue
 * itself uses.
 */
async function marksFor(
  service: ReturnType<typeof createServiceClient>,
  team: { id: number; conference: string | null },
  answer: GtgAnswerCtx,
) {
  const [region, record] = await Promise.all([
    teamRegion(service, team.id),
    recordFor(service, team.id, answer.season, answer.startTs),
  ]);
  return gtgMarks({ id: team.id, conference: team.conference, region, record }, answer);
}

export async function GET() {
  const day = productDate(new Date());
  const { user, row } = await userAndRow(day);
  if (!user || !row) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  const service = createServiceClient();
  const [answer, stats] = await Promise.all([dayAnswer(service, day), standingFor(service, user.id)]);
  if (!answer) return NextResponse.json({ error: "No puzzle today" }, { status: 404 });
  return NextResponse.json(gtgPayload(day, row, answer, stats));
}

export async function POST(req: NextRequest) {
  const day = productDate(new Date());
  const { user, row } = await userAndRow(day);
  if (!user || !row) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });
  if (row.solved_at !== null || row.attempts >= GTG_MAX_ATTEMPTS) {
    return NextResponse.json({ error: "Today's puzzle is finished" }, { status: 409 });
  }

  let guessName: string;
  try {
    const body = (await req.json()) as { guess?: unknown };
    guessName = String(body.guess ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (guessName.length < 2 || guessName.length > 60) {
    return NextResponse.json({ error: "Guess a school, e.g. “Auburn”" }, { status: 400 });
  }

  const service = createServiceClient();
  const answer = await dayAnswer(service, day);
  if (!answer) return NextResponse.json({ error: "No puzzle today" }, { status: 404 });

  // A guess that does not resolve costs no attempt — it never reaches the
  // write below. That is what makes a typo free.
  const resolved = await resolveTeam(service, guessName);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const team = resolved.team;

  const marks = await marksFor(service, team, answer);
  const next: GtgRow = {
    /* The chip marks are STORED, not recomputed on read. Two reasons: a reload
       must show the same row you saw when you guessed, and recomputing would
       put two region lookups per historical guess on every GET. Stored in the
       existing jsonb, so there is no migration and a row written before this
       simply has no marks — which reads as "not compared", the truth. */
    guesses: [
      ...row.guesses,
      { name: team.school, verdict: marks.verdict, region: marks.region, record: marks.record },
    ],
    attempts: row.attempts + 1,
    solved_at: marks.verdict === "correct" ? new Date().toISOString() : null,
  };
  const { error } = await service.from("gtg_guesses").upsert(
    {
      user_id: user.id,
      day,
      guesses: next.guesses,
      attempts: next.attempts,
      solved_at: next.solved_at ?? row.solved_at,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,day" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(gtgPayload(day, next, answer, await standingFor(service, user.id)));
}
