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
import { COVID_SEASON } from "./eras";
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
  /**
   * SP+ for THIS season, used to admit teams promoted to FBS mid-window.
   * Absent for seasons loaded before the wide window existed, in which case
   * `admitNewFbs` is a no-op and the pool behaves as it always did.
   */
  sp?: CfbdSpRating[];
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
  // An empty list is never worth keeping (04:DQ-15). CFBD answers 200 with `[]`
  // for a season it has not published yet — `cfbd.ts` only throws on `!res.ok`
  // — and writing that caches the absence permanently: every later run reads
  // the file, skips the fetch, and gets `[]` again long after the real data
  // landed. The failure is silent and points the wrong way, because a build on
  // an empty talent list looks like a modelling problem rather than a stale
  // file. Costs one repeated request in exchange.
  //
  // Not local-dev-only, which is what the tracked row assumed: most call sites
  // pass `useCache: true` literally rather than threading `--cached`, so
  // `build-preseason` on a persistent working directory carries a poisoned
  // entry across runs. On a fresh CI runner the file is absent anyway, so the
  // damage there is confined to a single run.
  if (Array.isArray(data) && data.length === 0) return data;
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(data));
  return data;
}

/**
 * @param withAdvanced fetch per-game PPA. Default false, because nothing reads
 *   it at `epaWeight: 0` — which is what ships, `--tune-epa` having been tested
 *   and rejected. It was fetched unconditionally until 2026-08-18: one wasted
 *   CFBD call per season per run, plus an `efficiencyMargins` Map built over
 *   ~10k rows on EVERY `replaySeason` call, i.e. once per season per grid
 *   point. At 40 grid points x 11 seasons that is 440 Map builds feeding a
 *   `weight` of 0. Only `--tune-epa` passes true.
 */
export async function loadSeason(
  season: number,
  useCache: boolean,
  opts: { withAdvanced?: boolean; withSp?: boolean } = {},
): Promise<SeasonData> {
  const [games, lines, prevSp, advanced, sp] = await Promise.all([
    cached(`games-${season}`, () => cfbd.games(season), useCache),
    cached(`lines-${season}`, () => cfbd.lines(season), useCache),
    cached(`sp-${season - 1}`, () => cfbd.spRatings(season - 1), useCache),
    // One call covers the season. Tolerated as optional: a key without the
    // tier for this endpoint should degrade to the score-only model, not
    // break the backtest. The failure is now LOGGED rather than swallowed —
    // a tolerated error that prints nothing is `emptyIsHealthy` in another
    // costume, and over eleven seasons "some of them silently had no PPA" is
    // exactly the kind of thing that must not be inferred from a flat number.
    opts.withAdvanced
      ? cached(`advanced-${season}`, () => cfbd.advancedGameStats(season), useCache).catch(
          (err: unknown) => {
            console.log(
              `!! advanced stats unavailable for ${season} (${
                err instanceof Error ? err.message : String(err)
              }) — this season contributes nothing to any PPA-based fit.`,
            );
            return [];
          },
        )
      : Promise.resolve<CfbdAdvancedGameStat[]>([]),
    // SP+ for the season itself, not the one before: `admitNewFbs` uses it to
    // seed teams promoted to FBS partway through the window.
    opts.withSp
      ? cached(`sp-${season}`, () => cfbd.spRatings(season), useCache)
      : Promise.resolve<CfbdSpRating[]>([]),
  ]);
  return { season, games, lines, prevSp, advanced, sp };
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
  /** Per-team home-field advantage, points, already blended and centred by
   *  `centeredBlendedHfa`. Omit to price every home game at the flat
   *  `params.baseHfa`, which is what every replay did before 2026-08-18 and is
   *  therefore the identity behaviour.
   *
   *  This gap is why audit 03:M-1 was invisible to the backtest: production
   *  prices with a per-team table (`build-preseason.ts`) and the replay priced
   *  with a scalar, so a ~+1.9 inflation in that table could not show up in any
   *  calibration report. Must be built from seasons strictly before the one
   *  being replayed. */
  hfaByTeam?: ReadonlyMap<number, number>,
): {
  predictions: ReplayPrediction[];
  finalRatings: Map<number, number>;
  finalTilts: Map<number, number>;
  /** FBS membership changes applied to the pool this season (see admitNewFbs).
   *  Empty unless the caller loaded `data.sp`. */
  admitted: number[];
  retired: number[];
} {
  // Off/def carry the season (§2.2): overall ≡ off + def by construction, and
  // updateSubRatings preserves the overall margin update exactly (its off+def
  // deltas sum to the updateFromResult delta), so margins reproduce the tuned
  // behavior while totals gain real matchup signal.
  const tiltOf = (id: number) => tilts?.get(id) ?? 0;
  // Only build the PPA index when something will read it. At `epaWeight: 0` —
  // which is what ships, `--tune-epa` having been tested and rejected —
  // `blendedPoints` returns the raw score before touching this, so building it
  // is a Map over ~10k rows per season per grid point for nothing.
  if (params.epaWeight && (data.advanced?.length ?? 0) === 0) {
    // Loud, because the alternative is a silent fall back to the raw score:
    // `blendedPoints` returns it whenever the efficiency margin is null, so a
    // PPA-weighted run against an unloaded feed would produce a perfectly
    // plausible score-only number labelled as an efficiency fit. Callers opt
    // into the advanced fetch (`loadSeason(..., { withAdvanced: true })`), and
    // opting out while asking for a PPA blend is a mistake, not a preference.
    throw new Error(
      `replaySeason(${data.season}) got epaWeight ${params.epaWeight} with no advanced stats ` +
        `loaded. Pass { withAdvanced: true } to loadSeason, or leave epaWeight at 0 — silently ` +
        `scoring the raw margin as though it were an efficiency blend is the one outcome that ` +
        `must not happen.`,
    );
  }
  const effMargin = params.epaWeight ? efficiencyMargins(data.advanced) : () => null;
  const hfaOf = (teamId: number) => hfaByTeam?.get(teamId) ?? params.baseHfa;

  // FBS membership for THIS season, before anything is priced. Doing it here
  // rather than in each caller's chain loop is deliberate: there are a dozen
  // such loops across backtest.ts, all of the same shape, and a membership fix
  // applied in eleven of them is worse than none — the twelfth would produce a
  // number that looks comparable and is not. `data.sp` is absent unless the
  // caller asked for it, in which case this is a no-op and the pool behaves
  // exactly as it did before (identity).
  // SP+ rows carry team NAMES, and this season's games are a complete name->id
  // map for every team that plays in it — which is exactly the set admission
  // can act on.
  const idsByName = new Map<string, number>();
  for (const g of data.games) {
    idsByName.set(g.homeTeam, g.homeId);
    idsByName.set(g.awayTeam, g.awayId);
  }
  const admission = admitNewFbs(priors, priorsFromSp(data.sp ?? [], idsByName));
  const pool = admission.priors;

  const offense = new Map<number, number>();
  const defense = new Map<number, number>();
  for (const [id, prior] of pool) {
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
        const prior = pool.get(teamId);
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
          homeTeamHfa: hfaOf(g.homeId),
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
        homeFbs: pool.has(g.homeId),
        awayFbs: pool.has(g.awayId),
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
          hfa: hfaOf(g.homeId),
          neutralSite: g.neutralSite,
        },
        params,
      );
      if (pool.has(g.homeId)) {
        offense.set(g.homeId, (offense.get(g.homeId) ?? 0) + upd.homeOffDelta);
        defense.set(g.homeId, (defense.get(g.homeId) ?? 0) + upd.homeDefDelta);
      }
      if (pool.has(g.awayId)) {
        offense.set(g.awayId, (offense.get(g.awayId) ?? 0) + upd.awayOffDelta);
        defense.set(g.awayId, (defense.get(g.awayId) ?? 0) + upd.awayDefDelta);
      }
    }
  }

  const finalRatings = new Map<number, number>();
  const finalTilts = new Map<number, number>();
  for (const [id] of pool) {
    const off = offense.get(id) ?? 0;
    const def = defense.get(id) ?? 0;
    finalRatings.set(id, off + def);
    finalTilts.set(id, (off - def) / 2);
  }
  return {
    predictions,
    finalRatings,
    finalTilts,
    admitted: admission.admitted,
    retired: admission.retired,
  };
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

/**
 * Admit teams promoted to FBS partway through the window, and retire teams
 * that left.
 *
 * ## The defect this fixes
 *
 * `replaySeason` decides "is this team FBS?" by `priors.has(teamId)`, and
 * `priors` is seeded ONCE — from `priorsFromSp(seasons[0].prevSp)` — and then
 * chained forward by `chainPriors`, which carries exactly the key set it was
 * given. `finalRatings` is likewise built by iterating the priors it started
 * with. So the FBS pool is whatever SP+ listed in one year, frozen for the
 * whole window, and a team that joins FBS later never enters it: it is priced
 * at the flat FCS anchor (−30) for every game it plays, in every season, with
 * no error anywhere.
 *
 * At a three-season window seeded from 2022 that is Jacksonville State and Sam
 * Houston (2023) and Kennesaw State (2024) — small enough to have gone
 * unnoticed for the whole life of the backtest. Seeded from 2014 it is also
 * Charlotte, Coastal Carolina, Liberty, UAB's return and James Madison, and it
 * corrupts the FBS-vs-FCS slice — which is precisely the slice `--tune-fcs`
 * exists to fit.
 *
 * This is the same shape as `emptyIsHealthy` and as the caching of `[]`: a
 * default that is correct on a narrow window and wrong on a wide one, with no
 * symptom in between.
 *
 * ## The rule
 *
 * CFBD rates FBS teams in SP+, so presence in season S's SP+ IS the membership
 * test, and the rating is a ready-made seed.
 *
 * Retirement is gated on the feed being HEALTHY for that season rather than on
 * two consecutive absences. A single missing SP+ row is ambiguous between "this
 * team left FBS" and "CFBD is short that year", and the two want opposite
 * treatment — but the ambiguity is only real when the feed itself is thin. When
 * SP+ returns a full slate and a team is not in it, that is a relegation, and
 * `scripts/probe-cfbd-history.ts` is what establishes per-season feed health in
 * the first place. Below the floor nothing is retired, which fails toward
 * keeping a team in the pool: a stale FBS rating on a team that plays no FBS
 * games costs nothing, while wrongly dropping one prices a whole season at −30.
 */
export function admitNewFbs(
  priors: Map<number, number>,
  spThisSeason: Map<number, number>,
  opts: { healthyFloor?: number } = {},
): { priors: Map<number, number>; admitted: number[]; retired: number[] } {
  // No SP+ for this season means no evidence either way — leave the pool alone
  // rather than retiring everybody, which is what an empty map would do.
  if (spThisSeason.size === 0) {
    return { priors: new Map(priors), admitted: [], retired: [] };
  }

  const next = new Map(priors);
  const admitted: number[] = [];
  const retired: number[] = [];

  for (const [id, rating] of spThisSeason) {
    if (!next.has(id)) {
      next.set(id, rating);
      admitted.push(id);
    }
  }

  const healthy = spThisSeason.size >= (opts.healthyFloor ?? 100);
  if (healthy) {
    for (const id of priors.keys()) {
      if (spThisSeason.has(id)) continue;
      next.delete(id);
      retired.push(id);
    }
  }

  return { priors: next, admitted, retired };
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

/**
 * Point-in-time per-team home-field advantage, built from seasons strictly
 * before `before`.
 *
 * Mirrors `build-preseason.ts` step 7 exactly — FBS-vs-FBS only, non-neutral
 * only, `(meanHomeMargin − meanAwayMargin) / 2`, clamped to 0..6 — but with
 * two differences that matter for a replay:
 *
 *  1. **Membership is per-season, not "the current FBS list".** The production
 *     build approximates FBS-vs-FBS by 2026 membership across 2015–2024, which
 *     is a documented approximation there and would be lookahead here.
 *  2. **The window is strictly prior.** A team's HFA for season S is built from
 *     what happened before S, which is the only version of this quantity a
 *     week-1 prediction could have known.
 *
 * 2020 is always excluded, in both directions. An empty-stadium season
 * measures a different quantity, and the whole claim of a per-team HFA is that
 * it measures the same one repeatedly.
 *
 * Returns raw values and their mean; `centeredBlendedHfa` needs both.
 */
export function rawTeamHfa(
  seasons: readonly SeasonData[],
  fbsIds: ReadonlySet<number>,
  opts: { before: number; excludeSeasons?: readonly number[] },
): { raw: Map<number, number>; mean: number | null } {
  const skip = new Set(opts.excludeSeasons ?? [COVID_SEASON]);
  const homeMargins = new Map<number, number[]>();
  const awayMargins = new Map<number, number[]>();

  for (const season of seasons) {
    if (season.season >= opts.before || skip.has(season.season)) continue;
    for (const g of season.games) {
      if (g.homePoints === null || g.awayPoints === null || g.neutralSite) continue;
      // Home slates carry the FCS buy games and away slates do not, so a raw
      // home average is inflated by scheduling rather than by home field
      // (audit 03:M-1b). Restricting to FBS-vs-FBS is the same-source version
      // of SPEC §2.3's residuals.
      if (!fbsIds.has(g.homeId) || !fbsIds.has(g.awayId)) continue;
      const margin = g.homePoints - g.awayPoints;
      homeMargins.set(g.homeId, [...(homeMargins.get(g.homeId) ?? []), margin]);
      awayMargins.set(g.awayId, [...(awayMargins.get(g.awayId) ?? []), -margin]);
    }
  }

  const avg = (xs: number[] | undefined) => (xs && xs.length > 0 ? mean(xs) : null);
  const raw = new Map<number, number>();
  for (const id of new Set([...homeMargins.keys(), ...awayMargins.keys()])) {
    const h = avg(homeMargins.get(id));
    const a = avg(awayMargins.get(id));
    if (h === null || a === null) continue;
    raw.set(id, Math.min(6, Math.max(0, (h - a) / 2)));
  }
  return { raw, mean: raw.size === 0 ? null : mean([...raw.values()]) };
}

/**
 * Split-half correlation of raw team HFA across disjoint prior seasons.
 *
 * This is `--tune-team-hfa`'s Gate 0 and it runs before any MAE is computed.
 * If a team's home edge does not correlate with itself across two disjoint
 * samples, there is no per-team signal to blend and `teamHfaBlend` is 0 — no
 * downstream accuracy number can rescue a quantity that does not reproduce.
 * Odd and even years, 2020 excluded from both.
 */
export function hfaSplitHalf(
  seasons: readonly SeasonData[],
  fbsIds: ReadonlySet<number>,
  before: number,
): { r: number; n: number } {
  const all = seasons.filter((s) => s.season < before && s.season !== COVID_SEASON);
  const odd = all.filter((s) => s.season % 2 === 1);
  const even = all.filter((s) => s.season % 2 === 0);
  const a = rawTeamHfa(odd, fbsIds, { before }).raw;
  const b = rawTeamHfa(even, fbsIds, { before }).raw;

  const ids = [...a.keys()].filter((id) => b.has(id));
  if (ids.length < 3) return { r: NaN, n: ids.length };
  const xs = ids.map((id) => a.get(id) as number);
  const ys = ids.map((id) => b.get(id) as number);
  const mx = mean(xs);
  const my = mean(ys);
  const cov = mean(xs.map((x, i) => (x - mx) * (ys[i] - my)));
  const sx = Math.sqrt(mean(xs.map((x) => (x - mx) ** 2)));
  const sy = Math.sqrt(mean(ys.map((y) => (y - my) ** 2)));
  return { r: sx === 0 || sy === 0 ? NaN : cov / (sx * sy), n: ids.length };
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
