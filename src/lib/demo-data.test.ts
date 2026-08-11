import { describe, expect, it } from "vitest";
import { demoGames, demoHomeData, demoSaturday, demoSlateData } from "./demo-data";
import { splitPositions } from "./home";
import { dayTabLabels, kickSlot } from "./kick";

/** ET wall clock for an instant, e.g. "Sat 15:30". */
const et = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));

/**
 * The demo is posed against the viewer's own week rather than a frozen date,
 * so the thing worth testing is that the posing survives being opened at any
 * hour of any day — including across the November DST change, which is where
 * hardcoding a UTC offset would put every kickoff an hour out.
 */
const WHEN = {
  "midweek, DST": Date.parse("2026-08-11T15:00:00Z"),
  "the Saturday itself": Date.parse("2026-11-14T19:30:00Z"),
  "Saturday night, after the games": Date.parse("2026-11-15T04:00:00Z"),
  "standard time": Date.parse("2026-12-02T09:00:00Z"),
  "New Year's Eve": Date.parse("2026-12-31T23:59:00Z"),
};

describe("demoSaturday", () => {
  it("lands on a Saturday whenever it is asked", () => {
    for (const now of Object.values(WHEN)) {
      const { y, m, d } = demoSaturday(now);
      expect(new Date(Date.UTC(y, m - 1, d)).getUTCDay()).toBe(6);
    }
  });

  it("treats a Saturday as its own week, not the next one", () => {
    const saturday = Date.parse("2026-11-14T19:30:00Z");
    expect(demoSaturday(saturday)).toEqual({ y: 2026, m: 11, d: 14 });
  });
});

describe("demoGames", () => {
  it("keeps every kickoff on its intended ET wall time", () => {
    for (const [label, now] of Object.entries(WHEN)) {
      const games = demoGames(now);
      const times = games.map((g) => et(g.startTs!));
      expect(times, label).toEqual([
        "Fri 20:00",
        "Sat 12:00",
        "Sat 12:00",
        "Sat 15:30",
        "Sat 15:30",
        "Sat 16:00",
        "Sat 19:00",
        "Sat 19:00",
        "Sat 19:30",
        "Sat 19:30",
        "Sat 22:15",
        "Sat 22:30",
      ]);
    }
  });

  it("fills all four kickoff windows and two day tabs", () => {
    const games = demoGames(WHEN["midweek, DST"]);
    const slots = new Set(games.map((g) => kickSlot(g.startTs!)));
    expect(slots).toEqual(new Set(["Noon", "Afternoon", "Primetime", "Late"]));
    expect(dayTabLabels(games.map((g) => g.startTs!), "America/Chicago").map((d) => d.label)).toEqual([
      "Fri",
      "Sat",
    ]);
  });

  it("poses a Saturday in progress — finals, live games and kickoffs to come", () => {
    const games = demoGames(WHEN["standard time"]);
    const count = (s: string) => games.filter((g) => g.status === s).length;
    expect(count("final")).toBe(3);
    expect(count("in_progress")).toBe(3);
    expect(count("scheduled")).toBe(6);
  });

  it("carries an edge flag that agrees with its own arithmetic", () => {
    for (const g of demoGames(WHEN["midweek, DST"])) {
      const p = g.prediction;
      if (!p || p.vegasSpread === null) continue;
      const edge = Math.round((p.spread - p.vegasSpread) * 10) / 10;
      expect(p.edge).toBe(edge);
      expect(p.edgeFlag).toBe(
        Math.abs(edge) >= 4 ? "BIG_EDGE" : Math.abs(edge) >= 2 ? "EDGE" : null,
      );
    }
  });
});

describe("demoHomeData", () => {
  it("gives the hub something in every section", () => {
    const data = demoHomeData(WHEN["the Saturday itself"]);
    const { bets, picks } = splitPositions(data.positions);

    expect(bets.length).toBeGreaterThan(0);
    expect(picks.length).toBeGreaterThan(0);
    expect(data.groups.length).toBeGreaterThan(0);
    expect(data.curve.length).toBeGreaterThan(0);
    // The record block only renders once something has graded.
    expect(data.bets.decided).toBeGreaterThan(0);
    expect(data.picks.decided).toBeGreaterThan(0);
  });

  it("attaches the viewer's layers to the games, which is what the aura reads", () => {
    const data = demoHomeData(WHEN["the Saturday itself"]);
    const live = data.positions.find((p) => p.game.status === "in_progress");
    expect(live?.game.myBets.length).toBeGreaterThan(0);
    expect(live?.game.myPicks.length).toBeGreaterThan(0);
  });

  it("splits money from the pool without letting one tint the other", () => {
    const { bets, picks } = splitPositions(demoHomeData(WHEN["midweek, DST"]).positions);
    expect(bets.every((p) => p.game.myPicks.length === 0)).toBe(true);
    expect(picks.every((p) => p.game.myBets.length === 0)).toBe(true);
  });

  it("points firstKick at a game that has not kicked", () => {
    const data = demoHomeData(WHEN["midweek, DST"]);
    const game = demoGames(WHEN["midweek, DST"]).find((g) => g.startTs === data.firstKick);
    expect(game?.status).toBe("scheduled");
  });
});

describe("demoSlateData", () => {
  it("dates the lines earlier than the fetch, the way the real loader does", () => {
    const now = WHEN["the Saturday itself"];
    const slate = demoSlateData(now);
    expect(Date.parse(slate.linesAsOf!)).toBeLessThan(Date.parse(slate.fetchedAt));
    expect(slate.games).toHaveLength(12);
  });
});
