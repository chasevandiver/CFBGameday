import { NextResponse, type NextRequest } from "next/server";
import {
  GTG_MAX_ATTEMPTS,
  gtgHints,
  gtgVerdict,
  pickDailyGame,
  practicePool,
  type GtgAnswerCtx,
} from "../../../../lib/guess-game";
import { answerFor, cfbDeck, resolveTeam } from "../../../../lib/guess-game-data";
import { productDate } from "../../../../lib/streak";
import { createClient } from "../../../../lib/supabase/server";
import { createServiceClient } from "../../../../lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * Practice: play the archive for fun, scored by nobody.
 *
 * ## Why it cannot touch your season
 *
 * **There is no write in this file.** Points come from `gtg_leaderboard()`,
 * which aggregates `gtg_guesses`, which only the daily route ever writes. So
 * "practice does not count" is not a rule anybody has to remember — it is the
 * absence of an INSERT, and adding one would be an obvious thing to see in a
 * diff. The reads are the daily puzzle's own, shared through
 * `guess-game-data.ts` so a practice round is the same game with the same
 * clues.
 *
 * ## Why it is stateless
 *
 * Nothing is stored, so the client holds the round: it sends the seed and how
 * many guesses it has spent, and the server cuts exactly that many clues. That
 * trusts the client with its own attempt count — which is fine precisely
 * because nothing is scored. Lying to a practice round only spoils it for the
 * liar, and the alternative (a table, a cleanup job, RLS) is real machinery
 * bought for nothing. The daily puzzle, which IS scored, keeps its state in
 * the database where the client cannot reach it.
 *
 * ## Today's game is excluded, and that is the point
 *
 * A practice round that served up the daily puzzle would spoil the one thing
 * everybody plays together. It is filtered out of the deck before the pick,
 * so no seed can reach it.
 */

/** Seeds go into a hash and nothing else, but they still come from a client. */
const SEED = /^[A-Za-z0-9-]{6,64}$/;

async function practiceAnswer(
  db: ReturnType<typeof createServiceClient>,
  seed: string,
): Promise<GtgAnswerCtx | null> {
  const day = productDate(new Date());
  const deck = await cfbDeck(db, day);
  if (deck.length === 0) return null;

  const pool = practicePool(deck, pickDailyGame(day, deck));
  const gameId = pickDailyGame(seed, pool);
  return gameId === null ? null : answerFor(db, gameId);
}

async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Open a practice round: the free clue, and nothing else. */
export async function GET(req: NextRequest) {
  if (!(await signedIn())) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  const seed = req.nextUrl.searchParams.get("seed") ?? "";
  if (!SEED.test(seed)) return NextResponse.json({ error: "Bad seed" }, { status: 400 });

  const answer = await practiceAnswer(createServiceClient(), seed);
  if (!answer) return NextResponse.json({ error: "No games to practise on" }, { status: 404 });

  return NextResponse.json({
    seed,
    maxAttempts: GTG_MAX_ATTEMPTS,
    hints: gtgHints(answer, 0),
  });
}

export async function POST(req: NextRequest) {
  if (!(await signedIn())) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  let seed: string;
  let guessName: string;
  let attempts: number;
  try {
    const body = (await req.json()) as { seed?: unknown; guess?: unknown; attempts?: unknown };
    seed = String(body.seed ?? "");
    guessName = String(body.guess ?? "").trim();
    attempts = Number(body.attempts ?? 0);
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!SEED.test(seed)) return NextResponse.json({ error: "Bad seed" }, { status: 400 });
  if (!Number.isInteger(attempts) || attempts < 0 || attempts >= GTG_MAX_ATTEMPTS) {
    return NextResponse.json({ error: "This practice round is finished" }, { status: 409 });
  }
  if (guessName.length < 2 || guessName.length > 60) {
    return NextResponse.json({ error: "Guess a school, e.g. “Auburn”" }, { status: 400 });
  }

  const service = createServiceClient();
  const answer = await practiceAnswer(service, seed);
  if (!answer) return NextResponse.json({ error: "No games to practise on" }, { status: 404 });

  // Same refusals as the daily, and the same deal: an unresolved guess is not
  // an attempt.
  const resolved = await resolveTeam(service, guessName);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const verdict = gtgVerdict(
    { id: resolved.team.id, conference: resolved.team.conference },
    answer,
  );
  const spent = attempts + 1;
  const solved = verdict === "correct";
  const done = solved || spent >= GTG_MAX_ATTEMPTS;

  return NextResponse.json({
    seed,
    name: resolved.team.school,
    verdict,
    attempts: spent,
    maxAttempts: GTG_MAX_ATTEMPTS,
    solved,
    done,
    hints: gtgHints(answer, spent),
    // Gated on `done` exactly like the daily payload — the reveal is the only
    // thing separating a practice round from a spoiler machine.
    answer: done ? `${answer.awaySchool} @ ${answer.homeSchool}` : null,
    answerTeams: done ? { away: answer.awaySchool, home: answer.homeSchool } : null,
  });
}
