import { describe, expect, it } from "vitest";
import { MAX_WEEK, MIN_WEEK, isValidWeek, parseWeekParam } from "./week-range";

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
