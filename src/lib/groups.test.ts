import { describe, expect, it } from "vitest";
import { joinedLabel } from "./groups";

/**
 * The roster's one piece of logic. It exists so a member added a minute ago
 * reads as *just added* rather than as one more name in a list — which is the
 * whole reason the section was built.
 */
describe("joinedLabel", () => {
  const tz = "America/Chicago";
  // 2026-08-18 20:00 UTC = 3pm in Chicago.
  const now = new Date("2026-08-18T20:00:00Z");

  it("says today for someone added today", () => {
    expect(joinedLabel("2026-08-18T14:30:00Z", tz, now)).toBe("joined today");
  });

  it("counts by calendar day, not by elapsed hours", () => {
    // 04:30 UTC on the 18th is 11:30pm on the 17th in Chicago — fifteen hours
    // ago, and yesterday. Hours would have called this today and been wrong to
    // the only person who can check it.
    expect(joinedLabel("2026-08-18T04:30:00Z", tz, now)).toBe("joined yesterday");
  });

  it("and a late-night add on the current day is still today", () => {
    const lateNight = new Date("2026-08-19T04:30:00Z"); // 11:30pm on the 18th CT
    expect(joinedLabel("2026-08-19T02:00:00Z", tz, lateNight)).toBe("joined today");
  });

  it("falls back to a date once it stops being recent", () => {
    expect(joinedLabel("2026-08-12T16:00:00Z", tz, now)).toBe("joined Aug 12");
  });

  it("dates an old membership in the group's timezone, not the server's", () => {
    // 01:00 UTC on Aug 12 is still Aug 11 in Chicago.
    expect(joinedLabel("2026-08-12T01:00:00Z", tz, now)).toBe("joined Aug 11");
  });
});
