import { describe, expect, it } from "vitest";
import type { CfbdScoreboardGame } from "../../src/lib/cfbd";
import { consensusFromSnapshots } from "../../src/lib/consensus";
import { closingConsensus, freezableGames, SNAPSHOT_COLS, SCOREBOARD_COLS, scoreboardPatch, type ScoreboardRow } from "./jobs-core";

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

  it("passes through untouched when kickoff is unknown", () => {
    expect(closingConsensus([snapAt("2026-09-01T22:45:00Z")], null).spread).toBe(-3.5);
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
