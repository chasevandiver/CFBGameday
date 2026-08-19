/**
 * Era boundaries for the wide backtest window (2015–2025).
 *
 * These exist because of Q8's complaint, generalised. `returningProdWeight`
 * and `talentReloadStrength` were fitted against an input distribution that
 * the Aug 12 portal fix destroyed, and STATUS records the honest consequence:
 * both are "fitted on something that no longer exists". A parameter pooled
 * over eleven seasons has the same defect at larger scale — college football
 * in 2015 had no transfer portal, no NIL, no one-time-transfer exception, an
 * intact Pac-12 and a four-team playoff.
 *
 * The boundaries are drawn on RULE CHANGES, not on the data, and they are
 * fixed in this file BEFORE any wide-window number is printed. That ordering
 * is the whole point: a boundary chosen after seeing a result is a free
 * parameter, and this repo has already learned what unearned free parameters
 * do (five of them ran to a grid edge).
 *
 * 2020 is deliberately not an era. It is a hole — see `isChainOnly`.
 */

export type EraId = "E1" | "E2" | "E3" | "E4";

export interface Era {
  id: EraId;
  seasons: readonly number[];
  /** Why the boundary is HERE. Fixed before any result was seen. */
  reason: string;
}

/**
 * Ascending, contiguous apart from 2020, and covering 2015–2025 exactly.
 * Extending the window past 2025 means adding a season to E4 or opening E5 —
 * and if a rule change motivates E5, that is a code change with a reason
 * string, which is the intended friction.
 */
export const ERAS: readonly Era[] = [
  {
    id: "E1",
    seasons: [2015, 2016, 2017],
    reason: "pre-portal: no transfer portal, no NIL, four-team playoff",
  },
  {
    id: "E2",
    seasons: [2018, 2019],
    reason:
      "transfer portal opens (Oct 2018) but the one-time-transfer exception does not yet exist, " +
      "so movement is real and still gated by the sit-out year",
  },
  {
    id: "E3",
    seasons: [2021, 2022, 2023],
    reason:
      "one-time-transfer exception and NIL both arrive in 2021; Pac-12 still intact; " +
      "four-team playoff",
  },
  {
    id: "E4",
    seasons: [2024, 2025],
    reason: "realignment complete, Pac-12 collapsed, twelve-team playoff",
  },
];

/**
 * COVID. Empty stadiums collapse home-field advantage league-wide, the Pac-12
 * played no non-conference games at all and the Big Ten played a conference-only
 * nine-game slate — so the cross-classification structure `--diagnose-tiers`
 * and `--tune-tier-recenter` are built on barely exists that year.
 *
 * Chain-only: replayed so the prior chain into 2021 is built the same way every
 * other season's prior is built, and excluded from every scored sample. This is
 * exactly the treatment the bootstrap season already gets, for a different
 * reason.
 *
 * Dropping it outright was considered and rejected: it would leave 2021's prior
 * chained off 2019 finals across a two-year gap, and the chain's regression
 * constants (0.7x toward the mean) are calibrated on a one-year step.
 */
export const COVID_SEASON = 2020;

export function isChainOnly(season: number): boolean {
  return season === COVID_SEASON;
}

export function eraOf(season: number): Era | null {
  return ERAS.find((e) => e.seasons.includes(season)) ?? null;
}

/** Group scored seasons by era, dropping eras the window does not reach. */
export function erasIn(seasons: readonly number[]): Array<{ era: Era; seasons: number[] }> {
  return ERAS.map((era) => ({
    era,
    seasons: seasons.filter((s) => era.seasons.includes(s)),
  })).filter((g) => g.seasons.length > 0);
}

/**
 * The most recent era present in a window. `--tune-*` uses this for the
 * recency-dominance rule: a parameter pooled over eleven years must not be
 * WORSE than the incumbent on the seasons most like next season, or it is
 * fitted on a sport that no longer exists.
 */
export function latestEraIn(seasons: readonly number[]): Era | null {
  const groups = erasIn(seasons);
  return groups.length === 0 ? null : groups[groups.length - 1].era;
}

/**
 * Do per-era argmins agree closely enough to call a pooled fit real?
 *
 * `gridStep` is the tuner's own spacing, so "within one step" means the eras
 * disagree by less than the grid can resolve. Anything wider and the pooled
 * winner is an average of eras that want different values — which is a
 * finding ("this parameter is era-dependent"), not a parameter.
 */
export function eraFlip(
  argminByEra: Array<{ era: EraId; argmin: number }>,
  gridStep: number,
): { agree: boolean; spread: number } {
  if (argminByEra.length < 2) return { agree: true, spread: 0 };
  const values = argminByEra.map((a) => a.argmin);
  const spread = Math.max(...values) - Math.min(...values);
  return { agree: spread <= gridStep + 1e-9, spread };
}
