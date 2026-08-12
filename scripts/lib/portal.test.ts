import { describe, expect, it } from "vitest";
import { PORTAL_CLAMP, portalPoints, portalScale } from "./portal";

describe("portalScale", () => {
  it("counts a team with no portal activity as 0, not as missing", () => {
    // The old code took [...net.values()], so an FBS team that neither gained
    // nor lost anyone was dropped from the population entirely. Its true value
    // is 0 and it sits at the centre of the distribution — excluding it biases
    // both the mean and the spread.
    const net = new Map([[1, 10]]);
    const s = portalScale([1, 2, 3], net);
    expect(s.mean).toBeCloseTo(10 / 3, 10);
  });

  it("uses the standard deviation about the mean, not RMS about zero", () => {
    // sqrt(Σv²/n) is what shipped. For [-10, -10] that is 10; the SD is 0.
    const net = new Map([
      [1, -10],
      [2, -10],
    ]);
    const s = portalScale([1, 2], net);
    expect(s.mean).toBe(-10);
    expect(s.sd).toBe(1); // degenerate → guarded, not 10
  });

  it("scales on the population it is handed, not on everyone in the feed", () => {
    // FCS/D2 schools appear in the portal feed with small net movements and
    // used to dilute the divisor. Handing in only the FBS ids is the fix.
    const net = new Map([
      [1, 30],
      [2, -30],
      [99, 1], // a non-FBS school in the same feed
    ]);
    const fbsOnly = portalScale([1, 2], net);
    const everyone = portalScale([1, 2, 99], net);
    expect(fbsOnly.sd).toBeGreaterThan(everyone.sd);
  });

  it("never returns a zero divisor", () => {
    expect(portalScale([], new Map()).sd).toBe(1);
    expect(portalScale([1, 2], new Map([[1, 5], [2, 5]])).sd).toBe(1);
  });
});

describe("portalPoints", () => {
  const scale = { mean: -6.9, sd: 21.6 }; // the real 2026 FBS population

  it("gives an average off-season exactly zero", () => {
    // This is the whole point of centring. Uncentred, the mean FBS team
    // carried a −0.59 point penalty for being unremarkable.
    expect(portalPoints(-6.9, scale)).toBe(0);
  });

  it("is 1.5 points per standard deviation", () => {
    expect(portalPoints(-6.9 + 21.6, scale)).toBeCloseTo(1.5, 10);
    expect(portalPoints(-6.9 - 21.6, scale)).toBeCloseTo(-1.5, 10);
  });

  it("pulls Ohio State off the clamp", () => {
    // 37 players out, 17 in, almost all 3-star: net −55 stars. The old
    // standardization gave (−55/16.2)×1.5 = −5.09, which pinned to −4. That is
    // four rating points for shedding buried backups.
    const old = (-55 / 16.2) * 1.5;
    expect(old).toBeLessThan(-PORTAL_CLAMP);
    const fixed = portalPoints(-55, scale);
    expect(fixed).toBeGreaterThan(-PORTAL_CLAMP);
    expect(fixed).toBeCloseTo(-3.34, 1);
  });

  it("halves Alabama's penalty", () => {
    // net −23: (−23/16.2)×1.5 = −2.13 before, −1.12 after.
    expect(portalPoints(-23, scale)).toBeCloseTo(-1.12, 1);
  });

  it("still clamps a genuine outlier", () => {
    expect(portalPoints(-500, scale)).toBe(-PORTAL_CLAMP);
    expect(portalPoints(500, scale)).toBe(PORTAL_CLAMP);
  });

  it("does NOT fix the headcount problem, and should not pretend to", () => {
    // 91% of portal entries are 2- or 3-star, so net stars ≈ net players × 3.
    // A team that swaps 20 three-stars out for 20 three-stars in nets 0 — fine.
    // A team that ships 20 out and takes 10 in is scored −30 regardless of
    // whether any of the 20 ever played a snap. Centring cannot see that; only
    // weighting by production or by `rating` can. Asserted so the limitation is
    // a decision rather than an oversight.
    const shedsDepth = portalPoints(-30, scale);
    const losesStarters = portalPoints(-30, scale);
    expect(shedsDepth).toBe(losesStarters);
  });
});
