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

/**
 * --tune-prior: how much should preseason ratings carry over from last season
 * vs regress toward the talent composite? Replays with
 *   priors = w × replay_finals + (1−w) × talent_baseline
 * and scores ONLY weeks 1–4 (where the prior dominates pricing), for the
 * chained seasons (2024–2025; 2023 is the SP+ bootstrap either way).
 */
async function tunePriorCarryover(seasons: SeasonData[], teamIdsByName: Map<string, number>) {
  const { cfbd } = await import("../src/lib/cfbd");
  const { cached } = await import("./lib/replay");

  // talent baseline per season, on the rating points scale (z × 5.5, clamped)
  const talentBySeason = new Map<number, Map<number, number>>();
  for (const season of SEASONS) {
    const talent = await cached(`talent-${season}`, () => cfbd.talent(season), true);
    const vals = talent.map((t) => t.talent);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    const map = new Map<number, number>();
    for (const t of talent) {
      const id = teamIdsByName.get(t.team);
      if (id !== undefined) {
        map.set(id, Math.max(-18, Math.min(18, ((t.talent - mean) / std) * 5.5)));
      }
    }
    talentBySeason.set(season, map);
  }

  console.log("carryover w   early-wk NLL   early-wk MAE   (weeks 1–4 of 2024–2025)");
  let best: { w: number; nll: number } | null = null;
  for (const w of [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8]) {
    let priors = priorsFromSp(seasons[0].prevSp, teamIdsByName);
    const early: ReplayPrediction[] = [];
    for (const season of seasons) {
      const { predictions, finalRatings } = replaySeason(season, priors, DEFAULT_PARAMS);
      if (season.season > SEASONS[0]) {
        early.push(...predictions.filter((p) => p.week <= 4));
      }
      const talent = talentBySeason.get(season.season + 1) ?? talentBySeason.get(season.season)!;
      const next = new Map<number, number>();
      for (const [teamId, rating] of finalRatings) {
        const tal = talent.get(teamId) ?? -8;
        next.set(teamId, w * rating + (1 - w) * tal);
      }
      priors = next;
    }
    const graded = early.filter((p) => p.favoriteWon !== null);
    const nll =
      -graded.reduce((a, p) => a + Math.log(p.favoriteWon ? p.favWinProb : 1 - p.favWinProb), 0) /
      graded.length;
    const errors = early.map((p) => p.actualMargin - p.margin);
    const mae = errors.reduce((a, e) => a + Math.abs(e), 0) / errors.length;
    console.log(`${w.toFixed(2)}          ${nll.toFixed(4)}         ${mae.toFixed(2)}         n=${graded.length}`);
    if (!best || nll < best.nll) best = { w, nll };
  }
  if (best) console.log(`\nBest early-season carryover: w=${best.w}`);
}

/**
 * --tune-sp-blend: should the previous-season baseline be the replay's own
 * finals, CFBD's final SP+ (opponent-adjusted, better cross-conference
 * placement), or a blend? Builds priors as
 *   base = α × replay_finals + (1−α) × SP+_prev_final
 *   prior = 0.7 × base + 0.3 × talent
 * and scores weeks 1–4 of the chained seasons.
 */
async function tuneSpBlend(seasons: SeasonData[], teamIdsByName: Map<string, number>) {
  const { cfbd } = await import("../src/lib/cfbd");
  const { cached } = await import("./lib/replay");

  const talentBySeason = new Map<number, Map<number, number>>();
  const spFinalBySeason = new Map<number, Map<number, number>>();
  for (const season of SEASONS) {
    const talent = await cached(`talent-${season}`, () => cfbd.talent(season), true);
    const vals = talent.map((t) => t.talent);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    const tMap = new Map<number, number>();
    for (const t of talent) {
      const id = teamIdsByName.get(t.team);
      if (id !== undefined) tMap.set(id, Math.max(-18, Math.min(18, ((t.talent - mean) / std) * 5.5)));
    }
    talentBySeason.set(season, tMap);

    // final SP+ of the season itself (used as next season's baseline input)
    const sp = await cached(`sp-${season}`, () => cfbd.spRatings(season), true);
    spFinalBySeason.set(season, priorsFromSp(sp, teamIdsByName));
  }

  console.log("alpha (replay share)   early-wk NLL   early-wk MAE");
  let best: { a: number; nll: number } | null = null;
  for (const a of [0, 0.25, 0.5, 0.75, 1]) {
    let priors = priorsFromSp(seasons[0].prevSp, teamIdsByName);
    const early: ReplayPrediction[] = [];
    for (const season of seasons) {
      const { predictions, finalRatings } = replaySeason(season, priors, DEFAULT_PARAMS);
      if (season.season > SEASONS[0]) early.push(...predictions.filter((p) => p.week <= 4));
      const spFinal = spFinalBySeason.get(season.season)!;
      const talent = talentBySeason.get(season.season)!;
      const next = new Map<number, number>();
      for (const [teamId, rating] of finalRatings) {
        const sp = spFinal.get(teamId);
        const base = sp !== undefined ? a * rating + (1 - a) * sp : rating;
        const tal = talent.get(teamId) ?? -8;
        next.set(teamId, 0.7 * base + 0.3 * tal);
      }
      priors = next;
    }
    const graded = early.filter((p) => p.favoriteWon !== null);
    const nll =
      -graded.reduce((s, p) => s + Math.log(p.favoriteWon ? p.favWinProb : 1 - p.favWinProb), 0) /
      graded.length;
    const errors = early.map((p) => p.actualMargin - p.margin);
    const mae = errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length;
    console.log(`${a.toFixed(2)}                   ${nll.toFixed(4)}         ${mae.toFixed(2)}   n=${graded.length}`);
    if (!best || nll < best.nll) best = { a, nll };
  }
  if (best) console.log(`\nBest replay share: alpha=${best.a}`);
}

async function main() {
  const useCache = process.argv.includes("--cached");
  const tune = process.argv.includes("--tune");
  const tunePrior = process.argv.includes("--tune-prior");
  const tuneSp = process.argv.includes("--tune-sp-blend");

  console.log(`Loading seasons ${SEASONS.join(", ")} ${useCache ? "(cache preferred)" : "(fetching)"}…`);
  const seasons: SeasonData[] = [];
  for (const s of SEASONS) seasons.push(await loadSeason(s, useCache));

  const teamIdsByName = teamIdsByNameFrom(seasons);

  if (tunePrior) {
    await tunePriorCarryover(seasons, teamIdsByName);
    return;
  }
  if (tuneSp) {
    await tuneSpBlend(seasons, teamIdsByName);
    return;
  }

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
