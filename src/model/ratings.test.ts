import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAMS,
  blendWithPrior,
  blendedHfa,
  churnAdjustment,
  coachingAdjustment,
  luckCorrection,
  normalCdf,
  preseasonRating,
  priceGame,
  priorWeight,
  suggestedStake,
  updateFromResult,
  type PricingInputs,
  type TeamRating,
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
  it("is ~0 for an average-churn roster", () => {
    const adj = churnAdjustment({
      returningProductionOffense: 0.6,
      returningProductionDefense: 0.6,
      qbReturns: true,
      olReturningShare: 0.5,
      netPortalPoints: 0,
      blueChipFreshmen: 0,
    });
    expect(Math.abs(adj)).toBeLessThanOrEqual(1.5);
  });

  it("clamps to the −6..+6 range", () => {
    const gutted = churnAdjustment({
      returningProductionOffense: 0.05,
      returningProductionDefense: 0.05,
      qbReturns: false,
      olReturningShare: 0,
      netPortalPoints: -4,
      blueChipFreshmen: 0,
    });
    expect(gutted).toBe(-6);
    const loaded = churnAdjustment({
      returningProductionOffense: 0.95,
      returningProductionDefense: 0.95,
      qbReturns: true,
      olReturningShare: 1,
      netPortalPoints: 4,
      blueChipFreshmen: 5,
    });
    expect(loaded).toBe(6);
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
  it("is 50/50 team vs FBS average, and falls back to the average", () => {
    expect(blendedHfa(4.1)).toBeCloseTo(0.5 * 4.1 + 0.5 * 2.3);
    expect(blendedHfa(null)).toBe(2.3);
  });
});

describe("bet sizing", () => {
  it("suggests 0 units with no edge and caps at 2 units", () => {
    expect(suggestedStake(0.5)).toBe(0); // losing proposition at -110
    expect(suggestedStake(0.58)).toBeGreaterThan(0);
    expect(suggestedStake(0.9)).toBe(2); // hard cap
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
