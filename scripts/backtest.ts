/**
 * Point-in-time backtest over past seasons (docs/SPEC.md §2.5).
 *
 * Usage:
 *   CFBD_API_KEY=... npx tsx scripts/backtest.ts             # fetch + run 2023–2025
 *   npx tsx scripts/backtest.ts --cached                     # reuse .backtest-cache/
 *   npx tsx scripts/backtest.ts --tune                       # grid-search K / HFA, fit σ + slope
 *   npx tsx scripts/backtest.ts --tune-sigma                 # fit priorSigmaExtra (early-week uncertainty)
 *   npx tsx scripts/backtest.ts --tune-preseason-tilts       # should preseason off/def carry a shape?
 *   npx tsx scripts/backtest.ts --tune-coaching              # fit newHcIntercept / newHcSlope
 *   npx tsx scripts/backtest.ts --tune-anchors               # week-1 Elo / preseason poll anchor weights
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
 * CLV or line movement — no historical movement data exists.
 */

import {
  DEFAULT_PARAMS,
  coachingAdjustmentContinuous,
  priorWeight,
  type ModelParams,
} from "../src/model/ratings";
import { buildCoachTransitions, type CoachTransition } from "./lib/coaching";
import {
  chainPriors,
  chainTilts,
  loadSeason,
  priorsFromSp,
  replaySeason,
  scaleTilts,
  subTiltsFromSp,
  teamIdsByNameFrom,
  type ReplayPrediction,
  type SeasonData,
} from "./lib/replay";

const SEASONS = [2023, 2024, 2025];

/** Seasons the tuners score on: the bootstrap year is excluded because its
 *  priors come from SP+ rather than from our own chain either way. */
const SCORED = SEASONS.slice(1);

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const maeOf = (xs: number[]) => mean(xs.map(Math.abs));

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
  lines.push(`\n== Margin error ==  MAE ${mae.toFixed(2)}  σ ${sigma.toFixed(2)} (param: ${params.marginSigma})`);

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

  lines.push("\n== Edge flags vs stored line (break-even 52.4% at -110) ==");
  for (const [label, min] of [["EDGE ≥2", params.edgeThreshold], ["BIG ≥4", params.bigEdgeThreshold]] as const) {
    const flagged = predictions.filter(
      (p) => p.edge !== null && Math.abs(p.edge) >= min && p.vegasSpread !== null,
    );
    let wins = 0;
    let losses = 0;
    for (const p of flagged) {
      const likesHome = (p.edge as number) < 0;
      const coverMargin = p.actualMargin + (p.vegasSpread as number);
      if (coverMargin === 0) continue;
      const homeCovered = coverMargin > 0;
      if (likesHome === homeCovered) wins++;
      else losses++;
    }
    const total = wins + losses;
    lines.push(
      `${label}:  ${wins}-${losses}  (${total ? ((wins / total) * 100).toFixed(1) : "–"}%)  n=${total}`,
    );
  }

  return lines.join("\n");
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

  console.log("intercept  slope   early NLL   early MAE");
  let best: { i: number; s: number; nll: number } | null = null;
  for (const newHcIntercept of [0, -0.5, -1, -1.5, -2, -2.5]) {
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

async function main() {
  const useCache = process.argv.includes("--cached");
  const tune = process.argv.includes("--tune");
  const tunePrior = process.argv.includes("--tune-prior");
  const tuneSp = process.argv.includes("--tune-sp-blend");
  const tuneTilts = process.argv.includes("--tune-preseason-tilts");
  const tuneSigmaFlag = process.argv.includes("--tune-sigma");
  const tuneCoachingFlag = process.argv.includes("--tune-coaching");
  const tuneAnchorsFlag = process.argv.includes("--tune-anchors");

  console.log(`Loading seasons ${SEASONS.join(", ")} ${useCache ? "(cache preferred)" : "(fetching)"}…`);
  const seasons: SeasonData[] = [];
  for (const s of SEASONS) seasons.push(await loadSeason(s, useCache));

  const teamIdsByName = teamIdsByNameFrom(seasons);

  if (tunePrior) {
    await tunePriorCarryover(seasons, teamIdsByName);
    return;
  }
  if (tuneSp) {
    await tuneSpBlend(seasons, teamIdsByName);
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

  const run = (params: ModelParams): ReplayPrediction[] => {
    // No preseason tilt — matches production, where week-0 halves are even
    // unless PRESEASON_TILT_CARRY has been set from a --tune-preseason-tilts
    // winner. Run that flag to re-decide; it is no longer swept inline here
    // because the inline version chained tilts in every arm, which is not
    // what production does.
    let priors = priorsFromSp(seasons[0].prevSp, teamIdsByName);
    const all: ReplayPrediction[] = [];
    for (const season of seasons) {
      const { predictions, finalRatings } = replaySeason(season, priors, params);
      all.push(...predictions);
      priors = chainPriors(finalRatings);
    }
    return all;
  };

  if (!tune) {
    const predictions = run(DEFAULT_PARAMS);
    console.log(report(predictions, DEFAULT_PARAMS));
    if (tuneSigmaFlag) tuneSigma(predictions);
    return;
  }

  console.log("Tuning (grid search over K, HFA, sigma)…");
  let best: { params: ModelParams; score: number } | null = null;
  for (const kFactor of [0.2, 0.25, 0.3, 0.35, 0.4]) {
    for (const baseHfa of [2.0, 2.3, 2.6]) {
      const params: ModelParams = { ...DEFAULT_PARAMS, kFactor, baseHfa };
      const predictions = run(params);
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
