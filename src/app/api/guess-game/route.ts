import { NextResponse, type NextRequest } from "next/server";
import {
  GTG_MAX_ATTEMPTS,
  gtgPayload,
  gtgVerdict,
  pickDailyGame,
  type GtgRowState,
} from "../../../lib/guess-game";
import { answerFor, cfbDeck, resolveTeam } from "../../../lib/guess-game-data";
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

export async function GET() {
  const day = productDate(new Date());
  const { user, row } = await userAndRow(day);
  if (!user || !row) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  const service = createServiceClient();
  const answer = await dayAnswer(service, day);
  if (!answer) return NextResponse.json({ error: "No puzzle today" }, { status: 404 });
  return NextResponse.json(gtgPayload(day, row, answer));
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

  const verdict = gtgVerdict({ id: team.id, conference: team.conference }, answer);
  const next: GtgRow = {
    guesses: [...row.guesses, { name: team.school, verdict }],
    attempts: row.attempts + 1,
    solved_at: verdict === "correct" ? new Date().toISOString() : null,
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

  return NextResponse.json(gtgPayload(day, next, answer));
}
