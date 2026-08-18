import { describe, expect, it } from "vitest";
import {
  QUEUE_FLOOR,
  buildChains,
  cardValue,
  queueDays,
  queueVerdict,
  seededOrder,
  tapeCtxOf,
} from "./daily-puzzles";
import { cardGap, chainsWinner } from "../../src/lib/chains";
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

/* ---- Chains's deck builder ---------------------------------------------- */

describe("seededOrder", () => {
  it("is deterministic for a seed, so a repair run rebuilds the same deck", () => {
    expect(seededOrder(20, "2026-08-18")).toEqual(seededOrder(20, "2026-08-18"));
  });

  it("differs between days", () => {
    expect(seededOrder(20, "2026-08-18")).not.toEqual(seededOrder(20, "2026-08-19"));
  });

  it("is a permutation, losing and duplicating nothing", () => {
    const order = seededOrder(50, "2026-08-18");
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });
});

describe("cardValue", () => {
  const g = (over: Partial<DeckGame> = {}) =>
    ({
      id: 1,
      seasonId: 2019,
      week: 5,
      seasonType: "regular",
      startTs: null,
      homeTeamId: 1,
      awayTeamId: 2,
      homePoints: 45,
      awayPoints: 17,
      homeConference: null,
      awayConference: null,
      neutralSite: false,
      conferenceGame: true,
      venueId: null,
      notes: null,
      spread: -13.5,
      total: 55.5,
      pollPublished: true,
      homeRank: null,
      awayRank: null,
      salience: {} as DeckGame["salience"],
      ...over,
    }) as DeckGame;

  it("reads the three game-level comparands", () => {
    expect(cardValue("total_points", g())).toBe(62);
    expect(cardValue("margin", g())).toBe(28);
    expect(cardValue("spread", g())).toBe(13.5);
  });

  it("uses the absolute spread, so either side's favourite compares", () => {
    expect(cardValue("spread", g({ spread: 13.5 }))).toBe(13.5);
  });

  it("returns null rather than zero when the archive has no line", () => {
    // Zero would read as a pick'em and mint a card comparing a real favourite
    // against a fictional one.
    expect(cardValue("spread", g({ spread: null }))).toBeNull();
  });
});

describe("buildChains", () => {
  const pool: DeckGame[] = Array.from({ length: 60 }, (_, i) =>
    ({
      id: i + 1,
      seasonId: 2015 + (i % 10),
      week: (i % 13) + 1,
      seasonType: "regular",
      startTs: null,
      homeTeamId: 1,
      awayTeamId: 2,
      homePoints: 10 + ((i * 7) % 50),
      awayPoints: 3 + ((i * 11) % 40),
      homeConference: null,
      awayConference: null,
      neutralSite: false,
      conferenceGame: true,
      venueId: null,
      notes: null,
      spread: ((i * 3) % 27) - 13,
      total: 50,
      pollPublished: true,
      homeRank: null,
      awayRank: null,
      salience: {} as DeckGame["salience"],
    }) as DeckGame,
  );
  const schools = new Map([
    [1, "Georgia"],
    [2, "Auburn"],
  ]);

  it("builds a full deck", () => {
    expect(buildChains("2026-08-18", pool, schools, 12)).toHaveLength(12);
  });

  it("is deterministic, so everyone gets the same run", () => {
    const a = buildChains("2026-08-18", pool, schools, 12);
    const b = buildChains("2026-08-18", pool, schools, 12);
    expect(a.map((c) => `${c.kind}:${c.leftValue}:${c.rightValue}`)).toEqual(
      b.map((c) => `${c.kind}:${c.leftValue}:${c.rightValue}`),
    );
  });

  it("gives a different run on a different day", () => {
    const a = buildChains("2026-08-18", pool, schools, 12);
    const b = buildChains("2026-08-19", pool, schools, 12);
    expect(a.map((c) => c.leftValue)).not.toEqual(b.map((c) => c.leftValue));
  });

  /** The property that turns run length from a coin flip into a ladder. */
  it("orders easiest first", () => {
    const deck = buildChains("2026-08-18", pool, schools, 12);
    const gaps = deck.map(cardGap);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i - 1]!).toBeGreaterThanOrEqual(gaps[i]!);
  });

  /** A run has nowhere to put a void, so a tie is never minted. */
  it("never mints a card with equal values", () => {
    for (const c of buildChains("2026-08-18", pool, schools, 12)) {
      expect(c.leftValue).not.toBe(c.rightValue);
    }
  });

  it("mixes the kinds rather than shipping twelve of one", () => {
    const kinds = new Set(buildChains("2026-08-18", pool, schools, 12).map((c) => c.kind));
    expect(kinds.size).toBeGreaterThan(1);
  });

  it("answers every card correctly", () => {
    for (const c of buildChains("2026-08-18", pool, schools, 12)) {
      expect(c.answer).toBe(chainsWinner(c.kind, c.leftValue, c.rightValue));
    }
  });
});
