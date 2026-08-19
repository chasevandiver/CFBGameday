/**
 * Which season's talent file the live preseason ratings were built on.
 *
 * `build-preseason` falls back to SEASON−1 when CFBD has not published the
 * current year's talent composite, and that fallback is silent by design — the
 * build still produces a complete, confident-looking board. The `--check` gate
 * is what normally stops a fallback build from loading, but Q1 (docs/STATUS.md
 * §3) makes shipping one a legitimate choice when the alternative is opening
 * the season on a rating four versions behind.
 *
 * A deliberate degradation still has to be visible in the product, not just in
 * a workflow log nobody opens. So the build stamps every
 * `preseason_components.detail` with `talent_source` and `talent_stale`, and
 * `/model` renders a note off this function.
 *
 * **Only ever renders the affirmative.** Rows written before the stamp existed
 * (production's 2026.2.0 build, every backfill) carry neither field, and that
 * has to read as "unknown", never as "fresh" — claiming a rating is current
 * because a row is silent is the same defect as `emptyIsHealthy`. So `stale`
 * is true only when a row says so.
 */

export interface TalentProvenance {
  /** At least one loaded team was rated off a previous season's talent file. */
  stale: boolean;
  /** The season that file came from, when the rows say. */
  source: number | null;
  /** How many teams carry the stale stamp — a partial count is its own signal. */
  teams: number;
  /**
   * At least one loaded team was rated off the recruiting-class substitute
   * (`talent_kind: "recruiting"`, built when the composite is unpublished but
   * the classes are in — see scripts/lib/recruiting-talent.ts). Current-season
   * data, so not "stale", but a different construction than the composite the
   * model was tuned on, and that has to be visible in the product. Affirmative
   * only, like `stale`: rows without the stamp say nothing.
   */
  substitute: boolean;
  substituteTeams: number;
}

export function talentProvenance(rows: Array<{ detail: unknown }>): TalentProvenance {
  let teams = 0;
  let substituteTeams = 0;
  let source: number | null = null;

  for (const row of rows) {
    const detail = row.detail;
    if (typeof detail !== "object" || detail === null) continue;
    const d = detail as Record<string, unknown>;
    if (d.talent_kind === "recruiting") substituteTeams++;
    if (d.talent_stale !== true) continue;
    teams++;
    // First stamped source wins. One build writes one value to every row, so a
    // disagreement means two builds are mixed in the table — reporting the
    // first is no worse than reporting the last, and the count is what would
    // give that away.
    if (source === null && typeof d.talent_source === "number") source = d.talent_source;
  }

  return {
    stale: teams > 0,
    source,
    teams,
    substitute: substituteTeams > 0,
    substituteTeams,
  };
}
