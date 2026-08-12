/**
 * P4/G5 tier classification for the signed-error-by-slice diagnostics
 * (audit 03:M-3). Diagnostic-only: nothing in the model or the pricing path
 * reads a tier — this exists so the backtest can SEE a cross-classification
 * lean, which pooled MAE/σ/NLL are structurally blind to (they are symmetric,
 * and cross-tier games are a minority of the sample).
 *
 * The mapping is by conference NAME as CFBD spells it on /games, per season:
 *  - 2023: ACC, Big 12, Big Ten, Pac-12, SEC are power conferences.
 *  - 2024+: the Pac-12's two leftover teams (Oregon State, Washington State)
 *    play a G5-shaped schedule and are priced like G5 by the market, so the
 *    Pac-12 classifies G5 from 2024 on. That is a diagnostic judgment call,
 *    recorded here; two teams cannot swing the cross-tier aggregate either way.
 *  - Independents: Notre Dame is P4 (schedule and market treatment); every
 *    other independent (UConn, UMass, Army pre-AAC) is G5.
 */

const P4_CONFERENCES = new Set(["ACC", "Big 12", "Big Ten", "SEC"]);
const P4_INDEPENDENTS = new Set(["Notre Dame"]);

export type Tier = "P4" | "G5" | "FCS" | "unknown";

export function tierOf(
  conference: string | null | undefined,
  school: string,
  season: number,
  /** false = the team had no FBS rating (an FCS opponent in the replay) */
  isFbs = true,
): Tier {
  if (!isFbs) return "FCS";
  if (conference === undefined || conference === null) {
    // /games spells it "FBS Independents"; team rows say "FBS Independents"
    // too, so a bare null means the cached payload predates the field.
    return "unknown";
  }
  if (conference === "Pac-12" && season <= 2023) return "P4";
  if (P4_CONFERENCES.has(conference)) return "P4";
  if (conference === "FBS Independents") {
    return P4_INDEPENDENTS.has(school) ? "P4" : "G5";
  }
  return "G5";
}

/** Label for a game between two FBS tiers, order-independent. */
export function tierMatchup(home: Tier, away: Tier): string {
  if (home === "unknown" || away === "unknown") return "unknown";
  if (home === "FCS" || away === "FCS") return "FBS vs FCS";
  if (home === away) return `${home} vs ${home}`;
  return "cross-tier";
}

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
