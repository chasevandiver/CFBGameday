/**
 * The CFB Slate prediction model — pure functions, no I/O.
 * All parameters live in ModelParams so the backtest can tune them
 * and every prediction can be attributed to a model_version.
 * Spec: docs/SPEC.md §2.
 */

// 2026.1.0: params tuned on the 2023–2025 backtest (K/HFA grid + σ fit +
// slope calibrated to σ). Calibration within ~2pts in every win-prob bucket.
// 2026.2.0: talent-composite field fix (was silently defaulting for all
// teams), prior-year baseline blends replay finals 50/50 with final SP+
// (--tune-sp-blend): opponent adjustment fixes G5 schedule-pocket inflation.
// Both experiments re-validated with talent flowing; carryover optimum 0.70.
// 2026.3.0: off/def sub-ratings carry the replay (§2.2) and preseason halves
// tilt from prior-season SP+ off/def — totals are real predictions from this
// version on (2023–25 calibration: model MAE 13.09 vs constant 13.72).
// Pre-2026.3.0 rows priced totals as a constant; the UI must never show them.
// 2026.4.0: preseason off/def halves carry 40% of the prior season's SHAPE
// (PRESEASON_TILT_CARRY, fit by --tune-preseason-tilts: weeks 1–2 totals MAE
// 13.34 vs 13.72 for an even split, weeks 1–4 12.93 vs 13.16). Week-0/1 totals
// are real predictions from this version rather than the withheld constant.
// Margins are unchanged — tilt is margin-neutral by construction.
// 2026.4.0 also restructures churn: the "defense" input was a second, correlated
// OFFENSE metric (CFBD publishes no defensive returning production), so offense
// was double-counted at ×5+×5, defense was never modeled, and the ±6 clamp
// saturated for 28 of 138 teams in the 2026 build. Now one fitted weight plus a
// talent-reload term, because blue bloods lose the most production and replace
// it with blue-chips — Alabama carried the second-highest talent in the file and
// ranked 26th.
//
// Three sibling experiments ran and did NOT earn a change. Their machinery
// stays at identity defaults; recorded here so it isn't re-litigated:
//   - week-aware sigma (paramsForWeek/priorSigmaExtra): flat sigma won. Early
//     weeks fit a larger sigma only because cupcake blowouts give huge
//     residuals with near-certain winners — that is not directional
//     uncertainty, and widening made early-week NLL worse (0.3972 → 0.3992).
//   - coach QUALITY (newHcSlope): inert. NLL flat across slope values, and
//     every strong hire clamps to the same adjustment. The new-HC intercept
//     does help, but its fit was still unconverged at the grid edge.
//   - preseason anchors (week-1 Elo, preseason AP): ΔNLL 0.0026 vs a
//     pre-registered bar of 0.003. Missed, so not adopted.
export const MODEL_VERSION = "2026.4.0";

/**
 * Did this model version price totals for real? Rows frozen before 2026.3.0
 * stored the degenerate constant-57 total (audit bug #4) — those are history,
 * kept append-only, but their totals must not render as predictions.
 */
export function hasCalibratedTotals(modelVersion: string): boolean {
  const [y, major] = modelVersion.split(".").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(major)) return false;
  return y > 2026 || (y === 2026 && major >= 3);
}

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
  /**
   * Extra margin uncertainty carried by the preseason prior, points. Total
   * sigma at a given week is sqrt(marginSigma² + priorSigmaExtra²·w²) where w
   * is that week's prior weight — see paramsForWeek. 0 = flat sigma (the
   * behavior every version through 2026.3.0 shipped); fit by
   * `backtest.ts --tune-sigma`.
   */
  priorSigmaExtra: number;
  /**
   * Continuous coaching adjustment (coachingAdjustmentContinuous):
   * year-one install cost for ANY new head coach, and how much of it a proven
   * hire claws back per point of historical over-performance. Both 0 = no
   * coaching signal (the v1 behavior); fit by `backtest.ts --tune-coaching`.
   */
  newHcIntercept: number;
  newHcSlope: number;
  /**
   * Points of churn per unit of returning production above/below the FBS
   * average. Replaces the old implicit weight of 10 (two ×5 terms that were
   * assumed independent but were both offense). Fit by `--tune-churn`.
   */
  /**
   * How much of the rating update comes from per-play efficiency (PPA) rather
   * than the scoreboard. 0 = scores only, the behavior every version through
   * 2026.4.0 shipped; 1 = the margin signal is entirely efficiency-based.
   *
   * TESTED AND REJECTED — stays 0. `--tune-epa` over 2023–25 (PPA present for
   * ~1500-1650 games/season, so not a coverage problem):
   *
   *   weight   margin MAE   NLL      early MAE
   *   0.00     13.254       0.5005   14.24
   *   0.30     13.244       0.5013   14.26   ← best MAE
   *   1.00     13.378       0.5095   14.38
   *
   * The best case buys 0.010 points of MAE while NLL degrades monotonically
   * and early-season MAE gets worse. It fails on every axis that matters.
   *
   * Why the obvious idea didn't work: swapping the scoreboard margin for a
   * PPA-implied margin still feeds ONE noisy per-game number into an Elo update
   * that already averages over a dozen games. What actually separates SP+ from
   * a margin model is not "plays instead of points" — it is opponent-adjusted
   * regression across all plays, garbage-time filtering, and success-rate vs
   * explosiveness decomposition with special teams modeled separately. That is
   * a different rating system, not a different input to this one. Building it
   * is a real option; blending PPA into this update is not the shortcut to it.
   */
  epaWeight: number;
  returningProdWeight: number;
  /**
   * How much a high-talent roster blunts the returning-production term
   * (0 = off, 1 = the most talented roster ignores it entirely). Fit by
   * `--tune-churn`.
   */
  talentReloadStrength: number;
}

export const DEFAULT_PARAMS: ModelParams = {
  kFactor: 0.3,
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
  marginSigma: 16.8,
  winProbSlope: 0.101,
  edgeThreshold: 2,
  bigEdgeThreshold: 4,
  fcsTopRating: -25,
  fcsOtherRating: -35,
  // Identity defaults: each of these reproduces the 2026.3.0 math exactly.
  // They stay 0 until the corresponding backtest tuner earns a value under
  // its pre-registered decision rule (docs/SPEC.md §2.5).
  priorSigmaExtra: 0,
  newHcIntercept: 0,
  newHcSlope: 0,
  // Identity until --tune-epa earns it: 0 reproduces the score-only model.
  epaWeight: 0,
  // --tune-churn, NOT the argmin — a deliberate choice, recorded as such.
  //
  // The likelihood surface is flat: everything from weight 6–10 × reload 1–2
  // scores NLL 0.3940–0.3944, and the argmin slid to whichever grid edge it
  // was given (1.0, then 2.0 when the grid widened). That is an unidentified
  // parameter, not a signal. The global argmin (weight 10, reload 2) is worse
  // on two counts anyway: reload > 1 flips the interaction's sign, implying
  // lost production *helps* a blue blood, and it saturates the ±6 clamp for
  // 7.1% of teams. 6/1.0 sits in the interior, clamps nobody, is within 0.0004
  // of the minimum, and means "the most talented roster fully neutralizes the
  // penalty" rather than reverses it.
  //
  // What IS robust: the old setting (effectively weight 10, no reload) scored
  // 0.3968 — worse than switching churn off entirely at 0.3964. The gain from
  // fitting is ~0.002 NLL / 0.19 MAE, inside the ~0.25 standard error, so the
  // defensible claim is "a harmful setting was removed", not "churn improved".
  returningProdWeight: 6,
  talentReloadStrength: 1,
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
  /**
   * Returning production, 0..1 (CFBD `percentPPA`).
   *
   * ONE term, not two. This previously took an "offense" and a "defense"
   * value, but every field CFBD publishes on /player/returning — percentPPA,
   * usage, passingUsage — is an offensive PPA/usage measure. There is no
   * defensive counterpart in the payload, so the old "defense" input was fed
   * `usage`: a second, correlated *offense* metric. Each was scaled ×5, which
   * double-counted offense, left defense unmodeled, and saturated the ±6 clamp
   * (Alabama, Penn State and Auburn all pinned at −6.0 in the 2026 build).
   * Treat it honestly as a whole-roster proxy with a single fitted weight.
   */
  returningProduction: number;
  /** True if the primary QB (by prior-season usage) returns; null = unknown (no signal) */
  qbReturns: boolean | null;
  /** OL returning starts as a share of 5 × games, 0..1 */
  olReturningShare: number;
  /** Net portal points: sum of incoming impact minus outgoing impact, rating points */
  netPortalPoints: number;
  /** Count of incoming blue-chip (4/5-star) freshmen */
  blueChipFreshmen: number;
  /**
   * Talent baseline in rating points, for the reload interaction. Blue bloods
   * lose the most production to the NFL and so score worst on returning
   * production — but their replacements are also blue-chips. Applying churn
   * and talent additively double-penalizes exactly the programs that reload.
   * null disables the interaction.
   */
  talentBaseline?: number | null;
}

/**
 * Churn adjustment, clamped ±6 (§2.1). Returning production is centered on the
 * FBS average (~60%) so an average roster churns to 0; QB and OL carry extra
 * weight.
 *
 * `talentReloadStrength` scales the returning-production term down for
 * high-talent rosters and up for low-talent ones: losing your stars hurts a
 * MAC team far more than it hurts Georgia. 0 disables it.
 */
export function churnAdjustment(c: ChurnInputs, p: ModelParams = DEFAULT_PARAMS): number {
  const AVG_RETURNING = 0.6;
  // Talent is on the ±18 rating-point scale (z × 5.5, clamped in the builder).
  const talentZ =
    c.talentBaseline === null || c.talentBaseline === undefined
      ? 0
      : clamp(c.talentBaseline / 18, -1, 1);
  const reload = clamp(1 - p.talentReloadStrength * talentZ, 0, 2);
  const core = (c.returningProduction - AVG_RETURNING) * p.returningProdWeight * reload;
  // ~2x weight embedded relative to a generic starter; unknown = no signal
  const qb = c.qbReturns === null ? 0 : c.qbReturns ? 1.0 : -1.0;
  const ol = (c.olReturningShare - 0.5) * 3; // ~1.5x weight
  const freshmen = Math.min(c.blueChipFreshmen * 0.1, 0.75);
  const raw = core + qb + ol + c.netPortalPoints + freshmen;
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

export interface CoachTransitionInputs {
  /** Did the head coach change from last season? */
  newHc: boolean;
  /**
   * How much the incoming coach's past teams beat the baseline of the programs
   * he ran, in SP+ points (games-weighted). null = no prior HC history (a
   * first-time head coach), which carries the install cost but no quality
   * signal. Built by scripts/lib/coaching.ts from CFBD /coaches.
   */
  overPerf: number | null;
}

/**
 * Coaching adjustment from the incoming coach's own record (§2.1).
 *
 * A new head coach costs something in year one regardless of pedigree
 * (newHcIntercept — scheme install, staff turnover, roster fit); a coach whose
 * teams have historically outrun their program's baseline claws some of that
 * back (newHcSlope × overPerf). Deliberately a 2-parameter clamped linear
 * model: there are only ~20-30 FBS head-coach changes a year, so anything
 * richer would fit noise.
 *
 * Both parameters are 0 by default, making this a no-op until
 * `backtest.ts --tune-coaching` fits them — the v1 behavior was a hardcoded 0
 * for every team.
 */
export function coachingAdjustmentContinuous(
  c: CoachTransitionInputs,
  p: ModelParams = DEFAULT_PARAMS,
): number {
  if (!c.newHc) return 0;
  // Clamp the quality signal before it is scaled: one outlier tenure (a coach
  // who lapped a bad program) must not swing a preseason rating on its own.
  const quality = c.overPerf === null ? 0 : clamp(c.overPerf, -8, 8);
  return clamp(p.newHcIntercept + p.newHcSlope * quality, -4, 3);
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

export interface SubRatingUpdateInput {
  homeOffense: number;
  homeDefense: number;
  awayOffense: number;
  awayDefense: number;
  homePoints: number;
  awayPoints: number;
  /** Home team's HFA; ignored when neutralSite */
  hfa: number;
  neutralSite: boolean;
}

export interface SubRatingUpdate {
  homeOffDelta: number;
  homeDefDelta: number;
  awayOffDelta: number;
  awayDefDelta: number;
}

/**
 * Off/def sub-rating update from points scored/allowed vs opponent-adjusted
 * expectation (§2.2). Each scoring error splits between the offense that
 * produced it and the defense that allowed it.
 *
 * Invariant: a team's off+def deltas sum to exactly its overall delta from
 * updateFromResult whenever the caps don't bind — homeOff + homeDef moves by
 * K·(errHome − errAway)/2, the overall update's K·marginError/2. So a replay
 * can carry ONLY off/def (overall ≡ off + def) and reproduce the margin
 * behavior the backtest already tuned, while totals gain real signal.
 * Scoring errors cap at marginCap/2 per side so the summed cap matches the
 * overall margin cap.
 */
export function updateSubRatings(
  inp: SubRatingUpdateInput,
  p: ModelParams = DEFAULT_PARAMS,
): SubRatingUpdate {
  const hfa = inp.neutralSite ? 0 : inp.hfa;
  const expHome = FBS_AVG_POINTS + inp.homeOffense - inp.awayDefense + hfa / 2;
  const expAway = FBS_AVG_POINTS + inp.awayOffense - inp.homeDefense - hfa / 2;
  const cap = p.marginCap / 2;
  const errHome = clamp(inp.homePoints - expHome, -cap, cap);
  const errAway = clamp(inp.awayPoints - expAway, -cap, cap);
  const k = p.kFactor;
  return {
    homeOffDelta: (k * errHome) / 2,
    awayDefDelta: -(k * errHome) / 2,
    awayOffDelta: (k * errAway) / 2,
    homeDefDelta: -(k * errAway) / 2,
  };
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

/**
 * Margin uncertainty is not constant across a season (§2.3). In week 1 the
 * rating IS the preseason prior — an estimate of a team that has not played —
 * so the spread of actual margins around our prediction is wider than the
 * pooled full-season sigma the params carry. Treating them as equal is the
 * model claiming it knows as much on opening weekend as it does in November,
 * and it makes early win/cover probabilities overconfident (which flows
 * straight into ¼-Kelly stake sizing via cover_prob).
 *
 * Model: the prior contributes an independent error term that decays exactly
 * as the prior's own weight does, so
 *   σ(week)² = marginSigma² + priorSigmaExtra² · priorWeight(week)²
 * and the logistic slope stays tied to it by the usual logistic≈normal rule
 * (1.7/σ, the same relation backtest.ts uses when it refits).
 *
 * With priorSigmaExtra = 0 this returns the params unchanged — an exact
 * identity, so every pre-existing caller and test is unaffected.
 */
export function paramsForWeek(week: number, p: ModelParams = DEFAULT_PARAMS): ModelParams {
  if (!p.priorSigmaExtra) return p;
  const w = priorWeight(week, p);
  const sigma = Math.sqrt(p.marginSigma ** 2 + (p.priorSigmaExtra * w) ** 2);
  return { ...p, marginSigma: sigma, winProbSlope: 1.7 / sigma };
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

export const FBS_AVG_POINTS = 28.5; // average team points/game baseline for projections

/** Below this, a team's off/def halves are "even" for totals purposes. */
export const SPLIT_EPSILON = 0.01;

/**
 * Do these ratings carry a real off/def split?
 *
 * priceGame's projected total is
 *   (28.5 + homeOff − awayDef + 28.5 + awayOff − homeDef) × tempoFactor
 * and with a pure even split (offense = defense = overall/2) every one of
 * those team terms cancels: the total collapses to 2 × 28.5 × tempoFactor —
 * exactly 57.0 at tempo 70 — for every game on the board, regardless of who
 * is playing. That is a constant, not a prediction, so callers must store
 * null instead of dressing it up as one (audit bug #4).
 *
 * Shared by freezeJob and the preseason builder so the two paths can't drift.
 */
export function splitInformative(
  ratings: Iterable<{ offense: number; defense: number }>,
): boolean {
  for (const r of ratings) {
    if (Math.abs(r.offense - r.defense) > SPLIT_EPSILON) return true;
  }
  return false;
}

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
