/**
 * The CFB Slate prediction model — pure functions, no I/O.
 * All parameters live in ModelParams so the backtest can tune them
 * and every prediction can be attributed to a model_version.
 * Spec: docs/SPEC.md §2.
 */

export const MODEL_VERSION = "2026.0.1";

export interface ModelParams {
  /** Elo-style learning rate on capped margin error */
  kFactor: number;
  /** Blowout cap on margin, points */
  marginCap: number;
  /** FBS-average home field advantage, points */
  baseHfa: number;
  /** Weight of a team's own historical HFA vs the FBS average (0..1) */
  teamHfaBlend: number;
  /** Preseason blend: weight on previous season's final rating */
  priorRatingWeight: number; // 0.70
  /** Preseason blend: weight on talent baseline */
  talentWeight: number; // 0.30
  /** Prior weight by week for in-season decay; interpolated between knots */
  priorDecayKnots: Array<[week: number, weight: number]>;
  /** Std dev of actual margin around predicted margin (fit in backtest) */
  marginSigma: number;
  /** Logistic slope for win probability */
  winProbSlope: number;
  /** Edge flag thresholds, points */
  edgeThreshold: number;
  bigEdgeThreshold: number;
  /** Generic FCS opponent ratings vs average FBS */
  fcsTopRating: number;
  fcsOtherRating: number;
}

export const DEFAULT_PARAMS: ModelParams = {
  kFactor: 0.175,
  marginCap: 28,
  baseHfa: 2.3,
  teamHfaBlend: 0.5,
  priorRatingWeight: 0.7,
  talentWeight: 0.3,
  priorDecayKnots: [
    [0, 1.0],
    [4, 0.5],
    [8, 0.15],
    [12, 0.05],
  ],
  marginSigma: 15.5,
  winProbSlope: 0.145,
  edgeThreshold: 2,
  bigEdgeThreshold: 4,
  fcsTopRating: -25,
  fcsOtherRating: -35,
};

export interface TeamRating {
  overall: number;
  offense: number;
  defense: number;
  tempo: number; // plays/game
}

// ---------------------------------------------------------------------------
// Preseason prior (§2.1)
// ---------------------------------------------------------------------------

export interface PreseasonInputs {
  /** Final rating from previous season; null for new FBS entrants */
  finalPrevRating: number | null;
  /** Rating-scale baseline from 4-yr recruiting talent composite */
  talentBaseline: number;
  churnAdjustment: number;
  coachingAdjustment: number;
  luckCorrection: number;
}

export function preseasonRating(inp: PreseasonInputs, p: ModelParams = DEFAULT_PARAMS): number {
  // New FBS entrants: talent only (§2.1 v2 edge-case rules)
  const base =
    inp.finalPrevRating === null
      ? inp.talentBaseline
      : p.priorRatingWeight * inp.finalPrevRating + p.talentWeight * inp.talentBaseline;
  return base + inp.churnAdjustment + inp.coachingAdjustment + inp.luckCorrection;
}

export interface ChurnInputs {
  /** CFBD percentPPA-style returning production, 0..1 */
  returningProductionOffense: number;
  returningProductionDefense: number;
  /** True if the primary QB (by prior-season usage) returns */
  qbReturns: boolean;
  /** OL returning starts as a share of 5 × games, 0..1 */
  olReturningShare: number;
  /** Net portal points: sum of incoming impact minus outgoing impact, rating points */
  netPortalPoints: number;
  /** Count of incoming blue-chip (4/5-star) freshmen */
  blueChipFreshmen: number;
}

/**
 * Churn adjustment, typical range −6..+6 (§2.1).
 * Returning production is centered on the FBS average (~60%) so an average
 * roster churns to 0 adjustment; QB and OL carry extra weight.
 */
export function churnAdjustment(c: ChurnInputs): number {
  const AVG_RETURNING = 0.6;
  const offCore = (c.returningProductionOffense - AVG_RETURNING) * 5;
  const defCore = (c.returningProductionDefense - AVG_RETURNING) * 5;
  const qb = c.qbReturns ? 1.0 : -1.0; // ~2x weight embedded relative to a generic starter
  const ol = (c.olReturningShare - 0.5) * 3; // ~1.5x weight
  const freshmen = Math.min(c.blueChipFreshmen * 0.1, 0.75);
  const raw = offCore + defCore + qb + ol + c.netPortalPoints + freshmen;
  return clamp(raw, -6, 6);
}

export type CoachingChange =
  | { type: "intact" }
  | { type: "new_hc"; hireQuality: "strong" | "average" | "reach" }
  | { type: "new_coordinator"; count: 1 | 2 };

export function coachingAdjustment(change: CoachingChange): number {
  switch (change.type) {
    case "intact":
      return 0;
    case "new_hc":
      return change.hireQuality === "strong" ? -1 : change.hireQuality === "average" ? -2 : -3;
    case "new_coordinator":
      return change.count === 1 ? -0.75 : -1.5;
  }
}

export interface LuckInputs {
  actualWins: number;
  secondOrderWins: number; // from postgame win expectancy
  turnoverMargin: number;
  oneScoreWins: number;
  oneScoreLosses: number;
}

/** Luck correction, ±3 max (§2.1): overachievers regressed down, underachievers up. */
export function luckCorrection(l: LuckInputs): number {
  let points = -(l.actualWins - l.secondOrderWins) * 0.6;
  if (l.turnoverMargin > 8) points -= 0.5;
  if (l.turnoverMargin < -8) points += 0.5;
  const oneScoreGames = l.oneScoreWins + l.oneScoreLosses;
  if (oneScoreGames >= 5) {
    const rate = l.oneScoreWins / oneScoreGames;
    if (rate >= 0.8) points -= 0.5;
    if (rate <= 0.2) points += 0.5;
  }
  return clamp(points, -3, 3);
}

// ---------------------------------------------------------------------------
// In-season updating (§2.2)
// ---------------------------------------------------------------------------

export interface GameResultInput {
  homeRating: number;
  awayRating: number;
  predictedMargin: number; // home perspective, includes HFA etc.
  actualHomeMargin: number;
}

export interface RatingUpdate {
  homeDelta: number;
  awayDelta: number;
}

/** Elo-style update on capped margin error, split between the two teams. */
export function updateFromResult(g: GameResultInput, p: ModelParams = DEFAULT_PARAMS): RatingUpdate {
  const capped = clamp(g.actualHomeMargin, -p.marginCap, p.marginCap);
  const cappedPrediction = clamp(g.predictedMargin, -p.marginCap, p.marginCap);
  const error = capped - cappedPrediction;
  const delta = p.kFactor * error;
  return { homeDelta: delta / 2, awayDelta: -delta / 2 };
}

/** Piecewise-linear prior weight for a given week (§2.2 decay schedule). */
export function priorWeight(week: number, p: ModelParams = DEFAULT_PARAMS): number {
  const knots = p.priorDecayKnots;
  if (week <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [w1, v1] = knots[i];
    const [w0, v0] = knots[i - 1];
    if (week <= w1) {
      const t = (week - w0) / (w1 - w0);
      return v0 + t * (v1 - v0);
    }
  }
  return knots[knots.length - 1][1];
}

/** Blend the preseason prior with the results-to-date rating at a given week. */
export function blendWithPrior(
  preseason: number,
  resultsRating: number,
  week: number,
  p: ModelParams = DEFAULT_PARAMS,
): number {
  const w = priorWeight(week, p);
  return w * preseason + (1 - w) * resultsRating;
}

// ---------------------------------------------------------------------------
// Pricing a game (§2.3–2.4)
// ---------------------------------------------------------------------------

export interface PricingInputs {
  home: TeamRating;
  away: TeamRating;
  /** Home team's blended HFA; ignored when neutralSite */
  homeTeamHfa: number;
  neutralSite: boolean;
  /** Sum of admin-confirmed situational adjustments, home perspective (QB out, rest, travel, weather) */
  situationalPoints: number;
  /** Canonical Vegas spread, home perspective (negative = home favored); null when no line */
  vegasSpread: number | null;
  /** Other systems for the consensus flag, model-spread convention (positive = home better) */
  spPlusMargin?: number | null;
  fpiMargin?: number | null;
  eloMargin?: number | null;
}

export interface GamePrice {
  /** Model margin, home perspective: positive = home favored by that many */
  margin: number;
  /** Same number in Vegas convention (negative = home favored) */
  spread: number;
  homeWinProb: number;
  projectedHomeScore: number;
  projectedAwayScore: number;
  projectedTotal: number;
  /** vs Vegas: model_spread − vegas_spread (home perspective); null when no line */
  edge: number | null;
  edgeFlag: "EDGE" | "BIG_EDGE" | null;
  /** P(home covers vegasSpread); null when no line */
  homeCoverProb: number | null;
  consensusFlag: boolean;
}

const FBS_AVG_POINTS = 28.5; // average team points/game baseline for projections

export function priceGame(inp: PricingInputs, p: ModelParams = DEFAULT_PARAMS): GamePrice {
  const hfa = inp.neutralSite ? 0 : inp.homeTeamHfa;
  const margin =
    inp.home.overall - inp.away.overall + hfa + inp.situationalPoints;

  const homeWinProb = 1 / (1 + Math.exp(-p.winProbSlope * margin));

  // Projected score from off/def sub-ratings + tempo (§2.3). Sub-ratings are
  // points vs average; tempo scales the baseline.
  const tempoFactor = (inp.home.tempo + inp.away.tempo) / (2 * 70); // 70 plays/gm ~ average
  const homeScore =
    (FBS_AVG_POINTS + inp.home.offense - inp.away.defense) * tempoFactor + (inp.neutralSite ? 0 : hfa / 2);
  const awayScore =
    (FBS_AVG_POINTS + inp.away.offense - inp.home.defense) * tempoFactor - (inp.neutralSite ? 0 : hfa / 2);

  let edge: number | null = null;
  let edgeFlag: "EDGE" | "BIG_EDGE" | null = null;
  let homeCoverProb: number | null = null;
  let consensusFlag = false;

  if (inp.vegasSpread !== null) {
    const modelSpread = -margin; // convert to Vegas convention
    edge = modelSpread - inp.vegasSpread;
    const abs = Math.abs(edge);
    edgeFlag = abs >= p.bigEdgeThreshold ? "BIG_EDGE" : abs >= p.edgeThreshold ? "EDGE" : null;
    // P(home covers): P(actual margin > -vegasSpread), margin ~ N(model margin, sigma)
    homeCoverProb = 1 - normalCdf(-inp.vegasSpread, margin, p.marginSigma);

    // Consensus: model + SP+ + FPI + Elo all disagree with the line the same way
    const vegasMargin = -inp.vegasSpread;
    const systems = [margin, inp.spPlusMargin, inp.fpiMargin, inp.eloMargin];
    if (systems.every((s) => s !== null && s !== undefined)) {
      const dirs = (systems as number[]).map((s) => Math.sign(s - vegasMargin));
      consensusFlag = dirs.every((d) => d === dirs[0] && d !== 0);
    }
  }

  return {
    margin,
    spread: -margin,
    homeWinProb,
    projectedHomeScore: homeScore,
    projectedAwayScore: awayScore,
    projectedTotal: homeScore + awayScore,
    edge,
    edgeFlag,
    homeCoverProb,
    consensusFlag,
  };
}

/** Team HFA blended 50/50 (by default) with the FBS average (§2.3). */
export function blendedHfa(teamRawHfa: number | null, p: ModelParams = DEFAULT_PARAMS): number {
  if (teamRawHfa === null) return p.baseHfa;
  return p.teamHfaBlend * teamRawHfa + (1 - p.teamHfaBlend) * p.baseHfa;
}

// ---------------------------------------------------------------------------
// Bet sizing (§5.4): ¼ Kelly, hard-capped at 2 units
// ---------------------------------------------------------------------------

export function suggestedStake(coverProb: number, americanOdds = -110): number {
  const b = americanOdds > 0 ? americanOdds / 100 : 100 / -americanOdds;
  const kelly = (coverProb * (b + 1) - 1) / b;
  const quarter = Math.max(kelly, 0) / 4;
  // Stake as units where full Kelly on a 100u bankroll ~ percentage points
  return Math.min(round1(quarter * 100), 2);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** Standard normal CDF via Abramowitz–Stegun approximation. */
export function normalCdf(x: number, mean = 0, sigma = 1): number {
  const z = (x - mean) / (sigma * Math.SQRT2);
  return 0.5 * (1 + erf(z));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}
