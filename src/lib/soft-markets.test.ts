import { describe, expect, it } from "vitest";
import { softMarketTags } from "./soft-markets";

const TZ = "America/Chicago";

const team = (school: string, conference: string | null) => ({ school, conference });

// A Tuesday and a Saturday night in November 2026, both 7pm CT (01:00 UTC
// next day) — the wrap-around is the case a naive UTC weekday gets wrong.
const TUE_NIGHT = "2026-11-11T01:00:00Z"; // Tue Nov 10, 7:00 PM CT
const SAT_NIGHT = "2026-11-08T01:00:00Z"; // Sat Nov 7, 7:00 PM CT

describe("softMarketTags", () => {
  it("tags a MAC weekday game with both G5 and weekday", () => {
    expect(
      softMarketTags(
        { startTs: TUE_NIGHT, home: team("Toledo", "Mid-American"), away: team("Ohio", "Mid-American") },
        2026,
        TZ,
      ),
    ).toEqual(["G5", "weekday"]);
  });

  it("does not tag a P4 game, even on a weekday", () => {
    // Structural softness is about the pool, not the calendar alone — a Big
    // Ten game gets syndicate attention whenever it kicks.
    expect(
      softMarketTags(
        { startTs: TUE_NIGHT, home: team("Ohio State", "Big Ten"), away: team("Michigan", "Big Ten") },
        2026,
        TZ,
      ),
    ).toEqual(["weekday"]);
  });

  it("does not tag cross-tier games as G5", () => {
    // A P4-vs-G5 buy game is priced by the P4 side of the board.
    expect(
      softMarketTags(
        { startTs: SAT_NIGHT, home: team("Georgia", "SEC"), away: team("Marshall", "Sun Belt") },
        2026,
        TZ,
      ),
    ).toEqual([]);
  });

  it("judges the weekday in the display timezone, not UTC", () => {
    // 7pm CT Saturday is 01:00 UTC Sunday; Saturday must not read as soft.
    expect(
      softMarketTags(
        { startTs: SAT_NIGHT, home: team("Toledo", "Mid-American"), away: team("Ohio", "Mid-American") },
        2026,
        TZ,
      ),
    ).toEqual(["G5"]);
  });

  it("leaves Thursday and Friday untagged — national broadcast windows", () => {
    const THU_NIGHT = "2026-11-13T01:00:00Z"; // Thu Nov 12, 7:00 PM CT
    expect(
      softMarketTags(
        { startTs: THU_NIGHT, home: team("Memphis", "American Athletic"), away: team("Tulane", "American Athletic") },
        2026,
        TZ,
      ),
    ).toEqual(["G5"]);
  });

  it("skips the weekday read on a TBD kickoff rather than guessing", () => {
    expect(
      softMarketTags(
        { startTs: null, home: team("Toledo", "Mid-American"), away: team("Ohio", "Mid-American") },
        2026,
        TZ,
      ),
    ).toEqual(["G5"]);
  });
});
