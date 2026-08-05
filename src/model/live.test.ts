import { describe, expect, it } from "vitest";
import { fractionRemaining, liveWinProb } from "./live";
import { DEFAULT_PARAMS, normalCdf } from "./ratings";

describe("fractionRemaining", () => {
  it("full game before kickoff data arrives", () => {
    expect(fractionRemaining(null, null)).toBe(1);
  });

  it("start of Q1 is ~1, end of Q4 is ~0", () => {
    expect(fractionRemaining(1, "15:00")).toBe(1);
    expect(fractionRemaining(4, "0:30")).toBeCloseTo(30 / 3600);
    expect(fractionRemaining(4, "0:00")).toBe(0);
  });

  it("halftime boundary", () => {
    expect(fractionRemaining(2, "0:00")).toBeCloseTo(0.5);
    expect(fractionRemaining(3, "15:00")).toBeCloseTo(0.5);
  });

  it("unparseable clock falls back to full period remaining", () => {
    expect(fractionRemaining(3, null)).toBeCloseTo(0.5);
    expect(fractionRemaining(3, "halftime")).toBeCloseTo(0.5);
  });

  it("overtime is a small constant", () => {
    expect(fractionRemaining(5, "0:45")).toBe(0.04);
    expect(fractionRemaining(6, null)).toBe(0.04);
  });
});

describe("liveWinProb", () => {
  it("reproduces ~the pregame prob at kickoff", () => {
    const pregame = 1 - normalCdf(0, 7, DEFAULT_PARAMS.marginSigma);
    const live = liveWinProb({
      pregameMargin: 7,
      homePoints: 0,
      awayPoints: 0,
      period: 1,
      clock: "15:00",
    });
    expect(live).toBeCloseTo(pregame, 5);
  });

  it("a big late lead is near-certain", () => {
    const p = liveWinProb({
      pregameMargin: -3,
      homePoints: 35,
      awayPoints: 17,
      period: 4,
      clock: "2:00",
    });
    expect(p).toBeGreaterThan(0.95);
  });

  it("tied late in Q4 is a coin flip", () => {
    const p = liveWinProb({
      pregameMargin: 0,
      homePoints: 24,
      awayPoints: 24,
      period: 4,
      clock: "0:30",
    });
    expect(p).toBeCloseTo(0.5, 1);
  });

  it("tied in OT stays near a coin flip regardless of pregame margin", () => {
    const p = liveWinProb({
      pregameMargin: 10,
      homePoints: 27,
      awayPoints: 27,
      period: 5,
      clock: null,
    });
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(0.6);
  });

  it("is monotone in the score margin", () => {
    const at = (homePoints: number) =>
      liveWinProb({ pregameMargin: 0, homePoints, awayPoints: 21, period: 3, clock: "8:00" });
    expect(at(28)).toBeGreaterThan(at(24));
    expect(at(24)).toBeGreaterThan(at(17));
  });

  it("stays within (0, 1) even on absurd margins", () => {
    const p = liveWinProb({
      pregameMargin: 0,
      homePoints: 70,
      awayPoints: 0,
      period: 4,
      clock: "0:00",
    });
    expect(p).toBeLessThanOrEqual(0.999);
    expect(p).toBeGreaterThan(0.99);
  });
});
