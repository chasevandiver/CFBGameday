import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAMS,
  blendWithPrior,
  blendedHfa,
  centeredBlendedHfa,
  churnAdjustment,
  coachingAdjustment,
  luckCorrection,
  normalCdf,
  preseasonRating,
  priceGame,
  priorWeight,
  updateFromResult,
  type PricingInputs,
  type TeamRating,
  coachingAdjustmentContinuous,
  hasCalibratedTotals,
  paramsForWeek,
  splitInformative,
  updateSubRatings,
} from "./ratings";

const avgTeam: TeamRating = { overall: 0, offense: 0, defense: 0, tempo: 70 };
const team = (overall: number, off = overall / 2, def = overall / 2): TeamRating => ({
  overall,
  offense: off,
  defense: def,
  tempo: 70,
});

const basePricing = (overrides: Partial<PricingInputs> = {}): PricingInputs => ({
  home: avgTeam,
  away: avgTeam,
  homeTeamHfa: 2.3,
  neutralSite: false,
  situationalPoints: 0,
  vegasSpread: null,
  ...overrides,
});

describe("preseason rating", () => {
  it("blends 70/30 between last season and talent", () => {
    const r = preseasonRating({
      finalPrevRating: 10,
      talentBaseline: 20,
      churnAdjustment: 0,
      coachingAdjustment: 0,
      luckCorrection: 0,
    });
    expect(r).toBeCloseTo(0.7 * 10 + 0.3 * 20);
  });

  it("uses talent alone for new FBS entrants", () => {
    const r = preseasonRating({
      finalPrevRating: null,
      talentBaseline: -8,
      churnAdjustment: 0,
      coachingAdjustment: 0,
      luckCorrection: 0,
    });
    expect(r).toBe(-8);
  });
});

describe("churn adjustment", () => {
  const base = {
    returningProduction: 0.6,
    qbReturns: true as boolean | null,
    olReturningShare: 0.5,
    netPortalPoints: 0,
    blueChipFreshmen: 0,
  };

  it("is ~0 for an average-churn roster", () => {
    expect(Math.abs(churnAdjustment(base))).toBeLessThanOrEqual(1.5);
  });

  it("clamps to the −6..+6 range", () => {
    const gutted = churnAdjustment({
      ...base,
      returningProduction: 0.05,
      qbReturns: false,
      olReturningShare: 0,
      netPortalPoints: -4,
    });
    expect(gutted).toBe(-6);
    const loaded = churnAdjustment({
      ...base,
      returningProduction: 0.95,
      olReturningShare: 1,
      netPortalPoints: 4,
      blueChipFreshmen: 5,
    });
    expect(loaded).toBe(6);
  });

  it("scales with the fitted weight, so the clamp isn't doing the fitting", () => {
    const hot = churnAdjustment({ ...base, returningProduction: 0.3 }, DEFAULT_PARAMS);
    const cool = churnAdjustment(
      { ...base, returningProduction: 0.3 },
      { ...DEFAULT_PARAMS, returningProdWeight: 4 },
    );
    expect(hot).toBeLessThan(cool); // both negative; the hot weight is more so
  });

  it("blunts returning production for high-talent rosters when reload is on", () => {
    // Blue bloods lose the most production but replace it with blue-chips.
    // With reload on, the same weak returning number costs Alabama less.
    const params = { ...DEFAULT_PARAMS, talentReloadStrength: 0.75 };
    const bluechip = churnAdjustment(
      { ...base, returningProduction: 0.3, talentBaseline: 18 },
      params,
    );
    const g5 = churnAdjustment(
      { ...base, returningProduction: 0.3, talentBaseline: -12 },
      params,
    );
    expect(bluechip).toBeGreaterThan(g5);
  });

  it("reload strength 0 ignores talent entirely", () => {
    const off = { ...DEFAULT_PARAMS, talentReloadStrength: 0 };
    const withTalent = churnAdjustment(
      { ...base, returningProduction: 0.3, talentBaseline: 18 },
      off,
    );
    const without = churnAdjustment(
      { ...base, returningProduction: 0.3, talentBaseline: null },
      off,
    );
    expect(withTalent).toBe(without);
  });

  it("at the fitted reload of 1, max talent fully neutralizes the penalty", () => {
    // The reason 1.0 was chosen over the argmin of 2.0: at 1 the most talented
    // roster stops being punished for lost production; above 1 it would start
    // being *rewarded* for it, which is not a real mechanism.
    const maxTalent = churnAdjustment(
      { ...base, returningProduction: 0.2, talentBaseline: 18 },
      DEFAULT_PARAMS,
    );
    const neutralTalent = churnAdjustment(
      { ...base, returningProduction: 0.2, talentBaseline: 0 },
      DEFAULT_PARAMS,
    );
    // core term vanishes at max talent, so only QB/OL/portal/freshmen remain
    expect(maxTalent).toBeGreaterThan(neutralTalent);
    expect(maxTalent - neutralTalent).toBeCloseTo(
      (0.2 - 0.6) * -DEFAULT_PARAMS.returningProdWeight,
      6,
    );
  });
});

describe("coaching adjustment", () => {
  it("matches spec ranges", () => {
    expect(coachingAdjustment({ type: "intact" })).toBe(0);
    expect(coachingAdjustment({ type: "new_hc", hireQuality: "strong" })).toBe(-1);
    expect(coachingAdjustment({ type: "new_hc", hireQuality: "reach" })).toBe(-3);
    expect(coachingAdjustment({ type: "new_coordinator", count: 2 })).toBe(-1.5);
  });
});

describe("luck correction", () => {
  it("regresses overachievers down and underachievers up, capped at ±3", () => {
    const over = luckCorrection({
      actualWins: 11,
      secondOrderWins: 7.5,
      turnoverMargin: 12,
      oneScoreWins: 5,
      oneScoreLosses: 1,
    });
    expect(over).toBe(-3);
    const under = luckCorrection({
      actualWins: 4,
      secondOrderWins: 7,
      turnoverMargin: -10,
      oneScoreWins: 0,
      oneScoreLosses: 5,
    });
    expect(under).toBeGreaterThan(0);
    expect(under).toBeLessThanOrEqual(3);
  });
});

describe("in-season update", () => {
  it("moves both teams by half the K-scaled error, opposite directions", () => {
    const upd = updateFromResult(
      { homeRating: 5, awayRating: 0, predictedMargin: 7, actualHomeMargin: 17 },
      { ...DEFAULT_PARAMS, kFactor: 0.2 },
    );
    // error = 10, delta = 2
    expect(upd.homeDelta).toBeCloseTo(1);
    expect(upd.awayDelta).toBeCloseTo(-1);
  });

  it("caps blowout margins at ±28", () => {
    const upd = updateFromResult(
      { homeRating: 0, awayRating: 0, predictedMargin: 0, actualHomeMargin: 56 },
      { ...DEFAULT_PARAMS, kFactor: 0.2 },
    );
    expect(upd.homeDelta).toBeCloseTo((0.2 * 28) / 2);
  });
});

describe("prior decay", () => {
  it("follows the spec knots and interpolates between them", () => {
    expect(priorWeight(0)).toBe(1);
    expect(priorWeight(4)).toBe(0.5);
    expect(priorWeight(8)).toBeCloseTo(0.15);
    expect(priorWeight(12)).toBe(0.05);
    expect(priorWeight(14)).toBe(0.05); // beyond last knot stays flat
    expect(priorWeight(2)).toBeCloseTo(0.75);
  });

  it("blends prior and results by the week weight", () => {
    expect(blendWithPrior(10, 0, 4)).toBeCloseTo(5);
  });
});

describe("pricing", () => {
  it("a 7-point-better home team at home is favored by ~9.3 and wins ~74%", () => {
    const price = priceGame(basePricing({ home: team(7) }));
    expect(price.margin).toBeCloseTo(9.3);
    expect(price.spread).toBeCloseTo(-9.3);
    expect(price.homeWinProb).toBeGreaterThan(0.7);
    expect(price.homeWinProb).toBeLessThan(0.85);
  });

  it("zeroes HFA at neutral sites", () => {
    const price = priceGame(basePricing({ home: team(7), neutralSite: true }));
    expect(price.margin).toBeCloseTo(7);
  });

  it("an even game at home is roughly a coin flip plus home field", () => {
    const price = priceGame(basePricing());
    expect(price.homeWinProb).toBeGreaterThan(0.5);
    expect(price.homeWinProb).toBeLessThan(0.62);
    expect(price.projectedTotal).toBeCloseTo(57, 0);
  });

  it("flags edges vs the Vegas line and computes cover probability", () => {
    // Model says home -9.3; Vegas has home -4.5 → edge = -4.8 → BIG EDGE on home
    const price = priceGame(basePricing({ home: team(7), vegasSpread: -4.5 }));
    expect(price.edge).toBeCloseTo(-4.8);
    expect(price.edgeFlag).toBe("BIG_EDGE");
    expect(price.homeCoverProb).toBeGreaterThan(0.5);
  });

  it("raises the consensus flag only when all systems lean the same way vs the line", () => {
    const agree = priceGame(
      basePricing({
        home: team(7),
        vegasSpread: -4.5,
        spPlusMargin: 8,
        fpiMargin: 7.5,
        eloMargin: 6,
      }),
    );
    expect(agree.consensusFlag).toBe(true);
    const split = priceGame(
      basePricing({
        home: team(7),
        vegasSpread: -4.5,
        spPlusMargin: 3, // leans the other way vs vegasMargin 4.5
        fpiMargin: 7.5,
        eloMargin: 6,
      }),
    );
    expect(split.consensusFlag).toBe(false);
  });
});

describe("HFA blending", () => {
  // These exercise the FUNCTIONS at an explicit blend, not the shipped
  // parameter. `teamHfaBlend` went to 0 on 2026-08-18 (--tune-team-hfa: Gate 0
  // split-half r = −0.196, so there is no per-team signal to blend), which made
  // every assertion written against DEFAULT_PARAMS trivially true and stopped
  // them testing anything. The machinery still has to be correct for the day
  // somebody re-opens the question with a better per-team estimate.
  const HALF = { ...DEFAULT_PARAMS, teamHfaBlend: 0.5 };

  it("is 50/50 team vs FBS average, and falls back to the average", () => {
    // Assert the RELATIONSHIP, not the constant — this used to hardcode 2.3
    // and broke when baseHfa was refit to 3.0, which is a test failing for the
    // wrong reason.
    const base = HALF.baseHfa;
    expect(blendedHfa(4.1, HALF)).toBeCloseTo(0.5 * 4.1 + 0.5 * base);
    expect(blendedHfa(null, HALF)).toBe(base);
  });

  it("centered blend: mean applied HFA equals the fitted baseHfa", () => {
    // Raw home/away splits are inflated at the mean by scheduling (home
    // slates carry the FCS buy games), so blending toward them re-biases
    // every price toward the home side. Centering keeps the between-team
    // spread while pinning the mean to what --tune-hfa actually fit.
    const base = HALF.baseHfa;
    const raws = [2.1, 4.9, 6.0, 5.4, 3.8]; // mean 4.44, well above base
    const mean = raws.reduce((s, v) => s + v, 0) / raws.length;
    const blended = raws.map((r) => centeredBlendedHfa(r, mean, HALF));
    const blendedMean = blended.reduce((s, v) => s + v, 0) / blended.length;
    expect(blendedMean).toBeCloseTo(base);
    // between-team ordering survives at half strength
    expect(blended[2]).toBeGreaterThan(blended[0]);
    expect(blended[2] - blended[0]).toBeCloseTo(0.5 * (raws[2] - raws[0]));
  });

  it("centered blend falls back to baseHfa and never goes negative", () => {
    const base = HALF.baseHfa;
    expect(centeredBlendedHfa(null, 4.4, HALF)).toBe(base);
    expect(centeredBlendedHfa(3.0, null, HALF)).toBe(base);
    // an extreme low raw against a high mean floors at 0, not below
    expect(centeredBlendedHfa(0, 12, HALF)).toBe(0);
  });

  it("is inert as shipped: every team gets the flat baseHfa", () => {
    // The point of teamHfaBlend = 0. This is what retires audit 03:M-1 — an
    // inflated per-team table cannot bias anything it is no longer consulted
    // for, so `centeredBlendedHfa` stops being a mitigation and becomes a
    // no-op.
    expect(DEFAULT_PARAMS.teamHfaBlend).toBe(0);
    for (const raw of [0, 2.1, 6.0, 12]) {
      expect(centeredBlendedHfa(raw, 4.44)).toBe(DEFAULT_PARAMS.baseHfa);
      expect(blendedHfa(raw)).toBe(DEFAULT_PARAMS.baseHfa);
    }
  });
});

describe("normal CDF", () => {
  it("matches known values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  });
});

describe("updateSubRatings (spec §2.2 groundwork — display stays gated until backtested)", () => {
  const base = {
    homeOffense: 5,
    homeDefense: 5,
    awayOffense: 0,
    awayDefense: 0,
    hfa: 2,
    neutralSite: false,
  };
  // expected home = 28.5 + 5 − 0 + 1 = 34.5; expected away = 28.5 + 0 − 5 − 1 = 22.5

  it("no movement when both teams hit expectation", () => {
    const upd = updateSubRatings({ ...base, homePoints: 34.5, awayPoints: 22.5 });
    expect(upd).toEqual({ homeOffDelta: 0, awayDefDelta: -0, awayOffDelta: 0, homeDefDelta: -0 });
  });

  it("outscoring expectation credits the offense and debits the opposing defense equally", () => {
    const upd = updateSubRatings({ ...base, homePoints: 44.5, awayPoints: 22.5 });
    expect(upd.homeOffDelta).toBeGreaterThan(0);
    expect(upd.awayDefDelta).toBeCloseTo(-upd.homeOffDelta, 10);
    expect(upd.awayOffDelta).toBeCloseTo(0, 10);
    // K·errHome/2 with K=0.3, err=10 → the off+def sum matches updateFromResult
    expect(upd.homeOffDelta).toBeCloseTo((0.3 * 10) / 2, 10);
  });

  it("caps blowout scoring errors at half the margin cap per side", () => {
    const capped = updateSubRatings({ ...base, homePoints: 100, awayPoints: 22.5 });
    const atCap = updateSubRatings({ ...base, homePoints: 34.5 + 14, awayPoints: 22.5 });
    expect(capped.homeOffDelta).toBeCloseTo(atCap.homeOffDelta, 10);
  });

  it("off+def deltas per team sum to the overall margin update (invariant)", () => {
    const upd = updateSubRatings({ ...base, homePoints: 41.5, awayPoints: 19.5 });
    // margin error = errHome − errAway = 7 − (−3) = 10 → overall homeDelta = K·10/2
    expect(upd.homeOffDelta + upd.homeDefDelta).toBeCloseTo((0.3 * 10) / 2, 10);
    expect(upd.awayOffDelta + upd.awayDefDelta).toBeCloseTo(-(0.3 * 10) / 2, 10);
  });

  it("neutral sites drop the HFA split from expectations", () => {
    const neutral = updateSubRatings({
      ...base,
      neutralSite: true,
      homePoints: 33.5, // hits the neutral expectation exactly (28.5 + 5)
      awayPoints: 23.5,
    });
    expect(neutral.homeOffDelta).toBeCloseTo(0, 10);
    expect(neutral.awayOffDelta).toBeCloseTo(0, 10);
  });
});

describe("paramsForWeek (early-season uncertainty)", () => {
  it("is an exact identity while priorSigmaExtra is 0", () => {
    for (const week of [0, 1, 4, 8, 15]) {
      expect(paramsForWeek(week, DEFAULT_PARAMS)).toBe(DEFAULT_PARAMS);
    }
  });

  it("widens sigma most in week 0 and decays with the prior's weight", () => {
    const p = { ...DEFAULT_PARAMS, priorSigmaExtra: 8 };
    const wk0 = paramsForWeek(0, p);
    const wk4 = paramsForWeek(4, p);
    const wk12 = paramsForWeek(12, p);

    // week 0: prior weight 1 → full extra term in quadrature
    expect(wk0.marginSigma).toBeCloseTo(Math.sqrt(p.marginSigma ** 2 + 64), 10);
    expect(wk0.marginSigma).toBeGreaterThan(wk4.marginSigma);
    expect(wk4.marginSigma).toBeGreaterThan(wk12.marginSigma);
    // never below the base sigma
    expect(wk12.marginSigma).toBeGreaterThan(p.marginSigma);
  });

  it("keeps the win-prob slope tied to sigma, so early probs are softer", () => {
    const p = { ...DEFAULT_PARAMS, priorSigmaExtra: 8 };
    const wk1 = paramsForWeek(1, p);
    expect(wk1.winProbSlope).toBeCloseTo(1.7 / wk1.marginSigma, 10);

    // a 14-point favorite should be given a lower win prob in week 1 than
    // the same edge would get at the flat midseason sigma
    const priceWith = (params: typeof DEFAULT_PARAMS) =>
      priceGame(basePricing({ home: team(14), away: team(0), homeTeamHfa: 0 }), params).homeWinProb;
    expect(priceWith(wk1)).toBeLessThan(priceWith(DEFAULT_PARAMS));
  });
});

describe("coachingAdjustmentContinuous", () => {
  const fitted = { ...DEFAULT_PARAMS, newHcIntercept: -1.5, newHcSlope: 0.3 };
  // A struggling program: the healthy term must never touch these.
  const bad = { priorRating: -5 };

  it("pooled params sit at identity: a struggling-program change costs nothing", () => {
    expect(coachingAdjustmentContinuous({ newHc: true, overPerf: 5, ...bad })).toBe(0);
    expect(coachingAdjustmentContinuous({ newHc: true, overPerf: null, ...bad })).toBe(0);
  });

  it("charges −6 to a healthy-program succession at DEFAULT_PARAMS (2026.6.0)", () => {
    // The shipped parameter: --tune-coaching-split's interior optimum on both
    // windows. Boundary is prior ≥ 0; unknown prior takes the conservative
    // branch and charges nothing.
    expect(
      coachingAdjustmentContinuous({ newHc: true, overPerf: null, priorRating: 22.4 }),
    ).toBe(-6);
    expect(coachingAdjustmentContinuous({ newHc: true, overPerf: null, priorRating: 0 })).toBe(-6);
    expect(
      coachingAdjustmentContinuous({ newHc: true, overPerf: null, priorRating: -0.01 }),
    ).toBe(0);
    expect(
      coachingAdjustmentContinuous({ newHc: true, overPerf: null, priorRating: null }),
    ).toBe(0);
  });

  it("leaves an intact staff alone regardless of params or prior", () => {
    expect(coachingAdjustmentContinuous({ newHc: false, overPerf: 6, ...bad }, fitted)).toBe(0);
    expect(
      coachingAdjustmentContinuous({ newHc: false, overPerf: null, priorRating: 20 }, fitted),
    ).toBe(0);
  });

  it("charges the pooled install cost to a first-time HC (no quality signal)", () => {
    expect(coachingAdjustmentContinuous({ newHc: true, overPerf: null, ...bad }, fitted)).toBeCloseTo(-1.5, 10);
  });

  it("stacks the healthy term on top of the pooled term", () => {
    expect(
      coachingAdjustmentContinuous({ newHc: true, overPerf: null, priorRating: 10 }, fitted),
    ).toBeCloseTo(-6 - 1.5, 10);
  });

  it("credits a proven hire and penalizes an underperformer", () => {
    const proven = coachingAdjustmentContinuous({ newHc: true, overPerf: 6, ...bad }, fitted);
    const reach = coachingAdjustmentContinuous({ newHc: true, overPerf: -6, ...bad }, fitted);
    expect(proven).toBeCloseTo(-1.5 + 0.3 * 6, 10);
    expect(reach).toBeCloseTo(-1.5 + 0.3 * -6, 10);
    expect(proven).toBeGreaterThan(reach);
  });

  it("clamps the quality signal so one outlier tenure can't run away", () => {
    const huge = coachingAdjustmentContinuous({ newHc: true, overPerf: 40, ...bad }, fitted);
    const atCap = coachingAdjustmentContinuous({ newHc: true, overPerf: 8, ...bad }, fitted);
    expect(huge).toBeCloseTo(atCap, 10);
  });

  it("clamps the output to [-8, 3] — the floor must admit the fitted −6", () => {
    const extreme = { ...DEFAULT_PARAMS, newHcIntercept: -20, newHcSlope: 0 };
    expect(coachingAdjustmentContinuous({ newHc: true, overPerf: null, ...bad }, extreme)).toBe(-8);
    // Healthy stack (−6 + −20) hits the same floor rather than escaping it.
    expect(
      coachingAdjustmentContinuous({ newHc: true, overPerf: null, priorRating: 5 }, extreme),
    ).toBe(-8);
    const generous = { ...DEFAULT_PARAMS, newHcIntercept: 5, newHcSlope: 1, newHcHealthyIntercept: 5 };
    expect(coachingAdjustmentContinuous({ newHc: true, overPerf: 8, priorRating: 5 }, generous)).toBe(3);
  });
});

describe("splitInformative (the constant-total gate)", () => {
  it("rejects an even split — every total would price identically", () => {
    expect(splitInformative([{ offense: 5, defense: 5 }, { offense: -3, defense: -3 }])).toBe(false);
    expect(splitInformative([])).toBe(false);
  });

  it("accepts a split once any team's halves differ", () => {
    expect(splitInformative([{ offense: 5, defense: 5 }, { offense: 4, defense: -4 }])).toBe(true);
  });

  it("treats sub-epsilon rounding noise as still even", () => {
    expect(splitInformative([{ offense: 5.001, defense: 5 }])).toBe(false);
  });

  it("is exactly the condition under which priceGame's total is a constant", () => {
    const even = priceGame(basePricing({ home: team(21), away: team(-7), homeTeamHfa: 0 }));
    const evenOther = priceGame(basePricing({ home: team(3), away: team(10), homeTeamHfa: 0 }));
    // different teams, identical total — that's the bug the gate exists for
    expect(even.projectedTotal).toBeCloseTo(57, 10);
    expect(evenOther.projectedTotal).toBeCloseTo(57, 10);

    const tilted = priceGame(
      basePricing({ home: team(21, 14, 7), away: team(-7, -1, -6), homeTeamHfa: 0 }),
    );
    expect(tilted.projectedTotal).not.toBeCloseTo(57, 2);
  });
});

describe("hasCalibratedTotals", () => {
  it("gates totals to 2026.3.0+ — earlier versions priced a constant", () => {
    expect(hasCalibratedTotals("2026.3.0")).toBe(true);
    expect(hasCalibratedTotals("2026.4.1")).toBe(true);
    expect(hasCalibratedTotals("2027.0.0")).toBe(true);
    expect(hasCalibratedTotals("2026.2.0")).toBe(false);
    expect(hasCalibratedTotals("2026.1.0")).toBe(false);
    expect(hasCalibratedTotals("garbage")).toBe(false);
  });
});

/**
 * SYS-1. The old rule required all four systems present before it would even
 * look, which sounds stricter and was in practice weaker: `system_ratings`
 * never held an Elo row in any season, so the guard never passed and
 * `consensus_flag` was false on every prediction this project has ever made.
 * A rule that one absent feed silently switches off is not strict, it is dead.
 */
describe("consensus fires on the systems that have a number", () => {
  const base = {
    home: { overall: 10, offense: 5, defense: 5, tempo: 70 },
    away: { overall: 0, offense: 0, defense: 0, tempo: 70 },
    homeTeamHfa: 0,
    neutralSite: true,
    situationalPoints: 0,
  };
  // Model has home by 10; the line has home by 3. Model leans home.
  const price = (over: Record<string, number | null>) =>
    priceGame({ ...base, vegasSpread: -3, ...over } as Parameters<typeof priceGame>[0]);

  it("fires on two agreeing systems when the third has no data", () => {
    // The live 2026 case exactly: SP+ and FPI present, Elo absent all season.
    const p = price({ spPlusMargin: 8, fpiMargin: 7, eloMargin: null });
    expect(p.consensusFlag).toBe(true);
    expect(p.consensusAvailable).toBe(2);
    expect(p.consensusAgreed).toBe(2);
  });

  it("still refuses when one of the present systems disagrees", () => {
    // FPI leans the other way: 1 < 3 means it likes the away side of the line.
    const p = price({ spPlusMargin: 8, fpiMargin: 1, eloMargin: null });
    expect(p.consensusFlag).toBe(false);
    expect(p.consensusAgreed).toBe(1);
    expect(p.consensusAvailable).toBe(2);
  });

  it("will not call one external system a consensus", () => {
    // The model plus a friend is not agreement, it is a pair.
    const p = price({ spPlusMargin: 8, fpiMargin: null, eloMargin: null });
    expect(p.consensusFlag).toBe(false);
    expect(p.consensusAvailable).toBe(1);
  });

  it("will not call the model agreeing with itself a consensus", () => {
    const p = price({ spPlusMargin: null, fpiMargin: null, eloMargin: null });
    expect(p.consensusFlag).toBe(false);
    expect(p.consensusAvailable).toBe(0);
    expect(p.consensusAgreed).toBe(0);
  });

  it("uses all three when all three are there", () => {
    const p = price({ spPlusMargin: 8, fpiMargin: 7, eloMargin: 9 });
    expect(p.consensusFlag).toBe(true);
    expect(p.consensusAvailable).toBe(3);
  });

  it("refuses when the model itself sits exactly on the line", () => {
    // Sign zero is not a direction, and "everyone agrees on nothing" is not a
    // lean worth flagging.
    const p = priceGame({
      ...base,
      vegasSpread: -10,
      spPlusMargin: 12,
      fpiMargin: 11,
    } as Parameters<typeof priceGame>[0]);
    expect(p.consensusFlag).toBe(false);
  });

  it("counts nothing without a line, since there is nothing to disagree with", () => {
    const p = priceGame({ ...base, vegasSpread: null } as Parameters<typeof priceGame>[0]);
    expect(p.consensusFlag).toBe(false);
    expect(p.consensusAvailable).toBe(0);
  });
});
