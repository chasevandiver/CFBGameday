/**
 * The arcade's reads (R3-E3) — the IO half of `arcade.ts` and `trophies.ts`,
 * both of which stay pure and unit-tested.
 *
 * ## Scope is a product filter, not a boundary
 *
 * Same sentence `games-scope.ts` carries: RLS already decides what a viewer
 * may read (own rows always, others' once the game reveals). `roster.userIds`
 * narrows a readable set to the people you care about, and `null` means
 * everyone and takes the unfiltered path.
 *
 * ## Why the trophy shelf is yours alone
 *
 * `gtg_guesses` is own-rows-only under RLS (0059) — the leaderboard reaches
 * other people's Guess the Game results exclusively through the aggregates in
 * `gtg_leaderboard()`, which deliberately never expose per-day attempts. So
 * Ice Cold ("solved on the first guess") is underivable for anyone but the
 * viewer, and a shelf rendered for someone else would be **silently
 * incomplete** — a badge they earned quietly failing to appear, which is
 * worse than no shelf at all. Trophies are therefore the viewer's own; the
 * comparative surface is the standings. Crew-wide trophies would need a
 * definer aggregate over `gtg_guesses` — a migration, and one to take only if
 * anybody actually asks.
 *
 * ## `weeksPlayed`, and the one gap in it
 *
 * Weeks are counted from the dated rows the viewer can actually see: streak
 * pick days, and the `created_at` of line guesses and six-pack entries. Guess
 * the Game contributes no readable date for other members (above), so its
 * days would vanish from the denominator — which would flatter a
 * GtG-only player's rate. `gtg_leaderboard()`'s `played` count closes it: you
 * cannot fit twenty daily puzzles into one week, so `ceil(played / 7)` is a
 * true lower bound on weeks and the denominator takes the larger of the two.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { arcadeStandings, type ArcadeInputs, type ArcadeRow } from "./arcade";
import type { ScopeRoster } from "./games-scope";
import { entryScore, type EntryScore, type SixPackResult } from "./six-pack";
import { productDate, type StreakPickLike } from "./streak";
import { earnedTrophies, EMPTY_CTX, type Trophy } from "./trophies";

export interface ArcadeData {
  standings: ArcadeRow[];
  /** The viewer's own shelf — see the header for why it is not everyone's. */
  trophies: Trophy[];
}

/** The Monday of a YYYY-MM-DD product day, as the week's key. */
export function weekKey(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t)) return day;
  const d = new Date(t);
  // getUTCDay: 0 = Sunday. Monday-anchored, so a Sunday belongs to the week
  // that just ended rather than opening a new one mid-slate.
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(t - back * 86_400_000).toISOString().slice(0, 10);
}

const push = <T,>(map: Map<string, T[]>, key: string, value: T) => {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
};

const addDay = (map: Map<string, Set<string>>, key: string, day: string) => {
  const set = map.get(key);
  if (set) set.add(day);
  else map.set(key, new Set([day]));
};

/**
 * Everything the arcade needs, for one pool.
 *
 * Every member of the roster comes back with a row, including the ones who
 * have never played — `arcadeStandings` refuses a participation floor, and a
 * board that drops the people who have not started is how a standing stops
 * being a roster.
 */
export async function fetchArcade(
  supabase: SupabaseClient,
  roster: ScopeRoster,
  viewerId: string | null,
): Promise<ArcadeData> {
  const { userIds, nameById } = roster;
  // The scope filter, applied query-side when there is one. Written out per
  // query rather than through a generic helper: PostgREST's builder types are
  // deep enough that wrapping them costs more than it saves.
  const streakQ = supabase.from("streak_picks").select("user_id, day, result");
  const linesQ = supabase.from("line_guesses").select("user_id, abs_error, created_at");
  // A deploy that outran migration 0062 comes back as an error with null
  // data, which reads as "nobody has entered a six-pack" — the honest
  // degradation the hub already takes.
  const sixQ = supabase
    .from("six_pack_entries")
    .select("user_id, slate_id, idx, result, created_at");

  const [streakRes, linesRes, sixPackRes, gtgBoardRes, myGtgRes] = await Promise.all([
    userIds === null ? streakQ : streakQ.in("user_id", userIds),
    userIds === null ? linesQ : linesQ.in("user_id", userIds),
    userIds === null ? sixQ : sixQ.in("user_id", userIds),
    // `gtg_leaderboard()` is granted to authenticated only, and its `points`
    // column is the single definition of Guess the Game scoring — there is no
    // attempts arithmetic anywhere in TS.
    viewerId ? supabase.rpc("gtg_leaderboard") : Promise.resolve({ data: [] }),
    // Own rows only, by RLS and by design: the trophy shelf is the viewer's.
    viewerId
      ? supabase.from("gtg_guesses").select("day, attempts, solved_at").eq("user_id", viewerId)
      : Promise.resolve({ data: [] }),
  ]);

  const inScope = (id: string) => userIds === null || nameById.has(id);

  const streak = new Map<string, StreakPickLike[]>();
  const activeDays = new Map<string, Set<string>>();
  for (const p of (streakRes.data ?? []) as Array<{
    user_id: string;
    day: string;
    result: StreakPickLike["result"];
  }>) {
    if (!inScope(p.user_id)) continue;
    push(streak, p.user_id, { day: p.day, result: p.result });
    addDay(activeDays, p.user_id, p.day);
  }

  const lines = new Map<string, number[]>();
  for (const g of (linesRes.data ?? []) as Array<{
    user_id: string;
    abs_error: number | string | null;
    created_at: string;
  }>) {
    if (!inScope(g.user_id)) continue;
    addDay(activeDays, g.user_id, productDate(new Date(g.created_at)));
    if (g.abs_error !== null) push(lines, g.user_id, Number(g.abs_error));
  }

  // Six-pack entries group into weeks, and each week folds through
  // `entryScore` — the void accounting (a postponement drops out of both the
  // numerator and the perfect bar) has one definition and it lives there.
  const bySlate = new Map<string, Map<number, Array<{ idx: number; result: SixPackResult | null }>>>();
  for (const e of (sixPackRes.data ?? []) as Array<{
    user_id: string;
    slate_id: number;
    idx: number;
    result: SixPackResult | null;
    created_at: string;
  }>) {
    if (!inScope(e.user_id)) continue;
    addDay(activeDays, e.user_id, productDate(new Date(e.created_at)));
    const slates = bySlate.get(e.user_id) ?? new Map();
    const rows = slates.get(e.slate_id) ?? [];
    rows.push({ idx: e.idx, result: e.result });
    slates.set(e.slate_id, rows);
    bySlate.set(e.user_id, slates);
  }
  const sixPackWeeks = new Map<string, EntryScore[]>();
  for (const [uid, slates] of bySlate) {
    sixPackWeeks.set(
      uid,
      [...slates.values()].map((rows) =>
        entryScore(rows.map((r) => ({ idx: r.idx, choice: "", result: r.result }))),
      ),
    );
  }

  const gtgPoints = new Map<string, number>();
  const gtgPlayed = new Map<string, number>();
  for (const r of (gtgBoardRes.data ?? []) as Array<{
    user_id: string;
    points: number;
    played: number;
  }>) {
    if (!inScope(r.user_id)) continue;
    gtgPoints.set(r.user_id, r.points);
    gtgPlayed.set(r.user_id, r.played);
  }

  const weeksPlayed = new Map<string, number>();
  for (const uid of nameById.keys()) {
    const weeks = new Set([...(activeDays.get(uid) ?? [])].map(weekKey));
    // The GtG floor — see the header.
    weeksPlayed.set(uid, Math.max(weeks.size, Math.ceil((gtgPlayed.get(uid) ?? 0) / 7)));
  }

  const inputs: ArcadeInputs = {
    streak,
    gtgPoints,
    lines,
    sixPack: new Map(
      [...sixPackWeeks].map(([uid, weeks]) => [
        uid,
        weeks.map((w) => ({ correct: w.correct, perfect: w.perfect })),
      ]),
    ),
    weeksPlayed,
  };

  const members = [...nameById].map(([userId, name]) => ({ userId, name }));

  const myGtg = (myGtgRes.data ?? []) as Array<{
    day: string;
    attempts: number;
    solved_at: string | null;
  }>;
  const myDays = new Set(activeDays.get(viewerId ?? "") ?? []);
  for (const d of myGtg) myDays.add(d.day);

  return {
    standings: arcadeStandings(members, inputs),
    trophies:
      viewerId === null
        ? []
        : earnedTrophies({
            ...EMPTY_CTX,
            streak: streak.get(viewerId) ?? [],
            lineErrors: lines.get(viewerId) ?? [],
            gtgSolves: myGtg.filter((d) => d.solved_at !== null).map((d) => d.attempts),
            sixPack: sixPackWeeks.get(viewerId) ?? [],
            activeDays: [...myDays].sort(),
          }),
  };
}
