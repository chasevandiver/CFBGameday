import { describe, expect, it } from "vitest";
import type { CfbdScoreboardGame } from "../../src/lib/cfbd";
import { consensusFromSnapshots } from "../../src/lib/consensus";
import { closingConsensus, detectCoverFlips, freezableGames, SNAPSHOT_COLS, SCOREBOARD_COLS, scoreboardPatch, watchdogVerdict, type ScoreboardRow } from "./jobs-core";

describe("SNAPSHOT_COLS", () => {
  it("selects spread_open, which the opener silently falls back without", () => {
    expect(SNAPSHOT_COLS).toContain("spread_open");
  });

  it("selects every field the consensus and grading paths read", () => {
    for (const col of ["game_id", "provider", "spread", "total", "captured_at"]) {
      expect(SNAPSHOT_COLS).toContain(col);
    }
  });
});

describe("the silent fallback SNAPSHOT_COLS exists to prevent", () => {
  const snaps = (withOpen: boolean) => [
    {
      game_id: 1,
      provider: "book",
      spread: -9,
      ...(withOpen ? { spread_open: -6 } : {}),
      total: 51,
      captured_at: "2026-09-01T12:00:00Z",
    },
  ];

  it("reports a real opener when spread_open is selected", () => {
    expect(consensusFromSnapshots(snaps(true)).open).toBe(-6);
  });

  it("reports the CURRENT line as the opener when it isn't — no error", () => {
    // This is the failure mode: open === spread, so every prediction's
    // open_spread would duplicate vegas_spread and the line movement on the
    // receipt would read as zero for every game.
    const c = consensusFromSnapshots(snaps(false));
    expect(c.open).toBe(-9);
    expect(c.open).toBe(c.spread);
  });
});

describe("scoreboardPatch", () => {
  const boardGame = (over: Partial<CfbdScoreboardGame> = {}): CfbdScoreboardGame => ({
    id: 1,
    startDate: "2026-08-29T19:30:00Z",
    status: "completed",
    period: 4,
    clock: "0:00",
    situation: null,
    lastPlay: null,
    possession: null,
    homeTeam: { id: 10, name: "Home", points: 31 },
    awayTeam: { id: 11, name: "Away", points: 21 },
    tv: "ESPN",
    ...over,
  });

  const storedFinal: ScoreboardRow = {
    id: 1,
    status: "final",
    home_points: 31,
    away_points: 21,
    current_period: 4,
    current_clock: "0:00",
    current_situation: null,
    last_play: null,
    possession: null,
    tv: "ESPN",
    season_id: 2026,
    week: 1,
  };

  it("returns null for a final the row already records — no write, no realtime fan-out", () => {
    expect(scoreboardPatch(boardGame(), storedFinal)).toBeNull();
  });

  it("returns null for scheduled games regardless of stored state", () => {
    expect(scoreboardPatch(boardGame({ status: "scheduled" }), undefined)).toBeNull();
  });

  it("writes when a live score changes", () => {
    const stored = { ...storedFinal, status: "in_progress", home_points: 24 };
    const patch = scoreboardPatch(
      boardGame({ status: "in_progress", situation: "1st & 10 at AWY 25", possession: "home" }),
      stored,
    );
    expect(patch).not.toBeNull();
    expect(patch?.home_points).toBe(31);
  });

  it("writes when only the clock moves (live freshness is the point)", () => {
    const stored = {
      ...storedFinal,
      status: "in_progress",
      current_clock: "5:12",
      current_period: 3,
    };
    const patch = scoreboardPatch(
      boardGame({ status: "in_progress", period: 3, clock: "4:48" }),
      stored,
    );
    expect(patch?.current_clock).toBe("4:48");
  });

  it("writes the first time a game goes final, then goes quiet", () => {
    const live: ScoreboardRow = {
      ...storedFinal,
      status: "in_progress",
      current_situation: "4th & 1 at HOM 3",
      possession: "away",
    };
    const first = scoreboardPatch(boardGame(), live);
    expect(first?.status).toBe("final");
    expect(first?.current_situation).toBeNull();
    expect(scoreboardPatch(boardGame(), { ...live, ...first! })).toBeNull();
  });

  it("a null TV from the board never clobbers a stored assignment", () => {
    expect(scoreboardPatch(boardGame({ tv: null }), storedFinal)).toBeNull();
  });

  it("SCOREBOARD_COLS selects every field the diff compares", () => {
    for (const k of Object.keys(storedFinal)) expect(SCOREBOARD_COLS).toContain(k);
  });
});

describe("closingConsensus (stale-close guard)", () => {
  const kick = "2026-09-05T23:20:00Z";
  const snapAt = (captured_at: string, spread = -3.5) => ({
    game_id: 7,
    provider: "book",
    spread,
    total: 51.5,
    captured_at,
  });

  it("keeps a close captured inside the window", () => {
    const c = closingConsensus([snapAt("2026-09-05T22:45:00Z")], kick);
    expect(c.spread).toBe(-3.5);
    expect(c.total).toBe(51.5);
  });

  it("nulls a close whose last pre-kick snapshot is days old", () => {
    // Tuesday's line graded as Saturday's close is a plausible wrong number —
    // worse than no number. Results still grade; CLV stays in the ungraded set.
    const c = closingConsensus([snapAt("2026-09-01T22:45:00Z")], kick);
    expect(c.spread).toBeNull();
    expect(c.total).toBeNull();
  });

  it("nulls when every snapshot is post-kick (a backfill is not a close)", () => {
    const c = closingConsensus([snapAt("2026-09-06T04:00:00Z")], kick);
    expect(c.spread).toBeNull();
  });

  it("unknown kickoff = no close (a TBD-then-played game could bank a post-hoc line)", () => {
    expect(closingConsensus([snapAt("2026-09-01T22:45:00Z")], null).spread).toBeNull();
  });
});

describe("freezableGames (the merged Week 0/1 shape)", () => {
  // CFBD stores Week 0 inside week 1: 2026's week 1 spans Aug 29 – Sep 7.
  const g = (id: number, start_ts: string | null) => ({ id, start_ts });
  const week1 = [
    g(1, "2026-08-29T16:00:00Z"), // opening Saturday
    g(2, "2026-08-30T02:00:00Z"),
    g(3, "2026-09-03T23:00:00Z"), // weeknight
    g(4, "2026-09-05T19:30:00Z"), // second Saturday
    g(5, "2026-09-07T23:30:00Z"), // Labor Day Monday
  ];
  const none = new Set<number>();
  const HORIZON = 8;
  const thuAug27 = Date.parse("2026-08-28T03:00:00Z"); // Fri 03:00 UTC cron
  const thuSep3 = Date.parse("2026-09-04T03:00:00Z");

  it("the Aug 27 freeze takes only games kicking inside its horizon", () => {
    const ids = freezableGames(week1, none, thuAug27, HORIZON).map((x) => x.id);
    // Sep 5 is 8.7 days out, Sep 7 is 10.9 — both wait for their own Thursday
    expect(ids).toEqual([1, 2, 3]);
  });

  it("the Sep 3 freeze takes the rest, exactly once", () => {
    const frozen = new Set([1, 2, 3]);
    const ids = freezableGames(week1, frozen, thuSep3, HORIZON).map((x) => x.id);
    expect(ids).toEqual([4, 5]);
  });

  it("a re-run freezes nothing — no duplicate receipts", () => {
    const frozen = new Set([1, 2, 3, 4, 5]);
    expect(freezableGames(week1, frozen, thuSep3, HORIZON)).toEqual([]);
  });

  it("--force widens the horizon but still can't mint a duplicate", () => {
    const frozen = new Set([1, 2]);
    const ids = freezableGames(week1, frozen, thuAug27, HORIZON, true).map((x) => x.id);
    expect(ids).toEqual([3, 4, 5]);
  });

  it("a TBD kickoff in the current week freezes rather than waiting forever", () => {
    const ids = freezableGames([g(9, null)], none, thuAug27, HORIZON).map((x) => x.id);
    expect(ids).toEqual([9]);
  });
});

describe("watchdogVerdict (audit 07/OPS-1c)", () => {
  const fresh = { refreshLines: 2, syncGames: 2, scoreboard: 0.5 };
  it("is quiet when everything is fresh and nothing is live", () => {
    expect(watchdogVerdict(fresh, false)).toEqual([]);
    expect(watchdogVerdict(fresh, true)).toEqual([]);
  });
  it("flags refresh-lines silent past 26h", () => {
    expect(watchdogVerdict({ ...fresh, refreshLines: 40 }, false)).toEqual([
      expect.stringMatching(/refresh-lines/),
    ]);
  });
  it("flags sync-games silent past 30h", () => {
    expect(watchdogVerdict({ ...fresh, syncGames: 31 }, false)[0]).toMatch(/sync-games/);
  });
  it("flags a stale scoreboard ONLY while a game is live", () => {
    const stale = { ...fresh, scoreboard: 3 };
    expect(watchdogVerdict(stale, false)).toEqual([]); // nobody playing, no debt
    expect(watchdogVerdict(stale, true)[0]).toMatch(/scoreboard-loop/);
  });
  it("a never-run job (Infinity) trips its threshold", () => {
    expect(watchdogVerdict({ ...fresh, refreshLines: Infinity }, false)[0]).toMatch(/refresh-lines/);
  });

  // PUSH-10. The notify jobs are weekly and seasonal: silent all offseason on
  // purpose, so they are gated on there being something to notify about rather
  // than on an hours horizon.
  it("says nothing about the notify jobs out of season, however long they have been silent", () => {
    const silent = { ...fresh, picksDue: Infinity, logBets: Infinity };
    expect(watchdogVerdict(silent, false, false)).toEqual([]);
  });
  it("flags a notify job that missed a week while games are on", () => {
    const missed = { ...fresh, picksDue: 9 * 24, logBets: 2 };
    expect(watchdogVerdict(missed, false, true)[0]).toMatch(/notify-picks-due/);
  });
  it("tolerates a run that slipped a day", () => {
    // Weekly crons plus Actions lag: 7 days and change is normal, not a fault.
    expect(watchdogVerdict({ ...fresh, picksDue: 7.5 * 24, logBets: 2 }, false, true)).toEqual([]);
  });
  it("flags log-bets independently of picks-due", () => {
    const missed = { ...fresh, picksDue: 2, logBets: 9 * 24 };
    expect(watchdogVerdict(missed, false, true)[0]).toMatch(/notify-log-bets/);
  });

  // NFL-22. None of the NFL jobs was watched at all until 2026-08-14: the
  // verdict checked five CFB jobs and the live `detail.checked` proved it.
  describe("the NFL lane", () => {
    const nflFresh = { nflSyncGames: 2, nflRefreshLines: 2, nflLinesClose: 2, nflGrade: 2 };

    it("is quiet when the NFL jobs are fresh", () => {
      expect(watchdogVerdict({ ...fresh, ...nflFresh }, false)).toEqual([]);
    });

    it("says nothing about NFL jobs a caller does not pass", () => {
      // The fields are optional, so the CFB-only callers that existed before
      // this change cannot start going red because of a league they never read.
      expect(watchdogVerdict(fresh, false)).toEqual([]);
    });

    it("flags each NFL job independently", () => {
      const cases: Array<[keyof typeof nflFresh, number, RegExp]> = [
        ["nflSyncGames", 31, /nfl-sync-games/],
        ["nflRefreshLines", 40, /nfl-refresh-lines/],
        ["nflLinesClose", 90, /nfl-lines-close/],
        ["nflGrade", 90, /nfl-grade/],
      ];
      for (const [key, age, pattern] of cases) {
        const problems = watchdogVerdict({ ...fresh, ...nflFresh, [key]: age }, false);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(pattern);
      }
    });

    it("tolerates the 72h gaps the multi-day crons actually have", () => {
      // nfl-grade runs Mon/Tue/Fri and nfl-lines-close Sun/Mon/Thu/Sat, so
      // three days between successes is normal, not a fault. A threshold set
      // at "weekly-ish" would have cried every Thursday.
      const gap = { ...fresh, ...nflFresh, nflGrade: 73, nflLinesClose: 73 };
      expect(watchdogVerdict(gap, false)).toEqual([]);
    });

    it("a never-run NFL job trips its threshold", () => {
      expect(watchdogVerdict({ ...fresh, nflSyncGames: Infinity }, false)[0]).toMatch(
        /nfl-sync-games/,
      );
    });
  });
});

describe("detectCoverFlips — bad beats and backdoor covers (audit 10/G9)", () => {
  const lines = { spread: -10, total: 45.5 };
  // Home laying 10, up 24-14 late: home is covering by 0 ... actually +0, so
  // use 24-13 → home covers by 1. Away scores a TD to make it 24-20.
  const late = (over: Partial<Parameters<typeof detectCoverFlips>[1]> = {}) => ({
    homePoints: 24,
    awayPoints: 20,
    period: 4,
    clock: "0:38",
    lastPlay: "Alston 34 yd pass from Meyer (Kim KICK)",
    ...over,
  });

  it("the classic backdoor: dead game, meaningless TD, cover flips", () => {
    const flips = detectCoverFlips({ home_points: 24, away_points: 13 }, late(), lines);
    const spread = flips.find((f) => f.market === "spread")!;
    expect(spread.from_side).toBe("home"); // 24-13 beats -10 by 1
    expect(spread.to_side).toBe("away"); // 24-20 misses by 6
    // the home team won by 4 either way — that's what makes it a backdoor
    expect(spread.winner_changed).toBe(false);
    expect(spread.seconds_left).toBe(38);
    expect(spread.last_play).toMatch(/Alston/);
  });

  it("the same play flips the total, and both are logged", () => {
    // 24-13 = 37 (under 45.5); 24-20 = 44 (still under) → no total flip
    expect(
      detectCoverFlips({ home_points: 24, away_points: 13 }, late(), lines).map((f) => f.market),
    ).toEqual(["spread"]);
    // 34-20: the total clears 45.5 and the home side finally beats the 10
    const both = detectCoverFlips(
      { home_points: 21, away_points: 20 },
      late({ homePoints: 34 }),
      lines,
    );
    expect(both.map((f) => f.market).sort()).toEqual(["spread", "total"]);
    expect(both.find((f) => f.market === "total")!.to_side).toBe("over");
  });

  it("marks a lead change as a wild finish, not a backdoor", () => {
    const flips = detectCoverFlips(
      { home_points: 20, away_points: 17 },
      late({ homePoints: 20, awayPoints: 24 }),
      // laying 2.5, not 10: the cover and the game both turn over on this play
      { spread: -2.5, total: null },
    );
    expect(flips[0].winner_changed).toBe(true);
  });

  it("stays quiet when a score changes but the cover holds", () => {
    // home -10 up 35-7; a late FG doesn't move who's covering
    expect(
      detectCoverFlips({ home_points: 35, away_points: 7 }, late({ homePoints: 38, awayPoints: 7 }), {
        spread: -10,
        total: null,
      }),
    ).toEqual([]);
  });

  it("ignores everything before the 4th quarter — a 2nd-quarter swing isn't a bad beat", () => {
    expect(
      detectCoverFlips({ home_points: 24, away_points: 13 }, late({ period: 2 }), lines),
    ).toEqual([]);
  });

  it("catches overtime, which is period 5 and up", () => {
    const flips = detectCoverFlips(
      { home_points: 24, away_points: 13 },
      late({ period: 5, clock: null }),
      lines,
    );
    expect(flips.length).toBeGreaterThan(0);
    // an unusable clock logs the flip anyway, with seconds unknown
    expect(flips[0].seconds_left).toBeNull();
    expect(flips[0].period).toBe(5);
  });

  it("no line, no cover, no flip", () => {
    expect(
      detectCoverFlips({ home_points: 24, away_points: 13 }, late(), {
        spread: null,
        total: null,
      }),
    ).toEqual([]);
  });

  it("an unchanged score is a no-op — this is what makes a retried tick safe", () => {
    expect(detectCoverFlips({ home_points: 24, away_points: 20 }, late(), lines)).toEqual([]);
  });

  it("a game seen for the first time has no previous score to compare", () => {
    expect(detectCoverFlips({ home_points: null, away_points: null }, late(), lines)).toEqual([]);
  });
});
