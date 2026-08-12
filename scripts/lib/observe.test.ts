import { describe, expect, it } from "vitest";
import type { CfbdScoreboardGame } from "../../src/lib/cfbd";
import {
  clockSeconds,
  formatObservation,
  medianGapMs,
  observe,
  relevant,
  snapshotOf,
  verdictOf,
  type BoardSample,
} from "./observe";

const KICK = Date.parse("2026-08-29T18:00:00Z");

function game(over: Partial<CfbdScoreboardGame> = {}): CfbdScoreboardGame {
  return {
    id: 1,
    startDate: new Date(KICK).toISOString(),
    status: "scheduled",
    period: null,
    clock: null,
    situation: null,
    lastPlay: null,
    possession: null,
    homeTeam: { id: 10, name: "Home", points: null },
    awayTeam: { id: 20, name: "Away", points: null },
    tv: "ESPN",
    ...over,
  };
}

/** A live game with a score, so the common case reads in one line. */
function live(over: Partial<CfbdScoreboardGame> = {}, home = 7, away = 0): CfbdScoreboardGame {
  return game({
    status: "in_progress",
    period: 1,
    clock: "10:00",
    situation: "2nd & 7",
    lastPlay: "Run for 3 yards",
    possession: "Home",
    homeTeam: { id: 10, name: "Home", points: home },
    awayTeam: { id: 20, name: "Away", points: away },
    ...over,
  });
}

const at = (min: number) => KICK + min * 60_000;
const sample = (min: number, ...games: CfbdScoreboardGame[]): BoardSample => ({
  at: at(min),
  games,
});

// The failure this whole module exists for. `scoreboardPatch` matches the
// status string exactly and drops anything it does not recognise, so a rename
// produces zero writes, a green run, and a silent watchdog. It has to outrank
// every other reading of the data.
describe("status drift", () => {
  it("flags a renamed live status rather than calling the board stale", () => {
    const o = observe([
      sample(1, game({ status: "in-progress", period: 1, clock: "14:00" })),
      sample(2, game({ status: "in-progress", period: 1, clock: "13:22" })),
    ]);
    expect(o.verdict).toBe("UNKNOWN_STATUS");
    expect(o.notes[0]).toContain('"in-progress"');
    expect(o.notes[0]).toContain("writes NOTHING");
  });

  it("outranks STALE — the enum is the cause, a frozen board is the symptom", () => {
    const { verdict } = verdictOf(
      { in_progress: 5, LIVE: 5 },
      [
        {
          id: 1,
          label: "Away @ Home",
          startDate: "",
          statusTrail: ["in_progress"],
          wentLiveAt: 0,
          statusLagMs: 0,
          changes: [],
          liveSamples: 5,
          populatedWhileLive: {
            status: 5,
            period: 5,
            clock: 5,
            homePoints: 5,
            awayPoints: 5,
            situation: 0,
            lastPlay: 0,
            possession: 0,
          },
          maxQuietMs: 0,
          clockRegressions: 0,
        },
      ],
    );
    expect(verdict).toBe("UNKNOWN_STATUS");
  });

  it("counts every raw status string it saw, known or not", () => {
    const o = observe([sample(1, live()), sample(2, live({ status: "completed" }))]);
    expect(o.statusCounts).toEqual({ in_progress: 1, completed: 1 });
  });
});

describe("verdict", () => {
  it("reports a live board that never moves as STALE", () => {
    const o = observe([sample(1, live()), sample(2, live()), sample(3, live())]);
    expect(o.verdict).toBe("STALE");
    expect(o.notes[0]).toContain("not one watched field ever changed");
  });

  it("reports a moving board as OK", () => {
    const o = observe([
      sample(1, live({}, 7, 0)),
      sample(2, live({ clock: "08:12" }, 7, 3)),
      sample(3, live({ clock: "06:40", period: 2 }, 14, 3)),
    ]);
    expect(o.verdict).toBe("OK");
    expect(o.games[0].changes.map((c) => c.field)).toContain("homePoints");
    expect(o.games[0].changes.map((c) => c.field)).toContain("awayPoints");
  });

  // An empty window is the trap `emptyIsHealthy` set in the access probe: a
  // working feed and a dead one look identical when you never got to ask.
  it("never calls a window with no live game a pass", () => {
    const o = observe([sample(-60, game()), sample(-59, game())]);
    expect(o.verdict).toBe("NO_LIVE_GAMES");
    expect(o.verdict).not.toBe("OK");
    expect(o.notes[0]).toContain("proves nothing");
  });

  it("notes live games that never carried a lastPlay — the flip detector reads it", () => {
    const o = observe([
      sample(1, live({ lastPlay: null }, 7, 0)),
      sample(2, live({ lastPlay: null }, 7, 7)),
    ]);
    expect(o.verdict).toBe("OK");
    expect(o.notes.join(" ")).toContain("never carried a lastPlay");
  });

  it("notes a subset of live games sitting still without failing the run", () => {
    const mover = () => live({ id: 1 }, 7, 0);
    const frozen = game({ id: 2, status: "in_progress", period: 1, clock: "10:00" });
    const o = observe([
      sample(1, mover(), frozen),
      sample(2, live({ id: 1 }, 14, 0), frozen),
    ]);
    expect(o.verdict).toBe("OK");
    expect(o.notes.join(" ")).toContain("1 of 2 live game(s) never changed");
  });
});

describe("timings", () => {
  it("measures the lag from kickoff to CFBD leaving scheduled", () => {
    const o = observe([sample(-1, game()), sample(0, game()), sample(3, live())]);
    expect(o.games[0].statusLagMs).toBe(3 * 60_000);
  });

  it("reports a negative lag when CFBD flips the status early", () => {
    const o = observe([sample(-2, live())]);
    expect(o.games[0].statusLagMs).toBe(-2 * 60_000);
  });

  it("does not count pregame stillness as a quiet stretch", () => {
    const o = observe([sample(-120, game()), sample(-60, game()), sample(1, live())]);
    expect(o.games[0].maxQuietMs).toBe(0);
  });

  it("measures the longest live stretch with nothing moving", () => {
    const o = observe([
      sample(0, live({}, 7, 0)),
      sample(5, live({}, 7, 0)), // 5 min quiet
      sample(6, live({}, 14, 0)), // moved
      sample(8, live({}, 14, 0)),
    ]);
    expect(o.games[0].maxQuietMs).toBe(6 * 60_000);
  });

  it("does not count a first sighting as a change", () => {
    const o = observe([sample(1, live({}, 21, 14))]);
    expect(o.games[0].changes).toHaveLength(0);
    expect(o.verdict).toBe("STALE");
  });

  it("takes the median gap between changes, not the mean", () => {
    // 30s, 30s, and one 20-minute halftime: the mean would report ~7 min as
    // our freshness floor, which is the wrong number to design a poll around.
    const changes = [0, 30_000, 60_000, 1_260_000].map((ms) => ({
      gameId: 1,
      field: "clock" as const,
      from: null,
      to: null,
      at: KICK + ms,
    }));
    expect(medianGapMs(changes)).toBe(30_000);
  });

  it("has no median gap from a single change", () => {
    expect(medianGapMs([{ gameId: 1, field: "clock", from: null, to: null, at: KICK }])).toBeNull();
  });
});

describe("clock", () => {
  it("parses MM:SS", () => {
    expect(clockSeconds("10:00")).toBe(600);
    expect(clockSeconds("0:07")).toBe(7);
  });

  it("returns null on a format we do not know, rather than guessing", () => {
    expect(clockSeconds(null)).toBeNull();
    expect(clockSeconds("")).toBeNull();
    expect(clockSeconds("1:02:03")).toBeNull();
  });

  it("flags a clock running up inside one period", () => {
    const o = observe([
      sample(1, live({ period: 1, clock: "08:00" })),
      sample(2, live({ period: 1, clock: "09:30" })),
    ]);
    expect(o.games[0].clockRegressions).toBe(1);
  });

  it("does not flag the reset at a period change", () => {
    const o = observe([
      sample(1, live({ period: 1, clock: "00:12" })),
      sample(2, live({ period: 2, clock: "15:00" })),
    ]);
    expect(o.games[0].clockRegressions).toBe(0);
  });
});

describe("bookkeeping", () => {
  it("flattens exactly the fields the live layer consumes", () => {
    expect(snapshotOf(live({}, 21, 17))).toEqual({
      status: "in_progress",
      period: 1,
      clock: "10:00",
      homePoints: 21,
      awayPoints: 17,
      situation: "2nd & 7",
      lastPlay: "Run for 3 yards",
      possession: "Home",
    });
  });

  it("tolerates a game appearing mid-window", () => {
    const o = observe([sample(1, live({ id: 1 })), sample(2, live({ id: 1 }), live({ id: 2 }))]);
    expect(o.games).toHaveLength(2);
    expect(o.games[1].changes).toHaveLength(0);
  });

  it("orders samples by time regardless of the order handed in", () => {
    const o = observe([sample(3, live({}, 14, 0)), sample(1, live({}, 7, 0))]);
    const points = o.games[0].changes.find((c) => c.field === "homePoints");
    expect(points).toMatchObject({ from: 7, to: 14 });
  });

  it("records the status trail in the order seen", () => {
    const o = observe([sample(-1, game()), sample(1, live()), sample(200, live({ status: "completed" }))]);
    expect(o.games[0].statusTrail).toEqual(["scheduled", "in_progress", "completed"]);
  });
});

// The board is the whole season, so narrowing is what keeps a 70-minute run
// from carrying ~880 games that cannot change today.
describe("relevant", () => {
  it("keeps a scheduled game inside the window — 'never left scheduled' is the failure", () => {
    expect(relevant([game({ startDate: new Date(at(30)).toISOString() })], KICK)).toHaveLength(1);
  });

  it("drops a scheduled game hours outside the window", () => {
    expect(relevant([game({ startDate: new Date(at(60 * 12)).toISOString() })], KICK)).toEqual([]);
  });

  it("keeps every non-scheduled game regardless of when it started", () => {
    const old = live({ startDate: new Date(at(-60 * 30)).toISOString() });
    expect(relevant([old], KICK)).toHaveLength(1);
  });

  it("drops a scheduled game with an unparseable start rather than watching the season", () => {
    expect(relevant([game({ startDate: "soon" })], KICK)).toEqual([]);
  });
});

describe("formatObservation", () => {
  it("marks an unknown status as DRIFT in the table", () => {
    const out = formatObservation(observe([sample(1, game({ status: "LIVE" }))]));
    expect(out).toContain("DRIFT");
    expect(out).toContain("VERDICT: UNKNOWN_STATUS");
  });

  it("says plainly when nothing was live", () => {
    const out = formatObservation(observe([sample(-300, game())]));
    expect(out).toContain("No game was ever in_progress");
  });

  it("renders a live game row", () => {
    const out = formatObservation(
      observe([sample(1, live({}, 7, 0)), sample(2, live({}, 7, 7))]),
    );
    expect(out).toContain("Away @ Home");
    expect(out).toContain("VERDICT: OK");
  });
});
