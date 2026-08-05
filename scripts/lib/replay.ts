/**
 * Season replay engine shared by the backtest and the preseason builder.
 * Lookahead guard: week-N predictions use only ratings from weeks < N.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cfbd, type CfbdGame, type CfbdLine, type CfbdSpRating } from "../../src/lib/cfbd";
import {
  blendWithPrior,
  priceGame,
  updateFromResult,
  type ModelParams,
  type TeamRating,
} from "../../src/model/ratings";

export const CACHE_DIR = path.join(process.cwd(), ".backtest-cache");
export const FCS_RATING = -30;

export interface SeasonData {
  season: number;
  games: CfbdGame[];
  lines: CfbdLine[];
  prevSp: CfbdSpRating[];
}

export async function cached<T>(
  name: string,
  fetcher: () => Promise<T>,
  useCache: boolean,
): Promise<T> {
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

export async function loadSeason(season: number, useCache: boolean): Promise<SeasonData> {
  const [games, lines, prevSp] = await Promise.all([
    cached(`games-${season}`, () => cfbd.games(season), useCache),
    cached(`lines-${season}`, () => cfbd.lines(season), useCache),
    cached(`sp-${season - 1}`, () => cfbd.spRatings(season - 1), useCache),
  ]);
  return { season, games, lines, prevSp };
}

export interface ReplayPrediction {
  season: number;
  week: number;
  gameId: number;
  margin: number;
  homeWinProb: number;
  vegasSpread: number | null;
  edge: number | null;
  actualMargin: number;
  favoriteWon: boolean | null;
  favWinProb: number;
}

export function consensusLine(lines: CfbdLine | undefined): number | null {
  if (!lines || lines.lines.length === 0) return null;
  const spreads = lines.lines.map((l) => l.spread).filter((s): s is number => s !== null);
  if (spreads.length === 0) return null;
  return spreads.reduce((a, b) => a + b, 0) / spreads.length;
}

export function replaySeason(
  data: SeasonData,
  priors: Map<number, number>,
  params: ModelParams,
): { predictions: ReplayPrediction[]; finalRatings: Map<number, number> } {
  const results = new Map<number, number>(priors);
  const predictions: ReplayPrediction[] = [];
  const linesById = new Map(data.lines.map((l) => [l.id, l]));

  const weeks = [...new Set(data.games.map((g) => g.week))].sort((a, b) => a - b);
  for (const week of weeks) {
    const weekGames = data.games
      .filter((g) => g.week === week && g.homePoints !== null && g.awayPoints !== null)
      .sort((a, b) => a.id - b.id);

    const weekPredictions: Array<{ game: CfbdGame; margin: number }> = [];
    for (const g of weekGames) {
      const blendedRating = (teamId: number): number => {
        const prior = priors.get(teamId);
        if (prior === undefined) return FCS_RATING;
        return blendWithPrior(prior, results.get(teamId) ?? prior, week, params);
      };
      const home = blendedRating(g.homeId);
      const away = blendedRating(g.awayId);

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
        vegasSpread: consensusLine(linesById.get(g.id)),
        edge: price.edge,
        actualMargin,
        favoriteWon,
        favWinProb,
      });
      weekPredictions.push({ game: g, margin: price.margin });
    }

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
      if (priors.has(g.homeId)) results.set(g.homeId, (results.get(g.homeId) ?? 0) + upd.homeDelta);
      if (priors.has(g.awayId)) results.set(g.awayId, (results.get(g.awayId) ?? 0) + upd.awayDelta);
    }
  }

  return { predictions, finalRatings: results };
}

export function priorsFromSp(
  sp: CfbdSpRating[],
  teamIdsByName: Map<string, number>,
): Map<number, number> {
  const priors = new Map<number, number>();
  for (const r of sp) {
    if (r.team === "nationalAverages") continue;
    const id = teamIdsByName.get(r.team);
    if (id !== undefined) priors.set(id, r.rating);
  }
  return priors;
}

/** Next season's prior regresses replay finals 30% toward the mean. */
export function chainPriors(finals: Map<number, number>): Map<number, number> {
  const priors = new Map<number, number>();
  for (const [teamId, rating] of finals) priors.set(teamId, 0.7 * rating);
  return priors;
}

export function teamIdsByNameFrom(seasons: SeasonData[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of seasons) {
    for (const g of s.games) {
      map.set(g.homeTeam, g.homeId);
      map.set(g.awayTeam, g.awayId);
    }
  }
  return map;
}
