/**
 * `daily-puzzles` — generates a queue of days for the three trial games.
 *
 * ## Why a job at all, when Guess the Game needed none
 *
 * GTG-1 is the argument. Guess the Game picks its puzzle by hashing the day
 * against a deck read at request time: no job, no cadence, and therefore no
 * watchdog lane. When the deck turned out to be empty it stayed empty for
 * weeks and nothing went red, because there was nothing that could be late.
 *
 * Generating ahead turns that invisible failure into a measurable one. The job
 * keeps `QUEUE_TARGET` days banked; `daysQueued` is the health metric and the
 * run FAILS below `QUEUE_FLOOR` — which is several days before any player sees
 * an empty screen. A transient CFBD or database hiccup with two weeks banked
 * is a green run carrying an error string; a generator that has been broken
 * for ten days is a red one.
 *
 * The rendezvous hash did not go away, it moved: selection is still
 * `fnv1a(day + ":" + id)` argmax over the deck, so the same day still yields
 * the same puzzle for everybody and a growing deck still only changes the days
 * a new candidate would itself have won. What changed is that the result is
 * written down.
 *
 * ## One job, three games
 *
 * One cron, one `job_runs` row, one watchdog lane. `jobs.yml` already carries
 * about thirty crons and OPS-14 recorded that the dispatch dropdown truncates
 * around twelve — three more lanes is three more things that can be silently
 * absent. A generator that throws is caught per game, so one broken game
 * cannot stop the other two from being generated.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchSalienceDeck, type DeckGame } from "../../src/lib/salience-data";
import { buildTape, tapeEligible, type TapeCtx } from "../../src/lib/tape";
import { fnv1a, pickDailyGame } from "../../src/lib/guess-game";
import { productDate, productDateOffset } from "../../src/lib/streak";

/** How many days ahead to keep banked. */
export const QUEUE_TARGET = 14;
/** Below this the job throws, so somebody hears about it with days to spare. */
export const QUEUE_FLOOR = 4;

export type Json = Record<string, unknown>;

/** The days `today .. today + n - 1`, as product dates. */
export function queueDays(now: Date, n: number): string[] {
  return Array.from({ length: n }, (_, i) => productDateOffset(now, i));
}

/**
 * A deck game, as The Tape's question builder sees it.
 *
 * The fixture's own conference columns are not read here — The Tape asks no
 * conference question — but the mapping is written out field by field anyway
 * rather than spread, so a column added to `DeckGame` cannot silently become a
 * question input.
 */
export function tapeCtxOf(g: DeckGame, homeSchool: string, awaySchool: string): TapeCtx {
  return {
    homeSchool,
    awaySchool,
    homePoints: g.homePoints,
    awayPoints: g.awayPoints,
    season: g.seasonId,
    week: g.week,
    seasonType: g.seasonType,
    neutralSite: g.neutralSite,
    conferenceGame: g.conferenceGame,
    spread: g.spread,
    total: g.total,
    pollPublished: g.pollPublished,
    homeRank: g.homeRank,
  };
}

/**
 * How much of the deck a day may draw from.
 *
 * Salience ranks the whole archive; this takes the top slice, so a puzzle is
 * always a game somebody might remember. Sized so the deck outlasts a couple of
 * seasons of daily play without repeating — the exact number is worth revisiting
 * once BF-4 reports how many eligible games there actually are.
 */
export const TAPE_DECK_SIZE = 900;

export interface GenerateResult extends Json {
  generated: number;
  daysQueued: number;
}

/**
 * Fill The Tape's queue.
 *
 * Idempotent: a day already in `tape_puzzles` is left exactly as it is, never
 * regenerated. That is not an optimisation — a regenerated day would re-word
 * questions somebody had already answered, and the stored `correct` flags
 * would then describe a round that no longer exists.
 *
 * The deck is read ONCE for the whole queue rather than per day. Eleven seasons
 * of games, polls and closing lines is a heavy read and it does not change
 * between the days of one run.
 */
export async function generateTape(
  db: SupabaseClient,
  now: Date,
  target = QUEUE_TARGET,
): Promise<GenerateResult> {
  const days = queueDays(now, target);

  const { data: existingRows } = await db
    .from("tape_puzzles")
    .select("day")
    .gte("day", days[0]!)
    .lte("day", days[days.length - 1]!);
  const existing = new Set(((existingRows ?? []) as Array<{ day: string }>).map((r) => r.day));

  const missing = days.filter((d) => !existing.has(d));
  if (missing.length === 0) {
    return { generated: 0, daysQueued: await countQueued(db, "tape_puzzles", days[0]!) };
  }

  const deck = (await fetchSalienceDeck(db)).filter((g) =>
    tapeEligible(tapeCtxOf(g, "home", "away")),
  );
  if (deck.length === 0) {
    throw new Error("tape: no eligible games — has backfill-lines run?");
  }
  const pool = deck.slice(0, TAPE_DECK_SIZE);
  const schools = await schoolNames(db, pool);

  /* A day must not draw a game another QUEUED day already has. Rendezvous
     argmax is stable but it is not injective across days, and the same fixture
     twice in one fortnight is the most visible way this can look broken. */
  const used = new Set(await queuedGameIds(db, days[0]!));
  let generated = 0;

  for (const day of missing) {
    const candidates = pool.filter((g) => !used.has(g.id));
    if (candidates.length === 0) break;

    const gameId = pickDailyGame(day, candidates.map((g) => g.id));
    if (gameId === null) break;
    const game = candidates.find((g) => g.id === gameId)!;

    const home = schools.get(game.homeTeamId);
    const away = schools.get(game.awayTeamId);
    if (!home || !away) continue;

    const questions = buildTape(tapeCtxOf(game, home, away));

    const { error: pErr } = await db
      .from("tape_puzzles")
      .insert({ day, game_id: game.id });
    if (pErr) throw new Error(`tape: ${day} puzzle insert failed: ${pErr.message}`);

    const { error: qErr } = await db.from("tape_questions").insert(
      questions.map((q, idx) => ({
        day,
        idx,
        kind: q.kind,
        prompt: q.prompt,
        choices: q.choices,
        answer: q.answer,
      })),
    );
    if (qErr) throw new Error(`tape: ${day} questions insert failed: ${qErr.message}`);

    used.add(game.id);
    generated += 1;
  }

  return { generated, daysQueued: await countQueued(db, "tape_puzzles", days[0]!) };
}

async function schoolNames(
  db: SupabaseClient,
  deck: DeckGame[],
): Promise<Map<number, string>> {
  const ids = [...new Set(deck.flatMap((g) => [g.homeTeamId, g.awayTeamId]))];
  const out = new Map<number, string>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await db
      .from("teams")
      .select("id, school")
      .in("id", ids.slice(i, i + 500));
    for (const t of (data ?? []) as Array<{ id: number; school: string }>) out.set(t.id, t.school);
  }
  return out;
}

async function queuedGameIds(db: SupabaseClient, from: string): Promise<number[]> {
  const { data } = await db.from("tape_puzzles").select("game_id").gte("day", from);
  return ((data ?? []) as Array<{ game_id: number }>).map((r) => r.game_id);
}

/** How many days from `from` onward already have a puzzle. The health metric. */
export async function countQueued(
  db: SupabaseClient,
  table: string,
  from: string,
): Promise<number> {
  const { count } = await db
    .from(table)
    .select("day", { count: "exact", head: true })
    .gte("day", from);
  return count ?? 0;
}

/**
 * Whether a run should be red.
 *
 * Pure and exported so the threshold is testable without a database. A game
 * that failed to generate but still has a fortnight banked is not an outage;
 * one that has been failing long enough to draw the queue down is, and this is
 * the only place that judgement is made.
 */
export function queueVerdict(
  results: Record<string, { daysQueued?: number }>,
  floor = QUEUE_FLOOR,
): { ok: boolean; starved: string[] } {
  const starved = Object.entries(results)
    .filter(([, r]) => (r.daysQueued ?? 0) < floor)
    .map(([name]) => name);
  return { ok: starved.length === 0, starved };
}

/**
 * The job. One generator per game, each caught, then one verdict over all of
 * them — so a single broken generator cannot stop the others being filled, and
 * cannot hide behind their success either.
 */
export async function dailyPuzzlesJob(db: SupabaseClient): Promise<Json> {
  const now = new Date();
  const today = productDate(now);
  const detail: Record<string, Json> = {};

  const generators: Array<[string, (db: SupabaseClient, now: Date) => Promise<GenerateResult>]> = [
    ["tape", generateTape],
  ];

  for (const [name, run] of generators) {
    try {
      detail[name] = await run(db, now);
    } catch (e) {
      detail[name] = {
        error: e instanceof Error ? e.message : String(e),
        daysQueued: await countQueued(db, `${name}_puzzles`, today).catch(() => 0),
      };
    }
  }

  const verdict = queueVerdict(detail as Record<string, { daysQueued?: number }>);
  if (!verdict.ok) {
    throw new Error(
      `daily-puzzles: queue below ${QUEUE_FLOOR} days for ${verdict.starved.join(", ")} — ${JSON.stringify(detail)}`,
    );
  }
  return { day: today, ...detail };
}

/** Re-exported so a caller does not have to reach into guess-game for it. */
export { fnv1a };
