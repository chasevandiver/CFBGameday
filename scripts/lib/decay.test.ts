import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, priorWeight } from "../../src/model/ratings";
import { NO_BLEND_KNOTS, scaleDecayKnots } from "./decay";

const at = (speed: number) => ({
  ...DEFAULT_PARAMS,
  priorDecayKnots: scaleDecayKnots(DEFAULT_PARAMS.priorDecayKnots, speed),
});

describe("scaleDecayKnots (--tune-decay's family)", () => {
  it("is the shipped schedule exactly at speed 1", () => {
    for (let week = 0; week <= 16; week++) {
      expect(priorWeight(week, at(1))).toBe(priorWeight(week, DEFAULT_PARAMS));
    }
  });

  it("runs the same curve faster: w_s(week) = w(week × s)", () => {
    // Week 4 at 1.5× carries what week 6 carries today: halfway from 0.5 to 0.15.
    expect(priorWeight(4, at(1.5))).toBeCloseTo(priorWeight(6, DEFAULT_PARAMS), 12);
    expect(priorWeight(4, at(1.5))).toBeCloseTo(0.325, 12);
    // ...and slower: week 5 at 0.8× carries what week 4 does today.
    expect(priorWeight(5, at(0.8))).toBeCloseTo(0.5, 12);
  });

  it("keeps the knot weights, including the 0.05 floor — only when they arrive moves", () => {
    expect(priorWeight(0, at(2))).toBe(1);
    expect(priorWeight(6, at(2))).toBeCloseTo(0.05, 12); // 12 / 2
    expect(priorWeight(15, at(2))).toBe(0.05);
    expect(priorWeight(15, at(0.5))).toBeGreaterThan(0.05); // floor not reached until week 24
  });

  it("refuses a speed that is not positive", () => {
    expect(() => scaleDecayKnots(DEFAULT_PARAMS.priorDecayKnots, 0)).toThrow();
    expect(() => scaleDecayKnots(DEFAULT_PARAMS.priorDecayKnots, -1)).toThrow();
  });
});

describe("NO_BLEND_KNOTS (DECAY-2's arm)", () => {
  const noBlend = { ...DEFAULT_PARAMS, priorDecayKnots: NO_BLEND_KNOTS };

  it("is the prior before any game and the seeded Elo alone from week 1", () => {
    expect(priorWeight(0, noBlend)).toBe(1);
    for (let week = 1; week <= 16; week++) expect(priorWeight(week, noBlend)).toBe(0);
  });
});
