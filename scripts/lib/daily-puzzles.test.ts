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

/* ---- Depth Chart's generator --------------------------------------------- */

import { DC_MAX_PER_FAMILY, buildDepthChart, dcFamily, fillDisjoint } from "./daily-puzzles";
import { validateGrid, type DcCategory } from "../../src/lib/depth-chart";
import { isSpottable } from "./dc-facts";

/**
 * A synthetic fact index shaped like the real one: many overlapping categories
 * of a few kinds. The point of these tests is not that a particular grid comes
 * out, it is that the generator RELIABLY produces fair ones — an unfair board
 * is worse than no board, so the success rate is the number that matters.
 */
function syntheticFacts(count: number): { facts: DcCategory[]; kinds: Map<string, string> } {
  const kindNames = ["lost_to", "beat", "conference_in", "state", "ap_top10"];
  const facts: DcCategory[] = [];
  const kinds = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const kind = kindNames[i % kindNames.length]!;
    const id = `${kind}:${i}`;
    const members = new Set<number>();
    const size = 5 + (i % 8);
    for (let j = 0; j < size; j++) members.add((((i * 7 + j * 13) % 120) + 1));
    facts.push({ id, label: `Fact ${i}`, members, spottable: isSpottable(kind) });
    kinds.set(id, kind);
  }
  return { facts, kinds };
}

/**
 * The index as PRODUCTION actually has it — and the reason this fixture was
 * rewritten.
 *
 * The first version reproduced the 95% head-to-head *skew* but not the
 * *density*: 1,268 facts over 120 teams, with members laid out by an arithmetic
 * stride so every set overlapped every other set evenly. It passed at 100% and
 * then met the real index and generated one day out of fourteen, because real
 * facts CLUSTER — the teams that lost to Georgia in 2022 are largely the teams
 * in the SEC that year — and clustered sets collide far more often than
 * evenly-spread ones of the same size.
 *
 * So this one matches the live counts (2,306 head-to-head, 86 conference, 19
 * state, 12 AP, 1 dome, over 266 teams) and draws members from overlapping
 * CLUSTERS rather than a stride. A fixture that is easier than production is
 * worse than no fixture: it reports a number nobody should act on.
 */
function productionShapedFacts(): { facts: DcCategory[]; kinds: Map<string, string> } {
  const TEAMS = 266;
  const CLUSTERS = 18; // conference-sized pools that facts draw from
  const facts: DcCategory[] = [];
  const kinds = new Map<string, string>();
  let n = 0;

  const push = (kind: string, size: number, cluster: number, spread: number) => {
    const id = `${kind}:${n++}`;
    const members = new Set<number>();
    /* Mostly from one cluster, a little leakage — the shape a real
       "lost to X in Y" set has against a conference. */
    for (let j = 0; j < size; j++) {
      const fromCluster = j < size - spread;
      const base = fromCluster
        ? (cluster * (TEAMS / CLUSTERS) + ((j * 5 + n) % (TEAMS / CLUSTERS))) % TEAMS
        : (n * 13 + j * 29) % TEAMS;
      members.add(Math.floor(base) + 1);
    }
    facts.push({ id, label: `${kind} ${n}`, members, spottable: isSpottable(kind) });
    kinds.set(id, kind);
  };

  for (let i = 0; i < 1153; i++) push("lost_to", 4 + (i % 12), i % CLUSTERS, 1);
  for (let i = 0; i < 1153; i++) push("beat", 4 + (i % 9), (i * 7) % CLUSTERS, 1);
  for (let i = 0; i < 86; i++) push("conference_in", 4 + (i % 12), i % CLUSTERS, 0);
  for (let i = 0; i < 19; i++) push("state", 4 + (i % 9), (i * 3) % CLUSTERS, 0);
  for (let i = 0; i < 12; i++) push("ap_top10", 10, (i * 5) % CLUSTERS, 6);
  push("dome", 14, 4, 8);

  return { facts, kinds };
}

describe("fillDisjoint", () => {
  it("gives every category four members, none shared", () => {
    const chosen: DcCategory[] = [
      { id: "a", label: "a", members: new Set([1, 2, 3, 4, 5, 6]), spottable: true },
      { id: "b", label: "b", members: new Set([5, 6, 7, 8, 9]), spottable: true },
      { id: "c", label: "c", members: new Set([9, 10, 11, 12]), spottable: true },
      { id: "d", label: "d", members: new Set([13, 14, 15, 16]), spottable: true },
    ];
    const picks = fillDisjoint(chosen, "seed")!;
    expect(picks).not.toBeNull();
    expect(picks.flat()).toHaveLength(16);
    expect(new Set(picks.flat()).size).toBe(16);
    picks.forEach((p, i) => p.forEach((t) => expect(chosen[i]!.members.has(t)).toBe(true)));
  });

  /**
   * Most-constrained-first is what makes this work: category `c` has exactly
   * four members and must take them, and a greedy fill in draw order would let
   * `a` steal one and then fail.
   */
  it("lets a category with exactly four members take them", () => {
    const chosen: DcCategory[] = [
      { id: "a", label: "a", members: new Set([1, 2, 3, 4, 5, 6, 7, 8]), spottable: true },
      { id: "b", label: "b", members: new Set([5, 6, 7, 8, 9, 10, 11, 12]), spottable: true },
      { id: "c", label: "c", members: new Set([1, 2, 3, 4]), spottable: true },
      { id: "d", label: "d", members: new Set([13, 14, 15, 16]), spottable: true },
    ];
    const picks = fillDisjoint(chosen, "seed")!;
    expect(picks).not.toBeNull();
    expect([...picks[2]!].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it("returns null rather than a short group when it cannot be done", () => {
    const chosen: DcCategory[] = [
      { id: "a", label: "a", members: new Set([1, 2, 3, 4]), spottable: true },
      { id: "b", label: "b", members: new Set([1, 2, 3, 4]), spottable: true },
      { id: "c", label: "c", members: new Set([1, 2, 3, 4]), spottable: true },
      { id: "d", label: "d", members: new Set([1, 2, 3, 4]), spottable: true },
    ];
    expect(fillDisjoint(chosen, "seed")).toBeNull();
  });
});

describe("buildDepthChart", () => {
  const { facts, kinds } = syntheticFacts(220);

  it("produces a grid that passes its own validator", () => {
    const { grid } = buildDepthChart("2026-08-18", facts, kinds);
    expect(grid).not.toBeNull();
    const chosen = grid!.groups.map((g) => facts.find((f) => f.id === g.id)!);
    expect(validateGrid(grid!, chosen, facts).ok).toBe(true);
  });

  it("lays out sixteen distinct tiles", () => {
    const { grid } = buildDepthChart("2026-08-18", facts, kinds);
    expect(grid!.tiles).toHaveLength(16);
    expect(new Set(grid!.tiles).size).toBe(16);
    expect([...grid!.tiles].sort()).toEqual([...grid!.groups.flatMap((g) => g.teamIds)].sort());
  });

  it("is deterministic, so a repair run rebuilds the same board", () => {
    const a = buildDepthChart("2026-08-18", facts, kinds);
    const b = buildDepthChart("2026-08-18", facts, kinds);
    expect(a.grid!.tiles).toEqual(b.grid!.tiles);
    expect(a.grid!.groups.map((g) => g.id)).toEqual(b.grid!.groups.map((g) => g.id));
  });

  it("gives a different board on a different day", () => {
    const a = buildDepthChart("2026-08-18", facts, kinds);
    const b = buildDepthChart("2026-08-19", facts, kinds);
    expect(a.grid!.groups.map((g) => g.id)).not.toEqual(b.grid!.groups.map((g) => g.id));
  });

  /** Four "lost to X in Y" groups is one puzzle wearing four hats. */
  it("does not build a board out of one kind", () => {
    for (let d = 1; d <= 8; d++) {
      const { grid } = buildDepthChart(`2026-09-${String(d).padStart(2, "0")}`, facts, kinds);
      if (!grid) continue;
      const seen = new Map<string, number>();
      for (const g of grid.groups) {
        const k = kinds.get(g.id)!;
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      for (const n of seen.values()) expect(n).toBeLessThanOrEqual(2);
    }
  });

  /**
   * THE measurement. A generator that works most days and silently skips the
   * rest drains the queue, and the queue floor only buys warning if the rate is
   * high enough to keep it full. Measured over sixty days rather than asserted
   * from one.
   */
  it("succeeds on the overwhelming majority of days", () => {
    let ok = 0;
    const days = 60;
    for (let d = 0; d < days; d++) {
      const day = new Date(Date.UTC(2026, 8, 1) + d * 86_400_000).toISOString().slice(0, 10);
      if (buildDepthChart(day, facts, kinds).grid) ok += 1;
    }
    expect(ok / days).toBeGreaterThan(0.9);
  }, 30_000);

  it("reports why it failed, so a starving index says which knob to turn", () => {
    // Three categories only: every attempt is short, and the reject histogram
    // has to say so rather than reporting a bare failure.
    const thin = facts.slice(0, 3);
    const res = buildDepthChart("2026-08-18", thin, kinds, 5);
    expect(res.grid).toBeNull();
    expect(res.rejects.short).toBeGreaterThan(0);
  });
});

/* ---- kind diversity against the REAL index shape ------------------------- */

/**
 * The index BF-4 actually produced, in miniature: **95% head-to-head**. The
 * live counts were 1,159 `lost_to` and 1,147 `beat` against 118 of everything
 * else, and that skew broke the original diversity cap in two ways at once —
 * a board could take two `lost_to` plus two `beat` and read as four
 * restatements of the same claim, and a twelve-fact sample missed the other
 * families more than half the time.
 *
 * These fixtures reproduce the ratio rather than an even spread, because an
 * even spread is the case that already worked.
 */
const skewedFacts = productionShapedFacts;

describe("dcFamily", () => {
  /** lost_to and beat are the same claim pointed in opposite directions. */
  it("collapses the head-to-head pair", () => {
    expect(dcFamily("lost_to")).toBe(dcFamily("beat"));
  });

  it("leaves every other kind as its own family", () => {
    for (const k of ["conference_in", "state", "ap_top10", "dome"]) {
      expect(dcFamily(k)).toBe(k);
    }
  });
});

describe("buildDepthChart — against the real 95%-skewed index", () => {
  const { facts, kinds } = skewedFacts();

  it("still generates", () => {
    expect(buildDepthChart("2026-08-19", facts, kinds).grid).not.toBeNull();
  }, 15_000);

  /**
   * The regression this fix exists for: capping per KIND allowed two `lost_to`
   * plus two `beat`, which is a board of four head-to-head categories wearing
   * different hats. The family cap is what makes it impossible.
   */
  it("never builds a board of four head-to-head categories", () => {
    let boards = 0;
    for (let d = 1; d <= 10; d++) {
      const { grid } = buildDepthChart(`2026-10-${String(d).padStart(2, "0")}`, facts, kinds);
      if (!grid) continue;
      boards += 1;
      const h2h = grid.groups.filter((g) => dcFamily(kinds.get(g.id) ?? "") === "h2h").length;
      expect(h2h, "too many head-to-head groups on one board").toBeLessThanOrEqual(
        DC_MAX_PER_FAMILY,
      );
    }
    expect(boards).toBeGreaterThan(0);
  }, 15_000);

  /** Every board must reach outside the dominant family for at least two slots. */
  it("always includes at least two non-head-to-head categories", () => {
    for (let d = 1; d <= 10; d++) {
      const { grid } = buildDepthChart(`2026-11-${String(d).padStart(2, "0")}`, facts, kinds);
      if (!grid) continue;
      const other = grid.groups.filter((g) => dcFamily(kinds.get(g.id) ?? "") !== "h2h").length;
      expect(other).toBeGreaterThanOrEqual(2);
    }
  }, 15_000);

  /**
   * Drawing family-by-family instead of filtering a random sample is what keeps
   * the success rate up under this skew, and `DC_ATTEMPTS` is what finishes the
   * job — 200 attempts gave 86.7% here, 800 gives 100%. The measurements are in
   * the constant's docstring.
   *
   * Sixty days at 800 attempts is the slowest test in the suite by design: it
   * is the only thing standing between a skewed fact index and a queue that
   * quietly runs dry.
   */
  it("keeps a high success rate under the skew", () => {
    let ok = 0;
    const days = 60;
    for (let d = 0; d < days; d++) {
      const day = new Date(Date.UTC(2027, 0, 1) + d * 86_400_000).toISOString().slice(0, 10);
      if (buildDepthChart(day, facts, kinds).grid) ok += 1;
    }
    expect(ok / days).toBeGreaterThanOrEqual(0.98);
  }, 30_000);

  /**
   * The shape-of-failure test, and the one that would have caught the
   * production outage a day earlier than the queue floor did.
   *
   * A success rate alone hides *why* attempts fail. When Pass B checked every
   * stored fact, `rival_category` was **9,555 of ~11,200 rejections (85%)** and
   * the queue generated one day out of fourteen. One rejector swamping the
   * others means the generator is fighting the index rather than filtering it,
   * and it is a warning long before the success rate moves.
   *
   * `ambiguous` and `too_easy` are the rejectors that SHOULD dominate: they are
   * the fairness and quality checks doing their job.
   */
  it("does not let one rejector swamp the others", () => {
    const agg: Record<string, number> = {};
    for (let d = 0; d < 20; d++) {
      const day = new Date(Date.UTC(2027, 2, 1) + d * 86_400_000).toISOString().slice(0, 10);
      for (const [k, v] of Object.entries(buildDepthChart(day, facts, kinds).rejects)) {
        agg[k] = (agg[k] ?? 0) + v;
      }
    }
    const total = Object.values(agg).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    expect(
      (agg.rival_category ?? 0) / total,
      `rival_category is swamping the histogram: ${JSON.stringify(agg)}`,
    ).toBeLessThan(0.5);
  }, 30_000);
});
