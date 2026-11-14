/**
 * The college basketball model's record, as its own feed reports it (CBB-16).
 *
 * Nothing here is graded by this app. The cbbmodel repo grades its own picks
 * against its own pick-time line with its own rule (a bet when the model beats
 * the line by more than half a point) and publishes the result; this module
 * only reduces that feed to the one row the slate and the stats page read
 * (`cbb_model_stats`, 0087). Recomputing the record here from `predictions`
 * would produce a second number that disagreed with the model's own dashboard
 * by a game or two for reasons nobody could explain.
 *
 * Pure. The sync job fetches; the app reads the stored row.
 */

export interface Wl {
  w: number;
  l: number;
  p: number;
}

export type ConfidenceTier = "high" | "medium" | "low";

export interface CbbModelStats {
  modelVersion: string | null;
  /** When the feed these numbers came from was written. */
  generatedAt: string;
  seasonLabel: string;
  /** Every bet the model's rule made this season, against the spread. */
  ats: Wl;
  /** Straight-up winners. */
  su: { correct: number; total: number };
  byConfidence: Record<ConfidenceTier, Wl>;
  bestBets: Wl;
  valuePlays: Wl;
  /** ATS by the size of the model's disagreement with the line, in points. */
  byEdge: Array<{ bucket: string } & Wl>;
  clv: { n: number; avg: number | null; beatClosePct: number | null } | null;
  /** ATS by slate date, newest first, the most recent 14 days with a result. */
  days: Array<{ date: string } & Wl>;
}

/** The subset of the feed's index.json this reads. */
export interface FeedIndex {
  season_label: string;
  generated_at: string;
  model: { version: string | null };
  files: { season: string };
  summary: {
    ats?: Partial<Wl>;
    su?: { correct?: number; total?: number };
    by_confidence?: Partial<Record<ConfidenceTier, Partial<Wl>>>;
    best_bets?: Partial<Wl>;
    value_plays?: Partial<Wl>;
    clv?: { n?: number; avg?: number | null; beat_close_pct?: number | null };
    calibration?: { ats_by_edge?: Record<string, { w?: number; l?: number }> };
  };
}

/** The subset of a season-file record this reads. */
export interface FeedGradedRecord {
  slate_date: string;
  result: { ats: "W" | "L" | "P" | null } | null;
}

const wl = (v: Partial<Wl> | undefined): Wl => ({ w: v?.w ?? 0, l: v?.l ?? 0, p: v?.p ?? 0 });

export const DAYS_KEPT = 14;

export function buildCbbModelStats(index: FeedIndex, records: FeedGradedRecord[]): CbbModelStats {
  const s = index.summary;
  const byDate = new Map<string, Wl>();
  for (const r of records) {
    const g = r.result?.ats;
    if (!g) continue;
    const d = byDate.get(r.slate_date) ?? { w: 0, l: 0, p: 0 };
    if (g === "W") d.w += 1;
    else if (g === "L") d.l += 1;
    else d.p += 1;
    byDate.set(r.slate_date, d);
  }
  const days = [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, DAYS_KEPT)
    .map(([date, rec]) => ({ date, ...rec }));
  const c = s.clv;
  return {
    modelVersion: index.model.version,
    generatedAt: index.generated_at,
    seasonLabel: index.season_label,
    ats: wl(s.ats),
    su: { correct: s.su?.correct ?? 0, total: s.su?.total ?? 0 },
    byConfidence: {
      high: wl(s.by_confidence?.high),
      medium: wl(s.by_confidence?.medium),
      low: wl(s.by_confidence?.low),
    },
    bestBets: wl(s.best_bets),
    valuePlays: wl(s.value_plays),
    byEdge: Object.entries(s.calibration?.ats_by_edge ?? {}).map(([bucket, v]) => ({
      bucket,
      w: v.w ?? 0,
      l: v.l ?? 0,
      p: 0,
    })),
    clv: c && typeof c.n === "number" ? { n: c.n, avg: c.avg ?? null, beatClosePct: c.beat_close_pct ?? null } : null,
    days,
  };
}

/** Wins over decided games, 0–100 to one decimal; null with nothing decided. */
export function hitPct(r: Wl): number | null {
  const n = r.w + r.l;
  return n === 0 ? null : Math.round((r.w / n) * 1000) / 10;
}

/** "42-38", with pushes only when there are any. */
export function wlText(r: Wl): string {
  return `${r.w}-${r.l}${r.p ? `-${r.p}` : ""}`;
}

/** The feed's own thresholds (`confidence_tier` in FEED_SCHEMA.md). */
export function confidenceTier(confidence: number | null | undefined): ConfidenceTier | null {
  if (confidence == null || !Number.isFinite(confidence)) return null;
  return confidence >= 70 ? "high" : confidence >= 40 ? "medium" : "low";
}

export const TIER_LABEL: Record<ConfidenceTier, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

export interface ModelHit {
  /** What the game qualifies as: "Best bet", "Value play", "Medium confidence". */
  label: string;
  record: Wl;
  /** Null when nothing in that tier has been decided yet. */
  pct: number | null;
}

/**
 * The season hit rate for the most specific thing a game qualifies as (owner
 * call, 2026-11-12): a best bet reads the best-bet record, else a value play
 * reads the value record, else the game reads its confidence tier.
 *
 * Null when the model is not on a side at all. The feed only bets when it
 * beats the line by more than half a point, and every record above counts
 * bets — so a rate printed on a game the model would not bet is a rate for
 * something that game is not.
 */
export const BET_THRESHOLD = 0.5;

export function modelHitFor(
  stats: CbbModelStats | null,
  g: { edge: number | null; edgeFlag: "EDGE" | "BIG_EDGE" | null; confidence: number | null },
): ModelHit | null {
  if (!stats || g.edge === null || Math.abs(g.edge) <= BET_THRESHOLD) return null;
  const of = (label: string, record: Wl): ModelHit => ({ label, record, pct: hitPct(record) });
  if (g.edgeFlag === "BIG_EDGE") return of("Best bet", stats.bestBets);
  if (g.edgeFlag === "EDGE") return of("Value play", stats.valuePlays);
  const tier = confidenceTier(g.confidence);
  return tier ? of(TIER_LABEL[tier], stats.byConfidence[tier]) : null;
}

/** The newest day strictly before `today` (a `YYYY-MM-DD` board date). */
export function yesterdayOf(stats: CbbModelStats | null, today: string): ({ date: string } & Wl) | null {
  return stats?.days.find((d) => d.date < today) ?? null;
}

/**
 * The record for `date` itself, or null when nothing on it has been graded.
 * The feed grades a game once it is final (hourly through the slate), so on
 * the day being played this is a running tally, not the day's result.
 */
export function dayOf(stats: CbbModelStats | null, date: string): ({ date: string } & Wl) | null {
  return stats?.days.find((d) => d.date === date) ?? null;
}

export function isCbbModelStats(v: unknown): v is CbbModelStats {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.ats === "object" && o.ats !== null && Array.isArray(o.days) && typeof o.byConfidence === "object";
}
