import { describe, expect, it } from "vitest";
import type { TickerGame } from "../../lib/ticker";
import {
  cardOrder,
  network,
  newScores,
  packPages,
  packSections,
  scoreLabel,
  sectionOf,
} from "./TvCards";
import { tvStatus } from "./TvChip";

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

  it("never mixes sections on a page, so the label always matches", () => {
    const pages = packSections(
      ["summary", "bets", "bets", "bets", "live", "live"],
      [400, 300, 300, 300, 300, 300],
      700,
    );
    expect(pages).toEqual([
      { section: "summary", items: [0] },
      { section: "bets", items: [1, 2] },
      { section: "bets", items: [3] },
      { section: "live", items: [4, 5] },
    ]);
  });

  it("sorts a game into its section: any bet is yours, whatever its status", () => {
    expect(sectionOf(game({ mine: "on", status: "scheduled" }))).toBe("bets");
    expect(sectionOf(game({ status: "in_progress" }))).toBe("live");
    expect(sectionOf(game({ status: "scheduled" }))).toBe("next");
    expect(sectionOf(game({ status: "final" }))).toBe("final");
  });

  it("shortens networks for the badge", () => {
    expect(
      ["The CW Network", "ACC Network", "ESPN | ESPN2", "Fox", "ESPN2", null].map(network),
    ).toEqual(["CW", "ACCN", "ESPN", "FOX", "ESPN2", null]);
  });
});

/**
 * TV-20, owner request 2026-11-12: college basketball bets on the overlay —
 * "obviously there won't be a down or distance… and I do not want score
 * updates every time my basketball bet scores… basketball is halves and OTs."
 */
describe("a college basketball bet on the TV (TV-20)", () => {
  const hoops = (over: Partial<TickerGame>): TickerGame =>
    game({ sport: "cbb", mine: "covering", homeAbbr: "PUR", awayAbbr: "ILL", ...over });

  it("is never announced when it scores, however the points arrive", () => {
    const prev = new Map([[1, { h: 58, a: 61 }]]);
    expect(newScores(prev, [hoops({ homePoints: 61, awayPoints: 61 })], 0)).toEqual([]);
    expect(newScores(prev, [hoops({ homePoints: 64, awayPoints: 68 })], 0)).toEqual([]);
  });

  it("leaves football's announcements exactly as they were", () => {
    const prev = new Map([[1, { h: 7, a: 3 }]]);
    const alerts = newScores(prev, [game({ mine: "covering", homePoints: 14, awayPoints: 3 })], 0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].label).toBe("TOUCHDOWN");
  });

  it("reads its clock in halves", () => {
    expect(tvStatus(hoops({ period: 1, clock: "12:34" }))).toBe("1H 12:34");
    expect(tvStatus(hoops({ period: 2, clock: "3:18" }))).toBe("2H 3:18");
    expect(tvStatus(hoops({ period: 3, clock: "4:00" }))).toBe("OT 4:00");
    expect(tvStatus(hoops({ period: 4, clock: "1:10" }))).toBe("2OT 1:10");
  });

  it("puts halftime after the first period, and shortens it for the corner box", () => {
    expect(tvStatus(hoops({ period: 1, clock: "0:00" }))).toBe("HALFTIME");
    expect(tvStatus(hoops({ period: 1, clock: "0:00" }), { short: true })).toBe("HALF");
    // football's second quarter, for contrast: still halftime there
    expect(tvStatus(game({ period: 2, clock: "0:00" }))).toBe("HALFTIME");
    expect(tvStatus(game({ period: 1, clock: "0:00" }))).toBe("END Q1");
  });

  it("says when a final needed overtime", () => {
    expect(tvStatus(hoops({ status: "final", period: 3, clock: null }))).toBe("FINAL/OT");
    expect(tvStatus(hoops({ status: "final", period: 2, clock: null }))).toBe("FINAL");
    // a football final carries no period and reads as it always has
    expect(tvStatus(game({ status: "final", period: null, clock: null }))).toBe("FINAL");
  });

  it("sorts with the viewer's other games, live first", () => {
    const order = cardOrder([
      game({ id: 1, status: "final" }),
      hoops({ id: 2, status: "in_progress" }),
      hoops({ id: 3, status: "scheduled", mine: "on" }),
    ]).map((g) => g.id);
    expect(order).toEqual([2, 3, 1]);
  });
});
