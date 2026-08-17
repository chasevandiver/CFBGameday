/**
 * Build-time tier machinery. The CLASSIFICATION (`Tier`, `tierOf`,
 * `tierMatchup`) moved to `src/lib/tiers.ts` when `/edges` grew its
 * soft-market tags (F11) — the dependency runs scripts → src, never the other
 * way (src/lib/void.ts records the precedent) — and is re-exported here so the
 * backtest and preseason chain keep their import path. The pool re-levelling
 * below stays: nothing in the app reads it.
 */

import type { Tier } from "../../src/lib/tiers";

export { tierMatchup, tierOf, type Tier } from "../../src/lib/tiers";

/**
 * Re-level the two FBS pools of a preseason prior without touching anyone's
 * standing INSIDE a pool.
 *
 * Why this exists: a margin-Elo's intra-pool games are zero-sum within the
 * pool, so the level BETWEEN pools is set almost entirely by the prior, and
 * the ~1.5 cross-tier games per team per season re-level at only K/2 × error
 * per game (measured: a week-1 mis-level decays to ~0 only by week 9). Every
 * between-season regression the chain applies — 0.7× toward zero, or toward
 * talent (P4−G5 separation ~8–9) or SP+ blends (~13–16) — shrinks the pool
 * gap the replay finals carry (~16.5), and the season replay cannot restore
 * it before the early weeks are already priced. Mean-reversion is right for
 * teams WITHIN a pool; applied across pools it manufactures a
 * cross-classification lean (measured +9.8 vs the 2026 week-1 market).
 *
 * The shift is a per-pool additive constant, membership-weighted so the
 * overall FBS mean is unchanged. Within-pool matchups are unaffected by
 * construction; only cross-tier (and FBS-vs-FCS, by half the pool shift)
 * pricing moves.
 *
 * `targetGap` = gap the pools should carry (end-of-season blended gap + a
 * fitted offseason-divergence delta, fit by `backtest.ts --tune-tier-recenter`).
 */
export function recenterTierGap(
  priors: Map<number, number>,
  tierById: Map<number, Tier>,
  targetGap: number,
): Map<number, number> {
  const pools: Record<"P4" | "G5", number[]> = { P4: [], G5: [] };
  for (const [id, rating] of priors) {
    const tier = tierById.get(id);
    if (tier === "P4" || tier === "G5") pools[tier].push(rating);
  }
  if (pools.P4.length === 0 || pools.G5.length === 0) return new Map(priors);
  const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const gap = meanOf(pools.P4) - meanOf(pools.G5);
  const shortfall = targetGap - gap;
  const nP4 = pools.P4.length;
  const nG5 = pools.G5.length;
  const p4Shift = (shortfall * nG5) / (nP4 + nG5);
  const g5Shift = (-shortfall * nP4) / (nP4 + nG5);
  const out = new Map<number, number>();
  for (const [id, rating] of priors) {
    const tier = tierById.get(id);
    out.set(id, rating + (tier === "P4" ? p4Shift : tier === "G5" ? g5Shift : 0));
  }
  return out;
}

/** The measured pool gap of a rating map (P4 mean − G5 mean); null when a pool
 *  is empty or unclassified. */
export function tierGapOf(
  ratings: Map<number, number>,
  tierById: Map<number, Tier>,
): number | null {
  const pools: Record<"P4" | "G5", number[]> = { P4: [], G5: [] };
  for (const [id, rating] of ratings) {
    const tier = tierById.get(id);
    if (tier === "P4" || tier === "G5") pools[tier].push(rating);
  }
  if (pools.P4.length === 0 || pools.G5.length === 0) return null;
  const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return meanOf(pools.P4) - meanOf(pools.G5);
}
