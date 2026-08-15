import { describe, expect, it } from "vitest";
import { NFL_DIVISIONS, assertNoCfbCollision, divisionOf, isDivisionGame, nflVenueRow, type EspnVenue } from "./nfl";

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

describe("nflVenueRow (NFL-25)", () => {
  const v = (over: Partial<EspnVenue> = {}): EspnVenue => ({
    espnId: 3673,
    name: "Lumen Field",
    city: "Seattle",
    state: "WA",
    indoor: false,
    ...over,
  });

  it("offsets the id, so an ESPN stadium cannot land on a CFBD one", () => {
    expect(nflVenueRow(v())!.id).toBe(103673);
    expect(nflVenueRow(v())!.id).toBeGreaterThanOrEqual(100_000);
  });

  it("carries the fields the feed actually has", () => {
    expect(nflVenueRow(v())).toEqual({
      id: 103673,
      name: "Lumen Field",
      city: "Seattle",
      state: "WA",
      dome: false,
    });
  });

  it("maps indoor to dome, which is NOT NULL in the schema", () => {
    expect(nflVenueRow(v({ name: "Ford Field", indoor: true }))!.dome).toBe(true);
  });

  it("names a nameless venue rather than dropping the row", () => {
    // `venues.name` is NOT NULL, and a row with an id is still worth having.
    expect(nflVenueRow(v({ name: null }))!.name).toBe("Venue 103673");
  });

  it("is null with no id to key on — there is nothing to upsert against", () => {
    expect(nflVenueRow(v({ espnId: null }))).toBeNull();
    expect(nflVenueRow(null)).toBeNull();
  });

  it("does not invent coordinates, which is why NFL weather stays blocked", () => {
    // The scoreboard venue has no lat/lon. Asserting their ABSENCE keeps a
    // later change from quietly filling them with something plausible.
    expect(nflVenueRow(v())).not.toHaveProperty("latitude");
    expect(nflVenueRow(v())).not.toHaveProperty("longitude");
  });
});
