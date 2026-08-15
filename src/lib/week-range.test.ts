import { describe, expect, it } from "vitest";
import { MAX_WEEK, MIN_WEEK, isValidWeek, parseWeekParam, nflPlayoffLabel, NFL_PLAYOFF_ROUNDS } from "./week-range";

describe("isValidWeek", () => {
  it("accepts the addressable range, week 0 included", () => {
    expect(isValidWeek(MIN_WEEK)).toBe(true);
    expect(isValidWeek(0)).toBe(true);
    expect(isValidWeek(1)).toBe(true);
    expect(isValidWeek(MAX_WEEK)).toBe(true);
  });

  it("rejects out-of-range, non-integer and non-numeric input", () => {
    expect(isValidWeek(-1)).toBe(false);
    expect(isValidWeek(MAX_WEEK + 1)).toBe(false);
    expect(isValidWeek(1.5)).toBe(false);
    expect(isValidWeek(NaN)).toBe(false);
    expect(isValidWeek("3")).toBe(false);
    expect(isValidWeek(null)).toBe(false);
  });
});

describe("parseWeekParam", () => {
  it("reads a week the caller actually asked for", () => {
    expect(parseWeekParam("0")).toBe(0);
    expect(parseWeekParam("7")).toBe(7);
    expect(parseWeekParam(String(MAX_WEEK))).toBe(MAX_WEEK);
  });

  /* The regression this function exists for, found live on 2026-08-14.
     `URLSearchParams.get` returns null for an absent param and `Number(null)`
     is 0 — and week 0 is a real week, so an `isValidWeek(Number(raw))` check
     said yes and served week 0 of the regular season to every parameterless
     request. On the NFL side, which has no week 0, that is an empty slate
     while games are live. Absent must not read as zero. */
  it("distinguishes an absent param from week 0", () => {
    expect(parseWeekParam(null)).toBeNull();
    expect(parseWeekParam(undefined)).toBeNull();
    expect(parseWeekParam("")).toBeNull();
    expect(parseWeekParam("0")).toBe(0);
  });

  it("returns null rather than a bad week, so callers fall back to current", () => {
    expect(parseWeekParam("-1")).toBeNull();
    expect(parseWeekParam(String(MAX_WEEK + 1))).toBeNull();
    expect(parseWeekParam("abc")).toBeNull();
    expect(parseWeekParam("2.5")).toBeNull();
  });
});

describe("nflPlayoffLabel (NFL-6)", () => {
  it("names each stored round", () => {
    expect(nflPlayoffLabel(1)).toBe("Wild Card");
    expect(nflPlayoffLabel(2)).toBe("Divisional");
    expect(nflPlayoffLabel(3)).toBe("Conference");
    expect(nflPlayoffLabel(4)).toBe("Super Bowl");
  });

  it("uses STORED numbering, not ESPN's", () => {
    // ESPN puts the Pro Bowl at 4 and the Super Bowl at 5; nflStoredWeek drops
    // the Pro Bowl and stores the Super Bowl at 4. Getting this backwards would
    // label the championship "Pro Bowl" in January, which is the kind of thing
    // nobody checks until it is on screen.
    expect(nflPlayoffLabel(4)).toBe("Super Bowl");
    // `as const` already makes "Pro Bowl" a type error, so this reads the
    // labels as plain strings — the point is to fail if someone widens the
    // list, not to restate what the union says.
    const labels: readonly string[] = NFL_PLAYOFF_ROUNDS.map((r) => r.label);
    expect(labels).not.toContain("Pro Bowl");
  });

  it("is null outside the four rounds rather than guessing", () => {
    expect(nflPlayoffLabel(0)).toBeNull();
    expect(nflPlayoffLabel(5)).toBeNull();
  });

  it("covers exactly the four weeks the ingest stores", () => {
    expect(NFL_PLAYOFF_ROUNDS.map((r) => r.week)).toEqual([1, 2, 3, 4]);
  });
});
