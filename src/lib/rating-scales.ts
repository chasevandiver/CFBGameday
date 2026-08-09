/**
 * What a rating number means.
 *
 * "FPI 12.4" is not information. A rating needs three things a bare figure
 * lacks: what it measures, what the scale is, and where this team sits in the
 * field. Until now the first two lived only in `title=` tooltips on
 * `/ratings` and `/team/[id]` — unreachable on a mobile-only product — and the
 * third existed nowhere at all.
 *
 * The awkward fact this registry exists to hold: our model, SP+ and FPI are
 * all "points better than an average FBS team on a neutral field" and are
 * directly comparable, while Elo is on a ~1200–2200 scale and is not. That
 * conversion (25 Elo ≈ 1 point) was duplicated inline on the game page and the
 * game card; it belongs here, once, next to the reason it is needed.
 */

export type RatingSystem = "model" | "sp" | "fpi" | "elo" | "returning";

export interface RatingScale {
  /** Column and label text, e.g. "SP+". */
  label: string;
  /** What it measures, in one phrase. Rendered, not hidden in a tooltip. */
  blurb: string;
  /** Unit suffix for the value, or null when the number is unitless. */
  unit: string | null;
  /** Roughly the range that covers the FBS field, for the percentile meter. */
  range: { min: number; max: number };
  /** Format a raw stored value for display. */
  format: (v: number) => string;
  /**
   * Convert to points-vs-average so systems can be compared. Null for scales
   * that have no honest conversion.
   */
  toPoints: ((v: number) => number) | null;
}

/** Elo points per scoring point. The game page's footnote, made executable. */
export const ELO_PER_POINT = 25;

const signed = (digits: number) => (v: number) =>
  `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;

export const RATING_SCALES: Record<RatingSystem, RatingScale> = {
  model: {
    label: "Rating",
    blurb: "points vs an average FBS team, neutral field",
    unit: "pts",
    range: { min: -35, max: 30 },
    format: signed(1),
    toPoints: (v) => v,
  },
  sp: {
    label: "SP+",
    blurb: "points vs an average FBS team, neutral field",
    unit: "pts",
    range: { min: -35, max: 30 },
    format: signed(1),
    toPoints: (v) => v,
  },
  fpi: {
    label: "FPI",
    blurb: "points vs an average FBS team, neutral field",
    unit: "pts",
    range: { min: -35, max: 30 },
    format: signed(1),
    toPoints: (v) => v,
  },
  elo: {
    label: "Elo",
    blurb: `rating points — about ${ELO_PER_POINT} to a scoring point`,
    unit: null,
    // Elo has no zero-is-average convention, so it is the one system whose
    // number cannot be read as a margin without converting first.
    range: { min: 1150, max: 2100 },
    format: (v) => String(Math.round(v)),
    toPoints: (v) => (v - 1500) / ELO_PER_POINT,
  },
  returning: {
    label: "Returning",
    blurb: "share of last year's production back, FBS average about 60%",
    unit: "%",
    range: { min: 0.2, max: 0.95 },
    format: (v) => `${Math.round(v * 100)}%`,
    toPoints: null,
  },
};

/** "+12.4 pts" — the value with its unit, ready to render. */
export function formatRating(system: RatingSystem, value: number): string {
  const s = RATING_SCALES[system];
  return s.unit === null || s.unit === "%" ? s.format(value) : `${s.format(value)} ${s.unit}`;
}

/**
 * A margin between two teams on one system, in scoring points.
 *
 * Elo differences have to be divided down first; everything else is already
 * in points. Returns null for scales with no points conversion.
 */
export function systemMargin(
  system: RatingSystem,
  home: number | null,
  away: number | null,
): number | null {
  const to = RATING_SCALES[system].toPoints;
  if (to === null || home === null || away === null) return null;
  return to(away) - to(home);
}
