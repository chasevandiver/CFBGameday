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
  updateSubRatings,
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
  /** Off/def-driven projected total (§2.2 sub-ratings; tempo held at avg) */
  projectedTotal: number;
  vegasTotal: number | null;
  actualTotal: number;
}

export function consensusLine(lines: CfbdLine | undefined): number | null {
  if (!lines || lines.lines.length === 0) return null;
  const spreads = lines.lines.map((l) => l.spread).filter((s): s is number => s !== null);
  if (spreads.length === 0) return null;
  return spreads.reduce((a, b) => a + b, 0) / spreads.length;
}

export function consensusTotal(lines: CfbdLine | undefined): number | null {
  if (!lines || lines.lines.length === 0) return null;
  const totals = lines.lines.map((l) => l.overUnder).filter((t): t is number => t !== null);
  if (totals.length === 0) return null;
  return totals.reduce((a, b) => a + b, 0) / totals.length;
}

export function replaySeason(
  data: SeasonData,
  priors: Map<number, number>,
  params: ModelParams,
  /** Per-team off-vs-def tilt: off = prior/2 + tilt, def = prior/2 − tilt.
   *  Leaves margins untouched (off+def ≡ prior) but makes preseason totals
   *  informative from week 1. Seed from SP+ via subTiltsFromSp. */
  tilts?: Map<number, number>,
): {
  predictions: ReplayPrediction[];
  finalRatings: Map<number, number>;
  finalTilts: Map<number, number>;
} {
  // Off/def carry the season (§2.2): overall ≡ off + def by construction, and
  // updateSubRatings preserves the overall margin update exactly (its off+def
  // deltas sum to the updateFromResult delta), so margins reproduce the tuned
  // behavior while totals gain real matchup signal.
  const tiltOf = (id: number) => tilts?.get(id) ?? 0;
  const offense = new Map<number, number>();
  const defense = new Map<number, number>();
  for (const [id, prior] of priors) {
    offense.set(id, prior / 2 + tiltOf(id));
    defense.set(id, prior / 2 - tiltOf(id));
  }
  const predictions: ReplayPrediction[] = [];
  const linesById = new Map(data.lines.map((l) => [l.id, l]));

  const weeks = [...new Set(data.games.map((g) => g.week))].sort((a, b) => a - b);
  for (const week of weeks) {
    const weekGames = data.games
      .filter((g) => g.week === week && g.homePoints !== null && g.awayPoints !== null)
      .sort((a, b) => a.id - b.id);

    const weekPredictions: Array<{
      game: CfbdGame;
      home: TeamRating;
      away: TeamRating;
    }> = [];
    for (const g of weekGames) {
      const blended = (teamId: number): TeamRating => {
        const prior = priors.get(teamId);
        if (prior === undefined)
          return { overall: FCS_RATING, offense: FCS_RATING / 2, defense: FCS_RATING / 2, tempo: 70 };
        const pOff = prior / 2 + tiltOf(teamId);
        const pDef = prior / 2 - tiltOf(teamId);
        const off = blendWithPrior(pOff, offense.get(teamId) ?? pOff, week, params);
        const def = blendWithPrior(pDef, defense.get(teamId) ?? pDef, week, params);
        return { overall: off + def, offense: off, defense: def, tempo: 70 };
      };
      const home = blended(g.homeId);
      const away = blended(g.awayId);

      const price = priceGame(
        {
          home,
          away,
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
        projectedTotal: price.projectedTotal,
        vegasTotal: consensusTotal(linesById.get(g.id)),
        actualTotal: (g.homePoints as number) + (g.awayPoints as number),
      });
      weekPredictions.push({ game: g, home, away });
    }

    for (const { game: g, home, away } of weekPredictions) {
      // errors are measured against the BLENDED prediction (same reference the
      // old overall update used), then applied to the unblended running state
      const upd = updateSubRatings(
        {
          homeOffense: home.offense,
          homeDefense: home.defense,
          awayOffense: away.offense,
          awayDefense: away.defense,
          homePoints: g.homePoints as number,
          awayPoints: g.awayPoints as number,
          hfa: params.baseHfa,
          neutralSite: g.neutralSite,
        },
        params,
      );
      if (priors.has(g.homeId)) {
        offense.set(g.homeId, (offense.get(g.homeId) ?? 0) + upd.homeOffDelta);
        defense.set(g.homeId, (defense.get(g.homeId) ?? 0) + upd.homeDefDelta);
      }
      if (priors.has(g.awayId)) {
        offense.set(g.awayId, (offense.get(g.awayId) ?? 0) + upd.awayOffDelta);
        defense.set(g.awayId, (defense.get(g.awayId) ?? 0) + upd.awayDefDelta);
      }
    }
  }

  const finalRatings = new Map<number, number>();
  const finalTilts = new Map<number, number>();
  for (const [id] of priors) {
    const off = offense.get(id) ?? 0;
    const def = defense.get(id) ?? 0;
    finalRatings.set(id, off + def);
    finalTilts.set(id, (off - def) / 2);
  }
  return { predictions, finalRatings, finalTilts };
}

/**
 * Off-vs-def tilt from SP+ sub-ratings, mean-centered per side so the tilt is
 * pure shape: a team's overall prior is untouched (off+def still sums to it),
 * only how it splits changes. SP+ defense is lower-is-better, hence the flip.
 */
export function subTiltsFromSp(
  sp: CfbdSpRating[],
  teamIdsByName: Map<string, number>,
): Map<number, number> {
  const rows = sp.filter(
    (r) => r.team !== "nationalAverages" && r.offense !== null && r.defense !== null,
  );
  if (rows.length === 0) return new Map();
  const meanOff = rows.reduce((a, r) => a + (r.offense as { rating: number }).rating, 0) / rows.length;
  const meanDef = rows.reduce((a, r) => a + (r.defense as { rating: number }).rating, 0) / rows.length;
  const tilts = new Map<number, number>();
  for (const r of rows) {
    const id = teamIdsByName.get(r.team);
    if (id === undefined) continue;
    const rawOff = (r.offense as { rating: number }).rating - meanOff;
    const rawDef = meanDef - (r.defense as { rating: number }).rating;
    tilts.set(id, (rawOff - rawDef) / 2);
  }
  return tilts;
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
