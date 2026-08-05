/**
 * Point-in-time backtest over past seasons (docs/SPEC.md §2.5).
 *
 * Usage:
 *   CFBD_API_KEY=... npx tsx scripts/backtest.ts             # fetch + run 2023–2025
 *   npx tsx scripts/backtest.ts --cached                     # reuse .backtest-cache/
 *   npx tsx scripts/backtest.ts --tune                       # grid-search K / HFA, fit σ + slope
 *
 * Lookahead-bias guard lives in scripts/lib/replay.ts: week-N predictions use
 * only ratings computed from weeks < N plus the preseason prior.
 *
 * Bootstrap rule: the earliest season's priors are seeded from CFBD's
 * historical SP+ for the PREVIOUS season (§2.5 v2). Later seasons chain off
 * the replay's own final ratings.
 *
 * Scope: validates K-factor, prior decay, margin cap, HFA, win-prob slope and
 * margin sigma, and calibration vs the stored CFBD line. It does NOT validate
 * CLV or line movement — no historical movement data exists.
 */

import { DEFAULT_PARAMS, type ModelParams } from "../src/model/ratings";
import {
  chainPriors,
  loadSeason,
  priorsFromSp,
  replaySeason,
  teamIdsByNameFrom,
  type ReplayPrediction,
  type SeasonData,
} from "./lib/replay";

const SEASONS = [2023, 2024, 2025];

function report(predictions: ReplayPrediction[], params: ModelParams): string {
  const lines: string[] = [];
  const graded = predictions.filter((p) => p.favoriteWon !== null);

  lines.push("\n== Win-probability calibration ==");
  lines.push("bucket        n     predicted   actual");
  for (const [lo, hi] of [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]] as const) {
    const bucket = graded.filter((p) => p.favWinProb >= lo && p.favWinProb < hi);
    if (bucket.length === 0) continue;
    const predicted = bucket.reduce((a, p) => a + p.favWinProb, 0) / bucket.length;
    const actual = bucket.filter((p) => p.favoriteWon).length / bucket.length;
    lines.push(
      `${lo.toFixed(1)}–${Math.min(hi, 1).toFixed(1)}     ${String(bucket.length).padStart(5)}   ${(predicted * 100).toFixed(1)}%       ${(actual * 100).toFixed(1)}%`,
    );
  }

  const errors = predictions.map((p) => p.actualMargin - p.margin);
  const mae = errors.reduce((a, e) => a + Math.abs(e), 0) / errors.length;
  const sigma = Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / errors.length);
  lines.push(`\n== Margin error ==  MAE ${mae.toFixed(2)}  σ ${sigma.toFixed(2)} (param: ${params.marginSigma})`);

  lines.push("\n== Edge flags vs stored line (break-even 52.4% at -110) ==");
  for (const [label, min] of [["EDGE ≥2", params.edgeThreshold], ["BIG ≥4", params.bigEdgeThreshold]] as const) {
    const flagged = predictions.filter(
      (p) => p.edge !== null && Math.abs(p.edge) >= min && p.vegasSpread !== null,
    );
    let wins = 0;
    let losses = 0;
    for (const p of flagged) {
      const likesHome = (p.edge as number) < 0;
      const coverMargin = p.actualMargin + (p.vegasSpread as number);
      if (coverMargin === 0) continue;
      const homeCovered = coverMargin > 0;
      if (likesHome === homeCovered) wins++;
      else losses++;
    }
    const total = wins + losses;
    lines.push(
      `${label}:  ${wins}-${losses}  (${total ? ((wins / total) * 100).toFixed(1) : "–"}%)  n=${total}`,
    );
  }

  return lines.join("\n");
}

async function main() {
  const useCache = process.argv.includes("--cached");
  const tune = process.argv.includes("--tune");

  console.log(`Loading seasons ${SEASONS.join(", ")} ${useCache ? "(cache preferred)" : "(fetching)"}…`);
  const seasons: SeasonData[] = [];
  for (const s of SEASONS) seasons.push(await loadSeason(s, useCache));

  const teamIdsByName = teamIdsByNameFrom(seasons);

  const run = (params: ModelParams): ReplayPrediction[] => {
    let priors = priorsFromSp(seasons[0].prevSp, teamIdsByName);
    const all: ReplayPrediction[] = [];
    for (const season of seasons) {
      const { predictions, finalRatings } = replaySeason(season, priors, params);
      all.push(...predictions);
      priors = chainPriors(finalRatings);
    }
    return all;
  };

  if (!tune) {
    const predictions = run(DEFAULT_PARAMS);
    console.log(report(predictions, DEFAULT_PARAMS));
    return;
  }

  console.log("Tuning (grid search over K, HFA, sigma)…");
  let best: { params: ModelParams; score: number } | null = null;
  for (const kFactor of [0.2, 0.25, 0.3, 0.35, 0.4]) {
    for (const baseHfa of [2.0, 2.3, 2.6]) {
      const params: ModelParams = { ...DEFAULT_PARAMS, kFactor, baseHfa };
      const predictions = run(params);
      const graded = predictions.filter((p) => p.favoriteWon !== null);
      const nll =
        -graded.reduce(
          (a, p) => a + Math.log(p.favoriteWon ? p.favWinProb : 1 - p.favWinProb),
          0,
        ) / graded.length;
      const errors = predictions.map((p) => p.actualMargin - p.margin);
      const sigma = Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / errors.length);
      console.log(`K=${kFactor} HFA=${baseHfa} → NLL ${nll.toFixed(4)}, fitted σ ${sigma.toFixed(2)}`);
      if (!best || nll < best.score) best = { params: { ...params, marginSigma: sigma }, score: nll };
    }
  }
  if (best) {
    // Calibrate the win-prob slope to the fitted margin sigma (logistic ≈ normal: 1.7/σ)
    best.params.winProbSlope = 1.7 / best.params.marginSigma;
    console.log(
      `\nBest: K=${best.params.kFactor} HFA=${best.params.baseHfa} σ=${best.params.marginSigma.toFixed(2)} slope=${best.params.winProbSlope.toFixed(4)}`,
    );
    console.log(report(run(best.params), best.params));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
