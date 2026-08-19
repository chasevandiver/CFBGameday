/**
 * Which seasons does a backtest run replay, and which of them does the
 * objective actually see?
 *
 * Until 2026-08-18 the answer was two module-level constants in `backtest.ts`
 * (`SEASONS = [2023, 2024, 2025]`, `SCORED = SEASONS.slice(1)`), and the whole
 * question was closed. The 2015-22 archive backfill (BF-4) reopened it by
 * settling the thing that had kept the window at three seasons: CFBD line
 * coverage runs 95-100% per season back to 2015, against a 55-70% guess. Every
 * tuner scores against a stored spread, so thin old-season lines was the
 * plausible blocker and it is not real.
 *
 * ## Why the window is a value and not a constant
 *
 * Widening buys statistical power, and power is what the decisions table is
 * short of: `--tune-anchors` failed by 0.0004 NLL against a 0.003 bar,
 * `--tune-churn`'s gain was inside its ~0.25 SE, `--tune-ensemble`'s holdout
 * came in at 0.138 against a 0.15 bar. Roughly 4x the sample halves those
 * standard errors. That does not turn a rejection into a win. It turns "inside
 * noise" into an answer, which is the only honest thing more data can buy.
 *
 * ## Every number carries its window label, and this is not optional
 *
 * A metric without its window is not comparable to anything. `label` is
 * printed in the header of every report and MUST appear in any decisions-table
 * row, because the failure mode of a configurable window is a changelog whose
 * rows were computed against different corpora and do not say so.
 */

import { erasIn, isChainOnly, type Era } from "./eras";

/**
 * The window every published number is computed against.
 *
 * Changed 2026-08-18 from [2023, 2024, 2025] to the full archive, by owner
 * decision. That switch restates every figure recorded before it, which is the
 * same objection STATUS raises for not silently lifting the replay's preseason
 * tilt to 0.4 — so it is paid explicitly and once, in the landing commit, with
 * both windows reported side by side. See docs/CHANGELOG.md.
 */
export const DEFAULT_WINDOW = { from: 2015, to: 2025 } as const;

/**
 * The window every number recorded BEFORE 2026-08-18 was computed against.
 * Kept reachable by `--seasons=2023-2025` so any historical figure in
 * CHANGELOG or STATUS can be reproduced exactly rather than taken on trust.
 */
export const LEGACY_WINDOW = { from: 2023, to: 2025 } as const;

/** SP+ seeds the first season's priors from season-1, so 2015 needs 2014. */
export const EARLIEST_SEASON = 2015;

export class SeasonWindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeasonWindowError";
  }
}

export type CovidMode = "chain" | "score" | "drop";

export interface SeasonWindow {
  /** Every replayed season, ascending. */
  all: number[];
  /** What the objective sees: `all` minus warm-up minus chain-only. */
  scored: number[];
  /** Replayed and chained, not scored: priors come from SP+, not our chain. */
  warmup: number[];
  /** Replayed and chained, not scored, for a stated reason (COVID). */
  chainOnly: number[];
  /** e.g. "2015-2025/warmup1/covid-chain" — goes in every decisions-table row. */
  label: string;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/**
 * Build a window from an explicit season list.
 *
 * `warmup` generalises the old `SEASONS.slice(1)`: the earliest N seasons are
 * replayed to build the chain but never scored, because their priors come from
 * SP+ rather than from our own replay either way. Default 1, which reproduces
 * the previous split exactly.
 */
export function makeWindow(
  seasons: number[],
  opts: { warmup?: number; covid?: CovidMode } = {},
): SeasonWindow {
  const warmupCount = opts.warmup ?? 1;
  const covid = opts.covid ?? "chain";

  const sorted = [...seasons].sort((a, b) => a - b);
  if (new Set(sorted).size !== sorted.length) {
    throw new SeasonWindowError(`Duplicate season in window: ${seasons.join(", ")}`);
  }
  if (sorted.length < 2) {
    throw new SeasonWindowError(
      `A window needs at least 2 seasons (one warm-up, one scored); got ${sorted.length}. ` +
        `The earliest season's priors come from SP+, so a single-season window scores nothing.`,
    );
  }
  if (sorted[0] < EARLIEST_SEASON) {
    throw new SeasonWindowError(
      `Window starts at ${sorted[0]}, before ${EARLIEST_SEASON}. The first season is seeded from ` +
        `CFBD SP+ for the season BEFORE it, and the archive backfill (BF-4) verified coverage ` +
        `back to ${EARLIEST_SEASON}, not further.`,
    );
  }
  if (warmupCount < 1) {
    throw new SeasonWindowError(
      `warmup must be at least 1: the earliest season's priors come from SP+ rather than from ` +
        `our own chain, so scoring it compares two different constructions.`,
    );
  }

  const all = covid === "drop" ? sorted.filter((s) => !isChainOnly(s)) : sorted;
  const warmup = all.slice(0, warmupCount);
  const chainOnly =
    covid === "chain" ? all.filter((s) => isChainOnly(s) && !warmup.includes(s)) : [];
  const scored = all.filter((s) => !warmup.includes(s) && !chainOnly.includes(s));

  if (scored.length === 0) {
    throw new SeasonWindowError(
      `Window ${all.join(", ")} scores no seasons after removing ` +
        `${warmupCount} warm-up and ${chainOnly.length} chain-only. Widen it or lower --warmup.`,
    );
  }

  // A gapped list must not print as a range: "2015-2020" for [2015, 2020] is a
  // label that misdescribes the corpus it is supposed to identify, and the
  // whole job of the label is that a number can be traced back to its window.
  const contiguous = all.every((s, i) => i === 0 || s === all[i - 1] + 1);
  const span =
    all.length === 0 ? "empty" : contiguous ? `${all[0]}-${all[all.length - 1]}` : all.join(",");
  const label = `${span}/warmup${warmupCount}/covid-${covid}`;
  return { all, scored, warmup, chainOnly, label };
}

/**
 * Parse the window flags off argv.
 *
 *   --seasons=2015-2025     a range
 *   --seasons=2015,2016,2019  an explicit list (gaps allowed; the chain simply
 *                             steps further, which the caller must want)
 *   --warmup=2              how many leading seasons are chain-only
 *   --covid=chain|score|drop  what happens to 2020
 *
 * Rejects rather than repairs. A window that silently becomes something other
 * than what was typed produces a number nobody can reproduce.
 */
export function parseSeasonWindow(argv: readonly string[]): SeasonWindow {
  const valueOf = (flag: string): string | undefined => {
    const eq = argv.find((a) => a.startsWith(`${flag}=`));
    if (eq) return eq.slice(flag.length + 1);
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--")
      ? argv[i + 1]
      : undefined;
  };

  const covidRaw = valueOf("--covid") ?? "chain";
  if (covidRaw !== "chain" && covidRaw !== "score" && covidRaw !== "drop") {
    throw new SeasonWindowError(
      `--covid must be chain, score or drop; got "${covidRaw}". 2020 is an empty-stadium season: ` +
        `"chain" replays it for the prior chain without scoring it, which is the default.`,
    );
  }

  const warmupRaw = valueOf("--warmup");
  let warmup = 1;
  if (warmupRaw !== undefined) {
    warmup = Number(warmupRaw);
    if (!Number.isInteger(warmup)) {
      throw new SeasonWindowError(`--warmup must be a whole number; got "${warmupRaw}".`);
    }
  }

  const seasonsRaw = valueOf("--seasons");
  if (seasonsRaw === undefined) {
    return makeWindow(range(DEFAULT_WINDOW.from, DEFAULT_WINDOW.to), { warmup, covid: covidRaw });
  }

  const parseYear = (s: string): number => {
    const n = Number(s);
    // Number("") is 0 and Number(" ") is 0 — the exact shape of 04:DQ-13, where
    // an empty PRESEASON_TILT_CARRY passed a NaN guard and silently disabled a
    // fitted parameter. Check the text, not just the parse.
    if (!/^\d{4}$/.test(s.trim())) {
      throw new SeasonWindowError(`--seasons: "${s}" is not a four-digit season.`);
    }
    return n;
  };

  if (seasonsRaw.includes("-")) {
    const parts = seasonsRaw.split("-");
    if (parts.length !== 2) {
      throw new SeasonWindowError(`--seasons range must be FROM-TO; got "${seasonsRaw}".`);
    }
    const [from, to] = parts.map(parseYear);
    if (to <= from) {
      throw new SeasonWindowError(
        `--seasons=${seasonsRaw} is not ascending. Ranges run oldest-to-newest, because the ` +
          `prior chain does.`,
      );
    }
    return makeWindow(range(from, to), { warmup, covid: covidRaw });
  }

  return makeWindow(seasonsRaw.split(",").map(parseYear), { warmup, covid: covidRaw });
}

/**
 * Partition a window into a fit set and a season-wise holdout.
 *
 * Today only `--tune-ensemble` has a real holdout (fit 2023-24, hold out 2025),
 * and the comment there records why: an earlier version fit on all three
 * seasons and CALLED 2025 a holdout, which was "an in-sample number dressed as
 * out-of-sample". A wide window is what makes a genuine holdout affordable for
 * every tuner, which is worth more than any single parameter this widening
 * might move.
 */
export function splitWindow(
  window: SeasonWindow,
  holdoutCount: number,
): { fit: number[]; holdout: number[] } {
  if (holdoutCount < 1) throw new SeasonWindowError("holdout must be at least 1 season.");
  const scored = window.scored;
  if (scored.length - holdoutCount < 2) {
    throw new SeasonWindowError(
      `Window ${window.label} scores ${scored.length} seasons; holding out ${holdoutCount} ` +
        `leaves ${scored.length - holdoutCount} to fit on, which is not enough to fit anything. ` +
        `Widen the window (--seasons=2015-2025) or hold out fewer.`,
    );
  }
  return {
    fit: scored.slice(0, scored.length - holdoutCount),
    holdout: scored.slice(scored.length - holdoutCount),
  };
}

/** The minimum a row needs to appear in the per-season and per-era tables. */
export interface ScorableRow {
  season: number;
  margin: number;
  actualMargin: number;
  favWinProb: number;
  favoriteWon: boolean | null;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export interface SliceMetrics {
  n: number;
  mae: number;
  bias: number;
  biasSe: number;
  nll: number;
}

export function metricsOf(rows: readonly ScorableRow[]): SliceMetrics | null {
  if (rows.length === 0) return null;
  const errors = rows.map((r) => r.actualMargin - r.margin);
  const bias = mean(errors);
  const sigma = Math.sqrt(mean(errors.map((e) => e * e)));
  const graded = rows.filter((r) => r.favoriteWon !== null);
  const nll =
    graded.length === 0
      ? NaN
      : -graded.reduce(
          (a, r) => a + Math.log(r.favoriteWon ? r.favWinProb : 1 - r.favWinProb),
          0,
        ) / graded.length;
  return {
    n: rows.length,
    mae: mean(errors.map(Math.abs)),
    bias,
    biasSe: sigma / Math.sqrt(rows.length),
    nll,
  };
}

const fmt = (m: SliceMetrics) =>
  `${String(m.n).padStart(5)}   ${m.mae.toFixed(2).padStart(6)}   ` +
  `${(m.bias >= 0 ? "+" : "") + m.bias.toFixed(2)} +/-${m.biasSe.toFixed(2)}   ` +
  `${Number.isNaN(m.nll) ? "   --  " : m.nll.toFixed(4)}`;

/**
 * Per-season breakdown, generalising the precedent `tuneChurn` already sets:
 * "a parameter that helps 2024 and hurts 2025 is visibly overfit". Over eleven
 * seasons that check stops being a nicety and becomes the main defence against
 * fitting a sport that no longer exists.
 *
 * Chain-only seasons print as a marked, unscored row rather than vanishing —
 * an excluded season that leaves no trace is indistinguishable from a season
 * that was never loaded, and this repo has been bitten by exactly that shape
 * before (`emptyIsHealthy`).
 */
export function perSeasonTable(
  rows: readonly ScorableRow[],
  window: SeasonWindow,
): string {
  const lines = [
    `\n== Per season (${window.label}) ==`,
    "season    n      MAE     bias +/-SE       NLL",
  ];
  for (const season of window.all) {
    const seasonRows = rows.filter((r) => r.season === season);
    const m = metricsOf(seasonRows);
    const scored = window.scored.includes(season);
    if (!scored) {
      const why = window.warmup.includes(season) ? "warm-up, SP+ priors" : "COVID, chained only";
      const shadow = m ? `  [unscored: ${fmt(m)}]` : "";
      lines.push(`${season}    not scored (${why})${shadow}`);
      continue;
    }
    lines.push(m ? `${season}  ${fmt(m)}` : `${season}    no rows`);
  }
  return lines.join("\n");
}

/**
 * Per-era breakdown. The pooled number can look clean while two eras pull in
 * opposite directions — the same way a pooled signed bias of +0.03 hid a +9.8
 * lean on the 11% of games that were cross-classification.
 */
export function perEraTable(rows: readonly ScorableRow[], window: SeasonWindow): string {
  const lines = [
    `\n== Per era (${window.label}) ==`,
    "era   seasons        n      MAE     bias +/-SE       NLL   boundary reason",
  ];
  for (const { era, seasons } of erasIn(window.scored)) {
    const m = metricsOf(rows.filter((r) => seasons.includes(r.season)));
    if (!m) continue;
    lines.push(
      `${era.id}    ${`${seasons[0]}-${seasons[seasons.length - 1]}`.padEnd(10)}  ${fmt(m)}   ${era.reason}`,
    );
  }
  return lines.join("\n");
}

export type { Era };
