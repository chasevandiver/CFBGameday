import { describe, expect, it } from "vitest";
import { modelClv, openerClv, roundClv, spreadClv, summarizeClv, totalClv } from "./clv";

// The four worked examples. These are the whole point of the module: the sign
// was inverted in all four branches of jobs-core.ts until 2026-08-07 and no
// test existed to catch it. Each case is stated in bettor's terms first so a
// future reader can check the claim without re-deriving the algebra.
describe("spreadClv", () => {
  it("is positive when a home backer laid less than the close", () => {
    // Bet home −3. Closes home −6. You laid 3 where the close lays 6.
    expect(spreadClv("home", -3, -6)).toBe(3);
  });

  it("is negative when a home backer laid more than the close", () => {
    // Bet home −6. Closes home −3. You laid 6 where the close lays 3.
    expect(spreadClv("home", -6, -3)).toBe(-3);
  });

  it("is negative when an away backer took fewer points than the close", () => {
    // Bet away +3 (home −3). Closes home −6, i.e. away +6. You took 3 of the 6.
    expect(spreadClv("away", -3, -6)).toBe(-3);
  });

  it("is positive when an away backer took more points than the close", () => {
    // Bet away +6 (home −6). Closes home −3, i.e. away +3.
    expect(spreadClv("away", -6, -3)).toBe(3);
  });

  it("is exactly opposite for the two sides of the same move", () => {
    // Whatever one side gains on a line move, the other loses. A convention
    // that fails this is measuring market movement, not value.
    for (const [taken, close] of [
      [-3, -6],
      [7, 2.5],
      [0, -1.5],
    ]) {
      expect(spreadClv("home", taken, close)).toBe(-spreadClv("away", taken, close));
    }
  });

  it("is zero — not negative zero — when the line never moved", () => {
    // `-0` reaches the database and renders as "−0.00", which reads as a loss.
    expect(spreadClv("home", -3.5, -3.5)).toBe(0);
    expect(spreadClv("away", -3.5, -3.5)).toBe(0);
    expect(Object.is(spreadClv("away", -3.5, -3.5), -0)).toBe(false);
    expect(Object.is(totalClv("under", 50, 50), -0)).toBe(false);
  });
});

describe("totalClv", () => {
  it("is positive when an over backer bought the number cheaper", () => {
    // Over 50, closes 54.
    expect(totalClv("over", 50, 54)).toBe(4);
  });

  it("is negative when an under backer sold the number cheaper", () => {
    // Under 50, closes 54 — you would rather have had 54.
    expect(totalClv("under", 50, 54)).toBe(-4);
  });

  it("runs opposite to the spread convention", () => {
    // The over wants the number UP; a home backer wants it DOWN. Collapsing
    // these into one formula is how the sign gets lost.
    expect(totalClv("over", 50, 54)).toBeGreaterThan(0);
    expect(spreadClv("home", -50, -54)).toBeGreaterThan(0);
    expect(totalClv("over", 54, 50)).toBeLessThan(0);
  });
});

describe("modelClv", () => {
  it("reads a negative edge as a home lean", () => {
    // edge = model − market < 0 means the model wants home laying more than
    // the market does. Same convention as modelSideOf.
    expect(modelClv(-3, -7, -9)).toBe(2);
  });

  it("reads a positive edge as an away lean", () => {
    expect(modelClv(3, -7, -9)).toBe(-2);
  });

  it("agrees with spreadClv on the side it picked", () => {
    expect(modelClv(-3, -7, -9)).toBe(spreadClv("home", -7, -9));
    expect(modelClv(3, -7, -9)).toBe(spreadClv("away", -7, -9));
  });

  it("returns null when there is no side or no line to measure against", () => {
    expect(modelClv(null, -7, -9)).toBeNull(); // no edge computed
    expect(modelClv(0, -7, -9)).toBeNull(); // model agreed exactly — no side
    expect(modelClv(-3, null, -9)).toBeNull(); // no market line at freeze
    expect(modelClv(-3, -7, null)).toBeNull(); // never got a closing line
  });

  it("does not require an edge flag", () => {
    // Flagged edges are |edge| >= 2. CLV is measurable on every disagreement,
    // and restricting to flags throws away most of the sample.
    expect(modelClv(-0.5, -7, -7.5)).toBe(0.5);
  });
});

describe("openerClv", () => {
  it("is positive when the market drifted toward the model's side of the opener", () => {
    // Opener home −3, model says home −7 → the model's side of the opener is
    // home. Closes −5: a home backer at the opener laid 3 where the close
    // lays 5. This is the drift the 2023–25 post-mortem measured at +0.27.
    expect(openerClv(-7, -3, -5)).toBe(2);
  });

  it("is negative when the market moved away from the model", () => {
    // Opener home −3, model home −7, closes home −1: the opener's price got
    // better after the fact — taking the model's side early cost 2 points.
    expect(openerClv(-7, -3, -1)).toBe(-2);
  });

  it("takes its side from the opener, not the freeze-time market", () => {
    // Model −4, opened −2, closed −5. Against the opener the model leans home
    // (−4 < −2) even though against that close it would lean away. The opener
    // test grades the early read, so this is home's +3, not away's −3.
    expect(openerClv(-4, -2, -5)).toBe(3);
    expect(openerClv(-4, -2, -5)).toBe(spreadClv("home", -2, -5));
  });

  it("returns null when a number is missing or the model sat on the opener", () => {
    expect(openerClv(null, -3, -5)).toBeNull();
    expect(openerClv(-7, null, -5)).toBeNull(); // opener never captured
    expect(openerClv(-7, -3, null)).toBeNull(); // no closing snapshot
    expect(openerClv(-3, -3, -5)).toBeNull(); // no disagreement — no side
  });
});

describe("roundClv", () => {
  it("rounds to the hundredth the numeric(5,2) column stores", () => {
    expect(roundClv(1 / 3)).toBe(0.33);
    expect(roundClv(-1 / 3)).toBe(-0.33);
    expect(roundClv(2.5)).toBe(2.5);
  });
});

describe("summarizeClv", () => {
  it("averages only measurable values", () => {
    const s = summarizeClv([2, null, -1, null, 0]);
    expect(s.n).toBe(3);
    expect(s.avg).toBeCloseTo(1 / 3, 10);
  });

  it("counts ties apart from wins and losses", () => {
    // Half-point markets land on the number often; scoring a tie as a loss
    // would understate the model.
    const s = summarizeClv([1, 0, 0, -2]);
    expect(s).toEqual({ n: 4, avg: -0.25, beat: 1, flat: 2 });
  });

  it("reports nothing rather than zero on an empty sample", () => {
    // avg 0 would render as "dead even" when the truth is "no data".
    expect(summarizeClv([])).toEqual({ n: 0, avg: null, beat: 0, flat: 0 });
    expect(summarizeClv([null, null])).toEqual({ n: 0, avg: null, beat: 0, flat: 0 });
  });

  it("ignores NaN rather than poisoning the mean", () => {
    expect(summarizeClv([2, Number.NaN, 4]).avg).toBe(3);
  });
});
