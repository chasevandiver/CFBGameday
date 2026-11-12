import { describe, expect, it } from "vitest";
import scoreboard from "./__fixtures__/cbb-scoreboard.json";
import summary from "./__fixtures__/cbb-summary.json";
import conferences from "./__fixtures__/cbb-conferences.json";
import {
  isRealCbbPlay,
  parseCbbConferences,
  parseCbbEvent,
  parseCbbScoreboard,
  parseHoopsBox,
  type CbbWireEvent,
} from "./espn-cbb";

/**
 * Fixtures are trimmed verbatim from ESPN's live men's college basketball
 * board and one game's `/summary`, captured 2026-11-11 around midnight
 * Eastern: one game at halftime (USC at Cal), one with 23 seconds left
 * (Pacific at Long Beach State), a ranked blowout, a neutral-site event game
 * and an overtime final. They pin the shapes the ingest reads, so a change in
 * ESPN's feed fails here before it writes a wrong row.
 */
const fx = scoreboard as unknown as Record<string, CbbWireEvent>;

describe("parseCbbEvent", () => {
  it("reads halftime as a live game in period 1 with an expired clock", () => {
    const g = parseCbbEvent(fx.HALFTIME);
    expect(g.status).toBe("in_progress");
    expect(g.period).toBe(1);
    expect(g.clock).toBe("0:00");
    expect([g.awayPoints, g.homePoints]).toEqual([39, 30]);
    expect(g.homeLine).toEqual([30]);
    expect(g.awayLine).toEqual([39]);
  });

  it("carries both halves, the win probability and no scorer for a timeout", () => {
    const g = parseCbbEvent(fx.LIVE);
    expect(g.period).toBe(2);
    expect(g.clock).toBe("0:23");
    expect(g.homeLine).toEqual([33, 27]);
    expect(g.awayLine).toEqual([34, 23]);
    expect(g.winProb).toBe(0.755);
    expect(g.lastPlay).toBe("Pacific Timeout");
    expect(g.lastScorer).toBeNull();
    expect(isRealCbbPlay(g.lastPlay, g.lastPlayType)).toBe(false);
  });

  it("names the scorer only when the last play went in", () => {
    const made = structuredClone(fx.LIVE);
    const homeId = made.competitions[0].competitors.find((c) => c.homeAway === "home")!.team.id;
    made.competitions[0].situation = {
      lastPlay: {
        text: "Sammie Yeanay makes 26-foot three point jumper",
        type: { text: "JumpShot" },
        scoreValue: 3,
        team: { id: homeId },
      },
    };
    expect(parseCbbEvent(made).lastScorer).toEqual({ side: "home", pts: 3 });

    // ESPN stamps a MISS with the shot's worth too — a missed layup is 2.
    made.competitions[0].situation!.lastPlay!.text = "Jake Wilkins misses layup";
    expect(parseCbbEvent(made).lastScorer).toBeNull();
  });

  it("turns ESPN's 99 into unranked and keeps a real AP rank", () => {
    const g = parseCbbEvent(fx.FINAL_RANKED);
    expect(g.status).toBe("final");
    expect(g.home.rank).toBe(8);
    expect(g.away.rank).toBeNull();
    expect(g.home.record).toMatch(/^\d+-\d+$/);
    // nobody has played a league game in the second week of November
    expect(g.home.confRecord).toBeNull();
    // live-only fields are cleared on a final; the period is not
    expect(g.clock).toBeNull();
    expect(g.lastPlay).toBeNull();
    expect(g.winProb).toBeNull();
    expect(g.period).toBe(2);
  });

  it("keeps the overtime period and line on a final", () => {
    const g = parseCbbEvent(fx.FINAL_OT);
    expect(g.period).toBe(3);
    expect(g.homeLine).toEqual([37, 33, 6]);
    expect(g.awayLine).toEqual([31, 39, 10]);
    expect(g.homePoints).toBe(76);
    expect(g.awayPoints).toBe(80);
  });

  it("reads the event banner and the team identity", () => {
    const g = parseCbbEvent(fx.FINAL_NEUTRAL);
    expect(g.note).toBeTruthy();
    expect(g.home.espnId).toBeGreaterThan(0);
    expect(g.home.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(g.home.location).toBeTruthy();
    expect(g.venue?.espnId).toBeGreaterThan(0);
  });

  it("scores nothing before tip", () => {
    const pre = structuredClone(fx.FINAL_RANKED);
    pre.competitions[0].status = {
      displayClock: "0:00",
      period: 0,
      type: { name: "STATUS_SCHEDULED", state: "pre", completed: false },
    };
    const g = parseCbbEvent(pre);
    expect(g.status).toBe("scheduled");
    expect(g.homePoints).toBeNull();
    expect(g.period).toBeNull();
    expect(g.homeLine).toEqual([]);
  });
});

describe("parseCbbScoreboard", () => {
  it("tolerates an empty or malformed board", () => {
    expect(parseCbbScoreboard(null)).toEqual([]);
    expect(parseCbbScoreboard({})).toEqual([]);
    expect(parseCbbScoreboard({ events: Object.values(fx) })).toHaveLength(Object.keys(fx).length);
  });
});

describe("parseCbbConferences", () => {
  it("maps group ids to short names and drops Division I itself", () => {
    const m = parseCbbConferences(conferences);
    expect(m.has("50")).toBe(false);
    expect(m.get("2")).toBe("ACC");
    expect(m.get("3")).toBe("A-10");
  });
});

describe("parseHoopsBox", () => {
  const box = parseHoopsBox(summary)!;

  it("reads the team lines", () => {
    expect(box).not.toBeNull();
    expect(box.period).toBe(1);
    expect(box.half).toBe(1);
    expect(box.home.fg).toBe("11-33");
    expect(box.away.fg).toBe("14-36");
    expect(box.away.three).toBe("4-14");
    expect(box.home.rebounds).toBe(18);
    expect(box.home.line).toEqual([30]);
    expect(box.away.line).toEqual([39]);
  });

  it("counts fouls by half from the play-by-play, matching the box total", () => {
    expect(box.home.foulsByHalf).toEqual([9, 0]);
    expect(box.away.foulsByHalf).toEqual([7, 0]);
    expect(box.home.fouls).toBe(9);
    expect(box.away.fouls).toBe(7);
  });

  it("lists players scorers-first and drops the ones who did not play", () => {
    expect(box.home.players.length).toBeGreaterThan(4);
    const pts = box.home.players.map((p) => p.pts);
    expect(pts).toEqual([...pts].sort((a, b) => b - a));
    expect(box.away.players[0].fg).toMatch(/^\d+-\d+$/);
  });

  it("returns null when there is no box yet", () => {
    expect(parseHoopsBox(null)).toBeNull();
    expect(parseHoopsBox({ header: { competitions: [{ competitors: [] }] } })).toBeNull();
  });
});
