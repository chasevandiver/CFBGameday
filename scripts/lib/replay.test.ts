import { describe, expect, it } from "vitest";
import type { CfbdGame } from "../../src/lib/cfbd";
import { DEFAULT_PARAMS } from "../../src/model/ratings";
import { MAX_TILT, chainTilts, replaySeason, scaleTilts, type SeasonData } from "./replay";

const game = (
  id: number,
  week: number,
  homeId: number,
  awayId: number,
  homePoints: number,
  awayPoints: number,
): CfbdGame =>
  ({
    id,
    season: 2024,
    week,
    seasonType: "regular",
    startDate: `2024-09-0${week}T16:00:00.000Z`,
    startTimeTBD: false,
    neutralSite: false,
    conferenceGame: true,
    venueId: null,
    homeId,
    homeTeam: `T${homeId}`,
    homePoints,
    homePostgameWinProbability: null,
    awayId,
    awayTeam: `T${awayId}`,
    awayPoints,
    completed: true,
    notes: null,
  }) as CfbdGame;

const season: SeasonData = {
  season: 2024,
  games: [
    game(1, 1, 10, 20, 31, 17),
    game(2, 1, 30, 40, 21, 24),
    game(3, 2, 10, 30, 28, 27),
    game(4, 2, 20, 40, 14, 35),
    game(5, 3, 40, 10, 20, 23),
    game(6, 3, 30, 20, 45, 10),
  ],
  lines: [],
  prevSp: [],
};

const priors = new Map([
  [10, 12],
  [20, -4],
  [30, 6],
  [40, 0],
]);

describe("replaySeason tilt invariance", () => {
  // The preseason-tilt experiment rests on tilts moving totals without moving
  // margins (off+def ≡ overall). That holds EXACTLY where it matters most —
  // week 1, priced straight off the priors — and holds to second order after
  // that; see the cap-binding caveat below.
  const flat = replaySeason(season, priors, DEFAULT_PARAMS);
  const tiltMap = new Map([
    // Chosen so the two week-1 matchups have DIFFERENT tilt sums: a game's
    // total moves by 2×(homeTilt + awayTilt), so equal sums would coincide by
    // arithmetic and hide the effect this test is checking for.
    [10, 4],
    [20, -3],
    [30, 2],
    [40, 3],
  ]);
  const tilted = replaySeason(season, priors, DEFAULT_PARAMS, tiltMap);
  const wk1 = (r: typeof flat) => r.predictions.filter((p) => p.week === 1);

  it("leaves week-1 margins and win probabilities bit-identical", () => {
    const a = wk1(flat);
    const b = wk1(tilted);
    expect(b).toHaveLength(a.length);
    for (let i = 0; i < a.length; i++) {
      expect(b[i].margin).toBe(a[i].margin);
      expect(b[i].homeWinProb).toBe(a[i].homeWinProb);
    }
  });

  it("keeps final overall ratings within the cap-binding tolerance", () => {
    // Not exact — see the cap-binding caveat below — and per-team drift
    // accumulates across the season, so it exceeds the per-game margin drift.
    // This fixture deliberately stresses the clamp (a 45–10 blowout and tilts
    // near half of MAX_TILT inside a six-game season), so half a point is an
    // upper bound, not a typical figure.
    for (const [teamId, rating] of flat.finalRatings) {
      expect(Math.abs((tilted.finalRatings.get(teamId) as number) - rating)).toBeLessThan(0.5);
    }
  });

  it("but DOES move projected totals off the flat constant", () => {
    // Week 1 only: that is the window where ratings ARE the preseason prior,
    // so even halves make every game price the identical total (the bug the
    // splitInformative gate hides). From week 2 on, results differentiate the
    // halves on their own and totals vary even with no seeded tilt.
    const week1 = (r: typeof flat) =>
      new Set(
        r.predictions.filter((p) => p.week === 1).map((p) => p.projectedTotal.toFixed(6)),
      );
    expect(week1(flat).size).toBe(1);
    expect([...week1(flat)][0]).toBe((57).toFixed(6));
    expect(week1(tilted).size).toBeGreaterThan(1);
  });
});

describe("the cap-binding caveat on tilt invariance", () => {
  // updateSubRatings clamps each SIDE's scoring error at ±marginCap/2. A tilt
  // shifts the two per-side expectations in opposite directions without moving
  // their difference, so it can push one side across the clamp when the flat
  // split wasn't — and a clamp that binds on one arm but not the other leaves
  // a margin error the two runs no longer share.
  //
  // The effect is second-order and grows with tilt size, which is why MAX_TILT
  // exists and why the tuner compares margin MAE across policies rather than
  // assuming they are identical.
  const drift = (scale: number) => {
    const tilted = replaySeason(
      season,
      priors,
      DEFAULT_PARAMS,
      new Map([
        [10, 4 * scale],
        [20, -3 * scale],
        [30, 2 * scale],
        [40, 3 * scale],
      ]),
    );
    const flat = replaySeason(season, priors, DEFAULT_PARAMS);
    return Math.max(
      ...flat.predictions.map((p, i) => Math.abs(p.margin - tilted.predictions[i].margin)),
    );
  };

  it("is exactly zero while the clamps stay slack", () => {
    // Machine epsilon, not exact equality: the arithmetic reorders slightly
    // with different HFA values and lands at ~1e-15. Anything under 1e-9 is
    // "the clamps never bound", which is the actual claim.
    expect(drift(0.25)).toBeLessThan(1e-9);
  });

  it("grows monotonically with tilt magnitude once clamps bind", () => {
    expect(drift(1)).toBeGreaterThan(drift(0.5));
    expect(drift(2)).toBeGreaterThan(drift(1));
  });

  it("stays small enough that policy comparison remains meaningful", () => {
    // a full-size tilt perturbs any single margin by well under a point
    expect(drift(1)).toBeLessThan(0.5);
  });
});

describe("tilt chaining helpers", () => {
  it("regresses carried shape by lambda", () => {
    const chained = chainTilts(new Map([[1, 4]]), 0.7);
    expect(chained.get(1)).toBeCloseTo(2.8, 10);
  });

  it("clamps runaway tilts in both directions", () => {
    expect(chainTilts(new Map([[1, 100]]), 1).get(1)).toBe(MAX_TILT);
    expect(scaleTilts(new Map([[1, -100]]), 1).get(1)).toBe(-MAX_TILT);
  });

  it("lambda 0 erases shape entirely (back to an even split)", () => {
    expect(chainTilts(new Map([[1, 6]]), 0).get(1)).toBe(0);
  });
});

describe("lookahead guard (audit 02/M-06)", () => {
  // The one property the whole backtest rests on: week-N predictions may not
  // see week-N results. Statically the loops are ordered correctly, but no
  // test would catch a refactor that applies results before predicting — the
  // suite passed identically under simulated contamination. This is the net:
  // perturb week 2's scores wildly; every week-1 AND week-2 prediction must
  // be identical, because neither may consume week-2 results. Week 3 SHOULD
  // move (it legitimately learns from week 2) — asserted too, so the test
  // can't pass vacuously.
  it("perturbing week-N scores leaves week ≤ N predictions unchanged", () => {
    const base = replaySeason(season, priors, DEFAULT_PARAMS).predictions;
    const perturbed: SeasonData = {
      ...season,
      games: season.games.map((g) =>
        g.week === 2 ? { ...g, homePoints: (g.homePoints ?? 0) + 40 } : g,
      ),
    };
    const alt = replaySeason(perturbed, priors, DEFAULT_PARAMS).predictions;
    const byId = new Map(alt.map((p) => [p.gameId, p]));
    for (const p of base.filter((p) => p.week <= 2)) {
      expect(byId.get(p.gameId)?.margin).toBe(p.margin);
    }
    const wk3base = base.filter((p) => p.week === 3);
    expect(wk3base.some((p) => byId.get(p.gameId)?.margin !== p.margin)).toBe(true);
  });
});

describe("FCS bucket identity (P1-2 / Q4)", () => {
  // Team 50 has no prior, so it is priced as an FCS opponent. Two games so it
  // shows up in both a week-1 pricing (straight off the priors) and a later
  // one (after the Elo has moved), which are different code paths through
  // `blended`.
  const withFcs: SeasonData = {
    ...season,
    games: [...season.games, game(7, 1, 10, 50, 52, 3), game(8, 3, 50, 20, 7, 41)],
  };

  /**
   * The guarantee that makes it safe to land the two-bucket machinery sixteen
   * days before kickoff without a tuner run behind it.
   *
   * `fcsTopRating` and `fcsOtherRating` both ship at −30, so `fcsRatingOf`
   * returns the same number whichever bucket a team is in — which means bucket
   * membership is not merely inert, it is *unobservable*. A wrong bucket
   * assignment cannot move a prediction. Asserted with `toBe`, not
   * `toBeCloseTo`: this is bit-identity or it is nothing.
   */
  it("classifying a team changes no number while both buckets are equal", () => {
    expect(DEFAULT_PARAMS.fcsTopRating).toBe(DEFAULT_PARAMS.fcsOtherRating);

    const flat = replaySeason(withFcs, priors, DEFAULT_PARAMS);
    const bucketed = replaySeason(withFcs, priors, DEFAULT_PARAMS, undefined, new Set([50]));

    expect(bucketed.predictions.length).toBe(flat.predictions.length);
    const byId = new Map(bucketed.predictions.map((p) => [p.gameId, p]));
    for (const p of flat.predictions) {
      const q = byId.get(p.gameId)!;
      expect(q.margin).toBe(p.margin);
      expect(q.homeWinProb).toBe(p.homeWinProb);
      expect(q.projectedTotal).toBe(p.projectedTotal);
      expect(q.favWinProb).toBe(p.favWinProb);
    }
    for (const [id, r] of flat.finalRatings) {
      expect(bucketed.finalRatings.get(id)).toBe(r);
    }
  });

  /**
   * And the negative control, so the test above cannot pass vacuously: with the
   * buckets genuinely separated the same classification DOES move the numbers.
   * If this ever fails, `fcsTop` is not reaching the pricing path and the
   * identity assertion above is proving nothing.
   */
  it("but does change them once the buckets differ", () => {
    const split = { ...DEFAULT_PARAMS, fcsTopRating: -20, fcsOtherRating: -40 };
    const asOther = replaySeason(withFcs, priors, split).predictions;
    const asTop = replaySeason(withFcs, priors, split, undefined, new Set([50])).predictions;
    const byId = new Map(asTop.map((p) => [p.gameId, p]));
    expect(asOther.some((p) => byId.get(p.gameId)?.margin !== p.margin)).toBe(true);
  });
});
