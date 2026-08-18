/**
 * Point-in-time backtest over past seasons (docs/SPEC.md §2.5).
 *
 * Usage:
 *   CFBD_API_KEY=... npx tsx scripts/backtest.ts             # fetch + run 2023–2025
 *   npx tsx scripts/backtest.ts --cached                     # reuse .backtest-cache/
 *   npx tsx scripts/backtest.ts --seasons=2023-2025          # the pre-2026-08-18 reference window
 *   npx tsx scripts/backtest.ts --warmup=2 --covid=score     # window shape (scripts/lib/window.ts)
 *   npx tsx scripts/backtest.ts --tune                       # grid-search K / HFA, fit σ + slope
 *   npx tsx scripts/backtest.ts --tune-sigma                 # fit priorSigmaExtra (early-week uncertainty)
 *   npx tsx scripts/backtest.ts --tune-preseason-tilts       # should preseason off/def carry a shape?
 *   npx tsx scripts/backtest.ts --tune-coaching              # fit newHcIntercept / newHcSlope
 *   npx tsx scripts/backtest.ts --tune-churn                 # fit returning-production weight + talent reload
 *   npx tsx scripts/backtest.ts --tune-epa                   # ratings from per-play efficiency vs the scoreboard
 *   npx tsx scripts/backtest.ts --tune-ensemble              # blend weekly Elo + prior SP+ into our margin
 *   npx tsx scripts/backtest.ts --tune-hfa                   # home-field alone, judged on bias + MAE + calibration
 *   npx tsx scripts/backtest.ts --tune-fcs                   # is "top-tier FCS" a real category? (P1-2)
 *   npx tsx scripts/backtest.ts --tune-team-hfa              # is a per-team home edge real? (02:M-05)
 *   npx tsx scripts/backtest.ts --tune-anchors               # week-1 Elo / preseason poll anchor weights
 *   npx tsx scripts/backtest.ts --tune-prior                 # preseason carryover weight
 *   npx tsx scripts/backtest.ts --tune-sp-blend              # prior-year baseline: replay finals vs final SP+
 *   npx tsx scripts/backtest.ts --diagnose-edges             # THE EDGE GATE: market MAE + encompassing regression
 *   npx tsx scripts/backtest.ts --diagnose-tiers             # cross-classification level vs prior-chain construction
 *   npx tsx scripts/backtest.ts --tune-tier-recenter         # validate the week-1-anchored tier recentring patch
 *
 * Each --tune-* flag prints its own pre-registered decision rule alongside the
 * grid: a parameter moves off its identity default only when the rule clears.
 *
 * Lookahead-bias guard lives in scripts/lib/replay.ts: week-N predictions use
 * only ratings computed from weeks < N plus the preseason prior.
 *
 * Bootstrap rule: the earliest season's priors are seeded from CFBD's
 * historical SP+ for the PREVIOUS season (§2.5 v2). Later seasons chain off
 * the replay's own final ratings.
 *
 * Scope: validates K-factor, prior decay, margin cap, HFA, win-prob slope and
 * margin sigma, and calibration vs the stored CFBD line. It does NOT validate
 * CLV or line movement — no historical movement data exists, and eleven
 * seasons of a window that has none is still none.
 *
 * Window: 2015-2025 by default since 2026-08-18, scoring nine seasons (2015 is
 * the SP+ bootstrap, 2020 is chained but not scored). Every figure recorded
 * before that date was computed on 2023-2025, reachable with
 * `--seasons=2023-2025`. A number without its window label is not comparable to
 * anything — see scripts/lib/window.ts.
 */

import { pathToFileURL } from "node:url";
import {
  DEFAULT_PARAMS,
  centeredBlendedHfa,
  churnAdjustment,
  coachingAdjustmentContinuous,
  priorWeight,
  type ModelParams,
} from "../src/model/ratings";
import { buildCoachTransitions, type CoachTransition } from "./lib/coaching";
import { fcsMarginsVsFbs, fcsTopIds } from "../src/model/fcs";
import { sliceReport } from "./lib/slices";
import {
  chainPriors,
  chainTilts,
  consensusLine,
  hfaSplitHalf,
  loadSeason,
  priorsFromSp,
  rawTeamHfa,
  replaySeason,
  scaleTilts,
  subTiltsFromSp,
  teamIdsByNameFrom,
  type ReplayPrediction,
  type SeasonData,
} from "./lib/replay";
import {
  DEFAULT_WINDOW,
  LEGACY_WINDOW,
  makeWindow,
  parseSeasonWindow,
  SeasonWindowError,
  perEraTable,
  perSeasonTable,
  splitWindow,
  type SeasonWindow,
} from "./lib/window";
import { eraFlip, erasIn, latestEraIn } from "./lib/eras";
import { CoverageError, assertFeedCoverage, loadCoverageManifest } from "./lib/coverage";

/**
 * The replayed window and the scored subset of it.
 *
 * These were `[2023, 2024, 2025]` and `SEASONS.slice(1)` until 2026-08-18,
 * when the archive backfill (BF-4) settled the question that had kept them
 * there: CFBD line coverage runs 95-100% per season back to 2015, not the
 * 55-70% that had been assumed. `WINDOW` is now parsed from argv by `main()`
 * before any season is loaded — see scripts/lib/window.ts for the flags and
 * for why every number must be reported with its window label.
 *
 * They stay module-level `let`s rather than being threaded through ~25 call
 * sites: every tuner reads them at call time and `main()` is the only writer,
 * so there is exactly one assignment and no site can capture a stale window.
 * The default is the wide window, so a path that somehow ran without `main()`
 * would still use the documented default rather than a silent legacy one.
 */
let WINDOW: SeasonWindow = makeWindow(
  Array.from(
    { length: DEFAULT_WINDOW.to - DEFAULT_WINDOW.from + 1 },
    (_, i) => DEFAULT_WINDOW.from + i,
  ),
);
let SEASONS: number[] = WINDOW.all;

/** Seasons the tuners score on: the bootstrap year is excluded because its
 *  priors come from SP+ rather than from our own chain either way, and COVID
 *  2020 is excluded because an empty-stadium season measures a different
 *  quantity (scripts/lib/eras.ts). Both are still replayed, so the prior chain
 *  is unbroken. */
let SCORED: number[] = WINDOW.scored;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const maeOf = (xs: number[]) => mean(xs.map(Math.abs));

/**
 * Restrict predictions to the scored window.
 *
 * Until 2026-08-18 only the prior-construction tuners honoured `SCORED`;
 * `--tune`, `--tune-hfa`, `--tune-epa` and `--tune-sigma` pooled every loaded
 * season including the SP+-seeded bootstrap. That was tolerable when the
 * bootstrap was one season in three and every season was comparable. It is not
 * tolerable once the window also contains COVID 2020, whose home-field
 * advantage is a different quantity — so every tuner now scores the same set,
 * and the four that changed have their restated numbers in the changelog.
 */
const scoredOnly = <T extends { season: number }>(xs: readonly T[]): T[] =>
  xs.filter((x) => SCORED.includes(x.season));

/**
 * The two rules every wide-window fit must clear on top of its own
 * pre-registered criteria, printed with the grid so they are read before the
 * winner is.
 *
 * They exist because of Q8, generalised. `returningProdWeight` was fitted
 * against an input distribution that no longer exists, and a parameter pooled
 * over eleven seasons has that defect structurally: 2015 college football had
 * no portal, no NIL, an intact Pac-12 and a four-team playoff.
 */
function eraNote(parameter: string): string {
  const latest = latestEraIn(SCORED);
  const eras = erasIn(SCORED);
  if (eras.length < 2) {
    return `\n(Single era in this window — the era-flip and recency rules do not apply.)`;
  }
  return (
    `\nTWO RULES BEFORE ${parameter.toUpperCase()} SHIPS, on top of this tuner's own criteria:\n` +
    `  era-flip: refit within each of ${eras.map((e) => e.era.id).join(", ")} separately. If the\n` +
    `    per-era argmins do not agree within one grid step, the pooled winner is an average of\n` +
    `    eras that want different values — record "era-dependent", ship nothing (eraFlip()).\n` +
    `  recency: the ${latest?.id ?? "latest"}-only metric (${latest?.seasons.join(", ") ?? "?"}) must not be worse than\n` +
    `    the incumbent's by more than 1 SE. Next season resembles ${latest?.id ?? "the latest era"}, not 2015.`
  );
}

function nll(preds: ReplayPrediction[]): number {
  const graded = preds.filter((p) => p.favoriteWon !== null);
  return (
    -graded.reduce((a, p) => a + Math.log(p.favoriteWon ? p.favWinProb : 1 - p.favWinProb), 0) /
    graded.length
  );
}

function report(predictions: ReplayPrediction[], params: ModelParams): string {
  const lines: string[] = [];
  const graded = predictions.filter((p) => p.favoriteWon !== null);

  lines.push("\n== Win-probability calibration ==");
  lines.push("bucket        n     predicted   actual");
  for (const [lo, hi] of [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]] as const) {
    const bucket = graded.filter((p) => p.favWinProb >= lo && p.favWinProb < hi);
    if (bucket.length === 0) continue;
    const predicted = bucket.reduce((a, p) => a + p.favWinProb, 0) / bucket.length;
    const actual = bucket.filter((p) => p.favoriteWon).length / bucket.length;
    lines.push(
      `${lo.toFixed(1)}–${Math.min(hi, 1).toFixed(1)}     ${String(bucket.length).padStart(5)}   ${(predicted * 100).toFixed(1)}%       ${(actual * 100).toFixed(1)}%`,
    );
  }

  const errors = predictions.map((p) => p.actualMargin - p.margin);
  const mae = errors.reduce((a, e) => a + Math.abs(e), 0) / errors.length;
  const sigma = Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / errors.length);
  // Mean SIGNED error alongside MAE: both MAE and sigma are symmetric, so a
  // systematic lean toward one side is invisible in them. This is how the
  // home-side under-prediction went unnoticed until an ensemble regression
  // asked for a +2 intercept.
  const bias = errors.reduce((a, e) => a + e, 0) / errors.length;
  const biasSe = sigma / Math.sqrt(errors.length);
  lines.push(`\n== Margin error ==  MAE ${mae.toFixed(2)}  σ ${sigma.toFixed(2)} (param: ${params.marginSigma})`);
  lines.push(
    `bias (actual − model) ${bias >= 0 ? "+" : ""}${bias.toFixed(2)} ± ${biasSe.toFixed(2)} SE` +
      `${Math.abs(bias) > 2 * biasSe ? "  ← systematic; positive means home under-predicted" : ""}`,
  );

  // Totals calibration (§2.2 sub-ratings): the model total must beat the
  // constant-baseline strawman convincingly before totals surfaces ship.
  const withTotal = predictions.filter((p) => p.vegasTotal !== null);
  if (withTotal.length > 0) {
    const mae = (xs: number[]) => xs.reduce((a, e) => a + Math.abs(e), 0) / xs.length;
    const modelErr = withTotal.map((p) => p.actualTotal - p.projectedTotal);
    const marketErr = withTotal.map((p) => p.actualTotal - (p.vegasTotal as number));
    const constErr = withTotal.map((p) => p.actualTotal - 57);
    lines.push("\n== Totals calibration (vs games with a stored total) ==");
    lines.push(`model MAE ${mae(modelErr).toFixed(2)}   market MAE ${mae(marketErr).toFixed(2)}   constant-57 MAE ${mae(constErr).toFixed(2)}   n=${withTotal.length}`);
    for (const [label, filter] of [
      ["weeks 1–4", (p: ReplayPrediction) => p.week <= 4],
      ["weeks 5+ ", (p: ReplayPrediction) => p.week >= 5],
    ] as const) {
      const seg = withTotal.filter(filter);
      if (seg.length === 0) continue;
      lines.push(
        `${label}: model MAE ${mae(seg.map((p) => p.actualTotal - p.projectedTotal)).toFixed(2)}   ` +
          `market MAE ${mae(seg.map((p) => p.actualTotal - (p.vegasTotal as number))).toFixed(2)}   ` +
          `constant-57 MAE ${mae(seg.map((p) => p.actualTotal - 57)).toFixed(2)}   n=${seg.length}`,
      );
    }
    for (const min of [2, 4]) {
      const leans = withTotal.filter(
        (p) => Math.abs(p.projectedTotal - (p.vegasTotal as number)) >= min,
      );
      let overW = 0;
      let overL = 0;
      for (const p of leans) {
        const likesOver = p.projectedTotal > (p.vegasTotal as number);
        if (p.actualTotal === p.vegasTotal) continue;
        const wentOver = p.actualTotal > (p.vegasTotal as number);
        if (likesOver === wentOver) overW++;
        else overL++;
      }
      const n = overW + overL;
      lines.push(
        `O/U leans ≥${min}:  ${overW}-${overL}  (${n ? ((overW / n) * 100).toFixed(1) : "–"}%)  n=${n}  (52.4% breaks even)`,
      );
    }
  }

  // Per-week-segment uncertainty. A flat sigma across the season assumes the
  // model knows as much in week 1 (when the rating IS the preseason prior) as
  // it does in November. If the early segments fit a materially larger sigma,
  // win/cover probabilities in those weeks are overconfident — and cover_prob
  // drives ¼-Kelly stake sizing, so it costs real units.
  lines.push("\n== Uncertainty by week segment (is a flat sigma honest?) ==");
  lines.push("segment      n     MAE     fitted σ   NLL      implied slope");
  const segments: Array<[string, (p: ReplayPrediction) => boolean]> = [
    ["weeks 1–2", (p) => p.week <= 2],
    ["weeks 3–4", (p) => p.week >= 3 && p.week <= 4],
    ["weeks 5–8", (p) => p.week >= 5 && p.week <= 8],
    ["weeks 9+ ", (p) => p.week >= 9],
  ];
  for (const [label, filter] of segments) {
    const seg = predictions.filter(filter);
    if (seg.length === 0) continue;
    const segErrors = seg.map((p) => p.actualMargin - p.margin);
    const segMae = segErrors.reduce((a, e) => a + Math.abs(e), 0) / segErrors.length;
    const segSigma = Math.sqrt(segErrors.reduce((a, e) => a + e * e, 0) / segErrors.length);
    const segGraded = seg.filter((p) => p.favoriteWon !== null);
    const segNll =
      segGraded.length > 0
        ? -segGraded.reduce(
            (a, p) => a + Math.log(p.favoriteWon ? p.favWinProb : 1 - p.favWinProb),
            0,
          ) / segGraded.length
        : NaN;
    lines.push(
      `${label}  ${String(seg.length).padStart(5)}   ${segMae.toFixed(2)}   ${segSigma.toFixed(2)}      ` +
        `${Number.isNaN(segNll) ? "  –  " : segNll.toFixed(4)}   ${(1.7 / segSigma).toFixed(4)}`,
    );
  }
  lines.push(
    `pooled σ ${sigma.toFixed(2)} — a schedule ships only if the early segments sit clearly above it ` +
      `(priorSigmaExtra, fit with --tune-sigma).`,
  );

  // Edge-flag ATS. Two things to keep in mind reading this table:
  //  1. The bet line and the grade line are the SAME number (CFBD's settled
  //     consensus), so this measures "beat the close" — the hardest possible
  //     benchmark, and not a wager anyone can place. --diagnose-edges prices
  //     the same flags against the OPENING line, which is bettable.
  //  2. Buckets are disjoint. The old table reported "≥2" and "≥4" where the
  //     first contained the second, so the marginal 2–4pt band — the one that
  //     decides whether the threshold is set right — was never visible.
  lines.push("\n== Edge flags vs the CLOSING line (break-even 52.4% at -110) ==");
  lines.push("bucket        W-L-P        win%     ±1SE     n");
  const BUCKETS: Array<[string, number, number]> = [
    ["|edge| 2–3", 2, 3],
    ["|edge| 3–4", 3, 4],
    ["|edge| 4–6", 4, 6],
    ["|edge| 6–10", 6, 10],
    ["|edge| 10+", 10, Infinity],
    ["ALL ≥2", 2, Infinity],
  ];
  for (const [label, lo, hi] of BUCKETS) {
    const flagged = predictions.filter(
      (p) =>
        p.edge !== null &&
        p.vegasSpread !== null &&
        Math.abs(p.edge) >= lo &&
        Math.abs(p.edge) < hi,
    );
    const { wins, losses, pushes } = gradeAts(flagged, (p) => p.vegasSpread);
    const n = wins + losses;
    const pct = n ? (wins / n) * 100 : NaN;
    const se = n ? Math.sqrt(0.25 / n) * 100 : NaN;
    lines.push(
      `${label.padEnd(13)} ${`${wins}-${losses}-${pushes}`.padEnd(12)} ` +
        `${n ? pct.toFixed(1) : "  – "}%   ${n ? se.toFixed(1) : " – "}%    ${n}`,
    );
  }
  lines.push(
    "Pushes are now a real third outcome: the consensus is snapped to the half point, " +
      "so a true push on 3 or 7 is excluded instead of being scored W or L at random.",
  );

  // 03:M-3: signed error by slice. This is the table whose deferral let a
  // +9.8-point cross-classification lean ship into the 2026 preseason build —
  // it prints on every run now, tuners included.
  lines.push(sliceReport(predictions));

  return lines.join("\n");
}

export interface AtsRecord {
  wins: number;
  losses: number;
  pushes: number;
}

/**
 * Grade the model's ATS side for a set of predictions against a chosen line.
 *
 * `lineOf` is what makes bet-line vs grade-line separable: pass `vegasSpread`
 * to ask "did we beat the close", or `vegasOpen` to ask the question a bettor
 * actually faces. The side is taken from the sign of the edge against the line
 * being bet, not the stored `edge` field, so the two stay consistent.
 */
export function gradeAts(
  predictions: ReplayPrediction[],
  lineOf: (p: ReplayPrediction) => number | null,
): AtsRecord {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  for (const p of predictions) {
    const line = lineOf(p);
    if (line === null) continue;
    // model spread (Vegas convention) vs this line; negative edge = likes home
    const likesHome = -p.margin - line < 0;
    const coverMargin = p.actualMargin + line;
    if (coverMargin === 0) pushes++;
    else if (likesHome === coverMargin > 0) wins++;
    else losses++;
  }
  return { wins, losses, pushes };
}

/**
 * --tune-prior: how much should preseason ratings carry over from last season
 * vs regress toward the talent composite? Replays with
 *   priors = w × replay_finals + (1−w) × talent_baseline
 * and scores ONLY weeks 1–4 (where the prior dominates pricing), for the
 * chained seasons (2024–2025; 2023 is the SP+ bootstrap either way).
 */
async function tunePriorCarryover(seasons: SeasonData[], teamIdsByName: Map<string, number>) {
  const { cfbd } = await import("../src/lib/cfbd");
  const { cached } = await import("./lib/replay");

  // talent baseline per season, on the rating points scale (z × 5.5, clamped)
  const talentBySeason = new Map<number, Map<number, number>>();
  for (const season of SEASONS) {
    const talent = await cached(`talent-${season}`, () => cfbd.talent(season), true);
    const vals = talent.map((t) => t.talent);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    const map = new Map<number, number>();
    for (const t of talent) {
      const id = teamIdsByName.get(t.team);
      if (id !== undefined) {
        map.set(id, Math.max(-18, Math.min(18, ((t.talent - mean) / std) * 5.5)));
      }
    }
    talentBySeason.set(season, map);
  }

  console.log("carryover w   early-wk NLL   early-wk MAE   (weeks 1–4 of 2024–2025)");
  let best: { w: number; nll: number } | null = null;
  for (const w of [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8]) {
    let priors = priorsFromSp(seasons[0].prevSp, teamIdsByName);
    const early: ReplayPrediction[] = [];
    for (const season of seasons) {
      const { predictions, finalRatings } = replaySeason(season, priors, DEFAULT_PARAMS);
      if (season.season > SEASONS[0]) {
        early.push(...predictions.filter((p) => p.week <= 4));
      }
      const talent = talentBySeason.get(season.season + 1) ?? talentBySeason.get(season.season)!;
      const next = new Map<number, number>();
      for (const [teamId, rating] of finalRatings) {
        const tal = talent.get(teamId) ?? -8;
        next.set(teamId, w * rating + (1 - w) * tal);
      }
      priors = next;
    }
    const graded = early.filter((p) => p.favoriteWon !== null);
    const nll =
      -graded.reduce((a, p) => a + Math.log(p.favoriteWon ? p.favWinProb : 1 - p.favWinProb), 0) /
      graded.length;
    const errors = early.map((p) => p.actualMargin - p.margin);
    const mae = errors.reduce((a, e) => a + Math.abs(e), 0) / errors.length;
    console.log(`${w.toFixed(2)}          ${nll.toFixed(4)}         ${mae.toFixed(2)}         n=${graded.length}`);
    if (!best || nll < best.nll) best = { w, nll };
  }
  if (best) console.log(`\nBest early-season carryover: w=${best.w}`);
}

/**
 * --tune-sp-blend: should the previous-season baseline be the replay's own
 * finals, CFBD's final SP+ (opponent-adjusted, better cross-conference
 * placement), or a blend? Builds priors as
 *   base = α × replay_finals + (1−α) × SP+_prev_final
 *   prior = 0.7 × base + 0.3 × talent
 * and scores weeks 1–4 of the chained seasons.
 */
async function tuneSpBlend(seasons: SeasonData[], teamIdsByName: Map<string, number>) {
  const { cfbd } = await import("../src/lib/cfbd");
  const { cached } = await import("./lib/replay");

  const talentBySeason = new Map<number, Map<number, number>>();
  const spFinalBySeason = new Map<number, Map<number, number>>();
  for (const season of SEASONS) {
    const talent = await cached(`talent-${season}`, () => cfbd.talent(season), true);
    const vals = talent.map((t) => t.talent);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    const tMap = new Map<number, number>();
    for (const t of talent) {
      const id = teamIdsByName.get(t.team);
      if (id !== undefined) tMap.set(id, Math.max(-18, Math.min(18, ((t.talent - mean) / std) * 5.5)));
    }
    talentBySeason.set(season, tMap);

    // final SP+ of the season itself (used as next season's baseline input)
    const sp = await cached(`sp-${season}`, () => cfbd.spRatings(season), true);
    spFinalBySeason.set(season, priorsFromSp(sp, teamIdsByName));
  }

  console.log("alpha (replay share)   early-wk NLL   early-wk MAE");
  let best: { a: number; nll: number } | null = null;
  for (const a of [0, 0.25, 0.5, 0.75, 1]) {
    let priors = priorsFromSp(seasons[0].prevSp, teamIdsByName);
    const early: ReplayPrediction[] = [];
    for (const season of seasons) {
      const { predictions, finalRatings } = replaySeason(season, priors, DEFAULT_PARAMS);
      if (season.season > SEASONS[0]) early.push(...predictions.filter((p) => p.week <= 4));
      const spFinal = spFinalBySeason.get(season.season)!;
      const talent = talentBySeason.get(season.season)!;
      const next = new Map<number, number>();
      for (const [teamId, rating] of finalRatings) {
        const sp = spFinal.get(teamId);
        const base = sp !== undefined ? a * rating + (1 - a) * sp : rating;
        const tal = talent.get(teamId) ?? -8;
        next.set(teamId, 0.7 * base + 0.3 * tal);
      }
      priors = next;
    }
    const graded = early.filter((p) => p.favoriteWon !== null);
    const nll =
      -graded.reduce((s, p) => s + Math.log(p.favoriteWon ? p.favWinProb : 1 - p.favWinProb), 0) /
      graded.length;
    const errors = early.map((p) => p.actualMargin - p.margin);
    const mae = errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length;
    console.log(`${a.toFixed(2)}                   ${nll.toFixed(4)}         ${mae.toFixed(2)}   n=${graded.length}`);
    if (!best || nll < best.nll) best = { a, nll };
  }
  if (best) console.log(`\nBest replay share: alpha=${best.a}`);
}

/**
 * --diagnose-tiers: which prior-chain step produces the cross-classification
 * mis-levelling, and which construction removes it?
 *
 * Mechanism under test: a margin-Elo's intra-pool games are zero-sum WITHIN
 * the pool, so the level between two pools is set almost entirely by the
 * prior; the handful of cross-tier games per season re-level at only
 * K/2 × error per game. `chainPriors` regresses 30% toward ZERO — the FBS
 * midpoint — which drags the P4 pool down and the G5 pool up between seasons
 * by construction, and the replay cannot pull them apart again fast enough.
 *
 * Each variant replays 2023→2025 with a different between-season prior
 * construction and is scored on weeks 1–4 of the chained seasons (where the
 * prior dominates pricing) plus the pooled full-season report metrics.
 *
 * Decision rule (pre-registered, printed before any number): a variant is a
 * fix CANDIDATE only if, vs the bare-chain baseline —
 *   1. weeks 1–4 cross-tier G5-signed |mean edge vs market| at least halves;
 *   2. weeks 1–4 P4-vs-P4 home-signed mean edge stays within ±1.0;
 *   3. pooled MAE ≤ 13.30 and pooled NLL ≤ 0.5005;
 *   4. every win-prob calibration bucket within 3 points.
 * The shipping gate (|t| < 2 on the 2026 Week-1 market) is scored separately
 * by scripts/diagnose-tiers-2026.ts — this mode picks candidates, not winners.
 */
async function diagnoseTiers(seasons: SeasonData[], teamIdsByName: Map<string, number>) {
  const { talentBySeason, spFinalBySeason } = await loadPriorInputs(teamIdsByName);
  const { tierOf } = await import("./lib/tiers");
  const { g5SignedBias, g5SignedEdge, stat, tiersOf } = await import("./lib/slices");

  // Team → conference per season, for prior-separation accounting.
  const confBySeason = new Map<number, Map<number, { name: string; conf: string | null }>>();
  for (const s of seasons) {
    const m = new Map<number, { name: string; conf: string | null }>();
    for (const g of s.games) {
      m.set(g.homeId, { name: g.homeTeam, conf: g.homeConference ?? null });
      m.set(g.awayId, { name: g.awayTeam, conf: g.awayConference ?? null });
    }
    confBySeason.set(s.season, m);
  }

  const tierSeparation = (priors: Map<number, number>, season: number): string => {
    const teams = confBySeason.get(season);
    if (!teams) return "–";
    const pool: Record<string, number[]> = { P4: [], G5: [] };
    for (const [id, rating] of priors) {
      const t = teams.get(id);
      if (!t) continue;
      const tier = tierOf(t.conf, t.name, season, true);
      if (tier === "P4" || tier === "G5") pool[tier].push(rating);
    }
    if (pool.P4.length === 0 || pool.G5.length === 0) return "–";
    return (mean(pool.P4) - mean(pool.G5)).toFixed(1);
  };

  type ChainFn = (finals: Map<number, number>, seasonJustPlayed: number) => Map<number, number>;
  const talentChain =
    (alpha: number | null, talentW = 0.3): ChainFn =>
    (finals, seasonJustPlayed) => {
      const sp = spFinalBySeason.get(seasonJustPlayed)!;
      const talent = talentBySeason.get(seasonJustPlayed)!;
      const next = new Map<number, number>();
      for (const [teamId, rating] of finals) {
        const s = alpha === null ? undefined : sp.get(teamId);
        const base = alpha !== null && s !== undefined ? alpha * rating + (1 - alpha) * s : rating;
        next.set(teamId, (1 - talentW) * base + talentW * (talent.get(teamId) ?? -8));
      }
      return next;
    };

  // The FCS arms used to pass a scalar override to replaySeason. That knob is
  // gone — the anchor now lives in ModelParams as a two-bucket pair — so they
  // set both buckets to the same value, which is the same experiment: a flat
  // anchor at a different level, not a split.
  const variants: Array<{ label: string; chain: ChainFn; params?: ModelParams }> = [
    { label: "bare 0.7×finals (tuner chain)", chain: (f) => chainPriors(f) },
    { label: "0.7×finals+0.3×talent", chain: talentChain(null) },
    { label: "SP+ α=0.75 +talent", chain: talentChain(0.75) },
    { label: "SP+ α=0.50 +talent (≈prod)", chain: talentChain(0.5) },
    { label: "SP+ α=0.25 +talent", chain: talentChain(0.25) },
    { label: "SP+ α=0.00 +talent", chain: talentChain(0) },
    { label: "α=0.50, talent 0.4", chain: talentChain(0.5, 0.4) },
    {
      label: "bare chain, FCS −25",
      chain: (f) => chainPriors(f),
      params: { ...DEFAULT_PARAMS, fcsTopRating: -25, fcsOtherRating: -25 },
    },
    {
      label: "bare chain, FCS −35",
      chain: (f) => chainPriors(f),
      params: { ...DEFAULT_PARAMS, fcsTopRating: -35, fcsOtherRating: -35 },
    },
  ];

  console.log("\n== --diagnose-tiers: prior chain vs cross-classification level ==");
  console.log(
    "Candidate rule (fixed before running): halve wks1–4 cross-tier |edge|, keep P4vP4 within ±1,\n" +
      "pooled MAE ≤ 13.30, NLL ≤ 0.5005, every win-prob bucket within 3 pts.\n",
  );
  console.log(
    "variant                        cross_mkt(1–4)      cross_act(1–4)   P4vP4(1–4)   pooled MAE / NLL   worst bkt",
  );

  for (const v of variants) {
    let priors = priorsFromSp(seasons[0].prevSp, teamIdsByName);
    const early: ReplayPrediction[] = [];
    const all: ReplayPrediction[] = [];
    const seps: string[] = [];
    for (const season of seasons) {
      if (SCORED.includes(season.season)) {
        seps.push(`${season.season}: ${tierSeparation(priors, season.season)}`);
      }
      const { predictions, finalRatings } = replaySeason(
        season,
        priors,
        v.params ?? DEFAULT_PARAMS,
      );
      all.push(...predictions);
      if (SCORED.includes(season.season)) {
        early.push(...predictions.filter((p) => p.week <= 4));
      }
      priors = v.chain(finalRatings, season.season);
    }

    const crossMkt = stat(
      "x",
      early.map(g5SignedEdge).filter((x): x is number => x !== null),
    );
    const crossAct = stat(
      "x",
      early.map(g5SignedBias).filter((x): x is number => x !== null),
    );
    const p4p4 = stat(
      "x",
      early
        .filter((p) => {
          const { home, away } = tiersOf(p);
          return home === "P4" && away === "P4" && p.edge !== null;
        })
        .map((p) => -(p.edge as number)),
    );
    const errors = all.map((p) => p.actualMargin - p.margin);
    const pooledMae = maeOf(errors);
    const pooledNll = nll(all);
    // worst win-prob bucket miss, pooled
    const graded = all.filter((p) => p.favoriteWon !== null);
    let worst = 0;
    for (const [lo, hi] of [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]] as const) {
      const b = graded.filter((p) => p.favWinProb >= lo && p.favWinProb < hi);
      if (b.length === 0) continue;
      const predicted = mean(b.map((p) => p.favWinProb));
      const actual = b.filter((p) => p.favoriteWon).length / b.length;
      worst = Math.max(worst, Math.abs(predicted - actual) * 100);
    }

    const f = (s: { mean: number; se: number; t: number } | null) =>
      s ? `${s.mean >= 0 ? "+" : ""}${s.mean.toFixed(2)} t=${s.t.toFixed(1)}`.padEnd(16) : "–".padEnd(16);
    console.log(
      `${v.label.padEnd(30)} ${f(crossMkt)}    ${f(crossAct)} ${
        p4p4 ? `${p4p4.mean >= 0 ? "+" : ""}${p4p4.mean.toFixed(2)}`.padEnd(10) : "–".padEnd(10)
      }   ${pooledMae.toFixed(2)} / ${pooledNll.toFixed(4)}     ${worst.toFixed(1)}`,
    );
    console.log(`  prior P4−G5 separation at week 0:  ${seps.join("   ")}`);
  }

  // Reference: what separation do the anchors themselves carry? If the replay
  // finals sit well below these, the Elo compressed the tiers during the
  // season; if the priors sit below the finals, the chain step did it.
  console.log("\nAnchor separations (P4 mean − G5 mean), for reference:");
  for (const season of SCORED) {
    const spPrev = spFinalBySeason.get(season - 1);
    const tal = talentBySeason.get(season - 1);
    console.log(
      `  ${season}: final SP+ ${spPrev ? tierSeparation(spPrev, season) : "–"}   ` +
        `talent ${tal ? tierSeparation(tal, season) : "–"}`,
    );
  }
}

/**
 * --tune-tier-recenter: validate the tier-recentring patch on 2024–2025
 * before it prices a single 2026 game.
 *
 * The patch: after the preseason prior is built, measure the mean G5-signed
 * edge of that season's WEEK-1 cross-tier market lines against the prior, and
 * shift the two pools (zero-sum, membership-weighted) so that mean is zero.
 * Week-1 lines are available before week 1 — point-in-time sound — and the
 * within-pool ordering is untouched.
 *
 * Why market-anchored rather than a fitted constant: the offseason divergence
 * is not stable year to year (measured: 2024/2025 needed ~+2 over the
 * end-of-season gap; the 2026 market demands ~+8 — the portal/rev-share drain
 * is accelerating), so a constant fit on 2023–25 under-corrects 2026 by
 * construction. The static-δ grid below is printed to document exactly that.
 *
 * Decision rule (pre-registered, fixed before the first run):
 * ship the market-anchored recentre only if, on the chained seasons —
 *   1. weeks 2–4 cross-tier |mean edge vs market| ≤ half the unpatched value
 *      (week 1 is the fit set; weeks 2–4 are out-of-fit);
 *   2. weeks 1–4 cross-tier bias vs ACTUAL outcomes |t| < 2 (unpatched ≈ −4.7:
 *      the G5 sides really do underperform our numbers — the market is right);
 *   3. weeks 1–4 P4-vs-P4 mean edge stays within ±1.0;
 *   4. pooled MAE ≤ 13.30, NLL ≤ 0.5005, every win-prob bucket within 3 pts.
 */
async function tuneTierRecenter(seasons: SeasonData[], teamIdsByName: Map<string, number>) {
  const { talentBySeason, spFinalBySeason } = await loadPriorInputs(teamIdsByName);
  const { recenterTierGap, tierGapOf, tierOf } = await import("./lib/tiers");
  const { g5SignedBias, g5SignedEdge, stat, tiersOf } = await import("./lib/slices");

  // team → tier per season, from the games payload
  const tierBySeason = new Map<number, Map<number, import("./lib/tiers").Tier>>();
  for (const s of seasons) {
    const m = new Map<number, import("./lib/tiers").Tier>();
    for (const g of s.games) {
      m.set(g.homeId, tierOf(g.homeConference ?? null, g.homeTeam, s.season, true));
      m.set(g.awayId, tierOf(g.awayConference ?? null, g.awayTeam, s.season, true));
    }
    tierBySeason.set(s.season, m);
  }

  // production-shaped chain: base = 0.5×finals + 0.5×SP+, prior = 0.7×base + 0.3×talent
  const chain = (finals: Map<number, number>, seasonJustPlayed: number) => {
    const sp = spFinalBySeason.get(seasonJustPlayed)!;
    const talent = talentBySeason.get(seasonJustPlayed)!;
    const next = new Map<number, number>();
    for (const [teamId, rating] of finals) {
      const s = sp.get(teamId);
      const base = s !== undefined ? 0.5 * rating + 0.5 * s : rating;
      next.set(teamId, 0.7 * base + 0.3 * (talent.get(teamId) ?? -8));
    }
    return next;
  };

  /** Mean G5-signed edge of a season's week-1 cross-tier lines vs a prior. */
  const week1CrossEdge = (
    season: SeasonData,
    priors: Map<number, number>,
    tiers: Map<number, import("./lib/tiers").Tier>,
  ): { mean: number; n: number } => {
    const linesById = new Map(season.lines.map((l) => [l.id, l]));
    const edges: number[] = [];
    for (const g of season.games) {
      if (g.week !== 1) continue;
      const vegas = consensusLine(linesById.get(g.id));
      if (vegas === null) continue;
      const hr = priors.get(g.homeId);
      const ar = priors.get(g.awayId);
      if (hr === undefined || ar === undefined) continue;
      const ht = tiers.get(g.homeId);
      const at = tiers.get(g.awayId);
      const cross = (ht === "P4" && at === "G5") || (ht === "G5" && at === "P4");
      if (!cross) continue;
      const margin = hr - ar + (g.neutralSite ? 0 : DEFAULT_PARAMS.baseHfa);
      const edge = -margin - vegas;
      edges.push(at === "G5" ? edge : -edge);
    }
    return { mean: edges.length ? mean(edges) : 0, n: edges.length };
  };

  type Mode =
    | { kind: "off" }
    | { kind: "market" }
    | { kind: "delta"; delta: number };

  const run = (mode: Mode) => {
    let priors = priorsFromSp(seasons[0].prevSp, teamIdsByName);
    const early: ReplayPrediction[] = [];
    const late: ReplayPrediction[] = [];
    const all: ReplayPrediction[] = [];
    const fitNotes: string[] = [];
    for (const season of seasons) {
      const tiers = tierBySeason.get(season.season)!;
      if (SCORED.includes(season.season) && mode.kind !== "off") {
        const gap = tierGapOf(priors, tiers);
        if (gap !== null) {
          if (mode.kind === "market") {
            const { mean: fit, n } = week1CrossEdge(season, priors, tiers);
            priors = recenterTierGap(priors, tiers, gap + fit);
            fitNotes.push(`${season.season}: wk1 fit +${fit.toFixed(2)} (n=${n}), gap ${gap.toFixed(1)}→${(gap + fit).toFixed(1)}`);
          } else {
            // static δ over the season's blended end-of-prior-season gap: the
            // chain has already regressed it; restore to base gap + δ.
            const sp = spFinalBySeason.get(season.season - 1)!;
            const baseGap = tierGapOf(sp, tiers);
            if (baseGap !== null) {
              priors = recenterTierGap(priors, tiers, baseGap + mode.delta);
              fitNotes.push(`${season.season}: gap ${gap.toFixed(1)}→${(baseGap + mode.delta).toFixed(1)}`);
            }
          }
        }
      }
      const { predictions, finalRatings } = replaySeason(season, priors, DEFAULT_PARAMS);
      all.push(...predictions);
      if (SCORED.includes(season.season)) {
        early.push(...predictions.filter((p) => p.week <= 4));
        late.push(...predictions.filter((p) => p.week >= 2 && p.week <= 4));
      }
      priors = chain(finalRatings, season.season);
    }
    return { early, late, all, fitNotes };
  };

  console.log("\n== --tune-tier-recenter ==");
  console.log(
    "Rule (pre-registered): ship market-anchored only if wks2–4 cross |edge| halves (out-of-fit),\n" +
      "wks1–4 cross bias vs actual |t| < 2, P4vP4 within ±1, MAE ≤ 13.30, NLL ≤ 0.5005, buckets ≤ 3.\n",
  );
  console.log(
    "mode              cross_mkt wks2–4     cross_act wks1–4    P4vP4(1–4)   pooled MAE / NLL   worst bkt",
  );

  const modes: Array<[string, Mode]> = [
    ["off (baseline)", { kind: "off" }],
    ["market-anchored", { kind: "market" }],
    ["static δ=0", { kind: "delta", delta: 0 }],
    ["static δ=2", { kind: "delta", delta: 2 }],
    ["static δ=4", { kind: "delta", delta: 4 }],
    ["static δ=6", { kind: "delta", delta: 6 }],
    ["static δ=8", { kind: "delta", delta: 8 }],
  ];

  for (const [label, mode] of modes) {
    const { early, late, all, fitNotes } = run(mode);
    const crossLate = stat(
      "x",
      late.map(g5SignedEdge).filter((v): v is number => v !== null),
    );
    const crossAct = stat(
      "x",
      early.map(g5SignedBias).filter((v): v is number => v !== null),
    );
    const p4p4 = stat(
      "x",
      early
        .filter((p) => {
          const { home, away } = tiersOf(p);
          return home === "P4" && away === "P4" && p.edge !== null;
        })
        .map((p) => -(p.edge as number)),
    );
    const errors = all.map((p) => p.actualMargin - p.margin);
    const graded = all.filter((p) => p.favoriteWon !== null);
    let worst = 0;
    for (const [lo, hi] of [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]] as const) {
      const b = graded.filter((p) => p.favWinProb >= lo && p.favWinProb < hi);
      if (b.length === 0) continue;
      const predicted = mean(b.map((p) => p.favWinProb));
      const actual = b.filter((p) => p.favoriteWon).length / b.length;
      worst = Math.max(worst, Math.abs(predicted - actual) * 100);
    }
    const f = (s: { mean: number; se: number; t: number } | null) =>
      s ? `${s.mean >= 0 ? "+" : ""}${s.mean.toFixed(2)} t=${s.t.toFixed(1)}`.padEnd(18) : "–".padEnd(18);
    console.log(
      `${label.padEnd(17)} ${f(crossLate)}  ${f(crossAct)} ${
        p4p4 ? `${p4p4.mean >= 0 ? "+" : ""}${p4p4.mean.toFixed(2)}`.padEnd(10) : "–".padEnd(10)
      }   ${maeOf(errors).toFixed(2)} / ${nll(all).toFixed(4)}     ${worst.toFixed(1)}`,
    );
    if (fitNotes.length) console.log(`   ${fitNotes.join("   ")}`);
  }
}

/**
 * Talent baselines and final SP+ per season, on the rating-points scale —
 * the two ingredients every prior-construction tuner needs.
 */
async function loadPriorInputs(teamIdsByName: Map<string, number>) {
  const { cfbd } = await import("../src/lib/cfbd");
  const { cached } = await import("./lib/replay");
  const talentBySeason = new Map<number, Map<number, number>>();
  const spFinalBySeason = new Map<number, Map<number, number>>();
  for (const season of SEASONS) {
    const talent = await cached(`talent-${season}`, () => cfbd.talent(season), true);
    const vals = talent.map((t) => t.talent);
    const m = mean(vals);
    const std = Math.sqrt(mean(vals.map((v) => (v - m) ** 2)));
    const tMap = new Map<number, number>();
    for (const t of talent) {
      const id = teamIdsByName.get(t.team);
      if (id !== undefined) tMap.set(id, Math.max(-18, Math.min(18, ((t.talent - m) / std) * 5.5)));
    }
    talentBySeason.set(season, tMap);
    const sp = await cached(`sp-${season}`, () => cfbd.spRatings(season), true);
    spFinalBySeason.set(season, priorsFromSp(sp, teamIdsByName));
  }
  return { talentBySeason, spFinalBySeason };
}

/**
 * --tune-sigma: is a flat margin sigma honest across the season?
 *
 * Grid-searches priorSigmaExtra (the extra uncertainty carried by the
 * preseason prior, decaying with the prior's own weight) and reports NLL over
 * ALL weeks plus the early weeks alone. Win probabilities are recomputed from
 * each prediction's margin, so this scores the schedule without re-replaying.
 *
 * Decision rule: ship a schedule only if it improves both overall and early
 * NLL. If extra = 0 wins, the flat sigma was right and nothing changes.
 */
function tuneSigma(all: ReplayPrediction[]) {
  const graded = all.filter((p) => p.favoriteWon !== null);
  const score = (base: number, extra: number, preds: ReplayPrediction[]) => {
    let acc = 0;
    for (const p of preds) {
      const w = priorWeight(p.week, DEFAULT_PARAMS);
      const sigma = Math.sqrt(base ** 2 + (extra * w) ** 2);
      const homeWp = 1 / (1 + Math.exp(-(1.7 / sigma) * p.margin));
      const favWp = p.margin >= 0 ? homeWp : 1 - homeWp;
      acc += Math.log(p.favoriteWon ? favWp : 1 - favWp);
    }
    return -acc / preds.length;
  };

  const early = graded.filter((p) => p.week <= 4);
  console.log("\n== --tune-sigma: prior-driven extra uncertainty ==");
  console.log("base σ   extra   NLL (all)   NLL (weeks 1–4)");
  let best: { base: number; extra: number; s: number } | null = null;
  for (const base of [15.5, 16.0, 16.5, 16.8, 17.2]) {
    for (const extra of [0, 2, 4, 6, 8, 10, 12]) {
      const s = score(base, extra, graded);
      console.log(
        `${base.toFixed(1)}     ${String(extra).padStart(2)}      ${s.toFixed(4)}      ${score(base, extra, early).toFixed(4)}`,
      );
      if (!best || s < best.s) best = { base, extra, s };
    }
  }
  if (best) {
    const flat = score(best.base, 0, graded);
    console.log(
      `\nBest: marginSigma=${best.base} priorSigmaExtra=${best.extra} (NLL ${best.s.toFixed(4)} vs ${flat.toFixed(4)} flat)`,
    );
    console.log(
      best.extra === 0
        ? "→ flat sigma wins; keep priorSigmaExtra 0."
        : `→ set priorSigmaExtra=${best.extra}; week-1 σ becomes ${Math.sqrt(best.base ** 2 + best.extra ** 2).toFixed(2)}.`,
    );
  }
}

/**
 * --tune-preseason-tilts: should preseason off/def halves be seeded with a
 * shape, and if so from where?
 *
 * This replaces an earlier sweep whose arms all chained tilts forward, so the
 * configuration production actually runs (no tilts at all, halves reset to
 * even every preseason) was never on the board. Policies here differ in
 * exactly the way production differs.
 *
 * Scored purely on totals, because tilt is margin-neutral by construction
 * (off+def ≡ overall). That neutrality is exact for week-1 pricing but only
 * second-order afterwards: updateSubRatings clamps each SIDE's scoring error
 * at ±marginCap/2, and a tilt shifts the two per-side expectations in opposite
 * directions, so it can push one arm across the clamp when the even split
 * didn't. The margin MAE column below makes that drift visible — policies are
 * only comparable while it stays negligible, and a large divergence means
 * something is actually broken rather than merely clamping.
 */
const MARGIN_DRIFT_TOLERANCE = 0.25;
function tunePreseasonTilts(seasons: SeasonData[], teamIdsByName: Map<string, number>) {
  const spTilts = subTiltsFromSp(seasons[0].prevSp, teamIdsByName);

  interface Policy {
    label: string;
    seed: (finalTilts: Map<number, number> | null) => Map<number, number> | undefined;
  }
  const policies: Policy[] = [
    { label: "none (production)", seed: () => undefined },
    ...[0.4, 0.55, 0.7, 0.85].map((l) => ({
      label: `carryover λ=${l}`,
      seed: (f: Map<number, number> | null) => (f ? chainTilts(f, l) : scaleTilts(spTilts, l)),
    })),
    ...[0.25, 0.5, 0.75, 1.0].map((s) => ({
      label: `SP+ shape s=${s}`,
      seed: () => scaleTilts(spTilts, s),
    })),
  ];

  console.log("\n== --tune-preseason-tilts (totals MAE, chained seasons only) ==");
  console.log("policy               wk 1–2    wk 1–4    wk 5+     margin MAE");
  let baseline: { early: number; four: number } | null = null;
  let marginRef: number | null = null;

  for (const policy of policies) {
    let priors = priorsFromSp(seasons[0].prevSp, teamIdsByName);
    let tilts = policy.seed(null);
    const scored: ReplayPrediction[] = [];
    for (const season of seasons) {
      const { predictions, finalRatings, finalTilts } = replaySeason(
        season,
        priors,
        DEFAULT_PARAMS,
        tilts,
      );
      if (SCORED.includes(season.season)) scored.push(...predictions);
      priors = chainPriors(finalRatings);
      tilts = policy.seed(finalTilts);
    }
    const withTotal = scored.filter((p) => p.vegasTotal !== null);
    const totalsMae = (f: (p: ReplayPrediction) => boolean) =>
      maeOf(withTotal.filter(f).map((p) => p.actualTotal - p.projectedTotal));
    const early = totalsMae((p) => p.week <= 2);
    const four = totalsMae((p) => p.week <= 4);
    const marginMae = maeOf(scored.map((p) => p.actualMargin - p.margin));

    if (!baseline) baseline = { early, four };
    if (marginRef === null) marginRef = marginMae;
    else {
      const drift = Math.abs(marginMae - marginRef);
      if (drift > MARGIN_DRIFT_TOLERANCE) {
        throw new Error(
          `tilt policy "${policy.label}" moved margin MAE by ${drift.toFixed(3)} ` +
            `(${marginMae.toFixed(3)} vs ${marginRef.toFixed(3)}) — too far to be clamp binding; ` +
            "the off+def ≡ overall invariant is broken",
        );
      }
      if (drift > 0.01) {
        console.log(
          `  note: "${policy.label}" margin MAE drifted ${drift.toFixed(3)} from clamp binding`,
        );
      }
    }

    console.log(
      `${policy.label.padEnd(20)} ${early.toFixed(2)}     ${four.toFixed(2)}     ` +
        `${totalsMae((p) => p.week >= 5).toFixed(2)}     ${marginMae.toFixed(2)}`,
    );
  }
  console.log(
    "\nDecision rule: adopt a policy only if weeks 1–2 totals MAE beats " +
      `"none" by ≥0.15 (baseline ${baseline?.early.toFixed(2)}) AND weeks 1–4 is not worse by >0.05 ` +
      `(baseline ${baseline?.four.toFixed(2)}). Set PRESEASON_TILT_CARRY for the carryover winner.`,
  );
}

/**
 * --tune-coaching: fit the year-one install cost and the credit a proven hire
 * earns back, by rebuilding each season's priors with the coaching term active
 * and scoring the weeks where the prior dominates pricing.
 */
async function tuneCoaching(seasons: SeasonData[], teamIdsByName: Map<string, number>) {
  const { cfbd } = await import("../src/lib/cfbd");
  const { cached } = await import("./lib/replay");

  const coachRows = await cached(
    "coaches-history",
    () => cfbd.coaches({ minYear: 2001, maxYear: SEASONS[SEASONS.length - 1] }),
    true,
  );
  const transitions = new Map<number, Map<string, CoachTransition>>();
  for (const s of SEASONS) transitions.set(s, buildCoachTransitions(coachRows, s));
  const schoolById = new Map([...teamIdsByName].map(([school, id]) => [id, school]));
  const { talentBySeason, spFinalBySeason } = await loadPriorInputs(teamIdsByName);

  const changes = SCORED.map((s) =>
    [...(transitions.get(s)?.values() ?? [])].filter((t) => t.newHc),
  ).flat();
  console.log(
    `\n== --tune-coaching == (${changes.length} head-coach changes across ${SCORED.join(", ")}, ` +
      `${changes.filter((t) => t.overPerf !== null).length} with prior HC history)`,
  );

  const applyCoaching = (priors: Map<number, number>, year: number, p: ModelParams) => {
    const trans = transitions.get(year);
    if (!trans) return priors;
    const out = new Map<number, number>();
    for (const [teamId, rating] of priors) {
      const t = trans.get(schoolById.get(teamId) ?? "");
      const adj = coachingAdjustmentContinuous(
        { newHc: t?.newHc ?? false, overPerf: t?.overPerf ?? null },
        p,
      );
      out.set(teamId, rating + adj);
    }
    return out;
  };

  // Intercept grid runs to −5: the first fit bottomed out AT the −2.5 boundary
  // with NLL still falling, which means it was unconverged and the reported
  // optimum was an artifact of where the grid stopped.
  console.log("intercept  slope   early NLL   early MAE");
  let best: { i: number; s: number; nll: number } | null = null;
  const grid = new Map<string, number>();
  for (const newHcIntercept of [0, -0.5, -1, -1.5, -2, -2.5, -3, -3.5, -4, -4.5, -5]) {
    for (const newHcSlope of [0, 0.15, 0.3, 0.45]) {
      const params: ModelParams = { ...DEFAULT_PARAMS, newHcIntercept, newHcSlope };
      let priors = applyCoaching(
        priorsFromSp(seasons[0].prevSp, teamIdsByName),
        SEASONS[0],
        params,
      );
      const early: ReplayPrediction[] = [];
      for (const season of seasons) {
        const { predictions, finalRatings } = replaySeason(season, priors, DEFAULT_PARAMS);
        if (SCORED.includes(season.season)) early.push(...predictions.filter((p) => p.week <= 4));
        const spFinal = spFinalBySeason.get(season.season)!;
        const talent = talentBySeason.get(season.season)!;
        const next = new Map<number, number>();
        for (const [teamId, rating] of finalRatings) {
          const sp = spFinal.get(teamId);
          const base = sp !== undefined ? 0.5 * rating + 0.5 * sp : rating;
          next.set(teamId, 0.7 * base + 0.3 * (talent.get(teamId) ?? -8));
        }
        priors = applyCoaching(next, season.season + 1, params);
      }
      const n = nll(early);
      grid.set(`${newHcIntercept}|${newHcSlope}`, n);
      console.log(
        `${newHcIntercept.toFixed(2).padStart(6)}     ${newHcSlope.toFixed(2)}    ${n.toFixed(4)}      ` +
          `${maeOf(early.map((p) => p.actualMargin - p.margin)).toFixed(2)}`,
      );
      if (!best || n < best.nll) best = { i: newHcIntercept, s: newHcSlope, nll: n };
    }
  }
  if (best) {
    console.log(
      `\nBest: newHcIntercept=${best.i} newHcSlope=${best.s} (NLL ${best.nll.toFixed(4)}). ` +
        (best.i === 0 && best.s === 0
          ? "→ do-nothing wins; leave both at 0."
          : "→ set these in DEFAULT_PARAMS and bump MODEL_VERSION."),
    );
    if (best.i <= -5) {
      console.log(
        "!! WARNING: the intercept is still at the edge of the grid, so this optimum is\n" +
          "   unconverged. A penalty this large is more likely absorbing something else\n" +
          "   (new hires follow bad seasons, so the prior may simply be over-carrying)\n" +
          "   than measuring a real coaching effect. Widen further before shipping it.",
      );
    }
    const zeroSlopeNll = grid.get(`${best.i}|0`);
    const slopeInert =
      zeroSlopeNll !== undefined && Math.abs(best.nll - zeroSlopeNll) < 1e-4;
    if (slopeInert || best.s === 0) {
      console.log(
        "Coach QUALITY (slope) earns nothing here: NLL is flat across slope values, and\n" +
          "every strong hire clamps to the same adjustment. Ship the intercept alone —\n" +
          "'a new head coach costs points' is supported; 'a better one costs less' is not.",
      );
    }
    const top = changes
      .filter((t) => t.overPerf !== null)
      .sort((a, b) => Math.abs((b.overPerf as number)) - Math.abs(a.overPerf as number))
      .slice(0, 10);
    console.log("\nLargest coach-quality signals (sanity check):");
    for (const t of top) {
      const adj = coachingAdjustmentContinuous(
        { newHc: true, overPerf: t.overPerf },
        { ...DEFAULT_PARAMS, newHcIntercept: best.i, newHcSlope: best.s },
      );
      console.log(
        `  ${t.school.padEnd(24)} ${(t.coach ?? "?").padEnd(22)} overPerf ${(t.overPerf as number).toFixed(2)} → ${adj.toFixed(2)} pts`,
      );
    }
  }
}

/**
 * --tune-team-hfa: is a per-team home-field advantage real, and does 0.5 earn
 * its place? (02:M-05 / 03:M-1v)
 *
 * `teamHfaBlend` has shipped at 0.5 since SPEC §2.3 was written and has never
 * been validated by any replay. STATUS records it as blocked on "CFBD
 * publishing 2026 data", and that was the wrong blocker: it is only true if the
 * validation means "score the 2026 team_hfa table". It does not. `teamHfaBlend`
 * is a model parameter, and the point-in-time question — build each team's HFA
 * from seasons strictly BEFORE S, price S with it, score S — needs no 2026 data
 * at all. It needs prior seasons, which is exactly what the wide window is.
 *
 * The reason nobody noticed is structural and worth stating: production prices
 * with a per-team table and the replay priced with a flat scalar, so the ~+1.9
 * inflation audit 03:M-1 found in that table could not appear in any
 * calibration report. `replaySeason` now accepts `hfaByTeam`, which closes the
 * gap that made M-1 invisible.
 *
 * PRE-REGISTERED, fixed before the first number is printed:
 *
 *   Gate 0 — identification, and it runs FIRST. Split-half correlation of raw
 *   team HFA across disjoint prior seasons (odd vs even years, 2020 excluded
 *   from both) must be >= 0.30 over >= 100 teams. If a team's home edge does
 *   not reproduce against itself on disjoint samples there is nothing to blend,
 *   no accuracy number can rescue it, and the answer is teamHfaBlend = 0 —
 *   which is what the STATUS row already names as the fallback. Failing Gate 0
 *   closes 02:M-05 on evidence rather than by deferral.
 *
 *   Only if Gate 0 clears, grid the blend and ship a non-zero value only if ALL:
 *     1. pooled MAE improves by >= 0.05 vs blend 0 — a bar, not an argmin;
 *     2. home-signed bias |t| < 2 at the winner, and no worse than at blend 0.
 *        This is the number M-1 threatened, so it is the one that must hold;
 *     3. every win-probability bucket within 3 points;
 *     4. the winner is INTERIOR to the grid. A winner at 1.0 is unconverged and
 *        ships nothing — five parameters in this file have already run to a
 *        boundary, which the changelog calls the single most reliable
 *        diagnostic of the whole effort;
 *     5. the era-flip and recency rules below both clear.
 *
 * 2020 is excluded from the raw-HFA source window, always and separately from
 * the scoring exclusion. An empty-stadium season measures a different quantity,
 * and the entire claim of a per-team HFA is that it measures the same one
 * repeatedly.
 *
 * Whatever happens, it gets a decisions-table row carrying the window label.
 */
function tuneTeamHfa(seasons: SeasonData[], teamIdsByName: Map<string, number>) {
  console.log("\n== --tune-team-hfa ==  does a per-team home edge exist, and is 0.5 right?");
  console.log(
    "Pre-registered: Gate 0 is a split-half correlation >= 0.30 over >= 100 teams. If that\n" +
      "fails, teamHfaBlend = 0 and 02:M-05 closes on evidence. If it passes, a value ships only\n" +
      "on: pooled MAE better by >= 0.05, |t| on home bias < 2 and no worse than at blend 0,\n" +
      "every win-prob bucket within 3 points, and an INTERIOR winner.\n",
  );

  const fbsIds = new Set(priorsFromSp(seasons[0].prevSp, teamIdsByName).keys());
  for (const s of seasons) {
    for (const id of priorsFromSp(s.sp ?? [], teamIdsByName).keys()) fbsIds.add(id);
  }

  // Gate 0, before any accuracy number exists.
  const firstScored = SCORED[0];
  const split = hfaSplitHalf(seasons, fbsIds, firstScored);
  console.log(
    `Gate 0 — split-half correlation of raw team HFA (seasons < ${firstScored}, 2020 excluded): ` +
      `r = ${Number.isNaN(split.r) ? "n/a" : split.r.toFixed(3)} over n = ${split.n} teams.`,
  );
  if (!(split.r >= 0.3) || split.n < 100) {
    console.log(
      "\nGATE 0 FAILS. A team's home edge does not reproduce against itself on disjoint\n" +
        "samples, so there is no per-team signal to blend and no MAE number below could mean\n" +
        "anything. Pre-registered outcome: set teamHfaBlend = 0 and record it. That is 02:M-05\n" +
        "answered on evidence — the same shape as Q4 being answered by --tune-fcs's Gate 0.",
    );
    if (split.n > 0) console.log("(Grid still printed below, for the record only.)\n");
  }

  const replayAll = (blend: number) => {
    const params: ModelParams = { ...DEFAULT_PARAMS, teamHfaBlend: blend };
    let priors = priorsFromSp(seasons[0].prevSp, teamIdsByName);
    const all: ReplayPrediction[] = [];
    for (const season of seasons) {
      // Strictly-prior HFA: what a week-1 prediction for this season could
      // actually have known. Rebuilt per season, which is the whole point.
      const { raw, mean: rawMean } = rawTeamHfa(seasons, fbsIds, { before: season.season });
      const hfaByTeam = new Map<number, number>();
      for (const [id, value] of raw) {
        hfaByTeam.set(id, centeredBlendedHfa(value, rawMean, params));
      }
      const { predictions, finalRatings } = replaySeason(
        season,
        priors,
        params,
        undefined,
        undefined,
        blend === 0 ? undefined : hfaByTeam,
      );
      all.push(...predictions);
      priors = chainPriors(finalRatings);
    }
    return scoredOnly(all);
  };

  console.log("blend   MAE      bias(±SE)       NLL      worst bucket   mean applied HFA");
  const rows: Array<{ blend: number; mae: number; bias: number; se: number; nll: number }> = [];
  for (const blend of [0, 0.25, 0.5, 0.75, 1.0]) {
    const preds = replayAll(blend);
    const errs = preds.map((p) => p.actualMargin - p.margin);
    const bias = mean(errs);
    const sigma = Math.sqrt(mean(errs.map((e) => e * e)));
    const se = sigma / Math.sqrt(errs.length);
    const graded = preds.filter((p) => p.favoriteWon !== null);
    let worst = 0;
    for (const [lo, hi] of [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]] as const) {
      const b = graded.filter((p) => p.favWinProb >= lo && p.favWinProb < hi);
      if (b.length < 50) continue;
      worst = Math.max(
        worst,
        Math.abs(mean(b.map((p) => p.favWinProb)) - b.filter((p) => p.favoriteWon).length / b.length) *
          100,
      );
    }
    const { raw, mean: rawMean } = rawTeamHfa(seasons, fbsIds, {
      before: SCORED[SCORED.length - 1],
    });
    const applied =
      raw.size === 0
        ? DEFAULT_PARAMS.baseHfa
        : mean(
            [...raw.values()].map((v) =>
              centeredBlendedHfa(v, rawMean, { ...DEFAULT_PARAMS, teamHfaBlend: blend }),
            ),
          );
    rows.push({ blend, mae: maeOf(errs), bias, se, nll: nll(preds) });
    console.log(
      `${blend.toFixed(2)}    ${maeOf(errs).toFixed(3)}   ${bias >= 0 ? "+" : ""}${bias.toFixed(2)} ±${se.toFixed(2)}    ` +
        `${nll(preds).toFixed(4)}   ${worst.toFixed(1)} pts        ${applied.toFixed(2)}`,
    );
  }

  const flat = rows.find((r) => r.blend === 0);
  const best = rows.reduce((a, b) => (b.mae < a.mae ? b : a));
  if (flat) {
    const gain = flat.mae - best.mae;
    const interior = best.blend !== 0 && best.blend !== 1.0;
    console.log(
      `\nBest blend ${best.blend} — MAE gain vs flat ${gain >= 0 ? "+" : ""}${gain.toFixed(3)} ` +
        `(bar 0.05), |t| on bias ${Math.abs(best.bias / best.se).toFixed(2)} (bar < 2), ` +
        `${interior ? "INTERIOR" : "AT A GRID EDGE — unconverged, ships nothing"}.`,
    );
    console.log(
      gain >= 0.05 && interior && Math.abs(best.bias / best.se) < 2 && split.r >= 0.3
        ? `→ every pre-registered criterion clears. Record ${best.blend} with the window label.`
        : "→ at least one criterion fails: teamHfaBlend stays where it is, or goes to 0 per Gate 0.\n" +
            "   Record the numbers either way — a rejection with a number in it is the point.",
    );
  }
  console.log(eraNote("teamHfaBlend"));
}

/**
 * --tune-fcs: is "top-tier FCS" a real category, and what are the two numbers?
 *
 * SPEC §2.1 has always specified two FCS buckets (top ≈ −25, other ≈ −35) and
 * the code has always run a flat −30 — `fcsTopRating`/`fcsOtherRating` were
 * dead constants, and every other fitted parameter in the model was fitted
 * against the flat number. This is the run that decides whether the split is
 * worth having.
 *
 * PRE-REGISTERED, fixed before the first number is printed:
 *
 *   Gate 0 — does the split exist at all? At the flat −30, compare the
 *   bucket-signed bias of the top half against the other half. If |t| < 2 the
 *   two groups are not distinguishable in our own errors, and the answer to Q4
 *   is "one bucket, on evidence" rather than "one bucket, by deferral". Record
 *   the number and ship nothing.
 *
 *   Only if Gate 0 clears, grid (top, other) and ship a pair only if ALL of:
 *     1. both per-bucket biases move toward zero, neither |t| > 2 after;
 *     2. FBS-vs-FCS margin MAE improves by >= 0.25 points — a bar, not an
 *        argmin. The claimed defect is a several-point misprice; anything
 *        smaller is noise on blowouts;
 *     3. no spillover: pooled MAE <= baseline + 0.02, pooled NLL <= baseline +
 *        0.0005. The FCS rating feeds updateSubRatings for the FBS team that
 *        played the buy game, so moving it moves FBS ratings;
 *     4. it is a SPLIT, not a level shift: the population-weighted mean FCS
 *        rating stays within +/-1.5 of −30. A level shift would re-open the
 *        shipped --tune-tier-recenter fit, which is a different experiment.
 *
 * Whatever happens, it gets a decisions-table row with the numbers in it.
 *
 * The market is deliberately NOT the instrument here. Every other tuner
 * prefers "vs MARKET" because it is lower variance, but books barely hang FCS
 * buy games, so that slice collapses to a handful of rows. This scores vs
 * ACTUAL.
 *
 * Lookahead: buckets for season S are built from seasons strictly before S,
 * which with SEASONS = 2023–25 means 2024 sees one prior season and 2025 sees
 * two. Production gets three. That window mismatch is real and is the first
 * thing to check if a result looks too good — `cfbd.games(2021)`/`(2022)` into
 * the cache would close it at the cost of two metered calls.
 */
async function tuneFcs(seasons: SeasonData[], teamIdsByName: Map<string, number>) {
  const { stat } = await import("./lib/slices");

  console.log("\n== --tune-fcs ==  are there two kinds of FCS opponent?");
  console.log(
    "Pre-registered: Gate 0 is a two-sample |t| >= 2 between the buckets' vs-ACTUAL bias\n" +
      "at the flat anchor. If that fails, ship nothing and record the number. If it passes,\n" +
      "a pair ships only on: both biases toward zero (|t| < 2), FBS-vs-FCS MAE better by\n" +
      ">= 0.25, pooled MAE within +0.02 and NLL within +0.0005, and mean FCS rating within\n" +
      "+/-1.5 of -30 (a split, not a level shift).\n",
  );

  // FBS membership, per season rather than frozen at the first one.
  //
  // This read `priorsFromSp(seasons[0].prevSp)` — the FBS list of ONE year,
  // applied to the whole window. Over 2023-25 that was nearly harmless. Over
  // 2015-2025 it would classify James Madison's 2023 games, Coastal Carolina's
  // 2018 games and Liberty's 2019 games as FCS buy games, which is precisely
  // the population this tuner fits its two numbers on: it would answer the
  // question it exists to settle, confidently, using games that are not buy
  // games at all. See admitNewFbs in scripts/lib/replay.ts.
  const fbsBySeason = new Map<number, Set<number>>();
  for (const s of seasons) {
    const sp = priorsFromSp(s.sp ?? [], teamIdsByName);
    fbsBySeason.set(
      s.season,
      new Set(sp.size > 0 ? sp.keys() : priorsFromSp(s.prevSp, teamIdsByName).keys()),
    );
  }
  // Per-season lookup, so a promoted team's pre-promotion games still count as
  // buy games and its post-promotion games stop counting. Falls back to the
  // union when a season has no SP+ at all, which keeps the old behaviour rather
  // than declaring everybody FCS.
  const anyFbs = new Set([...fbsBySeason.values()].flatMap((set) => [...set]));
  const fbsIds = (season: number): ReadonlySet<number> => fbsBySeason.get(season) ?? anyFbs;
  const allGames = seasons.flatMap((s) => s.games);

  // Buckets per scored season, lookahead-clean.
  const topBySeason = new Map<number, ReadonlySet<number>>();
  for (const s of seasons) {
    const margins = fcsMarginsVsFbs(allGames, fbsIds, { before: s.season });
    topBySeason.set(s.season, fcsTopIds(margins));
  }
  for (const s of SCORED) {
    const top = topBySeason.get(s);
    const n = fcsMarginsVsFbs(allGames, fbsIds, { before: s }).size;
    console.log(`  ${s}: ${top?.size ?? 0} top of ${n} rated FCS teams (from seasons < ${s})`);
  }

  const replayAll = (params: ModelParams) => {
    let priors = priorsFromSp(seasons[0].prevSp, teamIdsByName);
    const all: ReplayPrediction[] = [];
    for (const season of seasons) {
      const { predictions, finalRatings } = replaySeason(
        season,
        priors,
        params,
        undefined,
        topBySeason.get(season.season),
      );
      if (SCORED.includes(season.season)) all.push(...predictions);
      priors = chainPriors(finalRatings);
    }
    return all;
  };

  /** Error signed from the FCS side: + means the FCS team beat our number. */
  const fcsSigned = (p: ReplayPrediction) =>
    p.homeFbs ? -(p.actualMargin - p.margin) : p.actualMargin - p.margin;
  const isBuyGame = (p: ReplayPrediction) => p.homeFbs !== p.awayFbs;
  const fcsIdOf = (p: ReplayPrediction) => (p.homeFbs ? p.awayId : p.homeId);
  const inTop = (p: ReplayPrediction) =>
    topBySeason.get(p.season)?.has(fcsIdOf(p)) ?? false;

  const base = replayAll(DEFAULT_PARAMS);
  const baseBuy = base.filter(isBuyGame);
  const baseMae = maeOf(base.map((p) => p.actualMargin - p.margin));
  const baseNll = nll(base);
  const baseBuyMae = maeOf(baseBuy.map(fcsSigned));

  const topArm = stat("top", baseBuy.filter(inTop).map(fcsSigned));
  const otherArm = stat("other", baseBuy.filter((p) => !inTop(p)).map(fcsSigned));
  console.log(
    `\nGate 0 — at the flat ${DEFAULT_PARAMS.fcsOtherRating}, vs ACTUAL, FCS-signed:`,
  );
  for (const arm of [topArm, otherArm]) {
    if (arm === null) continue;
    console.log(
      `  ${arm.label.padEnd(6)} n=${String(arm.n).padStart(4)}  ` +
        `${arm.mean >= 0 ? "+" : ""}${arm.mean.toFixed(2)} +/-${arm.se.toFixed(2)}  t=${arm.t.toFixed(2)}`,
    );
  }
  if (topArm === null || otherArm === null) {
    console.log("\nNot enough buy games in one bucket to test. Nothing ships.");
    return;
  }
  const diff = topArm.mean - otherArm.mean;
  const diffSe = Math.sqrt(topArm.se ** 2 + otherArm.se ** 2);
  const diffT = diffSe > 0 ? diff / diffSe : 0;
  console.log(
    `  difference  ${diff >= 0 ? "+" : ""}${diff.toFixed(2)} +/-${diffSe.toFixed(2)}  t=${diffT.toFixed(2)}`,
  );
  console.log(`  baseline: FBS-vs-FCS MAE ${baseBuyMae.toFixed(3)}, ` +
    `pooled MAE ${baseMae.toFixed(3)}, NLL ${baseNll.toFixed(4)}`);

  if (Math.abs(diffT) < 2) {
    console.log(
      "\nGATE 0 FAILS (|t| < 2). The two buckets are not distinguishable in our own\n" +
        "errors, so a split has nothing to correct. Ship nothing, keep both params at\n" +
        `${DEFAULT_PARAMS.fcsOtherRating}, and record this number in the decisions table —\n` +
        "that is Q4 answered on evidence rather than deferred.",
    );
    return;
  }

  console.log("\nGate 0 clears. Grid:\n");
  console.log("  top   other   buyMAE    bias(top)      bias(other)    pooled MAE / NLL   meanFCS");
  for (const top of [-22, -24, -26, -28, -30]) {
    for (const other of [-30, -32, -34, -36, -38]) {
      if (top < other) continue;
      const params: ModelParams = { ...DEFAULT_PARAMS, fcsTopRating: top, fcsOtherRating: other };
      const preds = replayAll(params);
      const buy = preds.filter(isBuyGame);
      const t = stat("top", buy.filter(inTop).map(fcsSigned));
      const o = stat("other", buy.filter((p) => !inTop(p)).map(fcsSigned));
      const nTop = t?.n ?? 0;
      const nOther = o?.n ?? 0;
      const meanFcs = (top * nTop + other * nOther) / Math.max(1, nTop + nOther);
      console.log(
        `  ${String(top).padStart(3)}   ${String(other).padStart(4)}   ` +
          `${maeOf(buy.map(fcsSigned)).toFixed(3)}   ` +
          `${(t?.mean ?? 0).toFixed(2).padStart(6)} (t=${(t?.t ?? 0).toFixed(1).padStart(5)})  ` +
          `${(o?.mean ?? 0).toFixed(2).padStart(6)} (t=${(o?.t ?? 0).toFixed(1).padStart(5)})  ` +
          `${maeOf(preds.map((p) => p.actualMargin - p.margin)).toFixed(3)} / ${nll(preds).toFixed(4)}   ` +
          `${meanFcs.toFixed(1)}`,
      );
    }
  }
  console.log(
    "\nApply the four criteria above to this table. A cell that wins on buyMAE alone\n" +
      "does not ship — criteria 3 and 4 are what stop an FCS fit from quietly re-leveling\n" +
      "the whole pool and re-opening --tune-tier-recenter.",
  );
}

/**
 * --tune-hfa: home-field advantage in isolation, K held at its validated 0.3.
 *
 * The joint K/HFA refit picked K=0.4 (grid boundary) and HFA=3.6, and that
 * config bought zero margin MAE while degrading win-prob calibration (the
 * 0.7–0.8 bucket went from 1.6 points off to 6.2), worsening totals MAE and
 * flipping the bias to −0.63. NLL is one scalar; the product's claims are
 * calibration, totals and margin together, and optimizing the first can move
 * the others the wrong way.
 *
 * So: change one thing, and judge it on bias, MAE and calibration at once.
 * The target is zero bias without giving anything else up.
 */
function tuneHfa(seasons: SeasonData[], teamIdsByName: Map<string, number>) {
  console.log("\n== --tune-hfa ==  K fixed at 0.3; the goal is zero bias, not minimum NLL");
  console.log("HFA    bias(±SE)      MAE      NLL      worst bucket miss");
  for (const baseHfa of [2.3, 2.6, 2.8, 3.0, 3.2, 3.6]) {
    const params: ModelParams = { ...DEFAULT_PARAMS, baseHfa };
    let priors = priorsFromSp(seasons[0].prevSp, teamIdsByName);
    const all: ReplayPrediction[] = [];
    for (const season of seasons) {
      const { predictions, finalRatings } = replaySeason(season, priors, params);
      all.push(...predictions);
      priors = chainPriors(finalRatings);
    }
    const scored = scoredOnly(all);
    const errs = scored.map((p) => p.actualMargin - p.margin);
    const bias = mean(errs);
    const sigma = Math.sqrt(mean(errs.map((e) => e * e)));
    const se = sigma / Math.sqrt(errs.length);

    // Largest calibration gap across the win-prob buckets — the thing the
    // joint refit quietly broke.
    const graded = scored.filter((p) => p.favoriteWon !== null);
    let worst = 0;
    for (const [lo, hi] of [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]] as const) {
      const b = graded.filter((p) => p.favWinProb >= lo && p.favWinProb < hi);
      if (b.length < 50) continue;
      const predicted = mean(b.map((p) => p.favWinProb));
      const actual = b.filter((p) => p.favoriteWon).length / b.length;
      worst = Math.max(worst, Math.abs(predicted - actual) * 100);
    }
    console.log(
      `${baseHfa.toFixed(1)}    ${bias >= 0 ? "+" : ""}${bias.toFixed(2)} ±${se.toFixed(2)}    ` +
        `${maeOf(errs).toFixed(3)}   ${nll(scored).toFixed(4)}   ${worst.toFixed(1)} pts`,
    );
  }
  console.log(
    "\nShip a value only if it moves bias toward zero WITHOUT growing MAE or the\n" +
      "worst bucket miss. A calibration regression is not worth a bias fix.",
  );
  console.log(eraNote("baseHfa"));
}

/**
 * --tune-ensemble: do the published rating systems know things we don't?
 *
 * SP+ already is opponent-adjusted play-level efficiency with garbage-time
 * filtering — the thing --tune-epa failed to reconstruct. Rather than rebuild
 * it, consume it. Our margin-based Elo and a play-based regression fail in
 * different ways, and blending models with different error sources is the most
 * reliable gain available.
 *
 * POINT-IN-TIME DISCIPLINE, which shapes the whole test: cfbd.spRatings(year)
 * returns ONE row per team-year — the FINAL rating. Feeding final-2024 SP+ into
 * a week-5-2024 prediction is lookahead and would produce a beautiful,
 * meaningless result. Only two terms are safe on history:
 *   - weekly Elo, which CFBD genuinely serves per week
 *   - PRIOR-season final SP+, known before a ball is snapped, decayed across
 *     the season so it fades as real results accumulate
 * Same-season SP+/FPI are deliberately absent here; see systemWeights.
 */
async function tuneEnsemble(seasons: SeasonData[], teamIdsByName: Map<string, number>) {
  const { cfbd } = await import("../src/lib/cfbd");
  const { cached } = await import("./lib/replay");

  // Weekly Elo per season. One call per season-week, disk-cached.
  const eloBySeasonWeek = new Map<string, Map<number, number>>();
  for (const season of SEASONS) {
    for (let week = 1; week <= 15; week++) {
      const rows = await cached(
        `elo-${season}-wk${week}`,
        () => cfbd.eloRatings(season, week),
        true,
      ).catch(() => []);
      const map = new Map<number, number>();
      for (const r of rows) {
        const id = teamIdsByName.get(r.team);
        if (id !== undefined && Number.isFinite(r.elo)) map.set(id, r.elo);
      }
      if (map.size > 0) eloBySeasonWeek.set(`${season}|${week}`, map);
    }
  }

  // Prior-season final SP+ — legitimately known before the season starts.
  const priorSp = new Map<number, Map<number, number>>();
  for (const season of SEASONS) {
    const rows = await cached(`sp-${season - 1}`, () => cfbd.spRatings(season - 1), true);
    priorSp.set(season, priorsFromSp(rows, teamIdsByName));
  }

  // Replay once with production params; the systems are evaluated against the
  // same predictions the model actually made.
  let priors = priorsFromSp(seasons[0].prevSp, teamIdsByName);
  const all: ReplayPrediction[] = [];
  for (const season of seasons) {
    const { predictions, finalRatings } = replaySeason(season, priors, DEFAULT_PARAMS);
    all.push(...predictions);
    priors = chainPriors(finalRatings);
  }

  const rows = all
    .map((p) => {
      // LAG BY ONE WEEK. CFBD's week-N Elo is the rating AFTER week N's games,
      // so joining on the same week hands the regression the result of the
      // game it is predicting. The first version of this did exactly that and
      // produced t=45 on Elo, a NEGATIVE coefficient on our own model, and MAE
      // 9.44 against a market at 11.98 — i.e. "beats Vegas by 2.5 points",
      // which is the shape of a leak, not a discovery.
      //
      // Week 1 falls back to the previous season's final Elo. Both are what a
      // Thursday freeze would actually have in hand.
      const elo =
        p.week > 1
          ? eloBySeasonWeek.get(`${p.season}|${p.week - 1}`)
          : lastEloOfSeason(eloBySeasonWeek, p.season - 1);
      const eloH = elo?.get(p.homeId);
      const eloA = elo?.get(p.awayId);
      const sp = priorSp.get(p.season);
      const spH = sp?.get(p.homeId);
      const spA = sp?.get(p.awayId);
      if (eloH === undefined || eloA === undefined || spH === undefined || spA === undefined) {
        return null;
      }
      return {
        p,
        // 25 Elo ≈ 1 point, the same conversion freezeJob uses for its
        // consensus flag (jobs-core.ts).
        eloMargin: (eloH - eloA) / 25,
        // Decays exactly as the preseason prior does, so a stale anchor stops
        // mattering once results exist.
        spMargin: (spH - spA) * priorWeight(p.week, DEFAULT_PARAMS),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  console.log(
    `\n== --tune-ensemble ==  ${rows.length} of ${all.length} games have weekly Elo + prior SP+`,
  );
  if (rows.length < 200) {
    console.log("Too few joined games to fit — check the Elo weekly coverage first.");
    return;
  }

  // Fit on 2023–24 ONLY. An earlier version fit on all three seasons and then
  // called 2025 a "holdout" — it wasn't one, 2025 was in the fit, and an
  // in-sample number dressed as out-of-sample is how a weight ships on
  // evidence it doesn't have.
  const HOLDOUT = SEASONS[SEASONS.length - 1];
  const fitRows = rows.filter((r) => r.p.season !== HOLDOUT);
  const holdoutRows = rows.filter((r) => r.p.season === HOLDOUT);
  console.log(`Fitting on ${fitRows.length} games (< ${HOLDOUT}), holding out ${holdoutRows.length}`);

  const { beta, se } = ols(
    fitRows.map((r) => r.p.actualMargin),
    [
      fitRows.map((r) => r.p.margin),
      fitRows.map((r) => r.eloMargin),
      fitRows.map((r) => r.spMargin),
    ],
  );
  const labels = ["intercept", "ours", "elo (weekly)", "prior SP+ (decayed)"];
  console.log("term                    coef      se       t");
  for (let i = 0; i < beta.length; i++) {
    console.log(
      `${labels[i].padEnd(22)} ${beta[i].toFixed(3).padStart(7)}  ${se[i].toFixed(3).padStart(6)}  ` +
        `${(beta[i] / se[i]).toFixed(2).padStart(6)}`,
    );
  }
  console.log(
    `\nBonferroni over ${ENSEMBLE_TESTS} regressors at α=0.05 → a system earns weight only at |t| > ${TIER_T}`,
  );

  // Blended prediction vs ours alone, in-sample and on the 2025 holdout.
  const blended = (r: (typeof rows)[number]) =>
    beta[0] + beta[1] * r.p.margin + beta[2] * r.eloMargin + beta[3] * r.spMargin;
  console.log("\nsample              ours MAE   ensemble MAE   delta");
  for (const [label, seg] of [
    [`fit (< ${HOLDOUT})`, fitRows],
    [`HOLDOUT ${HOLDOUT}`, holdoutRows],
  ] as Array<[string, typeof rows]>) {
    if (seg.length === 0) continue;
    const ours = maeOf(seg.map((r) => r.p.actualMargin - r.p.margin));
    const ens = maeOf(seg.map((r) => r.p.actualMargin - blended(r)));
    console.log(
      `${label.padEnd(19)} ${ours.toFixed(3)}      ${ens.toFixed(3)}         ${(ours - ens).toFixed(3)}`,
    );
    warnIfTooGood(`ensemble (${label})`, ens);
  }
  if (beta[1] < 0) {
    console.log(
      "!! Our own coefficient is NEGATIVE: the fit is subtracting this model, which\n" +
        "   means another regressor already carries the answer. Leak, not signal.",
    );
  }

  // Equal weights, no fitted coefficients. The fit above lands at ~0.45/0.50,
  // i.e. it is telling us the two models deserve equal say — and an equal-weight
  // ensemble cannot overfit because there is nothing to fit. The in-sample to
  // holdout decay of the fitted version (roughly halving) is the classic sign
  // that its coefficients carry season-specific noise, so the simpler form is
  // often the one that survives.
  console.log("\n-- Equal weights (no fitted coefficients) --");
  console.log("variant                       holdout MAE   vs ours");
  const oursHoldout = maeOf(holdoutRows.map((r) => r.p.actualMargin - r.p.margin));
  for (const [label, predict] of [
    ["50/50 ours+elo", (r: (typeof rows)[number]) => 0.5 * r.p.margin + 0.5 * r.eloMargin],
    [
      "50/50 + fitted intercept",
      (r: (typeof rows)[number]) => beta[0] + 0.5 * r.p.margin + 0.5 * r.eloMargin,
    ],
  ] as Array<[string, (r: (typeof rows)[number]) => number]>) {
    const mae = maeOf(holdoutRows.map((r) => r.p.actualMargin - predict(r)));
    console.log(
      `${label.padEnd(29)} ${mae.toFixed(3)}         ${(oursHoldout - mae).toFixed(3)}`,
    );
    warnIfTooGood(label, mae);
  }

  // Mean SIGNED error: the fitted intercept came in around +2 at t>4, which
  // says the blend wants a constant added to every home margin. Our model
  // already applies HFA, so a bias that size is a finding in its own right —
  // and MAE and sigma both hide it, since they are symmetric.
  const bias = (xs: (typeof rows)[number][]) =>
    mean(xs.map((r) => r.p.actualMargin - r.p.margin));
  console.log(
    `\nMean signed margin error (actual − ours): fit ${bias(fitRows).toFixed(2)}, ` +
      `holdout ${bias(holdoutRows).toFixed(2)}. Positive means we under-predict the home side.`,
  );
  console.log(
    `\nDecision rule: ship weights only if a system's t clears ${TIER_T} AND the 2025\n` +
      "holdout improves by ≥ 0.15 MAE. The EPA change bought 0.010 and was rejected;\n" +
      "anything of that size here is the same noise wearing a different hat.",
  );
}

const ENSEMBLE_TESTS = 3;

/** Latest week we have Elo for in a season — the pre-week-1 state for the next. */
function lastEloOfSeason(
  byWeek: Map<string, Map<number, number>>,
  season: number,
): Map<number, number> | undefined {
  for (let week = 15; week >= 1; week--) {
    const found = byWeek.get(`${season}|${week}`);
    if (found) return found;
  }
  return undefined;
}

/**
 * The closing line is the most accurate public estimate of a CFB margin there
 * is. Anything claiming to beat it by a wide margin in a backtest has a leak,
 * not an edge — so say so loudly rather than letting a spectacular number read
 * as success.
 *
 * This was hardcoded 11.98, measured on 2023-25. That is fine while the window
 * IS 2023-25 and wrong the moment it is not: the market's accuracy is not a
 * constant of nature, and policing an eleven-season run with a three-season
 * bar would either cry leak on every old season or miss a real one. Computed
 * from the loaded predictions instead, so the guard calibrates itself to
 * whatever window is running and there is one less number to re-fit by hand.
 *
 * Falls back to the historical constant when a window carries no stored lines
 * at all, so the check can never silently switch itself off.
 */
const MARKET_MAE_2023_25 = 11.98;

let marketMae = MARKET_MAE_2023_25;

function calibrateMarketBar(predictions: readonly ReplayPrediction[]): void {
  const withLine = predictions.filter((p) => p.vegasSpread !== null);
  if (withLine.length < 100) return;
  marketMae = maeOf(withLine.map((p) => p.actualMargin + (p.vegasSpread as number)));
}

function warnIfTooGood(label: string, mae: number) {
  if (mae < marketMae) {
    console.log(
      `!! ${label} MAE ${mae.toFixed(3)} beats the closing line (${marketMae.toFixed(2)} on this\n` +
        "   window). Treat this as a lookahead bug until proven otherwise: check that every\n" +
        "   input was knowable BEFORE kickoff, not merely published with that week's label.",
    );
  }
}

/**
 * --tune-epa: should ratings update from per-play efficiency instead of the
 * scoreboard?
 *
 * This is the largest known structural gap. The model has only ever seen final
 * scores; SP+ and every serious system are built on play data, and they beat us
 * by ~1.3 points of margin MAE. A final score is a noisy summary of ~150 plays,
 * so fitting on it means fitting on garbage time and special-teams variance.
 *
 * The blend preserves each game's TOTAL and moves only the margin, so this is
 * strictly a cleaner margin signal — totals modeling is unaffected.
 */
function tuneEpa(seasons: SeasonData[], teamIdsByName: Map<string, number>) {
  const covered = seasons.map(
    (s) => `${s.season}: ${new Set((s.advanced ?? []).map((r) => r.gameId)).size} games`,
  );
  console.log(`\n== --tune-epa ==  PPA coverage — ${covered.join(", ")}`);
  if (seasons.every((s) => (s.advanced ?? []).length === 0)) {
    console.log(
      "No advanced stats returned. Either the key's tier does not include\n" +
        "/stats/game/advanced, or the response shape differs — check before\n" +
        "concluding anything. The model stays score-only until this populates.",
    );
    return;
  }

  console.log("epaWeight   margin MAE   fitted σ    NLL      early MAE");
  let best: { w: number; mae: number } | null = null;
  for (const epaWeight of [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1]) {
    const params: ModelParams = { ...DEFAULT_PARAMS, epaWeight };
    let priors = priorsFromSp(seasons[0].prevSp, teamIdsByName);
    const all: ReplayPrediction[] = [];
    for (const season of seasons) {
      const { predictions, finalRatings } = replaySeason(season, priors, params);
      all.push(...predictions);
      priors = chainPriors(finalRatings);
    }
    // Scored on the model's own accuracy against real results — the efficiency
    // blend changes how ratings LEARN, never what they are graded against.
    const scored = scoredOnly(all);
    const errs = scored.map((p) => p.actualMargin - p.margin);
    const mae = maeOf(errs);
    const sigma = Math.sqrt(mean(errs.map((e) => e * e)));
    const early = scored.filter((p) => p.week <= 4);
    console.log(
      `${epaWeight.toFixed(2).padStart(7)}     ${mae.toFixed(3)}      ${sigma.toFixed(2)}     ` +
        `${nll(scored).toFixed(4)}   ${maeOf(early.map((p) => p.actualMargin - p.margin)).toFixed(2)}`,
    );
    if (!best || mae < best.mae) best = { w: epaWeight, mae };
  }
  if (best) {
    console.log(`\nBest: epaWeight=${best.w} (margin MAE ${best.mae.toFixed(3)})`);
    console.log(
      best.w === 0
        ? "→ scores win; efficiency adds nothing here. Keep epaWeight 0."
        : `→ set epaWeight=${best.w}. Market MAE is ${marketMae.toFixed(2)} — that is the bar this is\n` +
            "  chasing, and closing the gap to it is the whole point of the change.",
    );
    if (best.w === 1) {
      console.log("!! At the grid edge; pure efficiency won. Sanity-check before shipping.");
    }
  }
}

/**
 * --tune-churn: how hard should returning production move a preseason rating,
 * and does a high-talent roster blunt it?
 *
 * Two things forced this. The "defense" input was a second offense metric, so
 * the effective weight was ~10 on one correlated quantity rather than 5+5 on
 * two independent ones — and it saturated the ±6 clamp for four of the top 40
 * teams in the 2026 build. And blue bloods lose the most production to the NFL
 * while replacing it with blue-chips, so churn and talent applied additively
 * double-penalize the programs that reload (Alabama: 2nd-highest talent, 26th).
 */
async function tuneChurn(seasons: SeasonData[], teamIdsByName: Map<string, number>) {
  const { cfbd } = await import("../src/lib/cfbd");
  const { cached } = await import("./lib/replay");
  const { talentBySeason, spFinalBySeason } = await loadPriorInputs(teamIdsByName);

  // Returning production for each season's roster, keyed by team id.
  const retBySeason = new Map<number, Map<number, number>>();
  for (const season of SEASONS) {
    const rows = await cached(
      `returning-${season}`,
      () => cfbd.returningProduction(season),
      true,
    );
    const map = new Map<number, number>();
    for (const r of rows) {
      const id = teamIdsByName.get(r.team);
      if (id !== undefined && r.percentPPA !== null) map.set(id, r.percentPPA);
    }
    retBySeason.set(season, map);
  }
  console.log(
    `\n== --tune-churn == (returning production coverage: ` +
      `${retBySeason.get(SEASONS[1])?.size ?? 0} teams in ${SEASONS[1]})`,
  );
  console.log("weight  reload   early NLL   early MAE   clamped");

  // Reload runs past 1.0: the first fit pinned at 1.0 with NLL still falling,
  // and a strength above 1 is meaningful rather than nonsense — it flips the
  // sign for the most talented rosters, i.e. losing production would slightly
  // *help* them. That should lose, but the grid has to be able to say so.
  let best: { w: number; r: number; nll: number } | null = null;
  let gridMin = Infinity;
  let gridMax = -Infinity;
  const bestByEra = new Map<string, { argmin: number; nll: number }>();
  const perSeasonOfBest = new Map<number, number>();
  for (const returningProdWeight of [0, 3, 4, 5, 6, 7, 8, 10]) {
    for (const talentReloadStrength of [0, 0.5, 1, 1.5, 2]) {
      const params: ModelParams = {
        ...DEFAULT_PARAMS,
        returningProdWeight,
        talentReloadStrength,
      };
      let priors = priorsFromSp(seasons[0].prevSp, teamIdsByName);
      const early: ReplayPrediction[] = [];
      let clamped = 0;
      let churnCount = 0;
      for (const season of seasons) {
        const { predictions, finalRatings } = replaySeason(season, priors, DEFAULT_PARAMS);
        if (SCORED.includes(season.season)) early.push(...predictions.filter((p) => p.week <= 4));
        const next = season.season + 1;
        const spFinal = spFinalBySeason.get(season.season)!;
        const talent = talentBySeason.get(season.season)!;
        const ret = retBySeason.get(next) ?? retBySeason.get(season.season)!;
        const out = new Map<number, number>();
        for (const [teamId, rating] of finalRatings) {
          const sp = spFinal.get(teamId);
          const base = sp !== undefined ? 0.5 * rating + 0.5 * sp : rating;
          const tal = talent.get(teamId) ?? -8;
          const churn = churnAdjustment(
            {
              returningProduction: ret.get(teamId) ?? 0.6,
              qbReturns: null,
              olReturningShare: 0.5,
              netPortalPoints: 0,
              blueChipFreshmen: 0,
              talentBaseline: tal,
            },
            params,
          );
          churnCount++;
          if (Math.abs(Math.abs(churn) - 6) < 0.001) clamped++;
          out.set(teamId, 0.7 * base + 0.3 * tal + churn);
        }
        priors = out;
      }
      const n = nll(early);
      console.log(
        `${String(returningProdWeight).padStart(5)}   ${talentReloadStrength.toFixed(2)}     ` +
          `${n.toFixed(4)}      ${maeOf(early.map((p) => p.actualMargin - p.margin)).toFixed(2)}       ` +
          `${((clamped / Math.max(churnCount, 1)) * 100).toFixed(1)}%`,
      );
      gridMin = Math.min(gridMin, n);
      gridMax = Math.max(gridMax, n);
      // Per-era argmin, tracked alongside the pooled one. A pooled winner that
      // no era actually wants is an average, not a fit.
      for (const { era, seasons: eraSeasons } of erasIn(SCORED)) {
        const eraNll = nll(early.filter((p) => eraSeasons.includes(p.season)));
        const current = bestByEra.get(era.id);
        if (!current || eraNll < current.nll) {
          bestByEra.set(era.id, { argmin: returningProdWeight, nll: eraNll });
        }
      }
      if (!best || n < best.nll) {
        best = { w: returningProdWeight, r: talentReloadStrength, nll: n };
        // Per-season NLL for the leader: two seasons is a thin holdout, but a
        // parameter that helps 2024 and hurts 2025 is visibly overfit.
        perSeasonOfBest.clear();
        for (const s of SCORED) {
          perSeasonOfBest.set(s, nll(early.filter((p) => p.season === s)));
        }
      }
    }
  }
  if (best) {
    console.log(
      `\nBest: returningProdWeight=${best.w} talentReloadStrength=${best.r} (NLL ${best.nll.toFixed(4)})`,
    );
    console.log(
      `Per-season NLL at the winner: ` +
        [...perSeasonOfBest].map(([s, v]) => `${s} ${v.toFixed(4)}`).join("  ") +
        " — a split where one season carries the whole gain is overfit, not fitted.",
    );
    // The likelihood surface here was flat at the old window: everything from
    // weight 6-10 x reload 1-2 scored 0.3940-0.3944, and the argmin slid to
    // whichever grid edge it was given. Print the RANGE across the grid, because
    // that is what distinguishes the two explanations more data can separate:
    // flat-because-noisy shrinks with n, flat-because-unidentified does not.
    console.log(
      `NLL range across the whole grid: ${(gridMax - gridMin).toFixed(4)} ` +
        `(${gridMin.toFixed(4)}-${gridMax.toFixed(4)}). At the 2023-25 window this was ~0.0004. ` +
        `If it is still ~0.0004 at ${SCORED.length} scored seasons, the parameter is ` +
        `UNIDENTIFIED given the other terms, not merely noisy — and the honest answer is 0.`,
    );
    // The era-flip rule, actually evaluated rather than only described.
    const byEra = [...bestByEra].map(([era, v]) => ({ era: era as never, argmin: v.argmin }));
    if (byEra.length >= 2) {
      // One grid step on the weight axis: the grid is 0,3,4,5,6,7,8,10, so the
      // modal step is 1.
      const flip = eraFlip(byEra, 1);
      console.log(
        `Per-era argmin on returningProdWeight: ` +
          byEra.map((b) => `${b.era} ${b.argmin}`).join("  ") +
          ` — spread ${flip.spread}. ${
            flip.agree
              ? "Within one grid step: the eras agree, and the pooled winner is a fit."
              : "WIDER than one grid step: the eras want different values, so the pooled winner " +
                "is an average of them. Pre-registered outcome — record era-dependent, ship nothing."
          }`,
      );
    }
    console.log(eraNote("returningProdWeight"));
    if (best.r >= 2 || best.w >= 10) {
      console.log("!! WARNING: winner sits at the grid edge — unconverged, widen before shipping.");
    }
    console.log(
      best.w === 0
        ? "→ returning production earns NO weight: it is not predictive here once the\n" +
            "  prior and talent are in. Setting it to 0 is the honest outcome."
        : `→ set both in DEFAULT_PARAMS. The clamped%% column should be near zero; if the\n` +
            "  winner still saturates, the clamp is doing the fitting rather than the weight.",
    );
  }
}

/**
 * --tune-anchors: are there preseason signals worth adding to the prior beyond
 * our own replay finals and final SP+?
 *
 * Week-1 Elo and the preseason AP poll are both point-in-time retrievable for
 * past seasons (unlike preseason SP+, which CFBD overwrites with finals), so
 * unlike a judgment call these weights can actually be fit. Anchors missing
 * for a team (e.g. unranked) renormalize away rather than defaulting to zero,
 * which would otherwise drag every unranked team toward the mean.
 */
async function tuneAnchors(seasons: SeasonData[], teamIdsByName: Map<string, number>) {
  const { cfbd } = await import("../src/lib/cfbd");
  const { cached } = await import("./lib/replay");
  const { talentBySeason, spFinalBySeason } = await loadPriorInputs(teamIdsByName);

  // Elo at week 1 is CFBD's carried/regressed preseason state; 25 Elo ≈ 1 pt
  // is the same conversion the freeze job uses for its consensus flag.
  const eloBySeason = new Map<number, Map<number, number>>();
  const pollBySeason = new Map<number, Map<number, number>>();
  for (const season of SEASONS) {
    const elo = await cached(`elo-wk1-${season}`, () => cfbd.eloRatings(season, 1), true);
    const raw = new Map<number, number>();
    for (const r of elo) {
      const id = teamIdsByName.get(r.team);
      if (id !== undefined && Number.isFinite(r.elo)) raw.set(id, (r.elo - 1500) / 25);
    }
    const m = raw.size > 0 ? mean([...raw.values()]) : 0;
    eloBySeason.set(season, new Map([...raw].map(([id, v]) => [id, v - m])));

    const ranks = await cached(
      `rankings-wk1-${season}`,
      () => cfbd.rankings(season, { week: 1 }),
      true,
    );
    const poll = new Map<number, number>();
    for (const wk of ranks) {
      for (const p of wk.polls) {
        if (p.poll !== "AP Top 25") continue;
        for (const r of p.ranks) {
          const id = teamIdsByName.get(r.school);
          // Rank → points: log-spaced, since the gap between #1 and #5 is far
          // larger than between #20 and #24. ~18 pts at #1, ~1 pt at #25.
          if (id !== undefined) poll.set(id, 18 - 5.2 * Math.log(r.rank));
        }
      }
    }
    pollBySeason.set(season, poll);
  }
  console.log(
    `\n== --tune-anchors == (elo coverage ${eloBySeason.get(SEASONS[1])?.size ?? 0}, ` +
      `poll coverage ${pollBySeason.get(SEASONS[1])?.size ?? 0} teams)`,
  );
  console.log("gamma(elo)  delta(poll)   early NLL   early MAE");

  let best: { g: number; d: number; nll: number } | null = null;
  for (const gamma of [0, 0.1, 0.2, 0.3]) {
    for (const delta of [0, 0.1, 0.2]) {
      if (gamma + delta >= 1) continue;
      let priors = priorsFromSp(seasons[0].prevSp, teamIdsByName);
      const early: ReplayPrediction[] = [];
      for (const season of seasons) {
        const { predictions, finalRatings } = replaySeason(season, priors, DEFAULT_PARAMS);
        if (SCORED.includes(season.season)) early.push(...predictions.filter((p) => p.week <= 4));
        const next = season.season + 1;
        const spFinal = spFinalBySeason.get(season.season)!;
        const talent = talentBySeason.get(season.season)!;
        const elo = eloBySeason.get(next) ?? new Map();
        const poll = pollBySeason.get(next) ?? new Map();
        const rest = (1 - gamma - delta) / 2;
        const out = new Map<number, number>();
        for (const [teamId, rating] of finalRatings) {
          const terms: Array<[number, number]> = [[rest, rating]];
          const sp = spFinal.get(teamId);
          if (sp !== undefined) terms.push([rest, sp]);
          const e = elo.get(teamId);
          if (e !== undefined) terms.push([gamma, e]);
          const pl = poll.get(teamId);
          if (pl !== undefined) terms.push([delta, pl]);
          const wsum = terms.reduce((a, [w]) => a + w, 0);
          const base = wsum > 0 ? terms.reduce((a, [w, v]) => a + w * v, 0) / wsum : rating;
          out.set(teamId, 0.7 * base + 0.3 * (talent.get(teamId) ?? -8));
        }
        priors = out;
      }
      const n = nll(early);
      console.log(
        `${gamma.toFixed(2)}        ${delta.toFixed(2)}          ${n.toFixed(4)}      ` +
          `${maeOf(early.map((p) => p.actualMargin - p.margin)).toFixed(2)}`,
      );
      if (!best || n < best.nll) best = { g: gamma, d: delta, nll: n };
    }
  }
  if (best) {
    console.log(
      `\nBest: elo=${best.g} poll=${best.d} (NLL ${best.nll.toFixed(4)}). ` +
        (best.g === 0 && best.d === 0
          ? "→ neither anchor earns weight; keep the replay/SP+ blend as-is."
          : "→ wire these weights into build-preseason.ts's anchor blend."),
    );
  }
}

/**
 * Ordinary least squares with an intercept, returning coefficients and their
 * standard errors. Small and explicit rather than pulling in a stats library
 * for one 3×3 solve.
 */
export function ols(y: number[], xs: number[][]): { beta: number[]; se: number[]; n: number } {
  const n = y.length;
  const k = xs.length + 1;
  const X = y.map((_, i) => [1, ...xs.map((col) => col[i])]);

  // normal equations: (X'X) beta = X'y
  const xtx = Array.from({ length: k }, (_, a) =>
    Array.from({ length: k }, (_, b) => X.reduce((s, row) => s + row[a] * row[b], 0)),
  );
  const xty = Array.from({ length: k }, (_, a) => X.reduce((s, row, i) => s + row[a] * y[i], 0));

  const inv = invert(xtx);
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * xty[j], 0));

  const rss = y.reduce((s, yi, i) => {
    const fit = X[i].reduce((acc, v, j) => acc + v * beta[j], 0);
    return s + (yi - fit) ** 2;
  }, 0);
  const s2 = rss / (n - k);
  return { beta, se: inv.map((row, a) => Math.sqrt(s2 * row[a])), n };
}

/** Gauss-Jordan inversion; the matrices here are 3×3 and well conditioned. */
function invert(m: number[][]): number[][] {
  const k = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < k; col++) {
    let pivot = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const d = a[col][col];
    if (Math.abs(d) < 1e-12) throw new Error("singular matrix in OLS");
    for (let j = 0; j < 2 * k; j++) a[col][j] /= d;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = a[r][col];
      for (let j = 0; j < 2 * k; j++) a[r][j] -= f * a[col][j];
    }
  }
  return a.map((row) => row.slice(k));
}

/**
 * --diagnose-edges: the gate. Before tuning any threshold or hunting for
 * situational filters, establish whether the model carries information the
 * market does not.
 *
 * The logic: an "edge" is model − market. If the market is the more accurate
 * estimator, then a large disagreement is mostly OUR error, and selecting on
 * it selects the games we are most wrong about — which produces a sub-50% ATS
 * record no matter how the threshold is set. The encompassing regression
 * settles it directly.
 */
function diagnoseEdges(all: ReplayPrediction[]) {
  const withLine = all.filter((p) => p.vegasSpread !== null);
  console.log(`\n== --diagnose-edges ==  n=${withLine.length} games with a stored line`);

  // 1. Whose margin estimate is actually better?
  const modelErr = withLine.map((p) => p.actualMargin - p.margin);
  const marketErr = withLine.map((p) => p.actualMargin - -(p.vegasSpread as number));
  console.log("\n-- Margin accuracy, model vs market --");
  console.log(`model  MAE ${maeOf(modelErr).toFixed(2)}   RMSE ${rmse(modelErr).toFixed(2)}`);
  console.log(`market MAE ${maeOf(marketErr).toFixed(2)}   RMSE ${rmse(marketErr).toFixed(2)}`);
  console.log(
    maeOf(modelErr) < maeOf(marketErr)
      ? "→ the model is sharper than the closing line (rare; check for lookahead before believing it)"
      : "→ the closing line is sharper than the model, so a raw disagreement is mostly our own error",
  );

  // 2. Encompassing regression: actual ~ a + b1·model + b2·market
  const { beta, se, n } = ols(
    withLine.map((p) => p.actualMargin),
    [withLine.map((p) => p.margin), withLine.map((p) => -(p.vegasSpread as number))],
  );
  const [a, b1, b2] = beta;
  const t1 = b1 / se[1];
  const t2 = b2 / se[2];
  console.log("\n-- Encompassing regression: actual_margin ~ a + b1·model + b2·market --");
  console.log(`a  = ${a.toFixed(3)} (se ${se[0].toFixed(3)})`);
  console.log(`b1 = ${b1.toFixed(3)} (se ${se[1].toFixed(3)}, t = ${t1.toFixed(2)})   [model]`);
  console.log(`b2 = ${b2.toFixed(3)} (se ${se[2].toFixed(3)}, t = ${t2.toFixed(2)})   [market]`);
  console.log(`n = ${n}`);
  console.log(
    "Note: model and market both estimate the same quantity, so they are highly\n" +
      "collinear and both standard errors are inflated. Read b1's t-stat as a floor.",
  );

  const passesGate = t1 > 2;
  const w = b1 + b2 > 0 ? Math.max(0, Math.min(1, b1 / (b1 + b2))) : 0;
  console.log(
    passesGate
      ? `\n→ GATE PASSED: the model carries signal the closing line lacks (t=${t1.toFixed(2)}).\n` +
          `  Honest blend weight on the model: w = ${w.toFixed(3)}. Edges should be priced off\n` +
          `  fair = ${w.toFixed(3)}·model + ${(1 - w).toFixed(3)}·market, NOT off the raw difference.`
      : `\n→ GATE FAILED: b1 is not significantly positive (t=${t1.toFixed(2)}, need >2).\n` +
          "  The model adds nothing beyond the closing line. No threshold, filter or\n" +
          "  situational slice will produce a real 52.4% against the close — anything that\n" +
          "  appears to is noise. Recommendation: demote edges to information (plan P5).",
  );

  // 3. Shrunk fair line — how many flags survive, and do they do better?
  if (w > 0) {
    console.log("\n-- Edges repriced off the shrunk fair line --");
    console.log("threshold   W-L-P        win%     n");
    for (const thr of [0.5, 1, 1.5, 2, 3]) {
      const flagged = withLine.filter((p) => {
        const market = -(p.vegasSpread as number);
        const fair = w * p.margin + (1 - w) * market;
        return Math.abs(fair - market) >= thr;
      });
      const rec = gradeShrunk(flagged, w);
      const tot = rec.wins + rec.losses;
      console.log(
        `≥${thr.toFixed(1)}         ${`${rec.wins}-${rec.losses}-${rec.pushes}`.padEnd(12)} ` +
          `${tot ? ((rec.wins / tot) * 100).toFixed(1) : "  – "}%   ${tot}`,
      );
    }
  }

  // 4. The two places the gate was never run: totals, and inside market tiers.
  //
  // Pooling every game assumes all closing lines are equally efficient, which
  // is false — a Tuesday-night MAC game and Alabama–Georgia are not the same
  // market. And only margins went through the regression; totals never did,
  // despite the model sitting relatively closer to the market there.
  //
  // These are pre-registered, and the threshold is raised to account for
  // running several of them. No tier is added after seeing results.
  console.log("\n-- The gate, re-run where it wasn't: totals and market tiers --");
  console.log(
    `Bonferroni: ${TIER_TESTS} pre-registered tests at α=0.05 → require |t| > ${TIER_T.toFixed(1)} (not 2.0)`,
  );
  console.log("test                     n      b1(model)   t       b2(market)   verdict");

  const withTotal = all.filter((p) => p.vegasTotal !== null);
  reportGate(
    "totals (all games)",
    withTotal.map((p) => p.actualTotal),
    withTotal.map((p) => p.projectedTotal),
    withTotal.map((p) => p.vegasTotal as number),
  );

  // Liquidity: fewer books is a thinner, softer market. Split at the median so
  // the two halves are comparable in size.
  const counts = withLine.map((p) => p.bookCount).sort((a, b) => a - b);
  const medianBooks = counts[Math.floor(counts.length / 2)];
  for (const [label, keep] of [
    [`thin market (<${medianBooks} books)`, (p: ReplayPrediction) => p.bookCount < medianBooks],
    [`thick market (≥${medianBooks} books)`, (p: ReplayPrediction) => p.bookCount >= medianBooks],
  ] as Array<[string, (p: ReplayPrediction) => boolean]>) {
    const seg = withLine.filter(keep);
    if (seg.length < 100) continue;
    reportGate(
      label,
      seg.map((p) => p.actualMargin),
      seg.map((p) => p.margin),
      seg.map((p) => -(p.vegasSpread as number)),
    );
  }

  // Non-conference games are the cross-market matchups the model is most
  // likely to price differently than a market anchored on conference
  // reputation, and they are where our opponent adjustment can disagree most.
  for (const [label, keep] of [
    ["conference games", (p: ReplayPrediction) => p.conferenceGame],
    ["non-conference", (p: ReplayPrediction) => !p.conferenceGame],
  ] as Array<[string, (p: ReplayPrediction) => boolean]>) {
    const seg = withLine.filter(keep);
    if (seg.length < 100) continue;
    reportGate(
      label,
      seg.map((p) => p.actualMargin),
      seg.map((p) => p.margin),
      seg.map((p) => -(p.vegasSpread as number)),
    );
  }

  console.log(
    "A tier only counts if it clears the corrected threshold AND holds on the 2025\n" +
      "holdout. With this many tests, one crossing an uncorrected |t|>2 is expected noise.",
  );

  // 5. The bettable question: does the model beat the OPENING line?
  const withOpen = withLine.filter((p) => p.vegasOpen !== null);
  console.log(
    `\n-- vs the OPENING line (a wager you can actually place) --  n=${withOpen.length} with an opener`,
  );
  if (withOpen.length === 0) {
    console.log("No opening lines in the payload — CFBD did not populate spreadOpen here.");
  } else {
    console.log("bucket        W-L-P        win%     ±1SE    avg CLV   n");
    for (const [label, lo, hi] of [
      ["|edge| 2–4", 2, 4],
      ["|edge| 4+", 4, Infinity],
      ["ALL ≥2", 2, Infinity],
    ] as Array<[string, number, number]>) {
      // Flag off the OPENING line: that is the number available when betting.
      const flagged = withOpen.filter((p) => {
        const e = -p.margin - (p.vegasOpen as number);
        return Math.abs(e) >= lo && Math.abs(e) < hi;
      });
      const rec = gradeAts(flagged, (p) => p.vegasOpen);
      const tot = rec.wins + rec.losses;
      // CLV: did the market move toward our side between open and close?
      const clv = flagged
        .filter((p) => p.vegasSpread !== null)
        .map((p) => {
          const open = p.vegasOpen as number;
          const close = p.vegasSpread as number;
          const likesHome = -p.margin - open < 0;
          return likesHome ? open - close : close - open;
        });
      console.log(
        `${label.padEnd(13)} ${`${rec.wins}-${rec.losses}-${rec.pushes}`.padEnd(12)} ` +
          `${tot ? ((rec.wins / tot) * 100).toFixed(1) : "  – "}%   ` +
          `${tot ? (Math.sqrt(0.25 / tot) * 100).toFixed(1) : " – "}%   ` +
          `${clv.length ? (clv.reduce((s, v) => s + v, 0) / clv.length).toFixed(2).padStart(6) : "     –"}   ${tot}`,
      );
    }
    console.log(
      "Positive average CLV means the market moved toward our side after the opener —\n" +
        "a lower-variance signal of real edge than the ATS record at this sample size.",
    );
  }
}

/**
 * Pre-registered tier tests: totals, thin/thick market, conference/non-.
 * Bonferroni at α=0.05 over 5 tests → |t| > 2.5 rather than the usual 2.0.
 * Fixed here, before any of them run, so the bar can't drift after seeing a
 * result — which is the whole failure mode this guards against.
 */
const TIER_TESTS = 5;
const TIER_T = 2.5;

/**
 * One encompassing regression, reported as a row. `ours` and `theirs` are both
 * estimates of `actual`; the question is whether ours still carries a
 * coefficient once theirs is in the equation.
 */
function reportGate(label: string, actual: number[], ours: number[], theirs: number[]) {
  if (actual.length < 30) {
    console.log(`${label.padEnd(24)} ${String(actual.length).padStart(5)}   too few games`);
    return;
  }
  let beta: number[];
  let se: number[];
  try {
    ({ beta, se } = ols(actual, [ours, theirs]));
  } catch {
    console.log(`${label.padEnd(24)} ${String(actual.length).padStart(5)}   singular (collinear)`);
    return;
  }
  const t = beta[1] / se[1];
  const verdict = Math.abs(t) > TIER_T ? (t > 0 ? "CLEARS ***" : "negative") : "no signal";
  console.log(
    `${label.padEnd(24)} ${String(actual.length).padStart(5)}   ${beta[1].toFixed(3).padStart(8)}   ` +
      `${t.toFixed(2).padStart(5)}   ${beta[2].toFixed(3).padStart(9)}    ${verdict}`,
  );
}

function gradeShrunk(predictions: ReplayPrediction[], w: number): AtsRecord {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  for (const p of predictions) {
    const line = p.vegasSpread as number;
    const market = -line;
    const fair = w * p.margin + (1 - w) * market;
    const coverMargin = p.actualMargin + line;
    if (coverMargin === 0) pushes++;
    else if (fair > market === coverMargin > 0) wins++;
    else losses++;
  }
  return { wins, losses, pushes };
}

const rmse = (xs: number[]) => Math.sqrt(mean(xs.map((x) => x * x)));

async function main() {
  const useCache = process.argv.includes("--cached");
  const tune = process.argv.includes("--tune");
  const tunePrior = process.argv.includes("--tune-prior");
  const tuneSp = process.argv.includes("--tune-sp-blend");
  const tuneTilts = process.argv.includes("--tune-preseason-tilts");
  const tuneSigmaFlag = process.argv.includes("--tune-sigma");
  const tuneCoachingFlag = process.argv.includes("--tune-coaching");
  const tuneAnchorsFlag = process.argv.includes("--tune-anchors");
  const diagnose = process.argv.includes("--diagnose-edges");
  const diagnoseTiersFlag = process.argv.includes("--diagnose-tiers");
  const tuneTierRecenterFlag = process.argv.includes("--tune-tier-recenter");
  const tuneChurnFlag = process.argv.includes("--tune-churn");
  const tuneEpaFlag = process.argv.includes("--tune-epa");
  const tuneEnsembleFlag = process.argv.includes("--tune-ensemble");
  const tuneHfaFlag = process.argv.includes("--tune-hfa");
  const tuneFcsFlag = process.argv.includes("--tune-fcs");
  const tuneTeamHfaFlag = process.argv.includes("--tune-team-hfa");

  // The window comes first: it decides what is loaded, what is scored, and how
  // every number below is labelled.
  WINDOW = parseSeasonWindow(process.argv);
  SEASONS = WINDOW.all;
  SCORED = WINDOW.scored;

  const experiment =
    [
      ["tune-prior", tunePrior],
      ["tune-sp-blend", tuneSp],
      ["tune-preseason-tilts", tuneTilts],
      ["tune-sigma", tuneSigmaFlag],
      ["tune-coaching", tuneCoachingFlag],
      ["tune-anchors", tuneAnchorsFlag],
      ["tune-churn", tuneChurnFlag],
      ["tune-epa", tuneEpaFlag],
      ["tune-ensemble", tuneEnsembleFlag],
      ["tune-hfa", tuneHfaFlag],
      ["tune-fcs", tuneFcsFlag],
      ["tune-team-hfa", tuneTeamHfaFlag],
      ["diagnose-edges", diagnose],
      ["diagnose-tiers", diagnoseTiersFlag],
      ["tune-tier-recenter", tuneTierRecenterFlag],
      ["tune", tune],
    ].find(([, on]) => on)?.[0] as string | undefined;

  // Refuse a window whose feeds this experiment cannot cover, BEFORE spending a
  // call on it. A tuner that silently scores eight of eleven seasons and prints
  // a number labelled eleven is the failure this exists to prevent.
  assertFeedCoverage(experiment ?? "report", WINDOW, loadCoverageManifest());

  console.log(
    `Window ${WINDOW.label} — replaying ${SEASONS.length} seasons, scoring ${SCORED.length} ` +
      `(${SCORED.join(", ")}).`,
  );
  if (WINDOW.warmup.length > 0) {
    console.log(`  warm-up, chained but not scored: ${WINDOW.warmup.join(", ")} (SP+ priors)`);
  }
  if (WINDOW.chainOnly.length > 0) {
    console.log(
      `  chain-only, replayed but not scored: ${WINDOW.chainOnly.join(", ")} ` +
        `(COVID — empty stadiums collapse HFA and the Pac-12 played no non-conference games)`,
    );
  }
  console.log(
    `!! Every number below is specific to this window. A decisions-table row without ` +
      `"${WINDOW.label}" in it is not comparable to one that has it.`,
  );
  const isLegacy =
    SEASONS[0] === LEGACY_WINDOW.from && SEASONS[SEASONS.length - 1] === LEGACY_WINDOW.to;
  if (!isLegacy) {
    console.log(
      `   Every figure recorded in docs/ before 2026-08-18 was computed on ` +
        `${LEGACY_WINDOW.from}-${LEGACY_WINDOW.to}. Reproduce one exactly with ` +
        `--seasons=${LEGACY_WINDOW.from}-${LEGACY_WINDOW.to}.`,
    );
  }
  // Season-wise holdout. Stated up front, on every run, because the point of a
  // wide window is that a genuine holdout finally becomes affordable for every
  // tuner rather than only for --tune-ensemble.
  try {
    const { fit, holdout } = splitWindow(WINDOW, 2);
    console.log(
      `   Holdout available: fit ${fit[0]}-${fit[fit.length - 1]}, hold out ${holdout.join(", ")}. ` +
        `No parameter should ship on a fit-set gain alone — the holdout gain must be the same ` +
        `sign and at least half the size.`,
    );
  } catch {
    console.log(
      `   No holdout at this width: ${SCORED.length} scored seasons is too few to partition. ` +
        `Widen with --seasons=${DEFAULT_WINDOW.from}-${DEFAULT_WINDOW.to}.`,
    );
  }

  console.log(`Loading ${useCache ? "(cache preferred)" : "(fetching)"}…`);
  const seasons: SeasonData[] = [];
  for (const s of SEASONS) {
    seasons.push(
      await loadSeason(s, useCache, {
        // Only --tune-epa reads PPA; at epaWeight 0 nothing else does.
        withAdvanced: tuneEpaFlag,
        // SP+ for the season itself drives FBS membership (admitNewFbs).
        withSp: true,
      }),
    );
  }

  const teamIdsByName = teamIdsByNameFrom(seasons);

  if (tunePrior) {
    await tunePriorCarryover(seasons, teamIdsByName);
    return;
  }
  if (tuneSp) {
    await tuneSpBlend(seasons, teamIdsByName);
    return;
  }
  if (diagnoseTiersFlag) {
    await diagnoseTiers(seasons, teamIdsByName);
    return;
  }
  if (tuneTierRecenterFlag) {
    await tuneTierRecenter(seasons, teamIdsByName);
    return;
  }
  if (tuneTilts) {
    tunePreseasonTilts(seasons, teamIdsByName);
    return;
  }
  if (tuneCoachingFlag) {
    await tuneCoaching(seasons, teamIdsByName);
    return;
  }
  if (tuneAnchorsFlag) {
    await tuneAnchors(seasons, teamIdsByName);
    return;
  }
  if (tuneChurnFlag) {
    await tuneChurn(seasons, teamIdsByName);
    return;
  }
  if (tuneEpaFlag) {
    tuneEpa(seasons, teamIdsByName);
    return;
  }
  if (tuneEnsembleFlag) {
    await tuneEnsemble(seasons, teamIdsByName);
    return;
  }
  if (tuneHfaFlag) {
    tuneHfa(seasons, teamIdsByName);
    return;
  }
  if (tuneFcsFlag) {
    await tuneFcs(seasons, teamIdsByName);
    return;
  }
  if (tuneTeamHfaFlag) {
    tuneTeamHfa(seasons, teamIdsByName);
    return;
  }

  // Membership churn is printed once, on the reference run, rather than on
  // every grid point — but it IS printed. A team silently entering or leaving
  // the rating pool is exactly the class of change that produced the frozen-pool
  // defect this machinery fixes.
  let logChurn = false;
  const nameById = new Map<number, number | string>();
  for (const [name, id] of teamIdsByName) nameById.set(id, name);

  const run = (params: ModelParams): ReplayPrediction[] => {
    // No preseason tilt here, and that does NOT match production (02:M-12).
    // The comment this replaces said it did, on the premise that the tilt is
    // off "unless PRESEASON_TILT_CARRY has been set" — but the default is in
    // the code, not only in the environment: `build-preseason.ts:91` reads
    // `envNum("PRESEASON_TILT_CARRY", 0.4, …)`, so production ships 0.4 and an
    // unset variable changes nothing. The headline calibration below is
    // therefore computed at tilt 0 against a production that carries 0.4.
    //
    // Left at 0 rather than raised to match, because moving it silently
    // restates every number this report has ever produced, and the report is
    // the honesty gate for model changes. Re-decide with
    // `--tune-preseason-tilts`, which is why the inline sweep was removed: it
    // chained tilts in every arm, which production does not do either.
    // Recorded rather than fixed — see docs/STATUS.md.
    let priors = priorsFromSp(seasons[0].prevSp, teamIdsByName);
    const all: ReplayPrediction[] = [];
    for (const season of seasons) {
      const { predictions, finalRatings, admitted, retired } = replaySeason(season, priors, params);
      all.push(...predictions);
      if (logChurn && (admitted.length > 0 || retired.length > 0)) {
        const name = (id: number) => nameById.get(id) ?? String(id);
        console.log(
          `  ${season.season}: FBS pool ` +
            [
              admitted.length > 0 ? `+${admitted.map(name).join(", ")}` : "",
              retired.length > 0 ? `-${retired.map(name).join(", ")}` : "",
            ]
              .filter(Boolean)
              .join("  "),
        );
      }
      priors = chainPriors(finalRatings);
    }
    return all;
  };

  if (!tune) {
    logChurn = true;
    console.log("\nFBS membership changes applied to the pool (admitNewFbs):");
    const predictions = run(DEFAULT_PARAMS);
    logChurn = false;
    calibrateMarketBar(predictions);
    const scored = scoredOnly(predictions);
    console.log(report(scored, DEFAULT_PARAMS));
    // Per-season and per-era tables print on ALL predictions, so the unscored
    // seasons appear as marked rows rather than vanishing. A season excluded
    // without a trace is indistinguishable from one that was never loaded.
    console.log(perSeasonTable(predictions, WINDOW));
    console.log(perEraTable(predictions, WINDOW));
    if (tuneSigmaFlag) tuneSigma(scored);
    if (diagnose) diagnoseEdges(scored);
    return;
  }

  console.log("Tuning (grid search over K, HFA, sigma)…");
  let best: { params: ModelParams; score: number } | null = null;
  // HFA grid runs to 4.0. It used to stop at 2.6, and the ensemble work turned
  // up why that matters: mean SIGNED margin error is positive in both periods
  // (+0.55 on 2023-24, +1.31 on 2025), i.e. the model under-predicts the home
  // side. A regression blending our margin with Elo wanted a +2.0 intercept at
  // t=4.27 for the same reason. If the true HFA is above 2.6, the old grid
  // could never find it — and MAE and sigma are both symmetric, so neither
  // would ever have shown the bias.
  for (const kFactor of [0.2, 0.25, 0.3, 0.35, 0.4]) {
    for (const baseHfa of [2.0, 2.4, 2.8, 3.2, 3.6, 4.0]) {
      const params: ModelParams = { ...DEFAULT_PARAMS, kFactor, baseHfa };
      const predictions = scoredOnly(run(params));
      const graded = predictions.filter((p) => p.favoriteWon !== null);
      const nll =
        -graded.reduce(
          (a, p) => a + Math.log(p.favoriteWon ? p.favWinProb : 1 - p.favWinProb),
          0,
        ) / graded.length;
      const errors = predictions.map((p) => p.actualMargin - p.margin);
      const sigma = Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / errors.length);
      console.log(`K=${kFactor} HFA=${baseHfa} → NLL ${nll.toFixed(4)}, fitted σ ${sigma.toFixed(2)}`);
      if (!best || nll < best.score) best = { params: { ...params, marginSigma: sigma }, score: nll };
    }
  }
  if (best) {
    // Calibrate the win-prob slope to the fitted margin sigma (logistic ≈ normal: 1.7/σ)
    best.params.winProbSlope = 1.7 / best.params.marginSigma;
    console.log(
      `\nBest: K=${best.params.kFactor} HFA=${best.params.baseHfa} σ=${best.params.marginSigma.toFixed(2)} slope=${best.params.winProbSlope.toFixed(4)}`,
    );
    console.log(report(run(best.params), best.params));
  }
}

// Only run when invoked as a script. `gradeAts` and `ols` are exported for unit
// tests, and importing this file must not kick off a full backtest.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // A refused window or an uncovered feed is a message to read, not a stack
    // to decode: both already name the constraint and the flag that satisfies
    // it, and burying that under ten frames of module loader is how a helpful
    // error reads as a crash.
    if (err instanceof SeasonWindowError || err instanceof CoverageError) {
      console.error(`\n${err.message}\n`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}
