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
import {
  CHAINS_DECK,
  chainsOrder,
  chainsPrompt,
  chainsWinner,
  isMintable,
  type ChainsCard,
  type ChainsKind,
} from "../../src/lib/chains";
import {
  validateGrid,
  type DcCategory,
  type DcGrid,
  type DcReject,
} from "../../src/lib/depth-chart";
import { buildFacts, fetchFinalTop10, fetchVenues, toCategory } from "./dc-facts";
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
    ["chains", generateChains],
    ["dc", generateDepthChart],
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

/* ---- Chains -------------------------------------------------------------- */

/** How deep into the salience ranking Chains will reach. */
export const CHAINS_POOL = 2500;

/**
 * A deterministic shuffle of `0..n-1` from a seed.
 *
 * Fisher-Yates driven by the same FNV-1a the rendezvous hash uses, so a repair
 * run reproduces the same deck rather than a different one. `Math.random()`
 * would make regeneration produce a puzzle nobody else is playing.
 */
export function seededOrder(n: number, seed: string): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = fnv1a(`${seed}:${i}`) % (i + 1);
    [idx[i]!, idx[j]!] = [idx[j]!, idx[i]!];
  }
  return idx;
}

/** The value each kind compares, or null when this game cannot supply it. */
export function cardValue(kind: ChainsKind, g: DeckGame): number | null {
  switch (kind) {
    case "total_points":
      return g.homePoints + g.awayPoints;
    case "margin":
      return Math.abs(g.homePoints - g.awayPoints);
    case "spread":
      return g.spread === null ? null : Math.abs(g.spread);
    case "ap_finish":
      /* Not a game-level fact — a team's final poll finish. Chains does not
         mint these yet; the kind exists because inverting the comparison for a
         poll rank is the thing that ships wrong, and `chainsWinner` already
         handles and tests it. Recorded rather than half-built. */
      return null;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

const CHAINS_KINDS: ChainsKind[] = ["total_points", "margin", "spread"];

/** How a game reads on a card. */
function sideOf(g: DeckGame, home: string, away: string) {
  return {
    label: `${away} at ${home}`,
    sub:
      g.seasonType === "postseason"
        ? `${g.seasonId} · Postseason`
        : `${g.seasonId} · Week ${g.week}`,
    teamId: g.homeTeamId,
  };
}

/**
 * One day's deck: pairs drawn from the pool, ordered easiest first.
 *
 * Pure given its inputs, so the ordering property has a test that needs no
 * database. Cards whose two values are equal are DROPPED rather than kept — a
 * run has nowhere to put a tie.
 */
export function buildChains(
  day: string,
  pool: DeckGame[],
  schools: Map<number, string>,
  size = CHAINS_DECK,
): ChainsCard[] {
  const order = seededOrder(pool.length, day);
  const cards: ChainsCard[] = [];

  /* Walk the shuffled pool two at a time, cycling kinds so a deck is not four
     scoring cards in a row. Over-draws, because ties and missing values thin
     the result and a short deck would silently shorten everybody's ceiling. */
  for (let i = 0; i + 1 < order.length && cards.length < size * 3; i += 2) {
    const a = pool[order[i]!]!;
    const b = pool[order[i + 1]!]!;
    const kind = CHAINS_KINDS[cards.length % CHAINS_KINDS.length]!;

    const left = cardValue(kind, a);
    const right = cardValue(kind, b);
    if (left === null || right === null || !isMintable(left, right)) continue;

    const aHome = schools.get(a.homeTeamId);
    const aAway = schools.get(a.awayTeamId);
    const bHome = schools.get(b.homeTeamId);
    const bAway = schools.get(b.awayTeamId);
    if (!aHome || !aAway || !bHome || !bAway) continue;

    cards.push({
      kind,
      prompt: chainsPrompt(kind),
      left: sideOf(a, aHome, aAway),
      right: sideOf(b, bHome, bAway),
      leftValue: left,
      rightValue: right,
      answer: chainsWinner(kind, left, right),
    });
  }

  return chainsOrder(cards).slice(0, size);
}

/**
 * Fill Chains' queue. Idempotent by day for the same reason The Tape's is: a
 * regenerated day would rewrite a deck somebody has already played through.
 */
export async function generateChains(
  db: SupabaseClient,
  now: Date,
  target = QUEUE_TARGET,
): Promise<GenerateResult> {
  const days = queueDays(now, target);

  const { data: existingRows } = await db
    .from("chains_puzzles")
    .select("day")
    .gte("day", days[0]!)
    .lte("day", days[days.length - 1]!);
  const existing = new Set(((existingRows ?? []) as Array<{ day: string }>).map((r) => r.day));

  const missing = days.filter((d) => !existing.has(d));
  if (missing.length === 0) {
    return { generated: 0, daysQueued: await countQueued(db, "chains_puzzles", days[0]!) };
  }

  /* A far wider pool than The Tape's. A comparison is not a recall test, so an
     obscure game is a perfectly good card — it only has to have a number. */
  const pool = (await fetchSalienceDeck(db)).slice(0, CHAINS_POOL);
  if (pool.length < 4) throw new Error("chains: not enough games — has backfill-games run?");
  const schools = await schoolNames(db, pool);

  let generated = 0;
  for (const day of missing) {
    const deck = buildChains(day, pool, schools);
    if (deck.length === 0) continue;

    const { error: pErr } = await db
      .from("chains_puzzles")
      .insert({ day, deck_size: deck.length });
    if (pErr) throw new Error(`chains: ${day} puzzle insert failed: ${pErr.message}`);

    const { error: cErr } = await db.from("chains_cards").insert(
      deck.map((c, idx) => ({
        day,
        idx,
        kind: c.kind,
        prompt: c.prompt,
        left_label: c.left.label,
        left_sub: c.left.sub,
        left_team: c.left.teamId,
        right_label: c.right.label,
        right_sub: c.right.sub,
        right_team: c.right.teamId,
        left_value: c.leftValue,
        right_value: c.rightValue,
        answer: c.answer,
      })),
    );
    if (cErr) throw new Error(`chains: ${day} cards insert failed: ${cErr.message}`);
    generated += 1;
  }

  return { generated, daysQueued: await countQueued(db, "chains_puzzles", days[0]!) };
}

/* ---- Depth Chart --------------------------------------------------------- */

/** How many category draws a day gets before it is given up as ungeneratable. */
export const DC_ATTEMPTS = 200;
/** At most this many of one kind, so a grid is not one puzzle wearing four hats. */
export const DC_MAX_PER_KIND = 2;

export interface DcAttemptResult {
  grid: DcGrid | null;
  /** How many tiles could plausibly sit in two groups — the designed feel. */
  traps: number;
  attempts: number;
  /** Why the failures failed, so a starving generator says which knob to turn. */
  rejects: Record<DcReject, number>;
}

/** Deterministic pick of `k` distinct indices below `n`, from a seed. */
function seededPick(n: number, k: number, seed: string): number[] {
  return seededOrder(n, seed).slice(0, k);
}

/**
 * Try to build a fair grid for a day.
 *
 * Deterministic and seeded: a repair run reproduces the same board rather than
 * a different one, using the same FNV-1a idiom the rendezvous hash uses.
 * `Math.random()` here would mean a regenerated day is a puzzle nobody else is
 * playing.
 *
 * The loop is draw → fill → validate, and it reports WHICH check rejected each
 * attempt. That matters operationally: `ambiguous` means the fact index has too
 * much overlap and `too_easy` means too little, and the fix for one is the
 * opposite of the fix for the other. A generator that only said "failed" would
 * leave that undiagnosable.
 */
export function buildDepthChart(
  day: string,
  facts: DcCategory[],
  kinds: Map<string, string>,
  attempts = DC_ATTEMPTS,
): DcAttemptResult {
  const rejects: Record<DcReject, number> = {
    ambiguous: 0,
    rival_category: 0,
    too_easy: 0,
    short: 0,
  };
  let best: { grid: DcGrid; traps: number } | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const seed = `${day}:${attempt}`;
    const picked = seededPick(facts.length, 12, seed)
      .map((i) => facts[i]!)
      .filter(Boolean);

    /* Four categories, at most two of any kind. Four "lost to X in Y"
       categories is one puzzle wearing four hats, and it is the shape
       auto-generation drifts toward because that kind is the most numerous. */
    const chosen: DcCategory[] = [];
    const perKind = new Map<string, number>();
    for (const f of picked) {
      if (chosen.length === 4) break;
      const kind = kinds.get(f.id) ?? "?";
      if ((perKind.get(kind) ?? 0) >= DC_MAX_PER_KIND) continue;
      // A category contained in another gives a group with no independent
      // identity, and guarantees ambiguity besides.
      if (chosen.some((c) => isSubset(c.members, f.members) || isSubset(f.members, c.members)))
        continue;
      chosen.push(f);
      perKind.set(kind, (perKind.get(kind) ?? 0) + 1);
    }
    if (chosen.length < 4) {
      rejects.short += 1;
      continue;
    }

    const picks = fillDisjoint(chosen, seed);
    if (picks === null) {
      rejects.short += 1;
      continue;
    }

    const tiles = seededOrder(16, `${seed}:tiles`).map((i) => picks.flat()[i]!);
    const grid: DcGrid = {
      groups: chosen.map((c, i) => ({ id: c.id, label: c.label, teamIds: picks[i]! })),
      tiles,
    };

    const verdict = validateGrid(grid, chosen, facts);
    if (!verdict.ok) {
      rejects[verdict.reject] += 1;
      continue;
    }
    /* Among fair grids, prefer the one with the most traps — that is what makes
       a puzzle feel designed rather than sampled. Keep looking a little longer
       rather than taking the first pass. */
    if (best === null || verdict.traps > best.traps) best = { grid, traps: verdict.traps };
    if (best.traps >= 6) break;
  }

  return { grid: best?.grid ?? null, traps: best?.traps ?? 0, attempts, rejects };
}

function isSubset(a: Set<number>, b: Set<number>): boolean {
  if (a.size > b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * Four members each, none shared.
 *
 * Most-constrained category first with backtracking: if the smallest category
 * has exactly four members it must take them, and the others work around it.
 * A greedy fill in draw order would fail constantly on exactly the grids worth
 * keeping.
 */
export function fillDisjoint(chosen: DcCategory[], seed: string): number[][] | null {
  const order = chosen
    .map((c, i) => ({ i, size: c.members.size }))
    .sort((a, b) => a.size - b.size || a.i - b.i);

  const used = new Set<number>();
  const picks: number[][] = Array.from({ length: chosen.length }, () => []);

  const place = (k: number): boolean => {
    if (k === order.length) return true;
    const { i } = order[k]!;
    const pool = [...chosen[i]!.members].sort((a, b) => a - b).filter((t) => !used.has(t));
    if (pool.length < 4) return false;

    const shuffled = seededOrder(pool.length, `${seed}:${i}`).map((j) => pool[j]!);
    /* One deterministic draw per category, then backtrack across CATEGORIES
       rather than across every 4-subset — the full search is combinatorial and
       a failed draw is cheap to retry from the outer loop with a new seed. */
    const take = shuffled.slice(0, 4);
    take.forEach((t) => used.add(t));
    picks[i] = take;
    if (place(k + 1)) return true;
    take.forEach((t) => used.delete(t));
    picks[i] = [];
    return false;
  };

  return place(0) ? picks : null;
}

/**
 * Materialise the fact index, then fill the queue.
 *
 * The index is rebuilt on every run rather than incrementally: a finished
 * season does not change, so the only thing that moves it is a backfill, and
 * rebuilding is both simpler and self-healing.
 */
export async function generateDepthChart(
  db: SupabaseClient,
  now: Date,
  target = QUEUE_TARGET,
): Promise<GenerateResult> {
  const days = queueDays(now, target);

  const { data: existingRows } = await db
    .from("dc_puzzles")
    .select("day")
    .gte("day", days[0]!)
    .lte("day", days[days.length - 1]!);
  const existing = new Set(((existingRows ?? []) as Array<{ day: string }>).map((r) => r.day));
  const missing = days.filter((d) => !existing.has(d));
  if (missing.length === 0) {
    return { generated: 0, daysQueued: await countQueued(db, "dc_puzzles", days[0]!) };
  }

  const deck = await fetchSalienceDeck(db);
  if (deck.length === 0) throw new Error("depth-chart: no games — has backfill-games run?");
  const schools = await schoolNames(db, deck);
  const [venues, top10] = await Promise.all([fetchVenues(db), fetchFinalTop10(db)]);

  const raw = buildFacts(deck, schools, venues, top10);
  if (raw.length < 8) {
    throw new Error(`depth-chart: only ${raw.length} usable facts — the index is too thin`);
  }
  const kinds = new Map(raw.map((f) => [`${f.kind}:${f.subject}`, f.kind]));
  const facts = raw.map((f) => toCategory(f, `${f.kind}:${f.subject}`));

  let generated = 0;
  const rejects: Record<string, number> = {};
  for (const day of missing) {
    const { grid, traps, rejects: r } = buildDepthChart(day, facts, kinds);
    for (const [k, v] of Object.entries(r)) rejects[k] = (rejects[k] ?? 0) + v;
    /* No grid is a MISSING DAY, not a bad one. An unfair board is worse than
       none, and the queue floor is what turns a run of these into a red job
       days before anybody sees the gap. */
    if (!grid) continue;

    const { error: pErr } = await db.from("dc_puzzles").insert({ day, traps });
    if (pErr) throw new Error(`depth-chart: ${day} puzzle insert failed: ${pErr.message}`);

    const { error: gErr } = await db.from("dc_puzzle_groups").insert(
      grid.groups.map((g, gidx) => ({
        day,
        gidx,
        group_id: g.id,
        label: g.label,
        team_ids: g.teamIds,
      })),
    );
    if (gErr) throw new Error(`depth-chart: ${day} groups insert failed: ${gErr.message}`);

    const { error: tErr } = await db.from("dc_puzzle_tiles").insert(
      grid.tiles.map((team_id, tidx) => ({ day, tidx, team_id })),
    );
    if (tErr) throw new Error(`depth-chart: ${day} tiles insert failed: ${tErr.message}`);
    generated += 1;
  }

  return {
    generated,
    daysQueued: await countQueued(db, "dc_puzzles", days[0]!),
    facts: facts.length,
    /* Logged, never silent: a generator that quietly produced fewer days than
       it was asked for would read as healthy right up until the queue ran out. */
    ...(generated < missing.length ? { failed: missing.length - generated, rejects } : {}),
  };
}

/** Re-exported so a caller does not have to reach into guess-game for it. */
export { fnv1a };
