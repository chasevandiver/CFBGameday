/**
 * Signed error by slice (audit 03:M-3) — the table whose absence let a
 * +9.8-point cross-classification lean survive every calibration pass.
 *
 * Pooled MAE, σ and NLL are symmetric: a model 10 points wrong on 29 games in
 * ONE DIRECTION scores the same as one randomly wrong. The +0.74 home-side
 * bias taught this lesson once (it surfaced only because an unrelated
 * regression demanded an intercept); these tables exist so the next
 * directional lean is printed on every backtest run instead of discovered on
 * an opening-weekend slate.
 *
 * Two instruments, deliberately both:
 *  - vs MARKET (mean signed edge): low variance (books disagree with us by
 *    ~7 points SD, not σ=16.8), so a lean shows up at high t on small n. This
 *    is the sharp instrument, and the market is the gate.
 *  - vs ACTUAL (mean signed margin error): high variance but independent of
 *    the market — it says who was right about the lean, us or the books.
 *
 * Sign conventions, pinned by tests:
 *  - `edge` = model_spread − vegas_spread (Vegas convention), so edge > 0
 *    means the model favours the AWAY side relative to the market.
 *  - G5-signed: positive = we favour the G5 side (of a cross-tier game).
 *  - favourite-signed: positive = we favour the MARKET favourite.
 *  - bias (actual − model margin) is home-signed; re-signed per slice the
 *    same way, positive = that side outperformed our number.
 */

import type { ReplayPrediction } from "./replay";
import { tierMatchup, tierOf, type Tier } from "./tiers";

export interface SliceStat {
  label: string;
  n: number;
  mean: number;
  sd: number;
  se: number;
  t: number;
}

export function stat(label: string, values: number[]): SliceStat | null {
  const n = values.length;
  if (n === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
  const se = n > 1 ? sd / Math.sqrt(n) : Infinity;
  return { label, n, mean, sd, se, t: se > 0 && Number.isFinite(se) ? mean / se : 0 };
}

export function tiersOf(p: ReplayPrediction): { home: Tier; away: Tier } {
  return {
    home: tierOf(p.homeConference, p.homeTeam, p.season, p.homeFbs),
    away: tierOf(p.awayConference, p.awayTeam, p.season, p.awayFbs),
  };
}

export function isCrossTier(p: ReplayPrediction): boolean {
  const { home, away } = tiersOf(p);
  return tierMatchup(home, away) === "cross-tier";
}

/** Signed edge vs market, positive = we favour the G5 side. Cross-tier games
 *  with a line only. */
export function g5SignedEdge(p: ReplayPrediction): number | null {
  if (p.edge === null || !isCrossTier(p)) return null;
  const { away } = tiersOf(p);
  return away === "G5" ? p.edge : -p.edge;
}

/** Signed margin error vs actual, positive = the G5 side outperformed our
 *  number. Cross-tier games only. */
export function g5SignedBias(p: ReplayPrediction): number | null {
  if (!isCrossTier(p)) return null;
  const homeSigned = p.actualMargin - p.margin;
  const { home } = tiersOf(p);
  return home === "G5" ? homeSigned : -homeSigned;
}

/** Signed edge vs market, positive = we favour the market favourite. Null on
 *  pick'em lines (no favourite to sign toward). */
export function favSignedEdge(p: ReplayPrediction): number | null {
  if (p.edge === null || p.vegasSpread === null || p.vegasSpread === 0) return null;
  const favIsHome = p.vegasSpread < 0;
  return favIsHome ? -p.edge : p.edge;
}

/** Signed margin error vs actual, positive = the market favourite outperformed
 *  our number. */
export function favSignedBias(p: ReplayPrediction): number | null {
  if (p.vegasSpread === null || p.vegasSpread === 0) return null;
  const homeSigned = p.actualMargin - p.margin;
  return p.vegasSpread < 0 ? homeSigned : -homeSigned;
}

const fmt = (x: number, w = 7) => ((x >= 0 ? "+" : "") + x.toFixed(2)).padStart(w);

function row(s: SliceStat | null, label: string): string {
  if (!s) return `${label.padEnd(22)}     0        –       –       –`;
  const flag = Math.abs(s.t) >= 2 ? "  ← systematic (|t| ≥ 2)" : "";
  return (
    `${label.padEnd(22)} ${String(s.n).padStart(5)}   ${fmt(s.mean)}   ` +
    `±${s.se.toFixed(2).padStart(5)}   t=${s.t.toFixed(2).padStart(6)}${flag}`
  );
}

/**
 * The full 03:M-3 block, appended to every backtest report. `predictions`
 * is the pooled replay output (all seasons).
 */
export function sliceReport(predictions: ReplayPrediction[]): string {
  const lines: string[] = [];
  const withLine = predictions.filter((p) => p.edge !== null);

  lines.push("\n== Signed error by slice (03:M-3) ==");
  lines.push(
    "vs MARKET: mean(model_spread − vegas_spread), re-signed per slice.\n" +
      "vs ACTUAL: mean(actual − model margin), re-signed the same way.\n" +
      "A |t| ≥ 2 row is a systematic lean that pooled MAE/σ/NLL cannot see.",
  );

  // -- tier matchup ----------------------------------------------------------
  lines.push("\n-- Tier matchup (cross-tier rows are G5-signed: + = we favour the G5) --");
  lines.push("slice                      n   vs market      SE        t");
  const byMatchup = new Map<string, ReplayPrediction[]>();
  for (const p of predictions) {
    const { home, away } = tiersOf(p);
    const key = tierMatchup(home, away);
    byMatchup.set(key, [...(byMatchup.get(key) ?? []), p]);
  }
  for (const key of ["P4 vs P4", "G5 vs G5", "cross-tier", "FBS vs FCS", "unknown"]) {
    const games = byMatchup.get(key) ?? [];
    if (games.length === 0 && key === "unknown") continue;
    if (key === "cross-tier") {
      const edges = games.map(g5SignedEdge).filter((v): v is number => v !== null);
      lines.push(row(stat(key, edges), `${key} (G5-signed)`));
    } else {
      // within-tier / FCS rows are home-signed; a home/away lean shows here,
      // a tier lean cannot (both sides are the same tier).
      const edges = games
        .map((p) => (p.edge === null ? null : -p.edge))
        .filter((v): v is number => v !== null);
      lines.push(row(stat(key, edges), `${key} (home-signed)`));
    }
  }
  lines.push("slice                      n   vs actual      SE        t");
  for (const key of ["P4 vs P4", "G5 vs G5", "cross-tier", "FBS vs FCS", "unknown"]) {
    const games = byMatchup.get(key) ?? [];
    if (games.length === 0 && key === "unknown") continue;
    if (key === "cross-tier") {
      const biases = games.map(g5SignedBias).filter((v): v is number => v !== null);
      lines.push(row(stat(key, biases), `${key} (G5-signed)`));
    } else {
      const biases = games.map((p) => p.actualMargin - p.margin);
      lines.push(row(stat(key, biases), `${key} (home-signed)`));
    }
  }

  // -- equilibration: cross-tier lean by week --------------------------------
  lines.push(
    "\n-- Cross-tier lean by week segment (G5-signed; does the season replay level the pools?) --",
  );
  lines.push("segment                    n   vs market      SE        t");
  const cross = predictions.filter(isCrossTier);
  const segments: Array<[string, (p: ReplayPrediction) => boolean]> = [
    ["weeks 1–2", (p) => p.week <= 2],
    ["weeks 3–4", (p) => p.week >= 3 && p.week <= 4],
    ["weeks 5–8", (p) => p.week >= 5 && p.week <= 8],
    ["weeks 9+", (p) => p.week >= 9],
  ];
  for (const [label, keep] of segments) {
    const edges = cross.filter(keep).map(g5SignedEdge).filter((v): v is number => v !== null);
    lines.push(row(stat(label, edges), label));
  }
  lines.push("segment                    n   vs actual      SE        t");
  for (const [label, keep] of segments) {
    const biases = cross.filter(keep).map(g5SignedBias).filter((v): v is number => v !== null);
    lines.push(row(stat(label, biases), label));
  }

  // -- favourite/dog by market spread size ------------------------------------
  // Distinguishes a tier LEVEL offset from global scale compression: if the
  // rating scale is squashed, the favourite-signed lean grows with the spread
  // in EVERY slice, including P4 vs P4; a tier offset lives only cross-tier.
  lines.push("\n-- Favourite-signed lean by |market spread| (+ = we favour the market favourite) --");
  lines.push("slice                      n   vs market      SE        t");
  const buckets: Array<[string, number, number]> = [
    ["|spread| 0–3", 0, 3],
    ["|spread| 3–7", 3, 7],
    ["|spread| 7–14", 7, 14],
    ["|spread| 14–21", 14, 21],
    ["|spread| 21+", 21, Infinity],
  ];
  for (const [label, lo, hi] of buckets) {
    const seg = withLine.filter(
      (p) => Math.abs(p.vegasSpread as number) > lo && Math.abs(p.vegasSpread as number) <= hi,
    );
    const edges = seg.map(favSignedEdge).filter((v): v is number => v !== null);
    lines.push(row(stat(label, edges), label));
  }
  const p4Only = withLine.filter((p) => {
    const { home, away } = tiersOf(p);
    return home === "P4" && away === "P4" && Math.abs(p.vegasSpread as number) > 7;
  });
  lines.push(
    row(
      stat(
        "P4vP4 |spread| 7+",
        p4Only.map(favSignedEdge).filter((v): v is number => v !== null),
      ),
      "P4vP4 |spread| 7+",
    ),
  );

  // -- per-conference --------------------------------------------------------
  // Team-signed: every lined game contributes once per side, signed toward
  // that side's conference. + = we favour that conference vs the market.
  lines.push("\n-- Conference lean, team-signed vs market (+ = we favour that conference) --");
  lines.push("slice                      n   vs market      SE        t");
  const byConf = new Map<string, number[]>();
  for (const p of withLine) {
    const e = p.edge as number;
    if (p.homeConference) byConf.set(p.homeConference, [...(byConf.get(p.homeConference) ?? []), -e]);
    if (p.awayConference) byConf.set(p.awayConference, [...(byConf.get(p.awayConference) ?? []), e]);
  }
  const confStats = [...byConf.entries()]
    .map(([conf, vals]) => stat(conf, vals))
    .filter((s): s is SliceStat => s !== null && s.n >= 20)
    .sort((a, b) => b.mean - a.mean);
  for (const s of confStats) lines.push(row(s, s.label));

  return lines.join("\n");
}
