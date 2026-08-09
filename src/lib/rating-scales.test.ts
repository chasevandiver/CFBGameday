import { describe, expect, it } from "vitest";
import { describePlacement, rankAndPercentile } from "./rankings";
import { ELO_PER_POINT, formatRating, systemMargin } from "./rating-scales";

describe("formatRating", () => {
  it("signs a points scale and names the unit", () => {
    // "+12.4" alone is the problem this whole module exists for.
    expect(formatRating("fpi", 12.4)).toBe("+12.4 pts");
    expect(formatRating("model", -3)).toBe("-3.0 pts");
  });

  it("renders Elo as a whole number with no unit", () => {
    expect(formatRating("elo", 1842.6)).toBe("1843");
  });

  it("renders returning production as a percentage", () => {
    expect(formatRating("returning", 0.62)).toBe("62%");
  });
});

describe("systemMargin", () => {
  it("reads a points system straight off, away perspective", () => {
    // Home +10, away +3 → the margin favours home by 7, i.e. -7 away-side.
    expect(systemMargin("sp", 10, 3)).toBe(-7);
  });

  it("divides Elo down before comparing — it is not a points scale", () => {
    // 250 Elo apart is ten points, not two hundred and fifty.
    expect(systemMargin("elo", 1800, 1550)).toBe(-250 / ELO_PER_POINT);
    expect(systemMargin("elo", 1800, 1550)).toBe(-10);
  });

  it("is null when a value is missing or the scale has no conversion", () => {
    expect(systemMargin("sp", null, 3)).toBeNull();
    expect(systemMargin("returning", 0.6, 0.5)).toBeNull();
  });
});

describe("rankAndPercentile", () => {
  const field = [30, 20, 10, 0, -10];

  it("ranks best-first and reports the size of the field", () => {
    expect(rankAndPercentile(field, 30)).toEqual({ rank: 1, of: 5, percentile: 1 });
    expect(rankAndPercentile(field, -10)).toEqual({ rank: 5, of: 5, percentile: 0 });
  });

  it("puts the middle of the field at the middle", () => {
    expect(rankAndPercentile(field, 10)?.percentile).toBe(0.5);
  });

  it("gives tied values the better rank, as a leaderboard does", () => {
    expect(rankAndPercentile([10, 10, 5], 10)?.rank).toBe(1);
  });

  it("handles a scale where low wins", () => {
    expect(rankAndPercentile([1, 2, 3], 1, false)?.rank).toBe(1);
    expect(rankAndPercentile([1, 2, 3], 3, false)?.rank).toBe(3);
  });

  it("is null on an empty field, and top of a field of one", () => {
    expect(rankAndPercentile([], 5)).toBeNull();
    expect(rankAndPercentile([5], 5)?.percentile).toBe(1);
  });
});

describe("describePlacement", () => {
  it("says where a team sits in words, not just a number", () => {
    // A rank needs the size of the field to mean anything; a phrase does not.
    expect(describePlacement({ rank: 1, of: 136, percentile: 1 })).toBe("top 1%");
    expect(describePlacement({ rank: 14, of: 136, percentile: 0.9 })).toBe("top 10%");
    expect(describePlacement({ rank: 68, of: 136, percentile: 0.5 })).toBe("middle of the field");
    expect(describePlacement({ rank: 130, of: 136, percentile: 0.05 })).toBe("bottom 5%");
  });
});
