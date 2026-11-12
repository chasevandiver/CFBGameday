import { afterEach, describe, expect, it } from "vitest";
import scoreboard from "../../src/lib/__fixtures__/cbb-scoreboard.json";
import conferencesFx from "../../src/lib/__fixtures__/cbb-conferences.json";
import { parseCbbConferences, parseCbbEvent, type CbbWireEvent } from "../../src/lib/espn-cbb";
import { cbbSeasonId } from "../../src/lib/league";
import {
  assertNoForeignCollision,
  cbbGameRow,
  cbbSeasonLabel,
  cbbStartYear,
  cbbTeamRow,
  cbbVenueRow,
  dateRange,
  finalHoops,
  shiftDate,
} from "./cbb";
import { watchdogVerdict } from "./jobs-core";

const fx = scoreboard as unknown as Record<string, CbbWireEvent>;
const SEASON = cbbSeasonId(2026);
const conferences = parseCbbConferences(conferencesFx);

describe("cbbStartYear", () => {
  afterEach(() => {
    delete process.env.CBB_SEASON;
  });

  it("is the autumn the season tipped off in, across the new year", () => {
    expect(cbbStartYear(new Date("2026-11-12T12:00:00Z"))).toBe(2026);
    expect(cbbStartYear(new Date("2027-03-20T12:00:00Z"))).toBe(2026);
    // ESPN opens the next season in July
    expect(cbbStartYear(new Date("2027-06-30T12:00:00Z"))).toBe(2026);
    expect(cbbStartYear(new Date("2027-07-01T12:00:00Z"))).toBe(2027);
  });

  it("takes an explicit season for a backfill, and ignores an empty one", () => {
    process.env.CBB_SEASON = "2025";
    expect(cbbStartYear(new Date("2026-11-12T12:00:00Z"))).toBe(2025);
    process.env.CBB_SEASON = "";
    expect(cbbStartYear(new Date("2026-11-12T12:00:00Z"))).toBe(2026);
  });

  it("labels the season by both years", () => {
    expect(cbbSeasonLabel(2026)).toBe("2026-27 CBB");
    expect(cbbSeasonLabel(2099)).toBe("2099-00 CBB");
  });
});

describe("cbbGameRow", () => {
  it("stores the board date as the day, not the tip time", () => {
    const g = parseCbbEvent(fx.FINAL_RANKED);
    const row = cbbGameRow(g, SEASON, 2026, "2026-11-11")!;
    expect(row.week).toBe(10);
    expect(row.season_type).toBe("regular");
    expect(row.sport).toBe("cbb");
    expect(row.season_id).toBe(202026);
    // …even though this game tipped after midnight UTC on the 12th
    expect(g.startDate.slice(0, 10)).toBe("2026-11-12");
  });

  it("offsets team and venue ids off the football rows", () => {
    const g = parseCbbEvent(fx.FINAL_RANKED);
    const row = cbbGameRow(g, SEASON, 2026, "2026-11-11")!;
    expect(row.home_team_id).toBe(200000 + g.home.espnId);
    expect(row.away_team_id).toBe(200000 + g.away.espnId);
    expect(row.venue_id).toBe(200000 + g.venue!.espnId!);
    // the event id is NOT offset — ESPN's sequence is global
    expect(row.id).toBe(g.id);
  });

  it("asserts a final with its line score and period, and nothing live", () => {
    const row = cbbGameRow(parseCbbEvent(fx.FINAL_OT), SEASON, 2026, "2026-11-11")!;
    expect(row.status).toBe("final");
    expect(row.current_period).toBe(3);
    expect(row.hoops).toEqual({ h: [37, 33, 6], a: [31, 39, 10], run: null, wp: null });
    expect(row.home_points).toBe(76);
  });

  it("never asserts a status on a game that is live or yet to tip", () => {
    const live = cbbGameRow(parseCbbEvent(fx.LIVE), SEASON, 2026, "2026-11-11")!;
    expect("status" in live).toBe(false);
    expect("hoops" in live).toBe(false);
    expect("current_period" in live).toBe(false);
  });

  it("states a postponement, which ESPN publishes outright", () => {
    const ev = structuredClone(fx.FINAL_RANKED);
    ev.competitions[0].status = {
      displayClock: "0:00",
      period: 0,
      type: { name: "STATUS_POSTPONED", state: "post", completed: false },
    };
    const row = cbbGameRow(parseCbbEvent(ev), SEASON, 2026, "2026-11-11")!;
    expect(row.status).toBe("postponed");
    expect("hoops" in row).toBe(false);
  });

  it("drops what is not this season's game", () => {
    const g = parseCbbEvent(fx.FINAL_RANKED);
    // another season's event on the board
    expect(cbbGameRow(g, SEASON, 2025, "2026-11-11")).toBeNull();
    // a TBD bracket slot
    expect(cbbGameRow({ ...g, home: { ...g.home, espnId: -1 } }, SEASON, 2026, "2026-11-11")).toBeNull();
    // a date outside the season's day range
    expect(cbbGameRow(g, SEASON, 2026, "2026-10-20")).toBeNull();
    expect(cbbGameRow(g, SEASON, 2026, "2027-08-01")).toBeNull();
  });

  it("carries the event banner as the game's note", () => {
    const row = cbbGameRow(parseCbbEvent(fx.FINAL_NEUTRAL), SEASON, 2026, "2026-11-11")!;
    expect(typeof row.notes).toBe("string");
    expect(row.neutral_site).toBe(parseCbbEvent(fx.FINAL_NEUTRAL).neutralSite);
  });
});

describe("cbbTeamRow", () => {
  it("names the school, not the full display name, and resolves the conference", () => {
    const g = parseCbbEvent(fx.HALFTIME);
    const row = cbbTeamRow(g.home, conferences);
    expect(row.school).toBe("California");
    expect(row.mascot).toBe("Golden Bears");
    expect(row.conference).toBe("ACC");
    expect(row.classification).toBe("d1");
    expect(row.id).toBe(200025);
    expect(row.sport).toBe("cbb");
  });

  it("files a team with no known conference as non-Division-I, still with a row", () => {
    const g = parseCbbEvent(fx.HALFTIME);
    const row = cbbTeamRow({ ...g.home, conferenceId: null }, conferences);
    expect(row.conference).toBeNull();
    expect(row.classification).toBe("non-d1");
    const unmapped = cbbTeamRow({ ...g.home, conferenceId: "9999" }, conferences);
    expect(unmapped.classification).toBe("non-d1");
  });

  it("carries the rank and record the board states", () => {
    const g = parseCbbEvent(fx.FINAL_RANKED);
    expect(cbbTeamRow(g.home, conferences).poll_rank).toBe(8);
    expect(cbbTeamRow(g.away, conferences).poll_rank).toBeNull();
    expect(cbbTeamRow(g.home, conferences).record).toMatch(/^\d+-\d+$/);
  });
});

describe("cbbVenueRow / finalHoops", () => {
  it("marks every gym indoor, which is what suppresses the weather flag", () => {
    expect(cbbVenueRow(parseCbbEvent(fx.HALFTIME).venue)!.dome).toBe(true);
    expect(cbbVenueRow(null)).toBeNull();
    expect(cbbVenueRow({ espnId: null, name: "x", city: null, state: null, indoor: true })).toBeNull();
  });

  it("stores no line score for a game with none", () => {
    const g = parseCbbEvent(fx.FINAL_RANKED);
    expect(finalHoops({ ...g, homeLine: [], awayLine: [] })).toBeNull();
  });
});

describe("assertNoForeignCollision", () => {
  it("refuses to overwrite a football game", () => {
    expect(() =>
      assertNoForeignCollision([{ id: 401, sport: "cfb" }], new Set([401, 402])),
    ).toThrow(/401 \(cfb\)/);
    expect(() =>
      assertNoForeignCollision([{ id: 401, sport: "nfl" }], new Set([401])),
    ).toThrow(/global-event-id/);
  });

  it("lets a basketball row be updated", () => {
    expect(() =>
      assertNoForeignCollision([{ id: 401, sport: "cbb" }], new Set([401])),
    ).not.toThrow();
  });
});

describe("date helpers", () => {
  it("walks a range inclusively across a month and a clock change", () => {
    expect(dateRange("2026-10-31", "2026-11-02")).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(dateRange("2026-11-12", "2026-11-12")).toEqual(["2026-11-12"]);
    expect(dateRange("2026-11-12", "2026-11-11")).toEqual([]);
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2027-03-01", -1)).toBe("2027-02-28");
  });
});

/**
 * CBB-6. The basketball lane is watched from its first day, and it is watched
 * APART from football: the leagues have different live writers, so a healthy
 * one must never vouch for a dead one.
 */
describe("watchdogVerdict — the basketball lane", () => {
  const healthy = { refreshLines: 1, syncGames: 1, scoreboard: 1 };
  const quiet = { gameLive: false, gamesThisWeek: true, beatMin: Infinity };

  it("is silent when the caller does not ask", () => {
    expect(watchdogVerdict({ ...healthy, cbbSync: 99 }, false, false)).toEqual([]);
  });

  it("flags a sync that has gone quiet while there is basketball this week", () => {
    const p = watchdogVerdict({ ...healthy, cbbSync: 20 }, false, false, undefined, quiet);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/cbb-sync/);
  });

  it("does not flag the offseason, or a job whose first cron has not come", () => {
    const off = { ...quiet, gamesThisWeek: false };
    expect(watchdogVerdict({ ...healthy, cbbSync: 2000 }, false, false, undefined, off)).toEqual([]);
    expect(watchdogVerdict({ ...healthy, cbbSync: Infinity }, false, false, undefined, quiet)).toEqual([]);
  });

  it("pages when a basketball game is live and the edge pull is silent", () => {
    const p = watchdogVerdict({ ...healthy, cbbSync: 1 }, false, false, undefined, {
      gameLive: true,
      gamesThisWeek: true,
      beatMin: 12,
    });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/cbb live scores/);
  });

  it("keeps a live basketball game from arming football's alarms", () => {
    // gameLive (football) is false; only basketball is on. A dead football
    // loop is correct on a Tuesday and must not be reported.
    const p = watchdogVerdict({ ...healthy, scoreboard: 400, cbbSync: 1 }, false, false, Infinity, {
      gameLive: true,
      gamesThisWeek: true,
      beatMin: 0.5,
    });
    expect(p).toEqual([]);
  });

  it("does not let a healthy basketball pull vouch for a dead football one", () => {
    const p = watchdogVerdict({ ...healthy, cbbSync: 1 }, true, true, 30, {
      gameLive: true,
      gamesThisWeek: true,
      beatMin: 0.5,
    });
    expect(p.some((x) => /^live scores/.test(x))).toBe(true);
  });
});
