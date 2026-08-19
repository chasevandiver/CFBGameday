/**
 * Which FCS opponents are the good ones (SPEC §2.1, P1-2).
 *
 * The spec has always called for two FCS buckets — "top-tier ≈ −25, other
 * ≈ −35" — and the code has always used a flat −30. `fcsTopRating` and
 * `fcsOtherRating` sat in `DEFAULT_PARAMS` as dead constants, read nowhere,
 * while the flat number was hardcoded in four separate files. Every fitted
 * parameter in the model was fitted with the replay running at flat −30.
 *
 * ## What decides a bucket
 *
 * An FCS team's own average margin against FBS opponents. It is the most direct
 * measurement of the thing the rating is for — how much a buy game against this
 * particular opponent should move an FBS team's number — and it comes out of
 * games the backtest already loads.
 *
 * The split is the **median of the qualifying population**, not a tuned
 * threshold. That is deliberate: a free threshold would make `--tune-fcs` a
 * three-dimensional grid and hand the search another degree of freedom to
 * overfit with. The median is defined by the data and costs nothing.
 *
 * ## Lookahead
 *
 * `replaySeason`'s one invariant is that week-N predictions see nothing from
 * week N or later, and there is a test that perturbs week-2 scores to prove it.
 * A bucket computed over 2023–25 and used to price a 2023 game would break that
 * — quietly, in a way that flatters the backtest.
 *
 * So `before` is **required**, not optional, and the filter is inside this
 * function rather than left to the caller. A caller who forgets cannot compile.
 *
 * ## The identity default
 *
 * `fcsTopRating` and `fcsOtherRating` both ship at **−30**, so `fcsRatingOf`
 * returns the same number for every team and bucket membership is *literally
 * unobservable* in the output. That is a stronger safety property than "the
 * default reproduces today's behaviour": a wrong bucket assignment cannot move
 * a single prediction, so this machinery can land 16 days before kickoff and
 * wait for `backtest.ts --tune-fcs` to say whether the split is real.
 */
import type { ModelParams } from "./ratings";

/**
 * The four fields this needs from a game, structurally rather than as
 * `CfbdGame`. `src/model/` deliberately imports nothing from `src/lib/`, and a
 * narrow shape also means a database row works here unchanged — which the
 * production path will need, since production never sees a `CfbdGame`.
 */
export interface FcsGame {
  season: number;
  homeId: number;
  awayId: number;
  homePoints: number | null;
  awayPoints: number | null;
}

export interface FcsMargin {
  /** Mean of (this team's points − the FBS team's points), over completed
   *  games against FBS opponents. Negative for almost everyone. */
  avgMargin: number;
  n: number;
}

/**
 * Average margin vs FBS for every non-FBS team that played one, using only
 * seasons strictly before `before`.
 *
 * `fbsIds` rather than the feed's `classification` field: cached season files
 * written before that field was consumed do not carry it (`CfbdGame`'s own
 * comment says readers must tolerate undefined), and silently reclassifying
 * every team as FCS because a cache file is old is exactly the kind of failure
 * that would look like a modelling result.
 *
 * `fbsIds` may be a per-season LOOKUP rather than one set, and over a wide
 * window it must be. FBS membership is not constant: James Madison's games are
 * FCS buy games through 2021 and FBS games from 2022, and a single set has to
 * be wrong about one half or the other. A set is still accepted, because over
 * a three-season window it is the same answer and every existing caller passes
 * one.
 */
export function fcsMarginsVsFbs(
  games: FcsGame[],
  fbsIds: ReadonlySet<number> | ((season: number) => ReadonlySet<number>),
  opts: { before: number },
): Map<number, FcsMargin> {
  const totals = new Map<number, { sum: number; n: number }>();

  for (const g of games) {
    if (g.season >= opts.before) continue;
    if (g.homePoints === null || g.awayPoints === null) continue;

    const fbs = typeof fbsIds === "function" ? fbsIds(g.season) : fbsIds;
    const homeIsFbs = fbs.has(g.homeId);
    const awayIsFbs = fbs.has(g.awayId);
    // Exactly one side FBS. FBS-vs-FBS says nothing about an FCS team, and
    // FCS-vs-FCS is not on a scale we can read — those games are never in the
    // corpus anyway, since CFBD's classification=fbs filter drops them.
    if (homeIsFbs === awayIsFbs) continue;

    const fcsId = homeIsFbs ? g.awayId : g.homeId;
    const margin = homeIsFbs
      ? g.awayPoints - g.homePoints
      : g.homePoints - g.awayPoints;

    const t = totals.get(fcsId) ?? { sum: 0, n: 0 };
    t.sum += margin;
    t.n += 1;
    totals.set(fcsId, t);
  }

  return new Map(
    [...totals].map(([id, t]) => [id, { avgMargin: t.sum / t.n, n: t.n }]),
  );
}

/**
 * The top bucket: qualifying teams at or above the median average margin.
 *
 * A team below `minGames` is not classified at all and falls to the other
 * bucket at the call site. One 63−0 in three years is not evidence, and the
 * conservative side of a wrong guess here is treating a good FCS team as an
 * ordinary one — which is what the model does today.
 */
export function fcsTopIds(
  margins: Map<number, FcsMargin>,
  opts: { minGames?: number } = {},
): Set<number> {
  const minGames = opts.minGames ?? 2;
  const qualified = [...margins].filter(([, m]) => m.n >= minGames);
  if (qualified.length === 0) return new Set();

  const sorted = [...qualified].sort((a, b) => a[1].avgMargin - b[1].avgMargin);
  const mid = Math.floor(sorted.length / 2);
  // Even population: average the two middle values, the ordinary median. Odd:
  // the middle value itself, which lands in the top bucket via `>=`.
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1][1].avgMargin + sorted[mid][1].avgMargin) / 2
      : sorted[mid][1].avgMargin;

  return new Set(qualified.filter(([, m]) => m.avgMargin >= median).map(([id]) => id));
}

/**
 * The rating to price an FCS opponent at.
 *
 * With both parameters at their shipped −30 this returns −30 for everything and
 * `top` has no effect at all — see the identity note above.
 */
export function fcsRatingOf(
  teamId: number,
  top: ReadonlySet<number> | undefined,
  params: Pick<ModelParams, "fcsTopRating" | "fcsOtherRating">,
): number {
  return top?.has(teamId) ? params.fcsTopRating : params.fcsOtherRating;
}
