import { describe, expect, it } from "vitest";
import {
  footballWeekKey,
  leagueSplit,
  memberSplits,
  rangeLabel,
  undatedCount,
  weekBucketLabel,
  weekBuckets,
  type WeekWager,
} from "./week-records";
import { nflSeasonId } from "./league";

const CT = "America/Chicago";
const CFB = 2026;
const NFL = nflSeasonId(2026);

/** A settled 1u wager on a kickoff. `payoutUnits` null → the −110 convention. */
function w(
  startTs: string | null,
  seasonId: number,
  result: WeekWager["result"],
  extra: Partial<WeekWager> = {},
): WeekWager {
  return {
    seasonId,
    startTs,
    week: 3,
    seasonType: "regular",
    result,
    units: 1,
    payoutUnits: null,
    ...extra,
  };
}

describe("footballWeekKey", () => {
  it("anchors the week on Tuesday", () => {
    // Thu Sep 10 2026 through Mon Sep 14 2026 all sit in the week that opened
    // Tue Sep 8 — the NFL's own Tue→Mon week, and CFB's Thu→Sat inside it.
    expect(footballWeekKey("2026-09-11T00:15:00Z", CT)).toBe("2026-09-08"); // Thu night CT
    expect(footballWeekKey("2026-09-12T16:00:00Z", CT)).toBe("2026-09-08"); // Sat
    expect(footballWeekKey("2026-09-13T17:00:00Z", CT)).toBe("2026-09-08"); // Sun
    expect(footballWeekKey("2026-09-15T00:15:00Z", CT)).toBe("2026-09-08"); // Mon night CT
  });

  it("starts a new week on the Tuesday itself", () => {
    expect(footballWeekKey("2026-09-15T17:00:00Z", CT)).toBe("2026-09-15");
  });

  it("keeps a Labor Day Monday with the weekend it was played on", () => {
    // Sat Sep 5 2026 and Mon Sep 7 2026 (Labor Day) are one week of football.
    expect(footballWeekKey("2026-09-05T16:00:00Z", CT)).toBe("2026-09-01");
    expect(footballWeekKey("2026-09-08T00:00:00Z", CT)).toBe("2026-09-01"); // Mon 7pm CT
  });

  it("places a late kickoff by the viewer's day, not UTC's", () => {
    // 10:30pm Pacific Saturday is Sunday in UTC and still Saturday's week.
    const iso = "2026-09-13T05:30:00Z";
    expect(footballWeekKey(iso, "America/Los_Angeles")).toBe("2026-09-08");
    expect(footballWeekKey(iso, "America/New_York")).toBe("2026-09-08");
  });
});

describe("weekBuckets", () => {
  const bets: WeekWager[] = [
    w("2026-09-12T16:00:00Z", CFB, "win"), // Sat, CFB wk 3
    w("2026-09-12T23:00:00Z", CFB, "loss"), // Sat
    w("2026-09-13T17:00:00Z", NFL, "win", { week: 2 }), // Sun, NFL wk 2
    w("2026-09-15T00:15:00Z", NFL, "push", { week: 2 }), // Mon night CT
    w("2026-09-19T16:00:00Z", CFB, "win", { week: 4 }), // the next Saturday
    w(null, CFB, "win", { week: null, seasonType: null }), // a future
  ];

  it("groups by week, newest first, and days oldest first", () => {
    const weeks = weekBuckets(bets, CT);
    expect(weeks.map((x) => x.key)).toEqual(["2026-09-15", "2026-09-08"]);
    expect(weeks[1].days.map((d) => d.label)).toEqual(["Sat", "Sun", "Mon"]);
    expect(weeks[1].wagers).toHaveLength(4);
  });

  it("drops wagers with no kickoff, and counts them for the caller", () => {
    expect(weekBuckets(bets, CT).flatMap((x) => x.wagers)).toHaveLength(5);
    expect(undatedCount(bets)).toBe(1);
  });

  it("names a mixed week by both leagues' own numbers", () => {
    expect(weekBuckets(bets, CT)[1].label).toBe("CFB Wk 3 · NFL Wk 2");
  });

  it("ranges over the days that carry wagers, not the whole window", () => {
    expect(weekBuckets(bets, CT)[1].range).toBe("Sep 12–14");
  });
});

describe("weekBucketLabel", () => {
  it("uses the league's own name when only one league is in the week", () => {
    expect(weekBucketLabel([w("2026-09-12T16:00:00Z", CFB, "win")])).toBe("Week 3");
    expect(weekBucketLabel([w("2026-09-13T17:00:00Z", NFL, "win", { week: 2 })])).toBe(
      "NFL Week 2",
    );
  });

  it("names the NFL preseason and the postseasons", () => {
    expect(
      weekBucketLabel([w("2026-08-15T00:00:00Z", NFL, "win", { week: 2, seasonType: "preseason" })]),
    ).toBe("NFL Preseason Week 2");
    expect(
      weekBucketLabel([w("2027-01-10T18:00:00Z", NFL, "win", { week: 1, seasonType: "postseason" })]),
    ).toBe("NFL Wild Card");
    expect(
      weekBucketLabel([w("2027-01-01T18:00:00Z", CFB, "win", { week: 1, seasonType: "postseason" })]),
    ).toBe("Bowls & CFP");
  });

  it("takes the modal week, so one makeup game cannot rename the week", () => {
    const week = [
      w("2026-09-12T16:00:00Z", CFB, "win", { week: 3 }),
      w("2026-09-12T20:00:00Z", CFB, "loss", { week: 3 }),
      w("2026-09-12T23:00:00Z", CFB, "win", { week: 2 }), // a postponed opener
    ];
    expect(weekBucketLabel(week)).toBe("Week 3");
  });

  it("falls back rather than inventing a number it does not have", () => {
    expect(weekBucketLabel([w("2026-09-12T16:00:00Z", CFB, "win", { week: null })])).toBe("Week");
  });
});

describe("leagueSplit", () => {
  const bets = [
    w("2026-09-12T16:00:00Z", CFB, "win"),
    w("2026-09-12T23:00:00Z", CFB, "loss"),
    w("2026-09-13T17:00:00Z", NFL, "win"),
    w("2026-09-13T20:00:00Z", NFL, "void"),
  ];

  it("cuts both leagues out of one pile, and the total is the whole pile", () => {
    const s = leagueSplit(bets);
    expect([s.total.wins, s.total.losses]).toEqual([2, 1]);
    expect([s.cfb.wins, s.cfb.losses]).toEqual([1, 1]);
    expect([s.nfl.wins, s.nfl.losses]).toEqual([1, 0]);
  });

  it("adds up: the two leagues are the total", () => {
    const s = leagueSplit(bets);
    expect(s.cfb.decided + s.nfl.decided).toBe(s.total.decided);
    expect(s.cfb.units + s.nfl.units).toBeCloseTo(s.total.units, 10);
  });
});

describe("rangeLabel", () => {
  it("collapses one day, one month, and spans two", () => {
    expect(rangeLabel("2026-09-13", "2026-09-13")).toBe("Sep 13");
    expect(rangeLabel("2026-09-10", "2026-09-14")).toBe("Sep 10–14");
    expect(rangeLabel("2026-09-28", "2026-10-01")).toBe("Sep 28 – Oct 1");
  });
});

describe("memberSplits", () => {
  const names = new Map([
    ["u-jeff", "Jeff Ward"],
    ["u-hayden", "Hayden Cole"],
    ["u-sam", "Sam Ruiz"],
  ]);
  const wagers = [
    { ...w("2026-09-12T16:00:00Z", CFB, "win", { units: 2 }), userId: "u-jeff" },
    { ...w("2026-09-13T17:00:00Z", NFL, "loss"), userId: "u-jeff" },
    { ...w("2026-09-12T16:00:00Z", CFB, "loss", { units: 3 }), userId: "u-hayden" },
    { ...w("2026-09-12T20:00:00Z", CFB, null), userId: "u-sam" },
  ];

  it("ranks by units and names each member", () => {
    const rows = memberSplits(wagers, names);
    expect(rows.map((r) => r.name)).toEqual(["Jeff Ward", "Hayden Cole", "Sam Ruiz"]);
    expect(rows[0].split.cfb.wins).toBe(1);
    expect(rows[0].split.nfl.losses).toBe(1);
  });

  it("sinks a member with nothing decided below one who is down units", () => {
    const rows = memberSplits(wagers, names);
    expect(rows[rows.length - 1].userId).toBe("u-sam");
    expect(rows[rows.length - 1].pending).toBe(1);
  });

  it("leaves out members with no wager in the slice, and names an unknown id", () => {
    const rows = memberSplits([{ ...wagers[0], userId: "u-ghost" }], names);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("—");
  });
});
