import { describe, expect, it } from "vitest";
import { leadingSide } from "./ScoreTicker";
import type { TickerGame } from "../lib/ticker";

const chip = (over: Partial<TickerGame>): TickerGame => ({
  id: 1,
  status: "in_progress",
  startTs: null,
  period: 3,
  clock: "8:42",
  homeAbbr: "MICH",
  awayAbbr: "OSU",
  homePoints: 24,
  awayPoints: 21,
  ...over,
});

describe("leadingSide", () => {
  it("picks out whoever is in front, live or final", () => {
    expect(leadingSide(chip({}))).toBe("home");
    expect(leadingSide(chip({ status: "final", homePoints: 3, awayPoints: 10 }))).toBe("away");
  });

  it("highlights nobody in a tie — the NFL has them", () => {
    expect(leadingSide(chip({ homePoints: 17, awayPoints: 17 }))).toBeNull();
    expect(leadingSide(chip({ status: "final", homePoints: 17, awayPoints: 17 }))).toBeNull();
  });

  it("highlights nobody before kickoff", () => {
    expect(
      leadingSide(chip({ status: "scheduled", homePoints: null, awayPoints: null })),
    ).toBeNull();
  });

  it("treats a missing score as zero rather than as a leader", () => {
    expect(leadingSide(chip({ homePoints: null, awayPoints: null }))).toBeNull();
    expect(leadingSide(chip({ homePoints: null, awayPoints: 7 }))).toBe("away");
  });
});
