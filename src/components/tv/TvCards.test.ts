import { describe, expect, it } from "vitest";
import type { TickerGame, TickerTicket } from "../../lib/ticker";
import {
  cardOrder,
  finalUnits,
  finalWord,
  network,
  newBanners,
  newFinals,
  newFlips,
  newScores,
  packPages,
  packSections,
  scoreLabel,
  sectionOf,
  snapshot,
} from "./TvCards";
import { tvLine, tvStatus } from "./TvChip";

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

/**
 * Owner picks, 2026-11-14: a banner when a ticket changes sides of its number
 * (TV-24) and one when a bet settles (TV-23), on the takeover the touchdown
 * banner already uses.
 */
describe("the cover-flip and final banners (TV-23, TV-24)", () => {
  const tk = (over: Partial<TickerTicket> = {}): TickerTicket => ({
    label: "UGA -3.5",
    side: "home",
    state: "covering",
    ...over,
  });
  const mine = (over: Partial<TickerGame>, tickets: TickerTicket[] = [tk()]): TickerGame =>
    game({ mine: tickets[0].state, stake: tickets[0], tickets, ...over });

  it("announces a ticket that changed sides, and nothing on the first poll", () => {
    const before = [mine({ homePoints: 10, awayPoints: 3 })];
    const after = [mine({ homePoints: 10, awayPoints: 10 }, [tk({ state: "losing" })])];
    expect(newFlips(null, after, 0)).toEqual([]);
    const flips = newFlips(snapshot(null, before), after, 4);
    expect(flips).toEqual([
      { kind: "flip", gameId: 1, to: "losing", tickets: after[0].tickets, cause: null, key: 4 },
    ]);
  });

  it("says nothing while a ticket holds its side", () => {
    const before = [mine({ homePoints: 10, awayPoints: 3 })];
    expect(newFlips(snapshot(null, before), [mine({ homePoints: 17, awayPoints: 3 })], 0)).toEqual(
      [],
    );
  });

  it("carries a verdict through a push, so covering, push, not covering is one flip", () => {
    let snap = snapshot(null, [mine({})]);
    const onNumber = [mine({}, [tk({ state: "push" })])];
    expect(newFlips(snap, onNumber, 0)).toEqual([]);
    snap = snapshot(snap, onNumber);
    expect(newFlips(snap, [mine({}, [tk({ state: "losing" })])], 0)).toHaveLength(1);
    // ...and back to the side it started on is no flip at all
    expect(newFlips(snap, [mine({})], 0)).toEqual([]);
  });

  it("flips each ticket on its own: the side can hold while the under dies", () => {
    const under = (state: TickerTicket["state"]) => tk({ label: "U 54.5", side: "under", state });
    const snap = snapshot(null, [mine({}, [tk(), under("covering")])]);
    const flips = newFlips(snap, [mine({}, [tk(), under("losing")])], 0);
    expect(flips).toHaveLength(1);
    expect(flips[0].tickets.map((t) => t.label)).toEqual(["U 54.5"]);
  });

  it("never announces a basketball flip, where a spread trades sides all night", () => {
    const hoops = (state: TickerTicket["state"]) => mine({ sport: "cbb" }, [tk({ state })]);
    expect(newFlips(snapshot(null, [hoops("covering")]), [hoops("losing")], 0)).toEqual([]);
  });

  it("announces a final once, only for a game with a graded ticket", () => {
    const snap = snapshot(null, [
      mine({ id: 1 }),
      game({ id: 2 }),
      mine({ id: 3 }, [tk({ state: "on" })]),
      mine({ id: 4, status: "final" }),
    ]);
    const after = [
      mine({ id: 1, status: "final" }),
      game({ id: 2, status: "final" }),
      mine({ id: 3, status: "final" }, [tk({ state: "on" })]),
      mine({ id: 4, status: "final" }),
    ];
    expect(newFinals(snap, after, 0).map((f) => f.gameId)).toEqual([1]);
    expect(newFinals(null, after, 0)).toEqual([]);
    expect(newFinals(snapshot(snap, after), after, 0)).toEqual([]);
  });

  it("settles a basketball bet, though it never announced a basket", () => {
    const snap = snapshot(null, [mine({ sport: "cbb" })]);
    expect(newFinals(snap, [mine({ sport: "cbb", status: "final" })], 0)).toHaveLength(1);
  });

  it("shows one banner per event: a flip carries its score, a final replaces it", () => {
    const snap = snapshot(null, [mine({ id: 1, homePoints: 10, awayPoints: 3 }), mine({ id: 2 })]);
    const banners = newBanners(
      snap,
      [
        mine({ id: 1, homePoints: 10, awayPoints: 10 }, [tk({ state: "losing" })]),
        mine({ id: 2, status: "final", homePoints: 14 }),
      ],
      7,
    );
    expect(banners.map((b) => [b.kind, b.gameId, b.key])).toEqual([
      ["flip", 1, 7],
      ["final", 2, 8],
    ]);
    expect(banners[0]).toMatchObject({ cause: "TOUCHDOWN" });
  });

  it("still announces a plain score when nothing flipped", () => {
    const snap = snapshot(null, [mine({ homePoints: 7, awayPoints: 3 })]);
    const banners = newBanners(snap, [mine({ homePoints: 14, awayPoints: 3 })], 0);
    expect(banners).toEqual([{ kind: "score", gameId: 1, side: "home", label: "TOUCHDOWN", key: 0 }]);
  });

  it("words a final by its tickets and totals what they paid", () => {
    const won = tk({ units: 0.91 });
    const lost = tk({ label: "O 54.5", side: "over", state: "losing", units: -1 });
    expect(finalWord([won])).toBe("WON");
    expect(finalWord([lost])).toBe("LOST");
    expect(finalWord([tk({ state: "push", units: 0 })])).toBe("PUSH");
    expect(finalWord([won, lost])).toBe("SPLIT");
    expect(finalWord([tk({ state: "on" })])).toBeNull();
    expect(finalUnits([won, lost])).toBe(-0.09);
    // picks carry no price, so there is no figure to print
    expect(finalUnits([tk()])).toBeNull();
  });

  it("counts the tickets a one-line surface has no room to print (TV-22)", () => {
    const two = mine({}, [tk(), tk({ label: "O 54.5", side: "over" })]);
    expect(tvLine(two)).toEqual({ text: "UGA -3.5", mine: true, more: 1 });
    expect(tvLine(mine({}))).toMatchObject({ more: 0 });
    expect(tvLine(game({ spread: -3.5 }))).toEqual({ text: "UGA -3.5", mine: false, more: 0 });
  });
});
