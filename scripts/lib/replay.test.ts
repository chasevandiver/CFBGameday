import { rm, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CfbdGame } from "../../src/lib/cfbd";
import { DEFAULT_PARAMS } from "../../src/model/ratings";
import {
  CACHE_DIR,
  MAX_TILT,
  cached,
  chainTilts,
  hfaSplitHalf,
  replaySeason,
  scaleTilts,
  type SeasonData,
} from "./replay";

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

describe("cached", () => {
  const names: string[] = [];
  const tmp = (n: string) => {
    const name = `zz-test-${n}-${process.pid}`;
    names.push(name);
    return name;
  };
  const fileFor = (name: string) => path.join(CACHE_DIR, `${name}.json`);
  const exists = async (name: string) =>
    readFile(fileFor(name), "utf8").then(
      () => true,
      () => false,
    );

  afterEach(async () => {
    await Promise.all(names.splice(0).map((n) => rm(fileFor(n), { force: true })));
  });

  it("does not persist an empty response (04:DQ-15)", async () => {
    // CFBD answers 200 with [] for a season it has not published yet, and
    // cfbd.ts only throws on !res.ok. Writing that pins the absence: every
    // later run reads the file, skips the fetch, and gets [] again long after
    // the real data landed.
    const name = tmp("empty");
    await expect(cached(name, async () => [], false)).resolves.toEqual([]);
    expect(await exists(name)).toBe(false);
  });

  it("still persists a response that has rows", async () => {
    const name = tmp("full");
    await expect(cached(name, async () => [{ id: 1 }], false)).resolves.toEqual([{ id: 1 }]);
    expect(await exists(name)).toBe(true);
  });

  it("persists a non-array payload, empty or not — only lists are judged", async () => {
    // The emptiness test is Array-shaped on purpose. An object response has no
    // length to reason about, and guessing at one would be the kind of clever
    // that silently drops a legitimately empty record.
    const name = tmp("object");
    await expect(cached(name, async () => ({}), false)).resolves.toEqual({});
    expect(await exists(name)).toBe(true);
  });

  it("reads the cache back rather than refetching when told to", async () => {
    const name = tmp("roundtrip");
    await cached(name, async () => [{ id: 7 }], false);
    let called = false;
    const again = await cached(
      name,
      async () => {
        called = true;
        return [{ id: 99 }];
      },
      true,
    );
    expect(again).toEqual([{ id: 7 }]);
    expect(called).toBe(false);
  });
});

describe("FBS membership across a wide window (admitNewFbs)", () => {
  // The defect: `priors` is seeded once and `chainPriors` carries exactly the
  // key set it was given, so a team promoted to FBS mid-window is priced at the
  // flat FCS anchor for the rest of the decade with no error anywhere.
  it("admits a team that appears in this season's SP+ but not in the priors", () => {
    const promoted = 50;
    const sp = [
      { team: "T10", rating: 12 },
      { team: "T50", rating: -4 },
    ] as unknown as SeasonData["sp"];
    const withNewcomer: SeasonData = {
      ...season,
      sp,
      games: [...season.games, game(7, 1, 10, promoted, 30, 20)],
    };

    const before = replaySeason(season, priors, DEFAULT_PARAMS);
    expect(before.admitted).toEqual([]);
    expect(before.finalRatings.has(promoted)).toBe(false);

    const after = replaySeason(withNewcomer, priors, DEFAULT_PARAMS);
    expect(after.admitted).toEqual([promoted]);
    // Admitted at its SP+ rating, and carried into the chain rather than being
    // re-priced as an FCS opponent next season.
    expect(after.finalRatings.has(promoted)).toBe(true);
  });

  it("is identity when the caller did not load SP+ for the season", () => {
    // `withSp` is opt-in, so every pre-existing call site keeps its behaviour.
    const withoutSp = replaySeason(season, priors, DEFAULT_PARAMS);
    const withEmptySp = replaySeason({ ...season, sp: [] }, priors, DEFAULT_PARAMS);
    expect(withEmptySp.predictions).toEqual(withoutSp.predictions);
    expect(withEmptySp.admitted).toEqual([]);
    expect(withEmptySp.retired).toEqual([]);
  });

  it("does not retire anybody on a thin SP+ feed", () => {
    // A single missing SP+ row is ambiguous between "left FBS" and "CFBD is
    // short that year". The ambiguity is only real when the feed is thin, so
    // retirement is gated on feed health and fails toward keeping the team.
    const thin = [{ team: "T10", rating: 12 }] as unknown as SeasonData["sp"];
    const out = replaySeason({ ...season, sp: thin }, priors, DEFAULT_PARAMS);
    expect(out.retired).toEqual([]);
    expect(out.finalRatings.has(20)).toBe(true);
  });
});

describe("per-team HFA in the replay (02:M-05 / 03:M-1v)", () => {
  it("prices at flat baseHfa when no per-team map is passed", () => {
    // Identity: this is what every replay did before 2026-08-18, and it is why
    // audit 03:M-1 was invisible to the backtest — production priced with a
    // per-team table and the replay priced with a scalar.
    const flat = replaySeason(season, priors, DEFAULT_PARAMS);
    const alsoFlat = replaySeason(season, priors, DEFAULT_PARAMS, undefined, undefined, undefined);
    expect(alsoFlat.predictions).toEqual(flat.predictions);
  });

  it("shifts a home team's priced margin by exactly its HFA difference", () => {
    const flat = replaySeason(season, priors, DEFAULT_PARAMS);
    const hfa = new Map([[10, DEFAULT_PARAMS.baseHfa + 2]]);
    const withTeamHfa = replaySeason(season, priors, DEFAULT_PARAMS, undefined, undefined, hfa);

    const week1Flat = flat.predictions.find((p) => p.gameId === 1);
    const week1Team = withTeamHfa.predictions.find((p) => p.gameId === 1);
    expect(week1Team!.margin - week1Flat!.margin).toBeCloseTo(2, 6);

    // A game team 10 does not host is untouched.
    const awayFlat = flat.predictions.find((p) => p.gameId === 2);
    const awayTeam = withTeamHfa.predictions.find((p) => p.gameId === 2);
    expect(awayTeam!.margin).toBeCloseTo(awayFlat!.margin, 6);
  });
});

describe("the PPA index is not built when nothing reads it", () => {
  it("produces identical predictions with and without advanced stats at epaWeight 0", () => {
    // Proof that the fetch is skippable: at the shipped epaWeight of 0,
    // `blendedPoints` returns the raw score before touching PPA, so building a
    // Map over ~10k rows once per season per grid point buys nothing.
    const withAdvanced = replaySeason(
      { ...season, advanced: [] as never },
      priors,
      DEFAULT_PARAMS,
    );
    const without = replaySeason(season, priors, DEFAULT_PARAMS);
    expect(withAdvanced.predictions).toEqual(without.predictions);
    expect(DEFAULT_PARAMS.epaWeight).toBe(0);
  });
});

describe("a PPA blend without a PPA feed is refused, not degraded", () => {
  it("throws rather than silently scoring the raw margin", () => {
    // blendedPoints falls back to the raw score whenever the efficiency margin
    // is null, so this would otherwise produce a plausible score-only number
    // labelled as an efficiency fit.
    expect(() =>
      replaySeason(season, priors, { ...DEFAULT_PARAMS, epaWeight: 0.3 }),
    ).toThrow(/withAdvanced/);
  });

  it("is silent at epaWeight 0, which is what ships", () => {
    expect(() => replaySeason(season, priors, DEFAULT_PARAMS)).not.toThrow();
  });
});

describe("hfaSplitHalf distinguishes no-signal from no-data", () => {
  const g = (id: number, season: number, homeId: number, awayId: number, hp: number, ap: number) =>
    ({
      id,
      season,
      week: 1,
      seasonType: "regular",
      startDate: `${season}-09-01T16:00:00.000Z`,
      startTimeTBD: false,
      neutralSite: false,
      conferenceGame: true,
      venueId: null,
      homeId,
      homeTeam: `T${homeId}`,
      homePoints: hp,
      homePostgameWinProbability: null,
      awayId,
      awayTeam: `T${awayId}`,
      awayPoints: ap,
      completed: true,
      notes: null,
    }) as CfbdGame;

  const seasonWith = (year: number): SeasonData => ({
    season: year,
    games: [g(year * 10 + 1, year, 10, 20, 30, 20), g(year * 10 + 2, year, 20, 10, 24, 21)],
    lines: [],
    prevSp: [],
  });

  it("returns n = 0 when only one prior season exists, rather than a correlation", () => {
    // One prior year splits into odd-and-nothing, so there is no second half to
    // correlate against. The caller must read this as "cannot be evaluated",
    // never as "the correlation is zero" — an absent measurement reported as
    // evidence of absence is how a window problem becomes a model result.
    const out = hfaSplitHalf([seasonWith(2015)], new Set([10, 20]), 2016);
    expect(out.n).toBe(0);
    expect(Number.isNaN(out.r)).toBe(true);
  });

  it("excludes 2020 from both halves", () => {
    const seasons = [2015, 2016, 2020].map(seasonWith);
    const withCovid = hfaSplitHalf(seasons, new Set([10, 20]), 2021);
    const withoutCovid = hfaSplitHalf(
      seasons.filter((s) => s.season !== 2020),
      new Set([10, 20]),
      2021,
    );
    // An empty-stadium season measures a different quantity, so including it
    // must change nothing.
    expect(withCovid.n).toBe(withoutCovid.n);
  });
});
