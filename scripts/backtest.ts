/**
 * Point-in-time backtest over past seasons (docs/SPEC.md §2.5).
 *
 * Usage:
 *   CFBD_API_KEY=... npx tsx scripts/backtest.ts             # fetch + run 2023–2025
 *   npx tsx scripts/backtest.ts --cached                     # reuse .backtest-cache/
 *   npx tsx scripts/backtest.ts --tune                       # grid-search K / decay / HFA
 *
 * Lookahead-bias guard: the replay walks weeks in order; week-N predictions use
 * only ratings computed from weeks < N plus the preseason prior. Nothing in
 * this file reads a game's result before predicting it.
 *
 * Bootstrap rule: the earliest season's priors are seeded from CFBD's
 * historical SP+ for the PREVIOUS season (§2.5 v2). Later seasons chain off
 * the replay's own final ratings.
 *
 * Scope: validates K-factor, prior decay, margin cap, HFA, win-prob slope and
 * margin sigma, and calibration vs the stored CFBD line. It does NOT validate
 * CLV or line movement — no historical movement data exists.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cfbd, type CfbdGame, type CfbdLine, type CfbdSpRating } from "../src/lib/cfbd";
import {
  DEFAULT_PARAMS,
  blendWithPrior,
  priceGame,
  updateFromResult,
  type ModelParams,
  type TeamRating,
} from "../src/model/ratings";

const SEASONS = [2023, 2024, 2025];
const CACHE_DIR = path.join(process.cwd(), ".backtest-cache");

interface SeasonData {
  season: number;
  games: CfbdGame[];
  lines: CfbdLine[];
  prevSp: CfbdSpRating[]; // previous season's SP+ (for the bootstrap season only)
}

async function cached<T>(name: string, fetcher: () => Promise<T>, useCache: boolean): Promise<T> {
  const file = path.join(CACHE_DIR, `${name}.json`);
  if (useCache) {
    try {
      return JSON.parse(await readFile(file, "utf8")) as T;
    } catch {
      // fall through to fetch
    }
  }
  const data = await fetcher();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(data));
  return data;
}

async function loadSeason(season: number, useCache: boolean): Promise<SeasonData> {
  const [games, lines, prevSp] = await Promise.all([
    cached(`games-${season}`, () => cfbd.games(season), useCache),
    cached(`lines-${season}`, () => cfbd.lines(season), useCache),
    cached(`sp-${season - 1}`, () => cfbd.spRatings(season - 1), useCache),
  ]);
  return { season, games, lines, prevSp };
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

interface Prediction {
  season: number;
  week: number;
  gameId: number;
  margin: number; // model, home perspective
  homeWinProb: number;
  vegasSpread: number | null;
  edge: number | null;
  actualMargin: number;
  favoriteWon: boolean | null;
  favWinProb: number;
}

const FCS_RATING = -30;

function consensusLine(lines: CfbdLine | undefined): number | null {
  if (!lines || lines.lines.length === 0) return null;
  const spreads = lines.lines.map((l) => l.spread).filter((s): s is number => s !== null);
  if (spreads.length === 0) return null;
  return spreads.reduce((a, b) => a + b, 0) / spreads.length;
}

function replaySeason(
  data: SeasonData,
  priors: Map<number, number>, // teamId -> preseason rating
  params: ModelParams,
): { predictions: Prediction[]; finalRatings: Map<number, number> } {
  // results-to-date rating starts at the prior
  const results = new Map<number, number>(priors);
  const predictions: Prediction[] = [];
  const linesById = new Map(data.lines.map((l) => [l.id, l]));

  const weeks = [...new Set(data.games.map((g) => g.week))].sort((a, b) => a - b);
  for (const week of weeks) {
    const weekGames = data.games
      .filter((g) => g.week === week && g.homePoints !== null && g.awayPoints !== null)
      .sort((a, b) => a.id - b.id);

    // 1) Predict every game this week using ONLY current blended ratings
    const weekPredictions: Array<{ game: CfbdGame; margin: number; blendedHome: number; blendedAway: number }> = [];
    for (const g of weekGames) {
      const homePrior = priors.get(g.homeId);
      const awayPrior = priors.get(g.awayId);
      const blendedRating = (teamId: number, prior: number | undefined): number => {
        if (prior === undefined) return FCS_RATING; // non-FBS opponent
        return blendWithPrior(prior, results.get(teamId) ?? prior, week, params);
      };
      const home = blendedRating(g.homeId, homePrior);
      const away = blendedRating(g.awayId, awayPrior);

      const rating = (overall: number): TeamRating => ({
        overall,
        offense: overall / 2,
        defense: overall / 2,
        tempo: 70,
      });
      const price = priceGame(
        {
          home: rating(home),
          away: rating(away),
          homeTeamHfa: params.baseHfa,
          neutralSite: g.neutralSite,
          situationalPoints: 0,
          vegasSpread: consensusLine(linesById.get(g.id)),
        },
        params,
      );

      const actualMargin = (g.homePoints as number) - (g.awayPoints as number);
      const favIsHome = price.margin >= 0;
      const favWinProb = favIsHome ? price.homeWinProb : 1 - price.homeWinProb;
      const favoriteWon =
        actualMargin === 0 ? null : favIsHome ? actualMargin > 0 : actualMargin < 0;

      predictions.push({
        season: data.season,
        week,
        gameId: g.id,
        margin: price.margin,
        homeWinProb: price.homeWinProb,
        vegasSpread: price.edge !== null ? consensusLine(linesById.get(g.id)) : null,
        edge: price.edge,
        actualMargin,
        favoriteWon,
        favWinProb,
      });
      weekPredictions.push({ game: g, margin: price.margin, blendedHome: home, blendedAway: away });
    }

    // 2) THEN update ratings from this week's results (never before predicting)
    for (const { game: g, margin } of weekPredictions) {
      const actual = (g.homePoints as number) - (g.awayPoints as number);
      const upd = updateFromResult(
        {
          homeRating: results.get(g.homeId) ?? FCS_RATING,
          awayRating: results.get(g.awayId) ?? FCS_RATING,
          predictedMargin: margin,
          actualHomeMargin: actual,
        },
        params,
      );
      // FCS opponents are excluded from updates (§2.1); their team never enters `priors`
      if (priors.has(g.homeId)) results.set(g.homeId, (results.get(g.homeId) ?? 0) + upd.homeDelta);
      if (priors.has(g.awayId)) results.set(g.awayId, (results.get(g.awayId) ?? 0) + upd.awayDelta);
    }
  }

  return { predictions, finalRatings: results };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function report(predictions: Prediction[], params: ModelParams): string {
  const lines: string[] = [];
  const graded = predictions.filter((p) => p.favoriteWon !== null);

  // Calibration: bucket favorites by predicted win prob
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

  // Margin error
  const errors = predictions.map((p) => p.actualMargin - p.margin);
  const mae = errors.reduce((a, e) => a + Math.abs(e), 0) / errors.length;
  const sigma = Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / errors.length);
  lines.push(`\n== Margin error ==  MAE ${mae.toFixed(2)}  σ ${sigma.toFixed(2)} (param: ${params.marginSigma})`);

  // ATS on edge flags
  lines.push("\n== Edge flags vs stored line (break-even 52.4% at -110) ==");
  for (const [label, min] of [["EDGE ≥2", params.edgeThreshold], ["BIG ≥4", params.bigEdgeThreshold]] as const) {
    const flagged = predictions.filter(
      (p) => p.edge !== null && Math.abs(p.edge) >= min && p.vegasSpread !== null,
    );
    let wins = 0;
    let losses = 0;
    for (const p of flagged) {
      // Model likes home when edge < 0 (model spread more negative than Vegas)
      const likesHome = (p.edge as number) < 0;
      const coverMargin = p.actualMargin + (p.vegasSpread as number); // >0 = home covered
      if (coverMargin === 0) continue; // push
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

// ---------------------------------------------------------------------------
// Priors
// ---------------------------------------------------------------------------

/** Rough SP+ → our scale: SP+ rating is already ~points vs average. */
function priorsFromSp(sp: CfbdSpRating[], teamIdsByName: Map<string, number>): Map<number, number> {
  const priors = new Map<number, number>();
  for (const r of sp) {
    if (r.team === "nationalAverages") continue;
    const id = teamIdsByName.get(r.team);
    if (id !== undefined) priors.set(id, r.rating);
  }
  return priors;
}

/** Chain seasons: next season's prior regresses replay finals 30% toward SP+-style talent mean (0). */
function chainPriors(finals: Map<number, number>): Map<number, number> {
  const priors = new Map<number, number>();
  for (const [teamId, rating] of finals) priors.set(teamId, 0.7 * rating);
  return priors;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const useCache = process.argv.includes("--cached");
  const tune = process.argv.includes("--tune");

  console.log(`Loading seasons ${SEASONS.join(", ")} ${useCache ? "(cache preferred)" : "(fetching)"}…`);
  const seasons: SeasonData[] = [];
  for (const s of SEASONS) seasons.push(await loadSeason(s, useCache));

  // team name -> id map from the earliest season's games (FBS teams only appear as priors)
  const teamIdsByName = new Map<string, number>();
  for (const s of seasons) {
    for (const g of s.games) {
      teamIdsByName.set(g.homeTeam, g.homeId);
      teamIdsByName.set(g.awayTeam, g.awayId);
    }
  }

  const run = (params: ModelParams): Prediction[] => {
    let priors = priorsFromSp(seasons[0].prevSp, teamIdsByName);
    const all: Prediction[] = [];
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

  // Grid search
  console.log("Tuning (grid search over K, HFA, sigma)…");
  let best: { params: ModelParams; score: number } | null = null;
  for (const kFactor of [0.1, 0.15, 0.175, 0.2, 0.25]) {
    for (const baseHfa of [1.8, 2.3, 2.8]) {
      const params: ModelParams = { ...DEFAULT_PARAMS, kFactor, baseHfa };
      const predictions = run(params);
      // Score: negative log-likelihood of favorite results (lower = better calibrated)
      const graded = predictions.filter((p) => p.favoriteWon !== null);
      const nll =
        -graded.reduce(
          (a, p) => a + Math.log(p.favoriteWon ? p.favWinProb : 1 - p.favWinProb),
          0,
        ) / graded.length;
      // Also fit sigma from residuals for reporting
      const errors = predictions.map((p) => p.actualMargin - p.margin);
      const sigma = Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / errors.length);
      console.log(`K=${kFactor} HFA=${baseHfa} → NLL ${nll.toFixed(4)}, fitted σ ${sigma.toFixed(2)}`);
      if (!best || nll < best.score) best = { params: { ...params, marginSigma: sigma }, score: nll };
    }
  }
  if (best) {
    console.log(`\nBest: K=${best.params.kFactor} HFA=${best.params.baseHfa} σ=${best.params.marginSigma.toFixed(2)}`);
    console.log(report(run(best.params), best.params));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
