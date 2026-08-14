import { describe, expect, it } from "vitest";
import type { CfbdScoreboardGame } from "../../src/lib/cfbd";
import { asClient, FakeSupabase } from "./fake-supabase";
import { applyScoreboard, gradeGames } from "./jobs-core";

/**
 * GRADE-1: a game settles on the tick that sees it finish.
 *
 * Before this, `applyScoreboard` wrote scores and touched no wager, and grading
 * ran only from `ratings-update` (Sunday 13:00 UTC) and `nfl-grade` (Mon/Tue/
 * Fri). A bet on a Saturday-night final stayed open on the ledger for days, and
 * the slate card had no result to render — which is why the final-card verdict
 * looked broken as well.
 */

const KICKOFF = "2026-09-06T17:00:00Z";

/** One finished game with a spread bet, a total pick, and a captured close. */
const seed = () => ({
  games: [
    {
      id: 401,
      season_id: 102026,
      week: 1,
      status: "final",
      home_points: 27,
      away_points: 20,
      start_ts: KICKOFF,
      current_period: 4,
      current_clock: "0:00",
      current_situation: null,
      last_play: null,
      possession: null,
      tv: "CBS",
    },
  ],
  line_snapshots: [
    {
      game_id: 401,
      provider: "DraftKings",
      spread: -4.5,
      spread_open: -3,
      total: 44.5,
      captured_at: "2026-09-06T16:45:00Z",
    },
  ],
  bets: [
    {
      id: 900,
      game_id: 401,
      bet_type: "spread",
      side: "home",
      line_taken: -3,
      odds: -110,
      units: 2,
      result: null,
      voided_at: null,
      clv: null,
      closing_line: null,
      payout_units: null,
    },
  ],
  picks: [
    {
      id: 700,
      game_id: 401,
      market: "total",
      side: "over",
      line_at_pick: 44.5,
      result: null,
      clv: null,
    },
  ],
});

describe("gradeGames", () => {
  it("settles a final's bet and pick, with CLV against the captured close", async () => {
    const db = new FakeSupabase(seed());

    const out = (await gradeGames(asClient(db), [401])) as {
      betsGraded: number;
      picksGraded: number;
    };

    expect(out.betsGraded).toBe(1);
    expect(out.picksGraded).toBe(1);

    // Home -3 on a 7-point win covers; at -110 two units returns 1.82.
    const bet = db.rows("bets")[0];
    expect(bet.result).toBe("win");
    expect(bet.payout_units).toBe(1.82);
    // Took -3, closed -4.5 — the market came to us, so CLV is positive.
    expect(bet.closing_line).toBe(-4.5);
    expect(Number(bet.clv)).toBeGreaterThan(0);

    // 27 + 20 = 47 clears a 44.5 total.
    expect(db.rows("picks")[0].result).toBe("win");
  });

  it("is idempotent — a second pass finds nothing left", async () => {
    const db = new FakeSupabase(seed());
    await gradeGames(asClient(db), [401]);

    const again = (await gradeGames(asClient(db), [401])) as {
      betsGraded: number;
      picksGraded: number;
    };

    expect(again.betsGraded).toBe(0);
    expect(again.picksGraded).toBe(0);
    // and it did not rewrite the settled row
    expect(db.rows("bets")[0].payout_units).toBe(1.82);
  });

  /* The reason the ungraded reads come before the closing-line read: on a live
     tick almost every call finds nothing to settle, and line_snapshots is the
     expensive one. Under the old order it was fetched for every final on the
     board, 30 seconds apart, all afternoon. */
  it("does not read line_snapshots when there is nothing ungraded", async () => {
    const db = new FakeSupabase(seed());
    await gradeGames(asClient(db), [401]);
    const before = db.readCount("line_snapshots");

    await gradeGames(asClient(db), [401]);

    expect(db.readCount("line_snapshots")).toBe(before);
    expect(before).toBe(1);
  });

  it("leaves an unfinished game alone", async () => {
    const s = seed();
    s.games[0].status = "in_progress";
    const db = new FakeSupabase(s);

    const out = (await gradeGames(asClient(db), [401])) as { betsGraded: number };

    expect(out.betsGraded).toBe(0);
    expect(db.rows("bets")[0].result).toBe(null);
  });

  it("does nothing, and reads nothing, for an empty id list", async () => {
    const db = new FakeSupabase(seed());
    const out = (await gradeGames(asClient(db), [])) as { betsGraded: number };
    expect(out.betsGraded).toBe(0);
    expect(db.readCount("games")).toBe(0);
  });
});

describe("applyScoreboard grades what it sees finished", () => {
  const board = (status: CfbdScoreboardGame["status"]): CfbdScoreboardGame[] => [
    {
      id: 401,
      startDate: KICKOFF,
      status,
      period: 4,
      clock: "0:00",
      situation: null,
      lastPlay: null,
      possession: null,
      homeTeam: { id: 100010, name: "HOME", points: 27 },
      awayTeam: { id: 100011, name: "AWAY", points: 20 },
      tv: "CBS",
    },
  ];

  /* The case that decided the design. The NFL's 10-second edge function
     (migration 0044) writes finals straight to Postgres, so by the time this
     loop's next tick runs the stored row ALREADY says final and there is no
     transition left to detect. Gating on one would have missed the league the
     defect was reported on. */
  it("grades a game that was already stored as final — no transition to detect", async () => {
    const db = new FakeSupabase(seed());

    await applyScoreboard(asClient(db), board("completed"));

    expect(db.rows("bets")[0].result).toBe("win");
  });

  it("grades a game that finishes on this very tick", async () => {
    const s = seed();
    s.games[0].status = "in_progress";
    s.games[0].home_points = 20;
    const db = new FakeSupabase(s);

    await applyScoreboard(asClient(db), board("completed"));

    expect(db.rows("games")[0].status).toBe("final");
    expect(db.rows("bets")[0].result).toBe("win");
  });

  it("does not grade a game that is still being played", async () => {
    const s = seed();
    s.games[0].status = "in_progress";
    const db = new FakeSupabase(s);

    await applyScoreboard(asClient(db), board("in_progress"));

    expect(db.rows("bets")[0].result).toBe(null);
  });

  it("reports what it graded, and stays quiet when it graded nothing", async () => {
    const db = new FakeSupabase(seed());

    const first = (await applyScoreboard(asClient(db), board("completed"))) as {
      graded?: { betsGraded: number };
    };
    expect(first.graded?.betsGraded).toBe(1);

    const second = (await applyScoreboard(asClient(db), board("completed"))) as {
      graded?: unknown;
    };
    expect(second.graded).toBeUndefined();
  });

  /* The scoreboard's job is scores. A grading failure must not cost the slate
     its live layer — the scheduled pass is still the backstop and will report
     the same failure loudly. */
  it("still writes scores when grading blows up", async () => {
    const s = seed();
    s.games[0].status = "in_progress";
    s.games[0].home_points = 20;
    const db = new FakeSupabase(s);
    db.failures.set("bets:select", "connection reset");

    const out = (await applyScoreboard(asClient(db), board("completed"))) as {
      updated: number;
      graded?: unknown;
    };

    expect(out.updated).toBe(1);
    expect(db.rows("games")[0].status).toBe("final");
    expect(db.rows("games")[0].home_points).toBe(27);
    expect(out.graded).toBeUndefined();
  });
});
