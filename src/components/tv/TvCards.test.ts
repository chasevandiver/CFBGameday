import { describe, expect, it } from "vitest";
import type { TickerGame } from "../../lib/ticker";
import { cardOrder, newScores, packPages, scoreLabel } from "./TvCards";

const game = (over: Partial<TickerGame>): TickerGame => ({
  id: 1,
  status: "in_progress",
  startTs: "2026-11-14T18:00:00Z",
  period: 2,
  clock: "5:00",
  homeAbbr: "UGA",
  awayAbbr: "ALA",
  homePoints: 7,
  awayPoints: 3,
  ...over,
});

describe("TV cards (TV-8, TV-9)", () => {
  it("puts the viewer's games first, live before upcoming before final", () => {
    const order = cardOrder([
      game({ id: 1, status: "final" }),
      game({ id: 2, status: "in_progress" }),
      game({ id: 3, status: "final", mine: "covering" }),
      game({ id: 4, status: "scheduled", mine: "on" }),
      game({ id: 5, status: "in_progress", mine: "losing" }),
    ]).map((g) => g.id);
    expect(order).toEqual([5, 4, 3, 2, 1]);
  });

  it("packs cards greedily and gives an oversize card its own page", () => {
    expect(packPages([300, 300, 300, 900, 200], 700)).toEqual([[0, 1], [2], [3], [4]]);
  });

  it("names a score by its size", () => {
    expect([7, 6, 8, 3, 2, 1, 4].map(scoreLabel)).toEqual([
      "TOUCHDOWN",
      "TOUCHDOWN",
      "TOUCHDOWN",
      "FIELD GOAL",
      "SAFETY",
      "EXTRA POINT",
      "SCORE",
    ]);
  });

  it("alerts only on the viewer's games, and not on the first poll", () => {
    const g = [game({ id: 1, mine: "covering", awayPoints: 10 }), game({ id: 2, awayPoints: 10 })];
    expect(newScores(null, g, 0)).toEqual([]);
    const prev = new Map([
      [1, { h: 7, a: 3 }],
      [2, { h: 7, a: 3 }],
    ]);
    expect(newScores(prev, g, 5)).toEqual([
      { gameId: 1, side: "away", label: "TOUCHDOWN", key: 5 },
    ]);
  });
});
