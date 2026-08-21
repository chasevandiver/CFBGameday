import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CfbdScoreboardGame } from "../../src/lib/cfbd";
import { consensusFromSnapshots } from "../../src/lib/consensus";
import { closingConsensus, detectCoverFlips, freezableGames, recordJobRun, settleCanceledRun, SNAPSHOT_COLS, SCOREBOARD_COLS, scoreboardPatch, watchdogVerdict, type ScoreboardRow } from "./jobs-core";

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
    /* The horizon moved from 1.5h to 5h on 2026-08-20, and the question moved
       with it (LIVE-3). It used to ask whether a launch had SUCCEEDED, which
       LIVE-2's four-hour runs made meaningless: hourly launches cancel each
       other, so a healthy game day produces `canceled` rows for hours and no
       `ok` at all. At 1.5h this test's own scenario — 3 hours since the last
       successful launch, game live — is now the NORMAL Saturday shape, and
       paging for it would have taught everyone to ignore the one alarm that
       covers the live layer.
       Freshness is the beat's job now (the block below); this one only still
       catches the scheduler going silent altogether. */
    const stale = { ...fresh, scoreboard: 6 };
    expect(watchdogVerdict(stale, false)).toEqual([]); // nobody playing, no debt
    expect(watchdogVerdict(stale, true)[0]).toMatch(/scoreboard-loop/);
    // And the shape that used to trip it is now correctly silent.
    expect(watchdogVerdict({ ...fresh, scoreboard: 3 }, true)).toEqual([]);
  });
  it("a never-run job (Infinity) trips its threshold", () => {
    expect(watchdogVerdict({ ...fresh, refreshLines: Infinity }, false)[0]).toMatch(/refresh-lines/);
  });

  describe("the six-pack lane (R3-E2)", () => {
    it("says nothing when the caller omits it", () => {
      expect(watchdogVerdict({ ...fresh }, false, true)).toEqual([]);
    });
    it("stays quiet before the first run, like the streak", () => {
      expect(watchdogVerdict({ ...fresh, sixPack: Infinity }, false, true)).toEqual([]);
    });
    it("flags a stale run while there are games this week", () => {
      expect(watchdogVerdict({ ...fresh, sixPack: 9 * 24 }, false, true)[0]).toMatch(/six-pack/);
    });
    it("is silent out of season, however long it has been quiet", () => {
      // The notify-jobs lesson: correctly silent from January to August, so
      // an hours horizon would go red weekly until nobody read it.
      expect(watchdogVerdict({ ...fresh, sixPack: 200 * 24 }, false, false)).toEqual([]);
    });
    it("tolerates a run that slipped a day", () => {
      expect(watchdogVerdict({ ...fresh, sixPack: 7.5 * 24 }, false, true)).toEqual([]);
    });
  });

  describe("the streak lane (R2-C2)", () => {
    it("stays quiet before the FIRST run — a new job's cron hasn't come yet", () => {
      expect(watchdogVerdict({ ...fresh, streak: Infinity }, false)).toEqual([]);
    });
    it("but a job that HAS run and then went silent past 30h trips", () => {
      expect(watchdogVerdict({ ...fresh, streak: 31 }, false)[0]).toMatch(/streak/);
    });
    it("and a fresh run is quiet", () => {
      expect(watchdogVerdict({ ...fresh, streak: 2 }, false)).toEqual([]);
    });
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

describe("recordJobRun and the cancelled-run hole (OPS-4)", () => {
  /**
   * The hourly scoreboard loops overlap by design and the workflow's
   * concurrency group cancels the old one, so the process is signalled and
   * neither the ok nor the error branch ever runs. Thirteen rows had piled up
   * reading `running` with a null `finished_at` — a healthy handoff shaped
   * exactly like a job that died.
   */
  const fakeDb = () => {
    const updates: Record<string, unknown>[] = [];
    const db = {
      from: () => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: 7 } }) }) }),
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            updates.push(patch);
          },
        }),
      }),
    } as unknown as Parameters<typeof recordJobRun>[0];
    return { db, updates };
  };

  it("records a normal run as ok", async () => {
    const { db, updates } = fakeDb();
    await recordJobRun(db, "j", async () => ({ ticks: 1 }));
    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe("ok");
    expect(updates[0].finished_at).toBeTruthy();
  });

  it("does not leak a signal listener per call", async () => {
    // A long-lived process calls this more than once. Leaking a pair each time
    // eventually trips Node's MaxListenersExceeded warning, and the fix for
    // one hole should not open another.
    const { db } = fakeDb();
    const before = process.listenerCount("SIGTERM");
    for (let i = 0; i < 5; i++) await recordJobRun(db, "j", async () => ({}));
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });

  it("writes `canceled` when the runner signals it, instead of leaving `running`", async () => {
    const { db, updates } = fakeDb();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    try {
      const run = recordJobRun(db, "scoreboard-loop", async () => {
        process.emit("SIGTERM");
        // The handler settles the row; the job body would be killed here for
        // real, so what matters is the row, not this promise.
        await new Promise((r) => setTimeout(r, 5));
        return {};
      });
      await run;
      expect(updates[0].status).toBe("canceled");
      expect(updates[0].finished_at).toBeTruthy();
      expect(updates[0].error).toContain("SIGTERM");
    } finally {
      exit.mockRestore();
    }
  });

  it("never writes twice, so a signal racing a normal finish cannot double-report", async () => {
    const { db, updates } = fakeDb();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    try {
      await recordJobRun(db, "j", async () => {
        process.emit("SIGTERM");
        await new Promise((r) => setTimeout(r, 5));
        return {};
      });
      expect(updates).toHaveLength(1);
    } finally {
      exit.mockRestore();
    }
  });
});


describe("settling a run the runner cancelled (OPS-4b)", () => {
  /**
   * The 08-19 fix installed a SIGTERM handler and two more rows piled up
   * anyway — 08-19 03:40 and 08-20 03:40, both loops cancelled by the next
   * hourly launch. The signal goes to the step's shell and the runner
   * terminates the `npx tsx` tree 0.26 s later, so the handler is never
   * reached. What can reach it is a workflow step that runs after the
   * process is gone, and these are the two halves that makes possible:
   * the run publishing its id, and the step settling that exact row.
   */
  const tmpFile = () => join(mkdtempSync(join(tmpdir(), "jobrun-")), "job-run-id");

  const publishingDb = () =>
    ({
      from: () => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: 4242 } }) }) }),
        update: () => ({ eq: async () => {} }),
      }),
    }) as unknown as Parameters<typeof recordJobRun>[0];

  it("publishes the run id where the cancellation step will look for it", async () => {
    const path = tmpFile();
    process.env.JOB_RUN_ID_FILE = path;
    let seen: string | null = null;
    try {
      await recordJobRun(publishingDb(), "scoreboard-loop", async () => {
        // Mid-run is the only moment that matters: a cancellation lands here,
        // never before the insert or after the update.
        seen = readFileSync(path, "utf8");
        return {};
      });
    } finally {
      delete process.env.JOB_RUN_ID_FILE;
      rmSync(path, { force: true });
    }
    expect(seen).toBe("4242");
  });

  it("drops the pointer once the row settles itself, so a later cancellation has nothing stale to point at", async () => {
    const path = tmpFile();
    process.env.JOB_RUN_ID_FILE = path;
    try {
      await recordJobRun(publishingDb(), "refresh-lines", async () => ({}));
      expect(existsSync(path)).toBe(false);
    } finally {
      delete process.env.JOB_RUN_ID_FILE;
      rmSync(path, { force: true });
    }
  });

  it("writes nothing at all when the file is not configured — the local path is unchanged", async () => {
    delete process.env.JOB_RUN_ID_FILE;
    // The assertion is that this does not throw: publishRunId returns early
    // rather than writing to some default path outside Actions.
    await expect(recordJobRun(publishingDb(), "j", async () => ({}))).resolves.toEqual({});
  });

  const settlingDb = () => {
    const calls: { patch: Record<string, unknown>; filters: [string, unknown][] }[] = [];
    let rows: unknown[] = [{ id: 4242 }];
    const db = {
      from: () => ({
        update: (patch: Record<string, unknown>) => {
          const filters: [string, unknown][] = [];
          const chain = {
            eq: (col: string, val: unknown) => {
              filters.push([col, val]);
              return chain;
            },
            select: async () => {
              calls.push({ patch, filters });
              return { data: rows };
            },
          };
          return chain;
        },
      }),
    } as unknown as Parameters<typeof settleCanceledRun>[0];
    return { db, calls, matchNothing: () => (rows = []) };
  };

  it("records the cancellation with an observed finish time", async () => {
    const { db, calls } = settlingDb();
    expect(await settleCanceledRun(db, 4242, "canceled by the runner")).toBe("settled");
    expect(calls[0].patch.status).toBe("canceled");
    // Unlike 0073's swept rows, something watched this one end, so the
    // timestamp is observed rather than fabricated.
    expect(calls[0].patch.finished_at).toBeTruthy();
    expect(calls[0].patch.error).toContain("canceled by the runner");
  });

  it("only ever touches a row still reading `running`", async () => {
    const { db, calls } = settlingDb();
    await settleCanceledRun(db, 4242, "note");
    expect(calls[0].filters).toEqual([
      ["id", 4242],
      ["status", "running"],
    ]);
  });

  it("is a no-op on a run that finished in the seconds before the cancellation landed", async () => {
    const { db, matchNothing } = settlingDb();
    matchNothing();
    expect(await settleCanceledRun(db, 4242, "note")).toBe("already-finished");
  });
});


describe("the live-freshness watchdog rule (LIVE-3)", () => {
  /**
   * The old rule read `no scoreboard-loop launch succeeded in 1.5h` off a
   * `status = 'ok'` row, and LIVE-2 broke it the day it shipped: four-hour
   * runs that cancel each other write `canceled`, so `ok` rows stop appearing
   * on exactly the days football is played. It would have paged every
   * Saturday with nothing wrong.
   */
  const ages = (over: Partial<Parameters<typeof watchdogVerdict>[0]> = {}) => ({
    refreshLines: 1,
    syncGames: 1,
    scoreboard: 0.2,
    ...over,
  });

  it("says nothing when a poller is beating, however old the last launch is", () => {
    // The healthy game-day shape after LIVE-2: launches keep being cancelled
    // by their successors, so nothing has "succeeded" for hours, and the
    // scores are perfectly fresh the whole time.
    expect(watchdogVerdict(ages({ scoreboard: 3.9 }), true, false, 0.4)).toEqual([]);
  });

  it("pages when a game is live and nothing has polled it", () => {
    const problems = watchdogVerdict(ages(), true, false, 12);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("live scores");
    expect(problems[0]).toContain("12m");
  });

  it("says so plainly when neither poller has ever beaten", () => {
    const problems = watchdogVerdict(ages(), true, false, Infinity);
    // "Infinitym" is what a naive template would print here.
    expect(problems[0]).toContain("any recorded run");
    expect(problems[0]).not.toContain("Infinity");
  });

  it("owes nothing while no game is live", () => {
    expect(watchdogVerdict(ages({ scoreboard: 99 }), false, false, Infinity)).toEqual([]);
  });

  it("still catches the scheduler dying, at a horizon a game day cannot trip", () => {
    // Launches every hour; 5h of silence is the scheduler, not a handoff.
    const problems = watchdogVerdict(ages({ scoreboard: 6 }), true, false, 0.5);
    expect(problems.some((p) => p.includes("no loop has launched"))).toBe(true);
  });

  it("is not checked at all by a caller that omits the beat", () => {
    // Same posture as the NFL lane: an older caller cannot be broken by a new
    // argument it does not know about.
    expect(watchdogVerdict(ages(), true, false)).toEqual([]);
  });
});

describe("scoreboardPatch stamps when the play arrived (LIVE-4)", () => {
  const NOW = "2026-08-21T01:00:00.000Z";
  const game = (over: Record<string, unknown> = {}) =>
    ({
      id: 1,
      status: "in_progress",
      period: 2,
      clock: "7:00",
      situation: "1st & 10 at HOU 25",
      lastPlay: "Rush for 3 yards",
      lastPlayType: "Rush",
      possession: "home",
      homeTeam: { id: 1, name: "H", points: 7 },
      awayTeam: { id: 2, name: "A", points: 3 },
      tv: null,
      ...over,
    }) as unknown as Parameters<typeof scoreboardPatch>[0];

  const stored = (over: Partial<ScoreboardRow> = {}): ScoreboardRow =>
    ({
      id: 1,
      status: "in_progress",
      home_points: 7,
      away_points: 3,
      current_period: 2,
      current_clock: "7:00",
      current_situation: "1st & 10 at HOU 25",
      last_play: "Rush for 3 yards",
      possession: "home",
      tv: null,
      ...over,
    }) as ScoreboardRow;

  it("stamps a play that is new", () => {
    const patch = scoreboardPatch(game(), stored({ last_play: "Pass for 8 yards" }), NOW);
    expect(patch?.last_play).toBe("Rush for 3 yards");
    expect(patch?.last_play_at).toBe(NOW);
  });

  it("does not stamp a play kept through a timeout", () => {
    // The incoming "play" is a TV timeout, so keepLastPlay holds the stored
    // one — which arrived earlier and must keep the time it arrived.
    const patch = scoreboardPatch(
      game({ lastPlay: "Official Timeout at 11:36.", lastPlayType: "Official Timeout", clock: "6:30" }),
      stored(),
      NOW,
    );
    expect(patch?.last_play).toBe("Rush for 3 yards");
    expect(patch?.last_play_at).toBeUndefined();
  });

  it("never turns an otherwise-identical tick into a write", () => {
    // The stamp is applied after the diff decides. If it were part of the
    // diff, every tick would write and every write fans out over realtime.
    expect(scoreboardPatch(game(), stored(), NOW)).toBeNull();
  });

  it("leaves the stamp alone when a game goes final", () => {
    const patch = scoreboardPatch(game({ status: "completed" }), stored(), NOW);
    expect(patch?.last_play).toBeNull();
    expect(patch?.last_play_at).toBeUndefined();
  });
});
