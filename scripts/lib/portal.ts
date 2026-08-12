/**
 * Standardizing the net-portal signal (docs/SPEC.md §2.1, churn adjustment).
 *
 * `churnAdjustment` takes `netPortalPoints` already on the rating-point scale,
 * so the preseason builder has to turn "net star count" into points. It did
 * that with `stars / RMS(all schools) * 1.5`, which is a z-score with both
 * halves wrong:
 *
 *   1. WRONG POPULATION. The divisor was computed over every school appearing
 *      anywhere in the portal feed — 417 of them for 2026, of which only 138
 *      are FBS. The other 279 are FCS/D2 schools with small net movements, and
 *      they drag the spread down: the FBS-only SD is 21.6, the all-schools RMS
 *      is 16.2. A term applied to FBS teams must be scaled by FBS variation.
 *      FBS teams absent from the feed were also excluded from the pool
 *      entirely, when their true value is 0 and they belong in it.
 *
 *   2. WRONG STATISTIC. `sqrt(Σv²/n)` is RMS about zero, not a standard
 *      deviation, and nothing subtracted the mean. The 2026 mean net is −6.9
 *      stars — strongly negative, because ~22% of portal entries have not
 *      picked a destination yet, so their origin is debited and no school is
 *      credited. (That debit is correct: a player who enters the portal is
 *      gone whether or not he has signed. What is not correct is treating the
 *      resulting negative mean as if it were zero.) Uncentered, the average
 *      FBS team carried a −0.59 point portal penalty for having an average
 *      off-season.
 *
 * Together those made the term ~33% too large AND shifted, which is how Ohio
 * State — 37 players out, 17 in, almost all 3-stars — reached −5.09 and pinned
 * to the −4 clamp, alongside Florida State, Oregon, Michigan State and South
 * Alabama.
 *
 * This function fixes the standardization only. It does NOT fix the deeper
 * problem, which is that 91% of portal entries are 2- or 3-star, so the signal
 * is dominated by HEADCOUNT rather than talent: a blue blood shedding buried
 * backups scores like a catastrophe. That is a design question for
 * `--tune-churn`, not a bug, and it is recorded in docs/CHANGELOG.md rather
 * than quietly patched here.
 */

/** Population statistics for the net-portal signal, over one explicit roster. */
export interface PortalScale {
  mean: number;
  /** Standard deviation about the mean; never 0 (guards the division). */
  sd: number;
}

/**
 * Mean and SD of net portal stars across exactly the teams the adjustment will
 * be applied to. Teams with no portal activity count as 0 rather than being
 * dropped — an FBS team that neither gained nor lost anyone is a real
 * observation at the centre of the distribution, not a missing one.
 */
export function portalScale(teamIds: Iterable<number>, net: Map<number, number>): PortalScale {
  const vals = [...teamIds].map((id) => net.get(id) ?? 0);
  if (vals.length === 0) return { mean: 0, sd: 1 };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  // A degenerate population (every team identical) would divide by zero and
  // send every adjustment to ±Infinity, then to the clamp.
  return { mean, sd: sd || 1 };
}

/** Rating points per standard deviation of net portal movement. */
export const PORTAL_POINTS_PER_SD = 1.5;
/** Hard bound, matching the ±6 clamp churnAdjustment applies to the total. */
export const PORTAL_CLAMP = 4;

/**
 * Net portal stars → rating points, centred and scaled on the FBS population.
 *
 * Centred means the average off-season is worth 0, which is the only reading
 * under which this is an *adjustment*. Uncentred it was a league-wide level
 * shift plus a spread, and while a uniform shift cancels in a spread
 * (home − away), this one scaled with outflow — so it did not cancel, it
 * quietly taxed whoever lost the most players.
 */
export function portalPoints(netStars: number, scale: PortalScale): number {
  const z = (netStars - scale.mean) / scale.sd;
  const points = z * PORTAL_POINTS_PER_SD;
  return Math.min(Math.max(points, -PORTAL_CLAMP), PORTAL_CLAMP);
}
