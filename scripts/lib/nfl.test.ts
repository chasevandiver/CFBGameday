import { describe, expect, it } from "vitest";
import { NFL_DIVISIONS, assertNoCfbCollision, divisionOf, isDivisionGame } from "./nfl";

describe("NFL division table", () => {
  it("has exactly 32 teams in 8 divisions of 4", () => {
    const byDivision = new Map<string, number>();
    for (const d of Object.values(NFL_DIVISIONS))
      byDivision.set(d, (byDivision.get(d) ?? 0) + 1);
    expect(Object.keys(NFL_DIVISIONS)).toHaveLength(32);
    expect(byDivision.size).toBe(8);
    for (const [division, n] of byDivision) expect({ division, n }).toEqual({ division, n: 4 });
  });

  it("marks a division game the way conference_game means it", () => {
    expect(isDivisionGame("KC", "LV")).toBe(true); // AFC West twice
    expect(isDivisionGame("KC", "PHI")).toBe(false); // cross-conference
    expect(isDivisionGame("KC", "CIN")).toBe(false); // same conference, different division
    expect(isDivisionGame("KC", null)).toBe(false);
  });

  it("is case-tolerant but never inventive", () => {
    expect(divisionOf("kc")).toBe("AFC West");
    expect(divisionOf("XYZ")).toBeNull();
    expect(divisionOf(null)).toBeNull();
  });
});

describe("assertNoCfbCollision", () => {
  it("lets NFL upserts through — their own prior rows included", () => {
    expect(() =>
      assertNoCfbCollision(
        [{ id: 401872656, sport: "nfl" }],
        new Set([401872656, 401872657]),
      ),
    ).not.toThrow();
  });

  it("throws before an event id stored as CFB would be overwritten", () => {
    expect(() =>
      assertNoCfbCollision([{ id: 401628319, sport: "cfb" }], new Set([401628319])),
    ).toThrow(/global-event-id/);
  });
});
