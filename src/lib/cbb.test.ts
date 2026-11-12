import { describe, expect, it } from "vitest";
import {
  bonusFor,
  cbbBreakLabel,
  cbbCrunchTime,
  cbbDateOfDay,
  cbbDayIndex,
  cbbDayLabel,
  cbbElapsedMinutes,
  cbbHalftime,
  cbbPace,
  cbbPeriodLabel,
  cbbTipSlot,
  clockSeconds,
  easternDate,
  espnDateParam,
  currentCbbSeasonId,
  foulHalf,
  hoopsRead,
  isValidCbbDay,
  nextRun,
  runLabel,
} from "./cbb";
import { seasonWeeks, shortWeekLabel, weekLabel } from "./group-weeks";
import { breakLabel, overtimeSuffix, periodLabel, underTwo } from "./kick";
import {
  cbbSeasonId,
  cbbSeasonIdFromEndYear,
  cbbTeamId,
  seasonIdsForYear,
  seasonYearOf,
  sportOfSeasonId,
} from "./league";

const SEASON = cbbSeasonId(2026);

describe("league ids", () => {
  it("keys a basketball season by the year it starts", () => {
    expect(SEASON).toBe(202026);
    expect(cbbSeasonIdFromEndYear(2027)).toBe(SEASON);
    expect(sportOfSeasonId(SEASON)).toBe("cbb");
    expect(seasonYearOf(SEASON)).toBe(2026);
  });

  it("leaves the two football leagues exactly where they were", () => {
    expect(sportOfSeasonId(2026)).toBe("cfb");
    expect(sportOfSeasonId(102026)).toBe("nfl");
    expect(seasonYearOf(102026)).toBe(2026);
    expect(seasonIdsForYear(2026)).toEqual([2026, 102026, 202026]);
  });

  it("keeps a school's basketball row off its football row", () => {
    // Auburn is ESPN team 2 in both sports.
    expect(cbbTeamId(2)).toBe(200002);
  });
});

describe("the day index", () => {
  it("counts days from November 1 and round-trips", () => {
    expect(cbbDayIndex(SEASON, "2026-11-01")).toBe(0);
    expect(cbbDayIndex(SEASON, "2026-11-12")).toBe(11);
    // across New Year and a February with no leap day
    expect(cbbDayIndex(SEASON, "2027-01-01")).toBe(61);
    expect(cbbDayIndex(SEASON, "2027-03-01")).toBe(120);
    for (const d of ["2026-11-12", "2027-01-01", "2027-04-05"]) {
      expect(cbbDateOfDay(SEASON, cbbDayIndex(SEASON, d)!)).toBe(d);
    }
  });

  it("is not thrown by the autumn clock change", () => {
    // Nov 1 2026 is the day US clocks go back; a local-time subtraction is
    // an hour short across it and rounds the wrong way.
    expect(cbbDayIndex(SEASON, "2026-11-02")).toBe(1);
  });

  it("rejects what is not a date or not a day of the season", () => {
    expect(cbbDayIndex(SEASON, "11/12/2026")).toBeNull();
    expect(isValidCbbDay(11)).toBe(true);
    expect(isValidCbbDay(-1)).toBe(false);
    expect(isValidCbbDay(400)).toBe(false);
    expect(isValidCbbDay(1.5)).toBe(false);
  });

  it("labels and formats a board date without moving it", () => {
    expect(cbbDayLabel("2026-11-12")).toBe("Thu, Nov 12");
    expect(espnDateParam("2026-11-12")).toBe("20261112");
  });

  it("puts a late West Coast tip on the Eastern date it belongs to", () => {
    // 04:30Z on the 12th is 11:30pm ET on the 11th.
    expect(easternDate(new Date("2026-11-12T04:30:00Z"))).toBe("2026-11-11");
    expect(easternDate(new Date("2026-11-12T05:30:00Z"))).toBe("2026-11-12");
  });
});

describe("the clock", () => {
  it("labels halves and overtimes", () => {
    expect(cbbPeriodLabel(1)).toBe("1H");
    expect(cbbPeriodLabel(2)).toBe("2H");
    expect(cbbPeriodLabel(3)).toBe("OT");
    expect(cbbPeriodLabel(4)).toBe("2OT");
    expect(cbbPeriodLabel(null)).toBe("");
  });

  it("reads halftime from period 1 with an expired clock", () => {
    expect(cbbBreakLabel(1, "0:00")).toBe("HALFTIME");
    expect(cbbBreakLabel(2, "0:00")).toBe("END 2H");
    expect(cbbBreakLabel(1, "0:01")).toBeNull();
    expect(cbbBreakLabel(null, "0:00")).toBeNull();
  });

  it("parses both clock shapes", () => {
    expect(clockSeconds("12:34")).toBe(754);
    expect(clockSeconds("0:23")).toBe(23);
    expect(clockSeconds("23.4")).toBe(23);
    expect(clockSeconds(null)).toBeNull();
    expect(clockSeconds("soon")).toBeNull();
  });

  it("counts minutes played across halves and overtime", () => {
    expect(cbbElapsedMinutes(1, "20:00")).toBe(0);
    expect(cbbElapsedMinutes(1, "0:00")).toBe(20);
    expect(cbbElapsedMinutes(2, "10:00")).toBe(30);
    expect(cbbElapsedMinutes(3, "5:00")).toBe(40);
    expect(cbbElapsedMinutes(4, "2:30")).toBe(47.5);
    expect(cbbElapsedMinutes(null, "10:00")).toBeNull();
  });

  it("marks the last four minutes, and not an expired clock", () => {
    expect(cbbCrunchTime(2, "3:59")).toBe(true);
    expect(cbbCrunchTime(2, "4:00")).toBe(false);
    expect(cbbCrunchTime(1, "1:00")).toBe(false);
    expect(cbbCrunchTime(3, "2:00")).toBe(true);
    expect(cbbCrunchTime(2, "0:00")).toBe(false);
  });
});

describe("cbbPace", () => {
  it("projects the regulation total from points per minute", () => {
    // 69 points at the half is a 138 pace
    expect(cbbPace(30, 39, 1, "0:00")).toBe(138);
    // 117 with 23 seconds left has almost nothing left to add
    expect(cbbPace(60, 57, 2, "0:23")).toBe(118);
  });

  it("says nothing in the opening minutes or in overtime", () => {
    expect(cbbPace(9, 3, 1, "17:00")).toBeNull();
    expect(cbbPace(70, 70, 3, "4:00")).toBeNull();
    expect(cbbPace(null, 3, 1, "10:00")).toBeNull();
  });
});

describe("nextRun", () => {
  it("extends one side's run and hands it over when the other scores", () => {
    let run = nextRun(null, { home: 3, away: 0 });
    expect(run).toEqual({ side: "home", pts: 3 });
    run = nextRun(run, { home: 4, away: 0 });
    expect(run).toEqual({ side: "home", pts: 7 });
    expect(runLabel(run)).toBe("7-0 run");
    run = nextRun(run, { home: 0, away: 2 });
    expect(run).toEqual({ side: "away", pts: 2 });
    expect(runLabel(run)).toBeNull();
  });

  it("holds through a tick with no scoring", () => {
    const run = { side: "away" as const, pts: 9 };
    expect(nextRun(run, { home: 0, away: 0 })).toBe(run);
  });

  it("does not guess when both sides scored inside one tick", () => {
    const run = { side: "home" as const, pts: 9 };
    expect(nextRun(run, { home: 2, away: 3 })).toBeNull();
    // unless ESPN's last play says who scored last
    expect(nextRun(run, { home: 2, away: 3 }, { side: "away", pts: 3 })).toEqual({
      side: "away",
      pts: 3,
    });
  });

  it("clears on a stat correction", () => {
    expect(nextRun({ side: "home", pts: 8 }, { home: -1, away: 0 })).toBeNull();
  });
});

describe("the bonus", () => {
  it("is decided by the opponent's fouls this half", () => {
    expect(bonusFor(6)).toBeNull();
    expect(bonusFor(7)).toBe("bonus");
    expect(bonusFor(9)).toBe("bonus");
    expect(bonusFor(10)).toBe("double");
  });

  it("carries second-half fouls into overtime", () => {
    expect(foulHalf(1)).toBe(1);
    expect(foulHalf(2)).toBe(2);
    expect(foulHalf(3)).toBe(2);
    expect(foulHalf(null)).toBe(1);
  });
});

describe("cbbHalftime", () => {
  it("reads the first-half score off the stored line", () => {
    expect(cbbHalftime({ h: [30, 41], a: [39, 28], run: null, wp: null })).toEqual({
      home: 30,
      away: 39,
    });
    expect(cbbHalftime({ h: [], a: [], run: null, wp: null })).toBeNull();
    expect(cbbHalftime(null)).toBeNull();
  });
});

describe("cbbTipSlot", () => {
  it("splits the night on Eastern time", () => {
    expect(cbbTipSlot("2026-11-12T17:00:00Z")).toBe("Afternoon"); // noon ET
    expect(cbbTipSlot("2026-11-13T00:00:00Z")).toBe("Evening"); // 7pm ET
    expect(cbbTipSlot("2026-11-13T03:00:00Z")).toBe("Late"); // 10pm ET
    expect(cbbTipSlot("2026-11-13T05:00:00Z")).toBe("Late"); // midnight ET
  });
});

describe("hoopsRead", () => {
  const base = { period: 2, clock: "10:00", lines: { spread: -4.5, total: 141.5 } };

  it("says who is covering and by how much, in home-perspective lines", () => {
    // home −4.5, up 7: home covers by 2.5
    expect(hoopsRead({ ...base, homePoints: 60, awayPoints: 53 }).cover).toEqual({ side: "home", by: 2.5 });
    // up 3 is not enough: the dog is covering by 1.5
    expect(hoopsRead({ ...base, homePoints: 60, awayPoints: 57 }).cover).toEqual({ side: "away", by: 1.5 });
  });

  it("calls a whole-number line that is level a push", () => {
    const r = hoopsRead({ ...base, lines: { spread: -4, total: null }, homePoints: 60, awayPoints: 56 });
    expect(r.cover).toEqual({ side: "push", by: 0 });
  });

  it("reads pace against the market total", () => {
    // 113 points in 30 minutes is a 151 pace, 9.5 over a 141.5 total
    const r = hoopsRead({ ...base, homePoints: 60, awayPoints: 53 });
    expect(r.pace).toBe(151);
    expect(r.paceVsTotal).toBe(9.5);
  });

  it("says nothing it cannot back", () => {
    const noLines = hoopsRead({ ...base, lines: { spread: null, total: null }, homePoints: 60, awayPoints: 53 });
    expect(noLines.cover).toBeNull();
    expect(noLines.paceVsTotal).toBeNull();
    expect(noLines.pace).toBe(151);
    const preTip = hoopsRead({ ...base, homePoints: null, awayPoints: null });
    expect(preTip.cover).toBeNull();
    expect(preTip.pace).toBeNull();
  });
});

describe("currentCbbSeasonId", () => {
  it("is the season that started the previous autumn until July", () => {
    expect(currentCbbSeasonId(new Date("2026-11-12T00:00:00Z"))).toBe(202026);
    expect(currentCbbSeasonId(new Date("2027-04-05T00:00:00Z"))).toBe(202026);
    expect(currentCbbSeasonId(new Date("2027-07-01T00:00:00Z"))).toBe(202027);
  });
});

describe("the shared clock helpers, asked about basketball", () => {
  it("label halves through kick.ts when the sport is passed", () => {
    expect(periodLabel(2, "cbb")).toBe("2H");
    expect(periodLabel(2)).toBe("Q2");
    expect(periodLabel(2, "nfl")).toBe("Q2");
  });

  it("put halftime after period 1, not period 2", () => {
    expect(breakLabel(1, "0:00", "cbb")).toBe("HALFTIME");
    expect(breakLabel(2, "0:00", "cbb")).toBe("END 2H");
    // football is untouched
    expect(breakLabel(2, "0:00")).toBe("HALFTIME");
    expect(breakLabel(1, "0:00")).toBe("END Q1");
  });

  it("call the last four minutes tense, not the last two of Q2", () => {
    expect(underTwo(2, "3:30", "cbb")).toBe(true);
    expect(underTwo(2, "3:30")).toBe(false);
    expect(underTwo(1, "1:30", "cbb")).toBe(false);
    expect(underTwo(2, "1:30")).toBe(true);
  });

  it("say OT after two periods in basketball and four in football", () => {
    expect(overtimeSuffix(3, "cbb")).toBe(" / OT");
    expect(overtimeSuffix(4, "cbb")).toBe(" / 2OT");
    expect(overtimeSuffix(2, "cbb")).toBe("");
    expect(overtimeSuffix(3)).toBe("");
    expect(overtimeSuffix(5)).toBe(" / OT");
    expect(overtimeSuffix(null, "cbb")).toBe("");
  });
});

describe("a betting group's basketball calendar", () => {
  it("is the season's days, each named by its date", () => {
    const days = seasonWeeks("cbb", 1);
    expect(days[0]).toEqual({ seasonType: "regular", week: 1 });
    expect(days.every((d) => d.seasonType === "regular")).toBe(true);
    expect(days.length).toBeGreaterThan(150);
    // football's calendars are exactly what they were
    expect(seasonWeeks("cfb", 0).filter((w) => w.seasonType === "regular")).toHaveLength(17);
    expect(seasonWeeks("nfl", 1).filter((w) => w.seasonType === "preseason")).toHaveLength(4);
  });

  it("never prints a day as a week number", () => {
    const label = weekLabel({ seasonType: "regular", week: 11 }, "cbb");
    expect(label).not.toMatch(/week/i);
    expect(label).toMatch(/Nov 12/);
    expect(shortWeekLabel({ seasonType: "regular", week: 11 }, "cbb")).toBe(label);
    expect(weekLabel({ seasonType: "regular", week: 11 }, "cfb")).toBe("Week 11");
  });
});
