import { describe, expect, it } from "vitest";
import { QUEUE_FLOOR, queueDays, queueVerdict, tapeCtxOf } from "./daily-puzzles";
import { buildTape, tapeEligible } from "../../src/lib/tape";
import type { DeckGame } from "../../src/lib/salience-data";

/**
 * The pure half of the generator. What matters here is the QUEUE: Guess the
 * Game's puzzle was computed on read, so there was no job to be late and its
 * empty deck went unnoticed for weeks (GTG-1). Everything below is about
 * making that failure loud and early instead.
 */

describe("queueDays", () => {
  it("starts at today and runs forward", () => {
    const days = queueDays(new Date("2026-08-18T18:00:00Z"), 3);
    expect(days).toEqual(["2026-08-18", "2026-08-19", "2026-08-20"]);
  });

  /**
   * "Today" is America/Chicago everywhere in this product (`productDate`).
   * 03:00 UTC is still the previous evening in Chicago, and a generator that
   * used UTC would skip a day every night — and, worse, would disagree with the
   * date gate on `tape_puzzles`.
   */
  it("uses the product day, not UTC", () => {
    expect(queueDays(new Date("2026-08-19T03:00:00Z"), 1)).toEqual(["2026-08-18"]);
  });

  it("crosses a month boundary", () => {
    expect(queueDays(new Date("2026-08-31T18:00:00Z"), 2)).toEqual(["2026-08-31", "2026-09-01"]);
  });
});

describe("queueVerdict", () => {
  /**
   * The distinction the whole design rests on: an error with a fortnight banked
   * is not an outage, and a generator broken for ten days is — even though the
   * second one has not failed a single player yet.
   */
  it("is green when a game errored but the queue is still deep", () => {
    const v = queueVerdict({ tape: { daysQueued: 13 } });
    expect(v.ok).toBe(true);
    expect(v.starved).toEqual([]);
  });

  it("is red once the queue drains past the floor", () => {
    const v = queueVerdict({ tape: { daysQueued: QUEUE_FLOOR - 1 } });
    expect(v.ok).toBe(false);
    expect(v.starved).toEqual(["tape"]);
  });

  it("goes red days before anybody sees an empty screen", () => {
    // The floor is what buys the warning. At exactly the floor we are still ok;
    // below it we are not, and there are still that many playable days left.
    expect(queueVerdict({ tape: { daysQueued: QUEUE_FLOOR } }).ok).toBe(true);
    expect(QUEUE_FLOOR).toBeGreaterThan(1);
  });

  it("names every starved game, not just the first", () => {
    const v = queueVerdict({ tape: { daysQueued: 0 }, chains: { daysQueued: 1 } });
    expect(v.starved).toEqual(["tape", "chains"]);
  });

  it("treats a game with no count at all as starved", () => {
    // A generator that threw before it could even count is not healthy.
    expect(queueVerdict({ tape: {} }).ok).toBe(false);
  });
});

describe("tapeCtxOf", () => {
  const deckGame = (over: Partial<DeckGame> = {}): DeckGame =>
    ({
      id: 1,
      seasonId: 2013,
      week: 14,
      seasonType: "regular",
      startTs: "2013-11-30T20:30:00Z",
      homeTeamId: 2,
      awayTeamId: 333,
      homePoints: 34,
      awayPoints: 28,
      homeConference: "SEC",
      awayConference: "SEC",
      neutralSite: false,
      conferenceGame: true,
      venueId: 1,
      notes: null,
      spread: 10.5,
      total: 55.5,
      pollPublished: true,
      homeRank: 4,
      awayRank: 1,
      salience: {} as DeckGame["salience"],
      ...over,
    }) as DeckGame;

  it("carries the market and poll facts a question needs", () => {
    const ctx = tapeCtxOf(deckGame(), "Auburn", "Alabama");
    expect(ctx.spread).toBe(10.5);
    expect(ctx.total).toBe(55.5);
    expect(ctx.pollPublished).toBe(true);
    expect(ctx.homeRank).toBe(4);
  });

  it("produces a context a full round can be built from", () => {
    const ctx = tapeCtxOf(deckGame(), "Auburn", "Alabama");
    expect(tapeEligible(ctx)).toBe(true);
    expect(buildTape(ctx)).toHaveLength(5);
  });

  it("is ineligible when the archive has no market for that game", () => {
    const ctx = tapeCtxOf(deckGame({ spread: null, total: null }), "Auburn", "Alabama");
    expect(tapeEligible(ctx)).toBe(false);
  });
});
