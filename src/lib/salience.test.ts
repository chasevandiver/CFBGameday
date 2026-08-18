import { describe, expect, it } from "vitest";
import {
  SALIENCE,
  rankBySalience,
  rankQuality,
  salienceScore,
  type SalienceGame,
} from "./salience";
import { pollRanksByWeek, pollWeeks } from "./rankings";
import { pairKey } from "./salience-data";

/**
 * The weights are a judgement, not a fit — there is no training signal for
 * "memorable". So these tests pin PROPERTIES, not numbers: total-nullability,
 * monotonicity per term, and a hand-ordered golden set. A test that asserted
 * `salienceScore(x) === 43.2` would fail on every tuning pass and prove
 * nothing about whether the ranking is right.
 */

const g = (over: Partial<SalienceGame> = {}): SalienceGame => ({
  homePoints: 24,
  awayPoints: 17,
  homeRank: null,
  awayRank: null,
  spread: null,
  isRivalry: false,
  trophy: null,
  seasonType: "regular",
  notes: null,
  neutralSite: false,
  ...over,
});

describe("rankQuality", () => {
  it("floors an unranked team at the baseline", () => {
    expect(rankQuality(null)).toBe(2);
    expect(rankQuality(26)).toBe(2);
  });

  it("never scores a ranked team below unranked", () => {
    // marqueeScore's raw curve gives #25 → 0.7, which would let two unranked
    // teams outscore a #25. The floor is the fix and it has to stay.
    for (let r = 1; r <= 25; r++) expect(rankQuality(r)).toBeGreaterThanOrEqual(2);
  });

  it("rates a better rank higher", () => {
    expect(rankQuality(1)).toBeGreaterThan(rankQuality(10));
    expect(rankQuality(10)).toBeGreaterThan(rankQuality(24));
  });
});

describe("salienceScore — totality", () => {
  /**
   * The archive is full of games with no line and no poll. A NaN here makes
   * Array.sort order-dependent garbage and corrupts the deck ranking with no
   * error anywhere — the worst failure shape this module has.
   */
  it("is finite and non-negative with every optional input missing", () => {
    const s = salienceScore(g());
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
  });

  it("is finite on a blowout, a tie and a shutout", () => {
    for (const game of [
      g({ homePoints: 84, awayPoints: 0 }),
      g({ homePoints: 21, awayPoints: 21 }),
      g({ homePoints: 0, awayPoints: 0 }),
    ]) {
      expect(Number.isFinite(salienceScore(game))).toBe(true);
      expect(salienceScore(game)).toBeGreaterThanOrEqual(0);
    }
  });

  it("never reads a null spread as a pick'em", () => {
    // A null spread must contribute nothing. Treating it as 0 would make every
    // lineless game look like an upset the moment anybody won it.
    const noLine = salienceScore(g({ spread: null, homePoints: 30, awayPoints: 3 }));
    const pickEm = salienceScore(g({ spread: 0, homePoints: 30, awayPoints: 3 }));
    expect(noLine).toBe(pickEm); // a pick'em has no dog either — both add zero
  });
});

describe("salienceScore — monotone per term", () => {
  const cases: Array<[string, Partial<SalienceGame>]> = [
    ["rivalry", { isRivalry: true }],
    ["trophy on a rivalry", { isRivalry: true, trophy: "Floyd of Rosedale" }],
    ["postseason", { seasonType: "postseason" }],
    ["a named bowl", { seasonType: "postseason", notes: "Rose Bowl" }],
    ["neutral site", { neutralSite: true }],
    ["a ranked home team", { homeRank: 8 }],
    ["both ranked", { homeRank: 8, awayRank: 3 }],
  ];

  for (const [label, over] of cases) {
    it(`adding ${label} never lowers the score`, () => {
      expect(salienceScore(g(over))).toBeGreaterThanOrEqual(salienceScore(g()));
    });
  }

  it("rates a closer finish higher", () => {
    const oneScore = salienceScore(g({ homePoints: 24, awayPoints: 23 }));
    const twoScore = salienceScore(g({ homePoints: 24, awayPoints: 10 }));
    expect(oneScore).toBeGreaterThan(twoScore);
  });

  it("rates a bigger upset higher, and pays a premium past double digits", () => {
    const small = salienceScore(g({ spread: 3, homePoints: 21, awayPoints: 17 }));
    const medium = salienceScore(g({ spread: 9, homePoints: 21, awayPoints: 17 }));
    const big = salienceScore(g({ spread: 21, homePoints: 21, awayPoints: 17 }));
    expect(medium).toBeGreaterThan(small);
    expect(big).toBeGreaterThan(medium + SALIENCE.bigDog - 1);
  });

  it("pays nothing when the favourite held serve", () => {
    const chalk = salienceScore(g({ spread: -21, homePoints: 45, awayPoints: 10 }));
    const upset = salienceScore(g({ spread: 21, homePoints: 45, awayPoints: 10 }));
    expect(upset).toBeGreaterThan(chalk);
  });

  it("reads the dog correctly from either side of the line", () => {
    // home +14 winning, and away +14 winning, are the same event mirrored.
    const homeDogWins = salienceScore(g({ spread: 14, homePoints: 28, awayPoints: 24 }));
    const awayDogWins = salienceScore(g({ spread: -14, homePoints: 24, awayPoints: 28 }));
    expect(homeDogWins).toBeCloseTo(awayDogWins, 6);
  });

  it("counts a ranked team losing from either side", () => {
    const homeRankedLost = salienceScore(g({ homeRank: 4, homePoints: 17, awayPoints: 24 }));
    const homeRankedWon = salienceScore(g({ homeRank: 4, homePoints: 24, awayPoints: 17 }));
    expect(homeRankedLost).toBeGreaterThan(homeRankedWon);
  });

  it("caps the shootout term so a track meet cannot dominate", () => {
    const big = salienceScore(g({ homePoints: 70, awayPoints: 63 }));
    const absurd = salienceScore(g({ homePoints: 140, awayPoints: 133 }));
    expect(absurd - big).toBeLessThanOrEqual(SALIENCE.shootoutCap);
  });
});

/**
 * The golden set. This is the only test that catches weights which are
 * individually sensible and collectively wrong, which is the failure the
 * owner's complaint is actually about — every term above can pass while the
 * deck still leads with a Sun Belt buy game.
 *
 * Real games, hand-ordered. Assert the CHAIN, not the values.
 */
describe("salienceScore — the golden ordering", () => {
  const ironBowl2013 = g({
    // Auburn 34 Alabama 28, Kick Six. #4 beats #1 on the last play.
    homePoints: 34,
    awayPoints: 28,
    homeRank: 4,
    awayRank: 1,
    spread: 10.5,
    isRivalry: true,
    trophy: "Iron Bowl",
  });
  const rankedNeutralBlowout = g({
    // A top-ten meeting that was over by halftime, at a neutral site.
    homePoints: 45,
    awayPoints: 10,
    homeRank: 3,
    awayRank: 9,
    spread: -7,
    neutralSite: true,
  });
  const trophyGameNobodyRanked = g({
    homePoints: 20,
    awayPoints: 17,
    isRivalry: true,
    trophy: "Floyd of Rosedale",
    spread: -3,
  });
  const septemberBuyGame = g({
    homePoints: 52,
    awayPoints: 10,
    spread: -31.5,
  });

  it("puts the game everyone remembers first and the buy game last", () => {
    const scores = [
      ["Iron Bowl 2013", salienceScore(ironBowl2013)],
      ["ranked neutral blowout", salienceScore(rankedNeutralBlowout)],
      ["trophy game, nobody ranked", salienceScore(trophyGameNobodyRanked)],
      ["September buy game", salienceScore(septemberBuyGame)],
    ] as const;

    for (let i = 1; i < scores.length; i++) {
      expect(
        scores[i - 1]![1],
        `${scores[i - 1]![0]} should outrank ${scores[i]![0]}`,
      ).toBeGreaterThan(scores[i]![1]);
    }
  });

  it("beats a forgettable game by a wide margin, not a hair", () => {
    // If the gap is small the ranking is noise: a deck sorted on it would still
    // surface buy games in the top tranche.
    expect(salienceScore(ironBowl2013)).toBeGreaterThan(salienceScore(septemberBuyGame) * 3);
  });
});

describe("rankBySalience", () => {
  it("sorts best first", () => {
    const deck = [
      { id: 1, salience: g({ homePoints: 52, awayPoints: 3 }) },
      { id: 2, salience: g({ homeRank: 1, awayRank: 2, homePoints: 24, awayPoints: 23 }) },
    ];
    expect(rankBySalience(deck).map((d) => d.id)).toEqual([2, 1]);
  });

  /**
   * A total order is load-bearing, not tidy: all three games pick content by
   * rendezvous hash over this deck, so an order that depended on the query's
   * row order would hand different players different puzzles.
   */
  it("breaks ties on id so the order is total and deterministic", () => {
    const same = g();
    const deck = [
      { id: 9, salience: same },
      { id: 2, salience: same },
      { id: 5, salience: same },
    ];
    expect(rankBySalience(deck).map((d) => d.id)).toEqual([2, 5, 9]);
    expect(rankBySalience([...deck].reverse()).map((d) => d.id)).toEqual([2, 5, 9]);
  });

  it("does not mutate its input", () => {
    const deck = [
      { id: 1, salience: g({ homePoints: 52, awayPoints: 3 }) },
      { id: 2, salience: g({ homeRank: 1, awayRank: 2 }) },
    ];
    rankBySalience(deck);
    expect(deck.map((d) => d.id)).toEqual([1, 2]);
  });
});

/* ---- the per-week rank helpers, which salience depends on --------------- */

describe("pollRanksByWeek", () => {
  const row = (over: Partial<{ season_id: number; week: number; poll: string; team_id: number; rank: number }> = {}) => ({
    season_id: 2019,
    week: 8,
    poll: "AP Top 25",
    team_id: 1,
    rank: 3,
    ...over,
  });

  it("keys ranks by the week they were published in", () => {
    const m = pollRanksByWeek([row({ week: 8, rank: 3 }), row({ week: 12, rank: 1 })]);
    expect(m.get("2019:8:1")).toBe(3);
    expect(m.get("2019:12:1")).toBe(1);
  });

  /**
   * The whole reason this exists next to `pickPollRanks`: a historical puzzle
   * asks "were they ranked THAT week", and answering with the latest poll would
   * call a team ranked because of how its season finished.
   */
  it("does not let a later week answer for an earlier one", () => {
    const m = pollRanksByWeek([row({ week: 12, rank: 1 })]);
    expect(m.get("2019:8:1")).toBeUndefined();
  });

  it("resolves the poll per week, so the committee can start mid-season", () => {
    const m = pollRanksByWeek([
      row({ week: 8, poll: "AP Top 25", rank: 5 }),
      row({ week: 8, poll: "Coaches Poll", rank: 7 }),
      row({ week: 12, poll: "AP Top 25", rank: 5 }),
      row({ week: 12, poll: "Playoff Committee Rankings", rank: 9 }),
    ]);
    expect(m.get("2019:8:1")).toBe(5); // AP beats Coaches
    expect(m.get("2019:12:1")).toBe(9); // committee beats AP, once it exists
  });

  it("keeps seasons apart", () => {
    const m = pollRanksByWeek([row({ season_id: 2019, rank: 3 }), row({ season_id: 2021, rank: 20 })]);
    expect(m.get("2019:8:1")).toBe(3);
    expect(m.get("2021:8:1")).toBe(20);
  });
});

describe("pollWeeks", () => {
  /**
   * "This team has no rank" and "nobody was ranked this week" are different
   * facts that look identical in a lookup returning undefined — and only the
   * first one means unranked. Week 0 and any season we never backfilled have
   * no poll at all, so answering "was this team ranked?" with "no" there would
   * be a lie rather than a clue.
   */
  it("says which season-weeks published a poll at all", () => {
    const weeks = pollWeeks([
      { season_id: 2019, week: 8 },
      { season_id: 2019, week: 8 },
      { season_id: 2019, week: 9 },
    ]);
    expect(weeks.has("2019:8")).toBe(true);
    expect(weeks.has("2019:9")).toBe(true);
    expect(weeks.has("2019:0")).toBe(false);
  });
});

describe("pairKey", () => {
  it("matches whichever side hosted", () => {
    expect(pairKey(10, 20)).toBe(pairKey(20, 10));
  });
});
