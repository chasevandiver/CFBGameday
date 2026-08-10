import { describe, expect, it } from "vitest";
import { spreadClv } from "./clv";
import { liveSpreadStatus } from "./live-status";
import { fmtSpread, homeLineForSide, lineForSide } from "./slate";

/**
 * Round-trip pin for the bet `line_taken` convention.
 *
 * The slip and the form speak in the bettor's number ("UNC +6.5"); the table
 * stores home-perspective (−6.5); the grader, live status and CLV all read
 * home-perspective; every display converts back through `lineForSide`. The
 * write conversion was missing for away spread bets — the slip inserted +6.5,
 * the grader read it as home-perspective, and the bet graded backwards while
 * the ledger displayed it correctly. These tests walk the full loop so a
 * regression at any boundary fails here.
 */
describe("bet line convention round-trip (away spread)", () => {
  // Vegas: home −6.5. The away backer's ticket reads +6.5.
  const ticketLine = 6.5;
  const stored = homeLineForSide("away", ticketLine);

  it("stores home-perspective", () => {
    expect(stored).toBe(-6.5);
  });

  it("grades as the grader does: home wins by 3, away +6.5 covers", () => {
    // same formula as jobs-core: side away → coverMargin = −margin − line
    const margin = 3;
    const coverMargin = -margin - (stored as number);
    expect(coverMargin).toBeGreaterThan(0); // win
    expect(liveSpreadStatus("away", stored as number, 24, 21).state).toBe("winning");
  });

  it("grades a blowout loss: home wins by 10, away +6.5 loses", () => {
    expect(liveSpreadStatus("away", stored as number, 31, 21).state).toBe("losing");
  });

  it("CLV reads the stored value: close home −3.5 → away held +6.5 vs +3.5 = +3.0", () => {
    expect(spreadClv("away", stored as number, -3.5)).toBe(3);
  });

  it("displays convert back to the ticket's number", () => {
    expect(fmtSpread(lineForSide("away", stored))).toBe("+6.5");
  });

  it("home side passes through unchanged", () => {
    expect(homeLineForSide("home", -6.5)).toBe(-6.5);
    expect(fmtSpread(lineForSide("home", -6.5))).toBe("-6.5");
  });

  it("pick'em line never becomes −0", () => {
    expect(Object.is(homeLineForSide("away", 0), -0)).toBe(false);
  });
});
