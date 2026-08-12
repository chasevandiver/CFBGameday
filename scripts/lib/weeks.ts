/**
 * Week 0 is a real week. CFBD does not always say so.
 *
 * The last Saturday of August is Week 0 — a handful of games, usually one
 * marquee neutral-site opener, and it is the day this product's mission
 * statement starts ("Week 0 through the National Championship", SPEC §249,
 * which names Aug 29 as Week 0 and Sep 5 as Week 1). CFBD's 2026 feed labels
 * both of them `week: 1`: 99 games spread across Aug 29 → Sep 7, ten days and
 * two distinct Saturdays in one bucket.
 *
 * Everything downstream keys on `week` — the slate selector, the group boards,
 * the freeze, receipts, recap — so a merged week is not a cosmetic problem. It
 * puts the Georgia opener on the same slate as games played a week earlier,
 * gives that slate seven day-tabs, and asks one freeze to price both Saturdays.
 * `freezeJob` already carries a per-game horizon specifically to survive this
 * (jobs-core.ts:1033-1042); that workaround stays correct and stops being load-
 * bearing once the weeks are actually separate.
 *
 * The split is derived from the kickoffs rather than hardcoded to 2026, and it
 * is deliberately conservative: it fires only on the shape that cannot be a
 * normal week.
 *
 *   1. Only regular-season week 1. Week 0 is the only week CFBD merges, and
 *      inventing a `week - 1` anywhere else would collide with real weeks.
 *   2. Only when the kickoffs span more than `SPAN_DAYS`. A normal week runs
 *      Tuesday to Sunday — about six days. Ten is not a week.
 *   3. Split at the largest gap between consecutive kickoffs, and only if that
 *      gap is at least `MIN_GAP_DAYS`. Two Saturdays are separated by a real
 *      hole in the schedule; if there is no hole, there is no clean seam and
 *      this does nothing rather than guess.
 *
 * When CFBD labels Week 0 properly — as it has in other seasons — rule 2 never
 * fires and this is a no-op.
 */

const DAY_MS = 86_400_000;

/** A normal week spans ~6 days (Tue night → Sun night). More than 8 is two weekends. */
export const SPAN_DAYS = 8;
/** The quiet stretch between Week 0 and Week 1. Sunday–Wednesday, at least. */
export const MIN_GAP_DAYS = 2;

export interface SchedulableGame {
  id: number;
  week: number;
  seasonType: string;
  /** ISO kickoff. Null (TBD) games cannot be placed and are left where CFBD put them. */
  startDate: string | null;
}

/**
 * The subset of `games` that belong to Week 0, as ids. Empty whenever the feed
 * is already correct, which is the common case.
 */
export function weekZeroIds(games: readonly SchedulableGame[]): Set<number> {
  const empty = new Set<number>();

  const wk1 = games
    .filter((g) => g.seasonType === "regular" && g.week === 1 && g.startDate !== null)
    .map((g) => ({ id: g.id, t: Date.parse(g.startDate as string) }))
    .filter((g) => Number.isFinite(g.t))
    .sort((a, b) => a.t - b.t);

  if (wk1.length < 2) return empty;
  if ((wk1[wk1.length - 1].t - wk1[0].t) / DAY_MS <= SPAN_DAYS) return empty;

  let gapAt = -1;
  let gapSize = 0;
  for (let i = 1; i < wk1.length; i++) {
    const gap = wk1[i].t - wk1[i - 1].t;
    if (gap > gapSize) {
      gapSize = gap;
      gapAt = i;
    }
  }
  if (gapAt < 1 || gapSize / DAY_MS < MIN_GAP_DAYS) return empty;

  return new Set(wk1.slice(0, gapAt).map((g) => g.id));
}

/**
 * `week` as it should be stored, given the split. Everything not in Week 0 keeps
 * the number CFBD gave it, so this is safe to apply to every row unconditionally.
 */
export function resolvedWeek(game: SchedulableGame, weekZero: ReadonlySet<number>): number {
  return weekZero.has(game.id) ? 0 : game.week;
}
