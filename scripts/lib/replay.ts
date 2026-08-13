/**
 * Season replay engine shared by the backtest and the preseason builder.
 * Lookahead guard: week-N predictions use only ratings from weeks < N.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  cfbd,
  type CfbdAdvancedGameStat,
  type CfbdGame,
  type CfbdLine,
  type CfbdSpRating,
} from "../../src/lib/cfbd";
import { snapToHalf } from "../../src/lib/consensus";
import { fcsRatingOf } from "../../src/model/fcs";
import {
  blendWithPrior,
  priceGame,
  updateSubRatings,
  type ModelParams,
  type TeamRating,
} from "../../src/model/ratings";

export const CACHE_DIR = path.join(process.cwd(), ".backtest-cache");

export interface SeasonData {
  season: number;
  games: CfbdGame[];
  lines: CfbdLine[];
  prevSp: CfbdSpRating[];
  /** Per-game PPA; absent for seasons loaded before this was added. */
  advanced?: CfbdAdvancedGameStat[];
}

/**
 * Points-equivalent margin from each offense's total PPA rather than the
 * scoreboard. Same units, far less noise: it ignores defensive/special-teams
 * scores and garbage time, which move the final margin without telling you
 * much about how the teams actually played.
 *
 * Returns null when either side is missing PPA, so callers fall back to the
 * real margin rather than silently substituting a zero.
 */
export function efficiencyMargins(advanced: CfbdAdvancedGameStat[] | undefined) {
  const byGame = new Map<number, Map<string, number>>();
  for (const row of advanced ?? []) {
    const total = row.offense?.totalPPA ?? offenseTotalFrom(row);
    if (total === null) continue;
    const teams = byGame.get(row.gameId) ?? new Map<string, number>();
    teams.set(row.team, total);
    byGame.set(row.gameId, teams);
  }
  return (game: CfbdGame): number | null => {
    const teams = byGame.get(game.id);
    if (!teams) return null;
    const home = teams.get(game.homeTeam);
    const away = teams.get(game.awayTeam);
    if (home === undefined || away === undefined) return null;
    return home - away;
  };
}

/**
 * Re-split a game's points so the margin moves toward the efficiency margin
 * while the total stays exactly as played. `weight` 0 returns the real score
 * untouched, which is what makes this safe to ship dark.
 */
export function blendedPoints(
  game: CfbdGame,
  effMargin: (g: CfbdGame) => number | null,
  weight: number,
): { home: number; away: number } {
  const home = game.homePoints as number;
  const away = game.awayPoints as number;
  if (!weight) return { home, away };
  const eff = effMargin(game);
  if (eff === null) return { home, away };
  const total = home + away;
  const margin = (1 - weight) * (home - away) + weight * eff;
  return { home: total / 2 + margin / 2, away: total / 2 - margin / 2 };
}

/** Some CFBD responses carry per-play ppa without the season total. */
function offenseTotalFrom(row: CfbdAdvancedGameStat): number | null {
  const ppa = row.offense?.ppa;
  const plays = row.offense?.plays;
  if (ppa === null || ppa === undefined || plays === null || plays === undefined) return null;
  return ppa * plays;
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
  const [games, lines, prevSp, advanced] = await Promise.all([
    cached(`games-${season}`, () => cfbd.games(season), useCache),
    cached(`lines-${season}`, () => cfbd.lines(season), useCache),
    cached(`sp-${season - 1}`, () => cfbd.spRatings(season - 1), useCache),
    // One call covers the season. Tolerated as optional: a key without the
    // tier for this endpoint should degrade to the score-only model, not
    // break the backtest.
    cached(`advanced-${season}`, () => cfbd.advancedGameStats(season), useCache).catch(() => []),
  ]);
  return { season, games, lines, prevSp, advanced };
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
  /**
   * Market context the payload always carried and the replay used to discard.
   * Without these no bet filter can be evaluated at all, because the grader
   * has nothing but the settled line to look at.
   */
  /** Consensus of per-book OPENING spreads — the line you could actually bet */
  vegasOpen: number | null;
  /** How many books priced the game (thin markets are softer) */
  bookCount: number;
  /** max − min across books: disagreement between them */
  bookSpread: number | null;
  mlHome: number | null;
  mlAway: number | null;
  /** Context for pre-registered situational slices */
  neutralSite: boolean;
  conferenceGame: boolean;
  startDate: string;
  homeId: number;
  awayId: number;
  /**
   * Identity for the signed-error-by-slice tables (audit 03:M-3). Conference
   * is the season's alignment as /games reports it; null when the cached
   * season file predates the field (those games slice as "unknown", never
   * silently as G5). `homeFbs`/`awayFbs` mean "had an FBS rating in this
   * replay" — false is an FCS opponent, priced from `fcsTopRating` /
   * `fcsOtherRating` (src/model/fcs.ts), which are equal as shipped.
   */
  homeTeam: string;
  awayTeam: string;
  homeConference: string | null;
  awayConference: string | null;
  homeFbs: boolean;
  awayFbs: boolean;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Books hang lines in half-point increments, so a consensus must land on one.
 * The replay previously returned a raw multi-book mean (e.g. −6.83) while
 * production snapped to −7 (src/lib/consensus.ts). That gap was a real
 * train/serve skew: it made the ≥2 edge threshold trip on lines production
 * could never produce, and — worse — made `coverMargin === 0` push detection
 * essentially unreachable, so genuine pushes on 3 and 7 were scored as wins or
 * losses at random.
 */
export function consensusLine(lines: CfbdLine | undefined): number | null {
  const spreads = perBook(lines, (l) => l.spread);
  return spreads.length === 0 ? null : snapToHalf(mean(spreads));
}

export function consensusTotal(lines: CfbdLine | undefined): number | null {
  const totals = perBook(lines, (l) => l.overUnder);
  return totals.length === 0 ? null : snapToHalf(mean(totals));
}

/** Consensus of the per-book OPENING spread. */
export function consensusOpen(lines: CfbdLine | undefined): number | null {
  const opens = perBook(lines, (l) => l.spreadOpen);
  return opens.length === 0 ? null : snapToHalf(mean(opens));
}

export function bookCountOf(lines: CfbdLine | undefined): number {
  return perBook(lines, (l) => l.spread).length;
}

/** Disagreement between books on the spread, in points. */
export function bookDispersion(lines: CfbdLine | undefined): number | null {
  const spreads = perBook(lines, (l) => l.spread);
  return spreads.length < 2 ? null : Math.max(...spreads) - Math.min(...spreads);
}

export function consensusMoneyline(
  lines: CfbdLine | undefined,
  side: "home" | "away",
): number | null {
  const mls = perBook(lines, (l) => (side === "home" ? l.homeMoneyline : l.awayMoneyline));
  return mls.length === 0 ? null : Math.round(mean(mls));
}

function perBook(
  lines: CfbdLine | undefined,
  pick: (l: CfbdLine["lines"][number]) => number | null,
): number[] {
  if (!lines || lines.lines.length === 0) return [];
  return lines.lines.map(pick).filter((v): v is number => v !== null && Number.isFinite(v));
}

export function replaySeason(
  data: SeasonData,
  priors: Map<number, number>,
  params: ModelParams,
  /** Per-team off-vs-def tilt: off = prior/2 + tilt, def = prior/2 − tilt.
   *  Leaves margins untouched (off+def ≡ prior) but makes preseason totals
   *  informative from week 1. Seed from SP+ via subTiltsFromSp. */
  tilts?: Map<number, number>,
  /** The FCS teams in the top bucket (`src/model/fcs.ts`). Opponents with no
   *  FBS prior are priced at `params.fcsTopRating` when they are in this set
   *  and `params.fcsOtherRating` otherwise. Omit for one flat bucket — which
   *  is also what passing it does while the two params are equal, as they ship.
   *  Must be built from seasons strictly before the one being replayed; the
   *  lookahead guard above is not optional. */
  fcsTop?: ReadonlySet<number>,
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
  const effMargin = efficiencyMargins(data.advanced);
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
        if (prior === undefined) {
          const r = fcsRatingOf(teamId, fcsTop, params);
          return { overall: r, offense: r / 2, defense: r / 2, tempo: 70 };
        }
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

      const bookLines = linesById.get(g.id);
      predictions.push({
        season: data.season,
        week,
        gameId: g.id,
        margin: price.margin,
        homeWinProb: price.homeWinProb,
        vegasSpread: consensusLine(bookLines),
        edge: price.edge,
        actualMargin,
        favoriteWon,
        favWinProb,
        projectedTotal: price.projectedTotal,
        vegasTotal: consensusTotal(bookLines),
        actualTotal: (g.homePoints as number) + (g.awayPoints as number),
        vegasOpen: consensusOpen(bookLines),
        bookCount: bookCountOf(bookLines),
        bookSpread: bookDispersion(bookLines),
        mlHome: consensusMoneyline(bookLines, "home"),
        mlAway: consensusMoneyline(bookLines, "away"),
        neutralSite: g.neutralSite,
        conferenceGame: g.conferenceGame,
        startDate: g.startDate,
        homeId: g.homeId,
        awayId: g.awayId,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        homeConference: g.homeConference ?? null,
        awayConference: g.awayConference ?? null,
        homeFbs: priors.has(g.homeId),
        awayFbs: priors.has(g.awayId),
      });
      weekPredictions.push({ game: g, home, away });
    }

    for (const { game: g, home, away } of weekPredictions) {
      // Blend the scoreboard toward per-play efficiency before updating. The
      // GAME TOTAL is preserved and only the split moves, so totals modeling is
      // untouched and this is purely a cleaner margin signal. Falls back to the
      // raw score whenever PPA is missing for either side.
      const points = blendedPoints(g, effMargin, params.epaWeight);
      // errors are measured against the BLENDED prediction (same reference the
      // old overall update used), then applied to the unblended running state
      const upd = updateSubRatings(
        {
          homeOffense: home.offense,
          homeDefense: home.defense,
          awayOffense: away.offense,
          awayDefense: away.defense,
          homePoints: points.home,
          awayPoints: points.away,
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

/** Hard bound on a seeded preseason tilt. A tilt of 10 means an offense 20
 *  points better than its own defense relative to even — past anything real,
 *  so a bad chain or a stray SP+ row can't produce a nonsense total. */
export const MAX_TILT = 10;

/**
 * Carry off-vs-def SHAPE into next season, regressed by lambda. Separate from
 * chainPriors because the two answer different questions: chainPriors decides
 * how good a team will be, chainTilts decides whether that goodness is on
 * offense or defense. Overall ratings are untouched (off+def ≡ prior), so this
 * can only move totals, never margins.
 */
export function chainTilts(finalTilts: Map<number, number>, lambda: number): Map<number, number> {
  const tilts = new Map<number, number>();
  for (const [teamId, tilt] of finalTilts) {
    tilts.set(teamId, Math.max(-MAX_TILT, Math.min(MAX_TILT, lambda * tilt)));
  }
  return tilts;
}

/** Same bound applied to SP+-derived shape (subTiltsFromSp), scaled by s. */
export function scaleTilts(tilts: Map<number, number>, scale: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const [teamId, tilt] of tilts) {
    out.set(teamId, Math.max(-MAX_TILT, Math.min(MAX_TILT, scale * tilt)));
  }
  return out;
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
