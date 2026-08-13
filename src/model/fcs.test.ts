import { describe, expect, it } from "vitest";
import { fcsMarginsVsFbs, fcsRatingOf, fcsTopIds, type FcsGame } from "./fcs";
import { DEFAULT_PARAMS } from "./ratings";

const g = (
  season: number,
  homeId: number,
  awayId: number,
  homePoints: number | null,
  awayPoints: number | null,
): FcsGame => ({ season, homeId, awayId, homePoints, awayPoints });

// 1 and 2 are FBS; 50, 51, 52 are not.
const FBS = new Set([1, 2]);

describe("fcsMarginsVsFbs", () => {
  it("signs the margin from the FCS team's side, home or away", () => {
    const m = fcsMarginsVsFbs(
      [g(2024, 1, 50, 52, 3), g(2024, 50, 2, 10, 40)],
      FBS,
      { before: 2026 },
    );
    // Away at 3–52 is −49; home at 10–40 is −30. Mean −39.5.
    expect(m.get(50)).toEqual({ avgMargin: -39.5, n: 2 });
  });

  it("ignores games that are not exactly one FBS side", () => {
    const m = fcsMarginsVsFbs(
      [
        g(2024, 1, 2, 30, 20), // FBS vs FBS
        g(2024, 50, 51, 21, 14), // FCS vs FCS
        g(2024, 1, 50, 40, 10), // counts
      ],
      FBS,
      { before: 2026 },
    );
    expect([...m.keys()]).toEqual([50]);
    expect(m.get(50)?.n).toBe(1);
  });

  it("ignores unplayed games", () => {
    const m = fcsMarginsVsFbs(
      [g(2024, 1, 50, null, null), g(2024, 1, 50, 40, 10)],
      FBS,
      { before: 2026 },
    );
    expect(m.get(50)?.n).toBe(1);
  });

  it("uses only seasons strictly before `before` — the lookahead rule", () => {
    // The whole reason `before` is required rather than optional. Pricing a
    // 2025 game with a bucket that saw 2025 results would flatter the backtest
    // in a way no assertion downstream would catch.
    const games = [g(2023, 1, 50, 30, 20), g(2024, 1, 50, 60, 0), g(2025, 1, 50, 45, 3)];
    expect(fcsMarginsVsFbs(games, FBS, { before: 2024 }).get(50)).toEqual({
      avgMargin: -10,
      n: 1,
    });
    expect(fcsMarginsVsFbs(games, FBS, { before: 2025 }).get(50)?.n).toBe(2);
    expect(fcsMarginsVsFbs(games, FBS, { before: 2026 })?.get(50)?.n).toBe(3);
  });

  it("returns nothing when no FCS team played an FBS one", () => {
    expect(fcsMarginsVsFbs([g(2024, 1, 2, 30, 20)], FBS, { before: 2026 }).size).toBe(0);
    expect(fcsMarginsVsFbs([], FBS, { before: 2026 }).size).toBe(0);
  });
});

describe("fcsTopIds", () => {
  const margins = (...xs: Array<[number, number, number]>) =>
    new Map(xs.map(([id, avgMargin, n]) => [id, { avgMargin, n }]));

  it("splits an odd population at the middle value, which goes top", () => {
    const top = fcsTopIds(margins([50, -10, 3], [51, -30, 3], [52, -50, 3]));
    expect([...top].sort()).toEqual([50, 51]);
  });

  it("splits an even population at the mean of the two middles", () => {
    const top = fcsTopIds(margins([50, -10, 3], [51, -20, 3], [52, -40, 3], [53, -50, 3]));
    expect([...top].sort()).toEqual([50, 51]);
  });

  it("excludes teams below the minimum game count from the split entirely", () => {
    // A single 63–0 is not evidence. The unqualified team must not appear in
    // the top set AND must not drag the median.
    const top = fcsTopIds(margins([50, -10, 3], [51, -30, 3], [52, 0, 1]));
    expect(top.has(52)).toBe(false);
    expect([...top].sort()).toEqual([50]);
  });

  it("puts everyone in the top bucket when they are all tied", () => {
    // `>= median` with no spread. Harmless — with equal params it changes
    // nothing, and with unequal ones a population with no variation genuinely
    // has no bottom half.
    expect(fcsTopIds(margins([50, -30, 3], [51, -30, 3])).size).toBe(2);
  });

  it("returns an empty set when nothing qualifies", () => {
    expect(fcsTopIds(new Map()).size).toBe(0);
    expect(fcsTopIds(margins([50, -10, 1])).size).toBe(0);
  });
});

describe("fcsRatingOf", () => {
  it("returns exactly −30 for both buckets under the shipped params", () => {
    // The identity guarantee, asserted at its source. If either of these ever
    // changes, `--tune-fcs` has run and the changelog says why.
    expect(fcsRatingOf(50, new Set([50]), DEFAULT_PARAMS)).toBe(-30);
    expect(fcsRatingOf(51, new Set([50]), DEFAULT_PARAMS)).toBe(-30);
  });

  it("reads the right bucket once they differ", () => {
    const split = { fcsTopRating: -25, fcsOtherRating: -35 };
    expect(fcsRatingOf(50, new Set([50]), split)).toBe(-25);
    expect(fcsRatingOf(51, new Set([50]), split)).toBe(-35);
  });

  it("treats an unknown team and an absent bucket set as `other`", () => {
    const split = { fcsTopRating: -25, fcsOtherRating: -35 };
    expect(fcsRatingOf(99, new Set([50]), split)).toBe(-35);
    expect(fcsRatingOf(50, undefined, split)).toBe(-35);
  });
});
