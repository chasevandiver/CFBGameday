import { describe, expect, it } from "vitest";
import {
  boardRunsIn,
  firstRegular,
  parseWeekRef,
  seasonWeeks,
  weekLabel,
  weekQuery,
  type WeekRef,
} from "./group-weeks";

describe("seasonWeeks", () => {
  it("runs the NFL preseason, regular season and playoffs in order", () => {
    const w = seasonWeeks("nfl", 1);
    expect(w[0]).toEqual({ seasonType: "preseason", week: 1 });
    expect(w[3]).toEqual({ seasonType: "preseason", week: 4 });
    expect(w[4]).toEqual({ seasonType: "regular", week: 1 });
    expect(w[21]).toEqual({ seasonType: "regular", week: 18 });
    expect(w[w.length - 1]).toEqual({ seasonType: "postseason", week: 4 });
  });

  it("gives CFB no preseason and one postseason entry", () => {
    const w = seasonWeeks("cfb", 0);
    expect(w.some((x) => x.seasonType === "preseason")).toBe(false);
    expect(w[0]).toEqual({ seasonType: "regular", week: 0 });
    expect(w.filter((x) => x.seasonType === "postseason")).toHaveLength(1);
  });

  it("honours a season with no Week 0", () => {
    expect(seasonWeeks("cfb", 1)[0]).toEqual({ seasonType: "regular", week: 1 });
  });
});

describe("weekLabel", () => {
  it("never renders a preseason week as a bare number — the original defect", () => {
    expect(weekLabel({ seasonType: "preseason", week: 2 }, "nfl")).toBe("Preseason Week 2");
    expect(weekLabel({ seasonType: "regular", week: 2 }, "nfl")).toBe("Week 2");
  });

  it("names the playoff round rather than numbering it", () => {
    expect(weekLabel({ seasonType: "postseason", week: 1 }, "nfl")).toBe("Wild Card");
    expect(weekLabel({ seasonType: "postseason", week: 4 }, "nfl")).toBe("Super Bowl");
    expect(weekLabel({ seasonType: "postseason", week: 1 }, "cfb")).toBe("Bowls & CFP");
  });
});

describe("parseWeekRef", () => {
  const weeks = seasonWeeks("nfl", 1);
  const inPreseason: WeekRef = { seasonType: "preseason", week: 2 };

  it("falls back to the live pointer with no params at all", () => {
    expect(parseWeekRef(undefined, undefined, weeks, inPreseason)).toEqual(inPreseason);
  });

  it("reads a bare ?week= as the REGULAR season, not as more preseason", () => {
    // This is the fix: in August the fallback is a preseason week, and the old
    // behaviour inherited that season type for every `?week=` link.
    expect(parseWeekRef("2", undefined, weeks, inPreseason)).toEqual({
      seasonType: "regular",
      week: 2,
    });
  });

  it("takes the season type from ?st=", () => {
    expect(parseWeekRef("3", "pre", weeks, inPreseason)).toEqual({
      seasonType: "preseason",
      week: 3,
    });
    expect(parseWeekRef("2", "post", weeks, inPreseason)).toEqual({
      seasonType: "postseason",
      week: 2,
    });
  });

  it("clamps out-of-range weeks to the ends of that season type", () => {
    expect(parseWeekRef("9", "pre", weeks, inPreseason)).toEqual({
      seasonType: "preseason",
      week: 4,
    });
    expect(parseWeekRef("0", undefined, weeks, inPreseason)).toEqual({
      seasonType: "regular",
      week: 1,
    });
  });

  it("defaults to the first week of a named season type", () => {
    expect(parseWeekRef(undefined, "post", weeks, inPreseason)).toEqual({
      seasonType: "postseason",
      week: 1,
    });
  });
});

describe("weekQuery", () => {
  it("omits ?st= for the regular season and keeps extras", () => {
    expect(weekQuery({ seasonType: "regular", week: 5 })).toBe("?week=5");
    expect(weekQuery({ seasonType: "preseason", week: 2 }, { league: "nfl" })).toBe(
      "?week=2&st=pre&league=nfl",
    );
    expect(weekQuery({ seasonType: "regular", week: 5 }, { league: null })).toBe("?week=5");
  });
});

describe("boardRunsIn / firstRegular", () => {
  it("keeps pick'em boards out of the preseason", () => {
    expect(boardRunsIn({ seasonType: "preseason", week: 1 })).toBe(false);
    expect(boardRunsIn({ seasonType: "regular", week: 1 })).toBe(true);
    expect(boardRunsIn({ seasonType: "postseason", week: 1 })).toBe(true);
  });

  it("points at the season opener", () => {
    expect(firstRegular(seasonWeeks("nfl", 1))).toEqual({ seasonType: "regular", week: 1 });
  });
});
