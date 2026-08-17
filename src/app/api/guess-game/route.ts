import { NextResponse, type NextRequest } from "next/server";
import { consensusFromSnapshots, SNAPSHOT_COLS, type SnapshotLike } from "../../../lib/consensus";
import {
  GTG_MAX_ATTEMPTS,
  gtgPayload,
  gtgVerdict,
  pickDailyGame,
  type GtgAnswerCtx,
  type GtgRowState,
} from "../../../lib/guess-game";
import { NFL_ID_OFFSET } from "../../../lib/league";
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
 */

type GtgRow = GtgRowState;

/**
 * The deck: every CFB regular-season final we hold a score for.
 *
 * This used to be `for (const season of [2023, 2024, 2025])`, and that literal
 * was the whole bug: the three seasons it named were never backfilled into
 * this database, so the deck was empty and the page said "no puzzle today"
 * every day since R2-C3 shipped. Worse, it could not heal — when 2026
 * finishes, its games are season 2026 and the list would still be asking for
 * 2023.
 *
 * So the seasons are DISCOVERED rather than declared. Whatever CFB seasons
 * exist get played; a backfill widens the deck by landing rows, and the
 * season now being played widens it every Saturday. Rendezvous hashing is
 * what makes a growing deck safe — a new candidate only ever changes the days
 * it would itself have won, so yesterday's puzzle never moves.
 *
 * Read per season rather than in one query: a season is ~870 regular-season
 * games and PostgREST caps a response at 1000 rows, so one query over all of
 * them would silently truncate — and a silently truncated deck is a deck that
 * still works, which is the kind of bug nobody finds.
 *
 * Cached per instance per day — but **an empty deck is never cached**, and
 * that exception is the lesson of this whole bug rather than a micro-
 * optimisation. An empty deck is not a valid state to hold on to: it means
 * either something is wrong or a backfill is in flight, and both want the next
 * request to look again. Caching it pins "no puzzle today" onto a warm
 * instance for the rest of the day, so landing 2,700 games changes nothing
 * until that instance happens to recycle — the exact shape of failure that
 * made the original bug invisible for weeks. A non-empty deck is worth caching
 * because it only ever grows, and the rendezvous pick is deterministic anyway.
 */
let deckCache: { day: string; ids: number[] } | null = null;

async function cfbDeck(db: ReturnType<typeof createServiceClient>): Promise<number[]> {
  const { data: seasonRows } = await db
    .from("seasons")
    .select("id")
    .lt("id", NFL_ID_OFFSET)
    .order("id");

  const ids: number[] = [];
  for (const s of (seasonRows ?? []) as Array<{ id: number }>) {
    const { data } = await db
      .from("games")
      .select("id")
      .eq("season_id", s.id)
      .eq("season_type", "regular")
      .eq("status", "final")
      // A "final" with no score cannot answer its own first hint.
      .not("home_points", "is", null)
      .not("away_points", "is", null);
    for (const r of (data ?? []) as Array<{ id: number }>) ids.push(r.id);
  }
  return ids;
}

async function dayAnswer(
  db: ReturnType<typeof createServiceClient>,
  day: string,
): Promise<GtgAnswerCtx | null> {
  if (!deckCache || deckCache.day !== day) {
    const ids = await cfbDeck(db);
    // See the header: an empty deck is a state to retry, not to remember.
    if (ids.length > 0) deckCache = { day, ids };
    else deckCache = null;
  }
  const deck = deckCache?.ids ?? [];
  const gameId = pickDailyGame(day, deck);
  if (gameId === null) return null;

  const { data: game } = await db
    .from("games")
    .select("id, season_id, week, home_team_id, away_team_id, home_points, away_points")
    .eq("id", gameId)
    .maybeSingle();
  if (!game || game.home_points === null || game.away_points === null) return null;

  const [{ data: teams }, { data: snaps }] = await Promise.all([
    db
      .from("teams")
      .select("id, school, conference")
      .in("id", [game.home_team_id, game.away_team_id]),
    db.from("line_snapshots").select(SNAPSHOT_COLS).eq("game_id", gameId),
  ]);
  const teamById = new Map(
    ((teams ?? []) as Array<{ id: number; school: string; conference: string | null }>).map(
      (t) => [t.id, t],
    ),
  );
  const home = teamById.get(game.home_team_id);
  const away = teamById.get(game.away_team_id);
  if (!home || !away) return null;

  return {
    homeTeamId: game.home_team_id,
    homeConference: home.conference,
    homeSchool: home.school,
    awaySchool: away.school,
    homePoints: game.home_points,
    awayPoints: game.away_points,
    season: game.season_id,
    week: game.week,
    spread: consensusFromSnapshots((snaps ?? []) as SnapshotLike[]).spread,
  };
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

  // Resolve the school. Exact-insensitive on school or abbreviation first,
  // then a contains match if it is unambiguous.
  const { data: exact } = await service
    .from("teams")
    .select("id, school, conference")
    .eq("sport", "cfb")
    .or(`school.ilike.${guessName},abbreviation.ilike.${guessName}`)
    .limit(2);
  let team = (exact ?? [])[0] as
    | { id: number; school: string; conference: string | null }
    | undefined;
  if (!team) {
    const { data: fuzzy } = await service
      .from("teams")
      .select("id, school, conference")
      .eq("sport", "cfb")
      .ilike("school", `%${guessName}%`)
      .limit(2);
    const rows = (fuzzy ?? []) as Array<{ id: number; school: string; conference: string | null }>;
    if (rows.length === 1) team = rows[0];
    else if (rows.length > 1) {
      return NextResponse.json(
        { error: `“${guessName}” matches more than one school — be more specific` },
        { status: 422 },
      );
    }
  }
  if (!team) {
    return NextResponse.json({ error: `No school matching “${guessName}”` }, { status: 422 });
  }

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
