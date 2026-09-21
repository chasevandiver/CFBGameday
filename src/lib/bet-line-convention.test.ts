import { describe, expect, it } from "vitest";
import { spreadClv } from "./clv";
import { liveSpreadStatus } from "./live-status";
import { betTypeTakesLine, storedBetLine, ticketBetLine } from "./bet-line";
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

/**
 * `bet-line.ts` is the same convention with the BET TYPE routing attached, and
 * it moved out of `actions/bets.ts` so ADM-3's correction could reach it. The
 * round trip is asserted through both helpers here because a correction reads
 * the stored number, shows it to a human, and writes what they hand back — so
 * an asymmetry between the two directions would land as a sign flip on a row
 * that was already graded.
 */
describe("storedBetLine / ticketBetLine round-trip", () => {
  const cases: Array<[string, string | null, number]> = [
    ["spread", "away", 6.5],
    ["spread", "home", -6.5],
    ["spread", "away", -3], // GB -3 as an away backer: stored +3
    ["first_half", "away", 3.5],
    ["first_half", "home", -3.5],
    ["total", "over", 51.5],
    ["total", "under", 51.5],
    ["team_total", "over", 24.5],
  ];

  for (const [betType, side, ticket] of cases) {
    it(`${betType} ${side} ${ticket} survives the trip`, () => {
      const stored = storedBetLine(betType, side, ticket);
      expect(ticketBetLine(betType, side, stored)).toBe(ticket);
    });
  }

  it("spread-style flips for away, totals do not", () => {
    expect(storedBetLine("spread", "away", -3)).toBe(3);
    expect(storedBetLine("first_half", "away", -3)).toBe(3);
    // Side-agnostic: over 51.5 and under 51.5 are both 51.5.
    expect(storedBetLine("total", "under", 51.5)).toBe(51.5);
    expect(storedBetLine("team_total", "under", 24.5)).toBe(24.5);
  });

  it("null in, null out — a moneyline has no line to convert", () => {
    expect(storedBetLine("moneyline", "home", null)).toBeNull();
    expect(ticketBetLine("moneyline", "home", null)).toBeNull();
  });

  it("names the types that carry a number, and the two that do not", () => {
    for (const t of ["spread", "total", "team_total", "first_half"]) {
      expect(betTypeTakesLine(t)).toBe(true);
    }
    // A moneyline has a price; a future has neither a line nor a game.
    expect(betTypeTakesLine("moneyline")).toBe(false);
    expect(betTypeTakesLine("future")).toBe(false);
  });
});
