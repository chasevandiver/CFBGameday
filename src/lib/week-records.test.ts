import { describe, expect, it } from "vitest";
import {
  footballWeekKey,
  leagueSplit,
  memberRecords,
  refreshTier,
  sliceRecord,
  standingOf,
  rangeLabel,
  undatedCount,
  weekBucketLabel,
  weekBuckets,
  type WeekWager,
} from "./week-records";
import { nflSeasonId } from "./league";
import { formatRecord, type Tally } from "./records";

const formatOf = (t: Tally): string => formatRecord(t);

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

describe("memberRecords", () => {
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
    const rows = memberRecords(wagers, names);
    expect(rows.map((r) => r.name)).toEqual(["Jeff Ward", "Hayden Cole", "Sam Ruiz"]);
    expect(rows[0].record.now.cfb.wins).toBe(1);
    expect(rows[0].record.now.nfl.losses).toBe(1);
  });

  it("sinks a member with nothing decided below one who is down units", () => {
    const rows = memberRecords(wagers, names);
    expect(rows[rows.length - 1].userId).toBe("u-sam");
    expect(rows[rows.length - 1].record.upcoming).toBe(1);
  });

  it("leaves out members with no wager in the slice, and names an unknown id", () => {
    const rows = memberRecords([{ ...wagers[0], userId: "u-ghost" }], names);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("—");
  });

  /* WEEK-3. The point of a live ranking: at 4pm on a Saturday the order has to
     be the board's, not the grader's. Hayden is behind on settled bets and
     ahead on the board, and the board is what the page shows. */
  it("ranks on the board as it stands, not on what has settled", () => {
    const live = [
      { ...w("2026-09-12T16:00:00Z", CFB, "win", { units: 1 }), userId: "u-jeff" },
      {
        ...w("2026-09-12T20:00:00Z", CFB, null, {
          units: 4,
          odds: -110,
          standingState: "in_progress" as const,
          standing: "win" as const,
        }),
        userId: "u-hayden",
      },
    ];
    const rows = memberRecords(live, names);
    expect(rows.map((r) => r.userId)).toEqual(["u-hayden", "u-jeff"]);
    expect(rows[0].record.live).toBe(1);
    expect(rows[0].record.settled.total.decided).toBe(0);
  });
});

describe("sliceRecord", () => {
  const settledWin = w("2026-09-12T16:00:00Z", CFB, "win", { units: 1, odds: -110 });
  const liveWin = w("2026-09-12T20:00:00Z", CFB, null, {
    units: 2,
    odds: 150,
    standingState: "in_progress" as const,
    standing: "win" as const,
  });
  const ungradedFinal = w("2026-09-13T17:00:00Z", NFL, null, {
    units: 1,
    odds: -110,
    standingState: "final" as const,
    standing: "loss" as const,
  });
  const notKicked = w("2026-09-14T23:00:00Z", NFL, null, { units: 1, odds: -110 });

  it("keeps the settled record separate from the board's", () => {
    const r = sliceRecord([settledWin, liveWin, ungradedFinal, notKicked]);
    expect(formatOf(r.settled.total)).toBe("1-0");
    expect(formatOf(r.now.total)).toBe("2-1");
  });

  it("counts what is live, what is projected and what has not kicked off", () => {
    const r = sliceRecord([settledWin, liveWin, ungradedFinal, notKicked]);
    expect(r.live).toBe(1);
    // live + the final nobody has graded yet
    expect(r.projected).toBe(2);
    expect(r.upcoming).toBe(1);
  });

  it("prices a projected win at its own odds, not at −110", () => {
    // +150 on 2u pays 3u. The −110 convention would have said 1.82.
    expect(sliceRecord([liveWin]).now.total.units).toBeCloseTo(3, 10);
  });

  it("is the settled record exactly when nothing is out", () => {
    const r = sliceRecord([settledWin]);
    expect(r.now).toEqual(r.settled);
    expect([r.live, r.projected, r.upcoming]).toEqual([0, 0, 0]);
  });

  it("never lets the board overrule the grader", () => {
    // A stored push on a game the score would call a win: the row wins.
    const stored = w("2026-09-12T16:00:00Z", CFB, "push", {
      units: 1,
      odds: -110,
      standingState: "final" as const,
      standing: "win" as const,
    });
    expect(formatOf(sliceRecord([stored]).now.total)).toBe("0-0-1");
    expect(sliceRecord([stored]).projected).toBe(0);
  });
});

describe("standingOf", () => {
  const spread = { betType: "spread", side: "home" as const, line: -3 };

  it("reads a game in progress off the score", () => {
    expect(
      standingOf(spread, { status: "in_progress", home_points: 21, away_points: 10 }),
    ).toEqual({ standingState: "in_progress", standing: "win" });
  });

  it("reads a final the grader has not reached yet", () => {
    expect(standingOf(spread, { status: "final", home_points: 14, away_points: 17 })).toEqual({
      standingState: "final",
      standing: "loss",
    });
  });

  it("says nothing about a game that has not kicked off, or one with no score", () => {
    expect(standingOf(spread, { status: "scheduled", home_points: null, away_points: null }))
      .toEqual({ standingState: null, standing: null });
    expect(standingOf(spread, { status: "in_progress", home_points: null, away_points: null }))
      .toEqual({ standingState: null, standing: null });
    expect(standingOf(spread, undefined)).toEqual({ standingState: null, standing: null });
  });

  it("says nothing about a bet a full-game score cannot settle", () => {
    // R2-A4: team totals, first halves and futures wait for a manual result.
    for (const betType of ["team_total", "first_half", "future"]) {
      expect(
        standingOf(
          { betType, side: "over", line: 24 },
          { status: "final", home_points: 30, away_points: 20 },
        ),
      ).toEqual({ standingState: null, standing: null });
    }
  });

  it("calls a game sitting exactly on the number a push", () => {
    expect(standingOf(spread, { status: "in_progress", home_points: 10, away_points: 7 })).toEqual({
      standingState: "in_progress",
      standing: "push",
    });
  });
});

describe("refreshTier", () => {
  const now = Date.parse("2026-09-12T18:00:00Z");
  const at = (iso: string, extra: Partial<WeekWager> = {}) =>
    w(iso, CFB, null, { odds: -110, ...extra });

  it("goes fast the moment anything is being played", () => {
    expect(
      refreshTier(
        [at("2026-09-12T16:00:00Z", { standingState: "in_progress", standing: "win" })],
        now,
      ),
    ).toEqual({ live: true, imminent: true });
  });

  it("goes to the middle tier for a kickoff inside the window", () => {
    expect(refreshTier([at("2026-09-12T20:00:00Z")], now).imminent).toBe(true);
    // three hours past a start that never flipped to in_progress — a status
    // that lags is exactly when the page must keep asking
    expect(refreshTier([at("2026-09-12T16:00:00Z")], now).imminent).toBe(true);
  });

  it("idles on a book with nothing near", () => {
    expect(refreshTier([at("2026-09-13T20:00:00Z")], now)).toEqual({
      live: false,
      imminent: false,
    });
    expect(refreshTier([at("2026-09-12T10:00:00Z")], now).imminent).toBe(false);
  });

  it("idles on a settled book, and on one with no kickoffs at all", () => {
    const settled = w("2026-09-12T17:00:00Z", CFB, "win", {
      standingState: "final",
      standing: "win",
    });
    expect(refreshTier([settled], now)).toEqual({ live: false, imminent: false });
    expect(refreshTier([w(null, CFB, null)], now)).toEqual({ live: false, imminent: false });
  });
});
