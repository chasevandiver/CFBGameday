import { describe, expect, it } from "vitest";
import type { CfbdScoreboardGame } from "../../src/lib/cfbd";
import { consensusFromSnapshots } from "../../src/lib/consensus";
import { closingConsensus, SNAPSHOT_COLS, SCOREBOARD_COLS, scoreboardPatch, type ScoreboardRow } from "./jobs-core";

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
