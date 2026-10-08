/**
 * The prior-decay family `--tune-decay` searches (docs/SPEC.md §2.2).
 *
 * `priorDecayKnots` is the one schedule in DEFAULT_PARAMS no tuner has ever
 * touched — its provenance in the changelog is "Spec §2.2", a hand-written
 * 100% → 50% → 15% → 5% curve. Fitting its four knots freely would be a
 * three-weight grid over a likelihood this repo has already watched go flat,
 * so the search is over ONE number: the speed the spec's own curve runs at.
 *
 *   w_s(week) = w_spec(week × s)
 *
 * which is the same piecewise-linear shape with every knot's week divided by
 * `s`. s = 1 is the shipped schedule exactly (identity); s = 1.5 means week 4
 * carries the weight week 6 carries today (0.5 → 0.325); s = 0.8 slows it so
 * week 5 carries what week 4 does now. The weights at the knots, including
 * the 0.05 floor, are not searched — only when they are reached.
 *
 * Shipping a winner means writing the scaled knots into DEFAULT_PARAMS, which
 * `priorWeight` already reads; no new parameter, no new code path.
 */
export type DecayKnots = Array<[week: number, weight: number]>;

export function scaleDecayKnots(knots: DecayKnots, speed: number): DecayKnots {
  if (!(speed > 0)) throw new Error(`decay speed must be positive, got ${speed}`);
  return knots.map(([week, weight]) => [week / speed, weight]);
}

/**
 * DECAY-2's arm: weight 1 before any game, 0 from week 1. The in-season
 * "results" rating is an Elo seeded from the prior, so with these knots the
 * published rating is that Elo alone and the prior enters exactly once — as
 * the seed — instead of once as the seed and again through the blend.
 */
export const NO_BLEND_KNOTS: DecayKnots = [
  [0, 1],
  [1, 0],
];
