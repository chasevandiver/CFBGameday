/**
 * Roster-talent baseline from recruiting classes (`/recruiting/teams`) — the
 * substitute source for the `/talent` composite.
 *
 * `/talent` is a DERIVED file: CFBD computes the 247-style roster composite
 * from recruiting ratings and publishes it on its own schedule, with no
 * commitment about when (in 2026 it was still absent in mid-August while the
 * classes it is built from had been signed since February). The season gate
 * (docs/STATUS.md §2.6) already probes `/recruiting/teams` as "the composite's
 * raw material, and the substitute if the composite never lands" — this module
 * is that substitute, built rather than merely probed.
 *
 * Construction, fixed before any tuner run so the tuner judges ONE definition
 * rather than shopping among several:
 *
 *  - A roster is approximated by its trailing FOUR classes (season, season−1,
 *    season−2, season−3) — freshmen through seniors, the same population the
 *    composite approximates. Equal weights: a per-class weighting would be an
 *    unidentified parameter at this sample size, the exact defect
 *    `--tune-churn` documented.
 *  - A class with a null `points` is skipped; a team needs at least TWO of the
 *    four classes to get a number at all, otherwise it is absent and the
 *    caller's existing fallback (conference mean in `build-preseason.ts`,
 *    league −8 in the backtest chains) applies. Roster points are the mean of
 *    the available classes × 4, so a team with three ranked classes is not
 *    scored as though it signed nobody in the fourth.
 *  - The scale transform is the composite's exactly — z-score × 5.5, clamped
 *    ±18 — so downstream consumers (`talentWeight` 0.3, `talentReloadStrength`)
 *    see the same units. One deliberate difference: the z is computed over the
 *    FBS population the caller passes, not over whatever the feed returned.
 *    The composite feed changed shape mid-window (FBS+FCS through 2023,
 *    FBS-only from 2024 — BT-6), and a z over a shifting population moves every
 *    team's baseline for reasons that have nothing to do with talent. The
 *    substitute does not inherit that defect.
 *
 * What this deliberately cannot see: the portal. A recruiting-class sum is the
 * roster a team SIGNED, not the roster it fields, and portal movement is the
 * gap between the two. The model carries a separate portal term (`portalNet`
 * in `build-preseason.ts`), and how much the remaining gap costs is precisely
 * what `backtest.ts --tune-talent-source` measures rather than assumes.
 */

export interface RecruitingClassRow {
  year: number;
  team: string;
  points: number | null;
}

/** Classes a roster carries: season, season−1, season−2, season−3. */
export const ROSTER_CLASSES = 4;

/** Fewest ranked classes that still make a defensible roster estimate. */
export const MIN_CLASSES = 2;

/** One year's class points per school, nulls dropped. */
export function classPointsByTeam(rows: readonly RecruitingClassRow[]): Map<string, number> {
  const points = new Map<string, number>();
  for (const r of rows) {
    if (r.points !== null) points.set(r.team, r.points);
  }
  return points;
}

/**
 * Trailing-class roster points per school for one season: mean of the
 * available classes × ROSTER_CLASSES, absent under MIN_CLASSES.
 */
export function rosterClassPoints(
  byYear: ReadonlyMap<number, ReadonlyMap<string, number>>,
  season: number,
): Map<string, number> {
  const perTeam = new Map<string, number[]>();
  for (let y = season - ROSTER_CLASSES + 1; y <= season; y++) {
    const cls = byYear.get(y);
    if (!cls) continue;
    for (const [team, points] of cls) {
      const xs = perTeam.get(team) ?? [];
      xs.push(points);
      perTeam.set(team, xs);
    }
  }
  const roster = new Map<string, number>();
  for (const [team, xs] of perTeam) {
    if (xs.length < MIN_CLASSES) continue;
    const meanPoints = xs.reduce((a, b) => a + b, 0) / xs.length;
    roster.set(team, meanPoints * ROSTER_CLASSES);
  }
  return roster;
}

/**
 * The composite's scale transform — z × 5.5, clamped ±18 — computed over the
 * FBS ids in `pool` only (see the module note on why the population is pinned
 * rather than inherited from the feed). Returns empty when fewer than 20 pool
 * teams match or the spread is degenerate: a baseline nobody can stand on is
 * worse than an absent one, because absence routes to the existing fallbacks.
 */
export function scaleToTalentPoints(
  pointsByTeam: ReadonlyMap<string, number>,
  idsByName: ReadonlyMap<string, number>,
  pool: ReadonlySet<number>,
): Map<number, number> {
  const matched: Array<[number, number]> = [];
  for (const [team, points] of pointsByTeam) {
    const id = idsByName.get(team);
    if (id !== undefined && pool.has(id)) matched.push([id, points]);
  }
  if (matched.length < 20) return new Map();
  const vals = matched.map(([, p]) => p);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const std = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
  if (std === 0) return new Map();
  const out = new Map<number, number>();
  for (const [id, p] of matched) {
    out.set(id, Math.max(-18, Math.min(18, ((p - mean) / std) * 5.5)));
  }
  return out;
}
