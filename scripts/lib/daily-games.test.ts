import { describe, expect, it } from "vitest";
import type { SnapshotLike } from "../../src/lib/consensus";
import {
  gradeAssignments,
  marqueeScore,
  openingSpread,
  productDate,
  productDateOffset,
  selectMarquee,
  streakResult,
  type GuessRow,
  type MarqueeGame,
} from "./daily-games";

const snap = (over: Partial<SnapshotLike>): SnapshotLike => ({
  provider: "DraftKings",
  captured_at: "2026-09-01T12:00:00Z",
  spread: -3.5,
  spread_open: null,
  total: 44.5,
  ...over,
});

describe("openingSpread", () => {
  it("uses the book's own opener when any snapshot carries one (NFL)", () => {
    const snaps = [
      snap({ spread: -6.5, spread_open: -3 }),
      snap({ provider: "FanDuel", spread: -6, spread_open: -3.5 }),
    ];
    // median of true opens (-3, -3.5) → -3.25 → snaps to half away from zero
    expect(openingSpread(snaps)).toBe(-3.5);
  });

  it("falls back to the EARLIEST capture per provider (CFB proxy), never the current line", () => {
    const snaps = [
      snap({ captured_at: "2026-09-01T12:00:00Z", spread: -3 }),
      snap({ captured_at: "2026-09-05T12:00:00Z", spread: -7 }), // moved
    ];
    expect(openingSpread(snaps)).toBe(-3);
  });

  it("null with nothing to read", () => {
    expect(openingSpread([])).toBeNull();
    expect(openingSpread([snap({ spread: null })])).toBeNull();
  });
});

describe("marquee selection", () => {
  const g = (id: number, home: number, away: number, ts = `2026-09-05T1${id}:00:00Z`): MarqueeGame => ({
    id,
    home_team_id: home,
    away_team_id: away,
    start_ts: ts,
  });
  it("ranked matchups outrank unranked ones; ties break to the earlier kickoff", () => {
    const ranks = new Map([
      [1, 1],  // #1
      [2, 5],  // #5
      [3, 25], // #25
    ]);
    const games = [
      g(9, 100, 101), // unranked vs unranked
      g(8, 1, 2),     // #1 vs #5 — the game of the week
      g(7, 3, 102),   // #25 vs unranked
    ];
    expect(selectMarquee(games, ranks, 2)).toEqual([8, 7]);
  });
  it("a close spread raises the streak's version of the score", () => {
    const ranks = new Map<number, number>();
    const even = marqueeScore(g(1, 100, 101), ranks, -1);
    const blowout = marqueeScore(g(1, 100, 101), ranks, -24);
    expect(even).toBeGreaterThan(blowout);
  });
});

describe("productDate", () => {
  it("computes the calendar day in the product timezone, not UTC", () => {
    // 02:30 UTC Sunday is Saturday evening in Chicago.
    expect(productDate(new Date("2026-09-06T02:30:00Z"))).toBe("2026-09-05");
    expect(productDateOffset(new Date("2026-09-06T02:30:00Z"), 1)).toBe("2026-09-06");
  });
});

describe("gradeAssignments", () => {
  const rows: GuessRow[] = [
    { user_id: "u1", game_id: 5, guess: -3 },
    { user_id: "u2", game_id: 5, guess: 2.5 },
  ];
  it("grades absolute error against the open once snapshots exist", () => {
    const out = gradeAssignments(
      new Map([[5, rows]]),
      new Map([[5, [snap({ spread: -6.5, spread_open: -3.5 })]]]),
    );
    expect(out).toEqual([
      { user_id: "u1", game_id: 5, abs_error: 0.5 },
      { user_id: "u2", game_id: 5, abs_error: 6 },
    ]);
  });
  it("a game with no snapshots yields nothing — pending, not approximated", () => {
    expect(gradeAssignments(new Map([[5, rows]]), new Map())).toEqual([]);
  });
});

describe("streakResult", () => {
  it("settles a final on the winner", () => {
    expect(streakResult("final", 24, 20, "home")).toBe("win");
    expect(streakResult("final", 24, 20, "away")).toBe("loss");
  });
  it("a tie voids — a run is broken by a wrong answer, not a coin flip", () => {
    expect(streakResult("final", 20, 20, "home")).toBe("void");
  });
  it("a dead game voids (League Rule #4's spirit)", () => {
    expect(streakResult("postponed", null, null, "home")).toBe("void");
    expect(streakResult("canceled", null, null, "away")).toBe("void");
  });
  it("a live or incomplete game stays pending", () => {
    expect(streakResult("in_progress", 14, 10, "home")).toBeNull();
    expect(streakResult("final", null, null, "home")).toBeNull();
    expect(streakResult("scheduled", null, null, "home")).toBeNull();
  });
});
