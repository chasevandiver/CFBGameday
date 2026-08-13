/**
 * One implementation of "compute a record from a pile of wagers".
 *
 * This existed five times before this module: the season leaderboard
 * (`crew/page.tsx`), the weekly grid (`crew/week/[week]/page.tsx`), the slate's
 * crew-line records (`queries.ts`), the recap's CLV leaders
 * (`recap/[week]/page.tsx`) and the ledger's stat tiles plus reason-tag audit
 * (`ledger/page.tsx`). They disagreed in ways nobody had noticed: two counted
 * pushes and three didn't, the −110 units convention was inlined twice with a
 * magic 0.909, and only two of the five computed ROI at all.
 *
 * Five copies is also what makes the Groups work dangerous — group scoping
 * bolted onto five different tallies is five chances to scope one of them
 * wrong. So the tally moves here first, behaviour unchanged, and the group
 * filter later becomes an argument to one function instead of an edit to five.
 *
 * ## Picks and bets are both wagers
 *
 * They grade differently and that difference is the only thing this module has
 * to be careful about. A `bets` row carries `payout_units`, written by the
 * Sunday grader at the bet's real American odds. A `picks` row carries no
 * payout at all — pick'em is played at a flat −110 by League Rules #6 — so its
 * payout has to be synthesized. Pass `payoutUnits: null` and this module
 * applies the −110 convention; pass a number and it is used verbatim.
 */

/** `picks.result` / `bets.result`: ungraded, or one of four outcomes. */
export type WagerResult = "win" | "loss" | "push" | "void" | null;

/**
 * The numeric-arrival convention, pinned here once (05:N12).
 *
 * The premise this module was written on — "`numeric` columns arrive as
 * strings" — is **false** as the stack is configured: `audit/05-clv-and-grading.md`
 * §29 verified live that PostgREST answers `"spread":-3.0`, unquoted. But the
 * callers never agreed about it. `ledger/page.tsx` passes `payout_units`
 * straight off the row and `Number()`s `units` in the very next expression, so
 * one line assumed the premise was true and its neighbour assumed it was false.
 *
 * Settled in the direction that cannot break: this module is the arithmetic
 * boundary, it coerces once in `num()`, and the type now says so instead of
 * claiming a `number` the callers were not all supplying. The alternative —
 * delete `num()` and trust the types — means auditing every call site to add a
 * `Number()`, and missing one turns `units` into string concatenation silently.
 */
export type Numeric = number | string;

export interface Wager {
  result: WagerResult;
  /** Stake. `picks.units` defaults to 1; `bets.units` is user-set. */
  units: Numeric;
  /**
   * Graded payout at the wager's real odds, or null for anything graded at the
   * flat pick'em price. Null is not "zero" — it means "derive it".
   */
  payoutUnits?: Numeric | null;
  clv?: Numeric | null;
}

export interface Tally {
  wins: number;
  losses: number;
  pushes: number;
  /** wins + losses + pushes. Zero means nothing has graded yet. */
  decided: number;
  /** Net units won or lost. */
  units: number;
  /** Units at risk on decided, non-push wagers — the ROI denominator. */
  staked: number;
  /** units / staked, or null when nothing was ever at risk. */
  roi: number | null;
  /** Mean CLV over the wagers that have one. Null when none do. */
  avgClv: number | null;
  /** How many wagers backed `avgClv` — a mean of one is not a season. */
  clvCount: number;
}

/**
 * What one unit returns on a −110 win.
 *
 * The true figure is 10/11 = 0.90909…; 0.909 is what shipped, and every unit
 * total on the site to date was computed with it. Tightening it here would
 * silently restate historical leaderboards for a difference of nine
 * ten-thousandths of a unit, so the shipped value stands. Change it only
 * deliberately, and say so in the changelog when you do.
 */
export const PICKEM_WIN_PAYOUT = 0.909;

/** The one coercion point. See the `Numeric` note above for why it stays. */
const num = (v: Numeric | null | undefined): number => Number(v ?? 0);

/** Graded payout: the real one when a wager has it, the −110 one otherwise. */
function payoutOf(w: Wager): number {
  if (w.payoutUnits !== null && w.payoutUnits !== undefined) return num(w.payoutUnits);
  if (w.result === "win") return num(w.units) * PICKEM_WIN_PAYOUT;
  if (w.result === "loss") return -num(w.units);
  return 0;
}

/** True for wagers that count: graded, and not voided. */
export function isDecided(w: Wager): boolean {
  return w.result === "win" || w.result === "loss" || w.result === "push";
}

export const EMPTY_TALLY: Tally = {
  wins: 0,
  losses: 0,
  pushes: 0,
  decided: 0,
  units: 0,
  staked: 0,
  roi: null,
  avgClv: null,
  clvCount: 0,
};

/**
 * Fold wagers into a record. Ungraded and voided wagers are skipped entirely —
 * League Rule #4, push is no action and a void never happened.
 */
export function tally(wagers: Iterable<Wager>): Tally {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let units = 0;
  let staked = 0;
  let clvSum = 0;
  let clvCount = 0;

  for (const w of wagers) {
    if (!isDecided(w)) continue;
    if (w.result === "win") wins += 1;
    else if (w.result === "loss") losses += 1;
    else pushes += 1;

    units += payoutOf(w);
    if (w.result !== "push") staked += num(w.units);

    if (w.clv !== null && w.clv !== undefined) {
      clvSum += num(w.clv);
      clvCount += 1;
    }
  }

  return {
    wins,
    losses,
    pushes,
    decided: wins + losses + pushes,
    units,
    staked,
    roi: staked > 0 ? units / staked : null,
    avgClv: clvCount > 0 ? clvSum / clvCount : null,
    clvCount,
  };
}

/** Group wagers by a key, then tally each group. Keys with no wagers are absent. */
export function tallyBy<T extends Wager, K>(
  wagers: Iterable<T>,
  keyOf: (w: T) => K,
): Map<K, Tally> {
  const buckets = new Map<K, T[]>();
  for (const w of wagers) {
    const k = keyOf(w);
    const arr = buckets.get(k);
    if (arr) arr.push(w);
    else buckets.set(k, [w]);
  }
  const out = new Map<K, Tally>();
  for (const [k, arr] of buckets) out.set(k, tally(arr));
  return out;
}

/**
 * Cumulative units, wager by wager, in the order given.
 *
 * The caller sorts — oldest-first for a season curve — because "in order" means
 * `placed_at` for a bet and kickoff for a pick, and this module has neither.
 * Undecided and voided wagers contribute nothing but are still dropped rather
 * than plotted flat, so the curve has one point per settled wager.
 */
export function cumulativeUnits(wagers: Iterable<Wager>): number[] {
  const out: number[] = [];
  let running = 0;
  for (const w of wagers) {
    if (!isDecided(w)) continue;
    running += payoutOf(w);
    out.push(running);
  }
  return out;
}

/**
 * League Rules #5: leaderboard sorts on units, tie-broken by ROI, then average
 * CLV. Nulls sort last in both tiebreaks — a player with no priced wagers does
 * not leapfrog one with a measured edge.
 *
 * Pass to `Array.prototype.sort` directly: `rows.sort(byLeagueRules)`.
 */
export function byLeagueRules(a: Tally, b: Tally): number {
  return (
    b.units - a.units ||
    (b.roi ?? -Infinity) - (a.roi ?? -Infinity) ||
    (b.avgClv ?? -Infinity) - (a.avgClv ?? -Infinity)
  );
}

/** "12-7-1", or "12-7" when nothing pushed. The push is information, not noise. */
export function formatRecord(t: Tally): string {
  return t.pushes > 0
    ? `${t.wins}-${t.losses}-${t.pushes}`
    : `${t.wins}-${t.losses}`;
}
