import { describe, expect, it } from "vitest";
import type { CfbdScoreboardGame } from "../../src/lib/cfbd";
import { asClient, FakeSupabase } from "./fake-supabase";
import {
  applyScoreboard,
  gamesNeedingScoring,
  gradeGames,
  gradeSeasonFinals,
} from "./jobs-core";

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

/**
 * SCORE-1's cost control.
 *
 * `NFL-12` left the per-game ESPN `/summary` call as a decision owed, because
 * one call per live game per tick is ~16x the single scoreboard call on an NFL
 * Sunday. This gate is the whole reason it became affordable: each stored row
 * carries the running score after it, so the timeline itself says how many
 * points are already accounted for. Nothing to fetch unless that number has
 * fallen behind the scoreboard.
 */
describe("gamesNeedingScoring", () => {
  const game = (id: number, home: number, away: number) => ({
    id,
    home_points: home,
    away_points: away,
    home_team_id: 1,
    away_team_id: 2,
    week: 1,
    season_type: "regular",
  });

  it("asks for a game whose score has moved past its stored timeline", () => {
    const out = gamesNeedingScoring([game(1, 14, 7)], new Map([[1, 14]]));
    expect(out.map((g) => g.id)).toEqual([1]);
  });

  /* The common case by a distance: on a 30-second tick almost every pass finds
     nothing, and each one that does is a real score. */
  it("skips a game whose timeline is already complete", () => {
    expect(gamesNeedingScoring([game(1, 14, 7)], new Map([[1, 21]]))).toEqual([]);
  });

  it("asks for a game that has scored and has no timeline yet", () => {
    expect(gamesNeedingScoring([game(1, 7, 0)], new Map()).map((g) => g.id)).toEqual([1]);
  });

  /* A scoreless first quarter is not a reason to poll — there is nothing to
     fetch and the answer would be an empty array either way. */
  it("skips a scoreless game entirely", () => {
    expect(gamesNeedingScoring([game(1, 0, 0)], new Map())).toEqual([]);
  });

  it("treats a null score as zero rather than throwing", () => {
    const g = { ...game(1, 0, 0), home_points: null, away_points: null };
    expect(gamesNeedingScoring([g], new Map())).toEqual([]);
  });

  /* The shape of a real Saturday afternoon: most games are current, one just
     scored, one has not started. Only the middle one costs a call. */
  it("picks out only the games that moved, from a full board", () => {
    const out = gamesNeedingScoring(
      [game(1, 21, 14), game(2, 7, 7), game(3, 0, 0)],
      new Map([
        [1, 28], // 35 on the board, 28 accounted for — a touchdown just landed
        [2, 14], // level
      ]),
    );
    expect(out.map((g) => g.id)).toEqual([1]);
  });
});

/**
 * GRADE-2: the LAST game of a slate is the one GRADE-1 could not reach.
 *
 * `applyScoreboard` grades the board it just polled, and the loop only polls a
 * league while `activity()` says something is live. Those two facts collide on
 * exactly one game per slate: the moment the last one goes final, the league
 * turns idle, and the tick that would have offered it as "completed" never
 * runs. Owner report 2026-08-15 — two bets on a three-game preseason slate
 * settled within minutes, the third sat open for four hours with the next
 * scheduled backstop two days out.
 *
 * The sweep is `gradeSeasonFinals`, which the loop now calls on that idle edge.
 * This pins the sequence rather than the wiring: poll a board where the second
 * game is still playing, let it finish with nobody watching, sweep.
 */
const twoGameSlate = () => ({
  games: [
    {
      id: 401, season_id: 102026, week: 2, status: "final",
      home_points: 20, away_points: 7, start_ts: KICKOFF,
      current_period: 4, current_clock: "0:00", current_situation: null,
      last_play: null, possession: null, tv: "FOX",
    },
    {
      id: 402, season_id: 102026, week: 2, status: "in_progress",
      home_points: 7, away_points: 21, start_ts: KICKOFF,
      current_period: 4, current_clock: "2:00", current_situation: null,
      last_play: null, possession: null, tv: "FOX",
    },
  ],
  line_snapshots: [
    { game_id: 401, provider: "DraftKings", spread: -3, spread_open: -3,
      total: 40.5, captured_at: "2026-09-06T16:45:00Z" },
    { game_id: 402, provider: "DraftKings", spread: 3.5, spread_open: 3.5,
      total: 39.5, captured_at: "2026-09-06T16:45:00Z" },
  ],
  bets: [
    { id: 901, game_id: 401, bet_type: "moneyline", side: "home", line_taken: null,
      odds: 141, units: 1, result: null, voided_at: null, clv: null,
      closing_line: null, payout_units: null },
    { id: 902, game_id: 402, bet_type: "spread", side: "home", line_taken: 3.5,
      odds: -110, units: 1, result: null, voided_at: null, clv: null,
      closing_line: null, payout_units: null },
  ],
  picks: [],
});

/** The board as the feed reports it while game 402 is still playing. */
const boardWith402Live: CfbdScoreboardGame[] = [
  {
    id: 401, status: "completed", period: 4, clock: "0:00", situation: null,
    lastPlay: null, lastPlayType: null, possession: null,
    homeTeam: { id: 1, name: "WSH", points: 20 },
    awayTeam: { id: 2, name: "MIA", points: 7 }, tv: "FOX",
  },
  {
    id: 402, status: "in_progress", period: 4, clock: "2:00", situation: null,
    lastPlay: null, lastPlayType: null, possession: null,
    homeTeam: { id: 3, name: "ATL", points: 7 },
    awayTeam: { id: 4, name: "DEN", points: 21 }, tv: "FOX",
  },
] as unknown as CfbdScoreboardGame[];

describe("the last game of a slate", () => {
  it("is left ungraded by the live path, and the sweep settles it", async () => {
    const db = new FakeSupabase(twoGameSlate());

    // The tick that sees 401 finish. 402 is still playing, so it is not on the
    // completed list and nothing settles it.
    await applyScoreboard(asClient(db), boardWith402Live);
    expect(db.rows("bets").find((b) => b.id === 901)!.result).toBe("win");
    expect(db.rows("bets").find((b) => b.id === 902)!.result).toBe(null);

    // 402 goes final. Whoever writes it — a later tick, or the NFL's 10-second
    // edge writer (0044) — the league is idle now, so no further board is
    // polled and `gradeGames` is never called again.
    const g402 = db.rows("games").find((g) => g.id === 402)!;
    g402.status = "final";
    g402.current_clock = "0:00";

    // The sweep, which the loop runs on the live → idle edge.
    const out = (await gradeSeasonFinals(asClient(db), 102026)) as { betsGraded: number };
    expect(out.betsGraded).toBe(1);

    // ATL +3.5 losing 7-21: (7 - 21) + 3.5 = -10.5, a loss at one unit.
    const bet = db.rows("bets").find((b) => b.id === 902)!;
    expect(bet.result).toBe("loss");
    expect(bet.payout_units).toBe(-1);
    expect(bet.closing_line).toBe(3.5);
  });

  it("costs nothing when the sweep has nothing to settle", async () => {
    const db = new FakeSupabase(twoGameSlate());
    db.rows("games").find((g) => g.id === 402)!.status = "final";
    await gradeSeasonFinals(asClient(db), 102026);
    const before = db.readCount("line_snapshots");

    const again = (await gradeSeasonFinals(asClient(db), 102026)) as { betsGraded: number };

    expect(again.betsGraded).toBe(0);
    // The expensive read is skipped entirely on a sweep with nothing ungraded,
    // which is what makes calling this every run affordable.
    expect(db.readCount("line_snapshots")).toBe(before);
  });
});

describe("gradeGames — team totals and first halves (R2-A4)", () => {
  /* One final, 27–20 home, whose scoring_plays fully explain the board:
     halftime 17–3. Plus a second final whose plays DON'T (one captured play
     for a 21–14 game) — its first-half bet must stay open, not be guessed. */
  const gapSeed = () => ({
    games: [
      {
        id: 402,
        season_id: 2026,
        week: 2,
        status: "final",
        home_points: 27,
        away_points: 20,
        start_ts: KICKOFF,
      },
      {
        id: 403,
        season_id: 2026,
        week: 2,
        status: "final",
        home_points: 21,
        away_points: 14,
        start_ts: KICKOFF,
      },
    ],
    scoring_plays: [
      { game_id: 402, sequence: 1, period: 1, home_points: 7, away_points: 0 },
      { game_id: 402, sequence: 2, period: 1, home_points: 7, away_points: 3 },
      { game_id: 402, sequence: 3, period: 2, home_points: 17, away_points: 3 },
      { game_id: 402, sequence: 4, period: 3, home_points: 17, away_points: 13 },
      { game_id: 402, sequence: 5, period: 4, home_points: 24, away_points: 13 },
      { game_id: 402, sequence: 6, period: 4, home_points: 24, away_points: 20 },
      { game_id: 402, sequence: 7, period: 4, home_points: 27, away_points: 20 },
      // 403: the final says 21–14; this is the only play we captured.
      { game_id: 403, sequence: 1, period: 1, home_points: 7, away_points: 0 },
    ],
    line_snapshots: [],
    picks: [],
    bets: [
      // Home team total over 24.5 — home scored 27.
      {
        id: 901,
        game_id: 402,
        bet_type: "team_total",
        side: "over",
        team_side: "home",
        line_taken: 24.5,
        odds: -110,
        units: 1,
        result: null,
        voided_at: null,
        clv: null,
        closing_line: null,
        payout_units: null,
      },
      // Legacy team total: the subject team lives only in the description.
      {
        id: 902,
        game_id: 402,
        bet_type: "team_total",
        side: "under",
        team_side: null,
        line_taken: 24.5,
        odds: -110,
        units: 1,
        result: null,
        voided_at: null,
        clv: null,
        closing_line: null,
        payout_units: null,
      },
      // 1H home -7, stored home-perspective; halftime 17–3 covers.
      {
        id: 903,
        game_id: 402,
        bet_type: "first_half",
        side: "home",
        team_side: null,
        line_taken: -7,
        odds: -110,
        units: 2,
        result: null,
        voided_at: null,
        clv: null,
        closing_line: null,
        payout_units: null,
      },
      // 1H bet on the game whose plays can't prove the half.
      {
        id: 904,
        game_id: 403,
        bet_type: "first_half",
        side: "away",
        team_side: null,
        line_taken: 3,
        odds: -110,
        units: 1,
        result: null,
        voided_at: null,
        clv: null,
        closing_line: null,
        payout_units: null,
      },
    ],
  });

  it("settles a team total on the subject team's points, CLV null by design", async () => {
    const db = new FakeSupabase(gapSeed());
    const out = (await gradeGames(asClient(db), [402, 403])) as { betsGraded: number };

    expect(out.betsGraded).toBe(2); // 901 and 903

    const tt = db.rows("bets").find((b) => b.id === 901)!;
    expect(tt.result).toBe("win");
    expect(tt.payout_units).toBe(0.91);
    expect(tt.clv).toBe(null);
    expect(tt.closing_line).toBe(null);
  });

  it("skips a legacy team total with no structured team — never guesses", async () => {
    const db = new FakeSupabase(gapSeed());
    await gradeGames(asClient(db), [402, 403]);
    expect(db.rows("bets").find((b) => b.id === 902)!.result).toBe(null);
  });

  it("settles a first half only when scoring_plays prove the halftime score", async () => {
    const db = new FakeSupabase(gapSeed());
    await gradeGames(asClient(db), [402, 403]);

    // 402: halftime 17–3, home -7 covers by 7. Two units at -110 pay 1.82.
    const fh = db.rows("bets").find((b) => b.id === 903)!;
    expect(fh.result).toBe("win");
    expect(fh.payout_units).toBe(1.82);

    // 403: the plays under-explain the final; the bet stays open for manual
    // settle rather than being graded off an invented half.
    expect(db.rows("bets").find((b) => b.id === 904)!.result).toBe(null);
  });

  it("reads scoring_plays only when a first_half bet is ungraded", async () => {
    const db = new FakeSupabase(gapSeed());
    await gradeGames(asClient(db), [402, 403]);
    const before = db.readCount("scoring_plays");
    await gradeGames(asClient(db), [402, 403]);
    // Second pass: 901/903 settled; 902/904 remain, but only 904 is
    // first_half, so exactly one more chunked read happens.
    expect(db.readCount("scoring_plays")).toBe(before + 1);
  });

  /* The byte-parity claim for the shared path: the ORIGINAL seed — spread bet,
     total pick, captured close — settles identically with the new branches in
     the loop. The numbers here are copied from "settles a final's bet and
     pick" above; if this ever disagrees with that test, the new branches
     leaked into the old types. */
  it("changes nothing about how spread/total/moneyline settle", async () => {
    const db = new FakeSupabase(seed());
    const out = (await gradeGames(asClient(db), [401])) as {
      betsGraded: number;
      picksGraded: number;
    };
    expect(out.betsGraded).toBe(1);
    expect(out.picksGraded).toBe(1);
    const bet = db.rows("bets")[0];
    expect(bet.result).toBe("win");
    expect(bet.payout_units).toBe(1.82);
    expect(bet.closing_line).toBe(-4.5);
  });
});
