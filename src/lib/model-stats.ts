/**
 * The model's record, cut every way the crew asks about it (`/model/stats`).
 *
 * Owner request, 2026-09-04: "I want to be able to view the model's full stats
 * somewhere. It doesn't have its total record, I want to see how it's doing on
 * a bunch of different buckets." Receipts carries a four-tile calibration
 * strip and the row-by-row book; the season record and every split of it had
 * no home. This module is the arithmetic for that home, and `bet-cuts.ts` is
 * its template: key functions here, one tally, the page renders.
 *
 * ## What is graded, and against which line
 *
 * A frozen prediction takes no bet, so "the model's record" has to be defined
 * before it can be counted. Every number here follows the Receipts page's
 * definitions so the two surfaces cannot disagree:
 *
 *  - **SU** — the model's favourite (`home_win_prob ≥ 0.5` → home) won.
 *  - **ATS** — the model's lean (the sign of `edge = spread − vegas_spread`)
 *    covered the **freeze-time** consensus it was priced against. This is the
 *    record Receipts prints as "Model leans ATS".
 *  - **vs the close** — the same lean, taken against `close_spread`, the
 *    Sunday grader's kickoff consensus. The hardest benchmark there is, and not
 *    a wager anyone can place; reported as a headline, never as a cut.
 *  - **O/U** — the model's total against the closing consensus total. No
 *    market total is stored at freeze, so this is the only total record that
 *    exists. The freeze job stores no total at all while the off/def split is
 *    uninformative (preseason), so early weeks show nothing here by design.
 *  - **CLV** — `predictions.clv`, written by the grader; `src/lib/clv.ts` owns
 *    the sign. Summarised, never recomputed.
 *  - **MAE / bias** — model margin against the actual margin, home
 *    perspective. Bias positive means home teams beat the number on average —
 *    the +0.74 that decided the HFA change in the decisions log.
 *
 * ## Read the changelog before adding a bucket
 *
 * "Beware the bucket that clears" (docs/CHANGELOG.md): with disjoint edge
 * bands, the 6–10 band came back 53.5% over n=428 and it was noise — one of
 * five, non-monotonic, ~1 SE over. Every table on the stats page is
 * descriptive. The page prints n and the standard error beside every win
 * rate, and nothing here promotes a bucket to a strategy. The edge bands are
 * the backtest's own (`scripts/backtest.ts`, "Edge flags vs the CLOSING
 * line") so the in-season table reads against the 2023–25 one directly.
 *
 * Pure and database-free, like `records.ts` and `bet-cuts.ts`.
 */

import { type ClvSummary, summarizeClv } from "./clv";
import { kickSlot } from "./kick";
import { tierMatchup, tierOf } from "./tiers";

/** The team fields the tier cut needs. Two columns and a name, nothing drawn. */
export interface ReceiptTeam {
  school: string;
  conference: string | null;
  /** `teams.classification`: "fbs" | "fcs". */
  classification: string;
}

/**
 * One frozen prediction with the game and team context the cuts need.
 * Numerics arrive coerced — the page's job, since PostgREST's `numeric`
 * convention is the caller's problem (see `records.ts`, `Numeric`).
 */
export interface ModelReceipt {
  gameId: number;
  seasonId: number;
  week: number;
  /** `games.season_type`: regular | postseason. */
  seasonType: string;
  modelVersion: string;
  startTs: string | null;
  status: string;
  homePoints: number | null;
  awayPoints: number | null;
  neutralSite: boolean;
  conferenceGame: boolean;
  home: ReceiptTeam;
  away: ReceiptTeam;
  /** Model spread, home perspective (negative = home favoured). */
  spread: number;
  /** Model total, or null when the freeze declined to price one. */
  total: number | null;
  homeWinProb: number;
  /** Consensus the model was priced against at freeze. */
  vegasSpread: number | null;
  openSpread: number | null;
  /** Kickoff consensus, written by the Sunday grader. */
  closeSpread: number | null;
  /** Kickoff consensus total; null when none was captured near kickoff. */
  closeTotal: number | null;
  /** model spread − vegas spread. Negative = the model likes home more. */
  edge: number | null;
  edgeFlag: "EDGE" | "BIG_EDGE" | null;
  consensusFlag: boolean;
  clv: number | null;
}

export type Outcome = "win" | "loss" | "push";

export interface GradedReceipt extends ModelReceipt {
  /** Final with both scores — the only state anything below is counted in. */
  final: boolean;
  /** home − away, or null until final. */
  margin: number | null;
  /** The model's ATS lean against the freeze-time line. */
  lean: "home" | "away" | null;
  /** Lean vs the freeze-time consensus. */
  ats: Outcome | null;
  /** The model's side of the CLOSING number, graded against it. */
  atsClose: Outcome | null;
  /** The model's favourite won. */
  su: boolean | null;
  ouLean: "over" | "under" | null;
  /** Model total vs the closing total, graded on the final score. */
  ou: Outcome | null;
  /** |actual margin − model margin|. */
  absError: number | null;
  /** actual margin − model margin, home perspective. */
  signedError: number | null;
  /** |actual total − model total|, when a total was priced. */
  totalAbsError: number | null;
}

/**
 * One side's cover result on a home-perspective line. Written out rather than
 * imported from `cover.ts` so the push case reads at the call site — this is
 * the arithmetic Receipts uses, character for character.
 */
function coverOutcome(side: "home" | "away", line: number, margin: number): Outcome {
  const cm = margin + line; // > 0 = home covered
  if (cm === 0) return "push";
  return (cm > 0) === (side === "home") ? "win" : "loss";
}

/**
 * The model's side of a market number: negative disagreement means it likes
 * the home team more than the number does. Null when it sits on the number.
 */
function sideOf(modelSpread: number, marketSpread: number): "home" | "away" | null {
  const d = modelSpread - marketSpread;
  if (d === 0) return null;
  return d < 0 ? "home" : "away";
}

export function gradeReceipt(r: ModelReceipt): GradedReceipt {
  const final = r.status === "final" && r.homePoints !== null && r.awayPoints !== null;
  const margin = final ? (r.homePoints as number) - (r.awayPoints as number) : null;

  // Lean exists whenever the model disagrees with the freeze line — Receipts'
  // definition, which is `edge`'s sign rather than a recomputation.
  const lean = r.edge === null || r.edge === 0 ? null : r.edge < 0 ? "home" : "away";
  const closeSide = r.closeSpread === null ? null : sideOf(r.spread, r.closeSpread);
  const ouLean =
    r.total === null || r.closeTotal === null || r.total === r.closeTotal
      ? null
      : r.total > r.closeTotal
        ? "over"
        : "under";

  if (margin === null) {
    return {
      ...r,
      final,
      margin,
      lean,
      ats: null,
      atsClose: null,
      su: null,
      ouLean,
      ou: null,
      absError: null,
      signedError: null,
      totalAbsError: null,
    };
  }

  const ats = lean !== null && r.vegasSpread !== null ? coverOutcome(lean, r.vegasSpread, margin) : null;
  const atsClose =
    closeSide !== null && r.closeSpread !== null
      ? coverOutcome(closeSide, r.closeSpread, margin)
      : null;
  const su = r.homeWinProb >= 0.5 ? margin > 0 : margin < 0;

  let ou: Outcome | null = null;
  if (ouLean !== null && r.closeTotal !== null) {
    const scored = (r.homePoints as number) + (r.awayPoints as number);
    if (scored === r.closeTotal) ou = "push";
    else ou = (scored > r.closeTotal) === (ouLean === "over") ? "win" : "loss";
  }

  // The model's margin is −spread (a −7 spread predicts home by 7).
  const predicted = -r.spread;
  const signedError = margin - predicted;
  const totalAbsError =
    r.total === null ? null : Math.abs((r.homePoints as number) + (r.awayPoints as number) - r.total);

  return {
    ...r,
    final,
    margin,
    lean,
    ats,
    atsClose,
    su,
    ouLean,
    ou,
    absError: Math.abs(signedError),
    signedError,
    totalAbsError,
  };
}

/* ── The tally ───────────────────────────────────────────────────────────── */

export interface Record3 {
  wins: number;
  losses: number;
  pushes: number;
}

export interface ModelTally {
  /** Final games in the bucket. */
  n: number;
  /** Lean vs the freeze-time line. */
  ats: Record3;
  /** wins / (wins + losses), or null with nothing decided. */
  atsPct: number | null;
  /** One standard error on `atsPct`, the backtest's ±1SE column. */
  atsSe: number | null;
  /** The model's side of the closing number, graded against it. */
  atsClose: Record3;
  su: { wins: number; n: number };
  suPct: number | null;
  clv: ClvSummary;
  mae: number | null;
  bias: number | null;
  ou: Record3;
  ouPct: number | null;
  totalMae: number | null;
}

const EMPTY3 = (): Record3 => ({ wins: 0, losses: 0, pushes: 0 });

function add(rec: Record3, o: Outcome | null): void {
  if (o === "win") rec.wins += 1;
  else if (o === "loss") rec.losses += 1;
  else if (o === "push") rec.pushes += 1;
}

const pct = (r: Record3): number | null =>
  r.wins + r.losses > 0 ? r.wins / (r.wins + r.losses) : null;

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

/** Fold graded receipts into a record. Games that are not final contribute nothing. */
export function tallyModel(receipts: Iterable<GradedReceipt>): ModelTally {
  const ats = EMPTY3();
  const atsClose = EMPTY3();
  const ou = EMPTY3();
  let n = 0;
  let suWins = 0;
  let suN = 0;
  const clvs: Array<number | null> = [];
  const errs: number[] = [];
  const signed: number[] = [];
  const totalErrs: number[] = [];

  for (const r of receipts) {
    if (!r.final) continue;
    n += 1;
    add(ats, r.ats);
    add(atsClose, r.atsClose);
    add(ou, r.ou);
    if (r.su !== null) {
      suN += 1;
      if (r.su) suWins += 1;
    }
    clvs.push(r.clv);
    if (r.absError !== null) errs.push(r.absError);
    if (r.signedError !== null) signed.push(r.signedError);
    if (r.totalAbsError !== null) totalErrs.push(r.totalAbsError);
  }

  const decided = ats.wins + ats.losses;
  return {
    n,
    ats,
    atsPct: pct(ats),
    atsSe: decided > 0 ? Math.sqrt(0.25 / decided) : null,
    atsClose,
    su: { wins: suWins, n: suN },
    suPct: suN > 0 ? suWins / suN : null,
    clv: summarizeClv(clvs),
    mae: mean(errs),
    bias: mean(signed),
    ou,
    ouPct: pct(ou),
    totalMae: mean(totalErrs),
  };
}

/** "12-7-1", or "12-7" when nothing pushed. Same spelling as `records.ts`. */
export function formatRecord3(r: Record3): string {
  return r.pushes > 0 ? `${r.wins}-${r.losses}-${r.pushes}` : `${r.wins}-${r.losses}`;
}

/* ── Cuts ────────────────────────────────────────────────────────────────── */

/** The bucket a receipt falls in, or null when the cut does not apply to it. */
export type ModelCut = (r: GradedReceipt) => string | null;

export interface ModelCutSpec {
  label: string;
  cut: ModelCut;
  /** Fixed display order. Absent means by n, largest bucket first. */
  order?: readonly string[];
  /** Sort buckets by the first integer in their label (weeks). */
  numeric?: true;
  /** One line under the table on what the cut means. */
  note?: string;
}

export const weekOf: ModelCut = (r) =>
  r.seasonType === "postseason" ? "Postseason" : `Week ${r.week}`;

/**
 * The backtest's disjoint edge bands, plus the unflagged band under 2 that the
 * backtest never prints because it flags nothing there. Disjoint on purpose:
 * "≥2" containing "≥4" is how the marginal band stayed invisible before.
 */
export const EDGE_BANDS = ["Under 2", "2–3", "3–4", "4–6", "6–10", "10+"] as const;

export const edgeBandOf: ModelCut = (r) => {
  if (r.edge === null) return null;
  const e = Math.abs(r.edge);
  if (e < 2) return "Under 2";
  if (e < 3) return "2–3";
  if (e < 4) return "3–4";
  if (e < 6) return "4–6";
  if (e < 10) return "6–10";
  return "10+";
};

export const leanSideOf: ModelCut = (r) =>
  r.lean === null ? null : r.lean === "home" ? "Home" : "Away";

/** Which side of the market the model's lean lands on. */
export const leanFavDogOf: ModelCut = (r) => {
  if (r.lean === null || r.vegasSpread === null) return null;
  if (r.vegasSpread === 0) return "Pick'em";
  const homeFav = r.vegasSpread < 0;
  return (r.lean === "home") === homeFav ? "Favourite" : "Underdog";
};

export const SPREAD_BANDS = ["PK–3", "3.5–7", "7.5–14", "14.5–21", "21+"] as const;

export const spreadSizeOf: ModelCut = (r) => {
  if (r.vegasSpread === null) return null;
  const s = Math.abs(r.vegasSpread);
  if (s <= 3) return "PK–3";
  if (s <= 7) return "3.5–7";
  if (s <= 14) return "7.5–14";
  if (s <= 21) return "14.5–21";
  return "21+";
};

export const TIER_ORDER = ["P4 vs P4", "G5 vs G5", "cross-tier", "FBS vs FCS"] as const;

export const tierMatchupOf: ModelCut = (r) => {
  const season = r.seasonId;
  const h = tierOf(r.home.conference, r.home.school, season, r.home.classification !== "fcs");
  const a = tierOf(r.away.conference, r.away.school, season, r.away.classification !== "fcs");
  const m = tierMatchup(h, a);
  return m === "unknown" ? null : m;
};

export const conferenceGameOf: ModelCut = (r) =>
  r.conferenceGame ? "Conference" : "Non-conference";

export const siteOf: ModelCut = (r) => (r.neutralSite ? "Neutral site" : "Home field");

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Eastern weekday, the broadcast clock — same reasoning as `kickSlot`. */
export const dayOf: ModelCut = (r) => {
  if (!r.startTs) return null;
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(new Date(r.startTs));
  return (DAYS as readonly string[]).includes(label) ? label : null;
};

export const windowOf: ModelCut = (r) => (r.startTs ? kickSlot(r.startTs) : null);

export const consensusOf: ModelCut = (r) => (r.consensusFlag ? "With the systems" : "On its own");

/**
 * Where the market went between the opener and the freeze, relative to the
 * model's number. Lines snap to the half point, so any change is a real one.
 */
export const openerMoveOf: ModelCut = (r) => {
  if (r.openSpread === null || r.vegasSpread === null) return null;
  const before = Math.abs(r.spread - r.openSpread);
  const after = Math.abs(r.spread - r.vegasSpread);
  if (after === before) return "Held";
  return after < before ? "Came toward the model" : "Moved away";
};

export const versionOf: ModelCut = (r) => r.modelVersion;

export const ouLeanOf: ModelCut = (r) =>
  r.ouLean === null ? null : r.ouLean === "over" ? "Over" : "Under";

export const TOTAL_BANDS = ["Under 45", "45–55", "55–65", "65+"] as const;

export const totalSizeOf: ModelCut = (r) => {
  if (r.ouLean === null || r.closeTotal === null) return null;
  const t = r.closeTotal;
  if (t < 45) return "Under 45";
  if (t < 55) return "45–55";
  if (t < 65) return "55–65";
  return "65+";
};

export const WEEK_CUT: ModelCutSpec = {
  label: "Week",
  cut: weekOf,
  numeric: true,
  note: "Postseason games are one bucket.",
};

export const DISAGREEMENT_CUTS: readonly ModelCutSpec[] = [
  {
    label: "Edge size",
    cut: edgeBandOf,
    order: EDGE_BANDS,
    note: "Points of disagreement with the freeze line. Flags start at 2; the backtest's bands, so this reads against 2023–25 directly.",
  },
  {
    label: "Systems",
    cut: consensusOf,
    order: ["With the systems", "On its own"],
    note: "Whether SP+, FPI and Elo sided with the model at freeze.",
  },
  {
    label: "Opener to freeze",
    cut: openerMoveOf,
    order: ["Came toward the model", "Held", "Moved away"],
    note: "How the market moved between the opening number and Thursday, relative to the model's.",
  },
];

export const MATCHUP_CUTS: readonly ModelCutSpec[] = [
  { label: "Lean", cut: leanSideOf, order: ["Home", "Away"] },
  {
    label: "Favourite or dog",
    cut: leanFavDogOf,
    order: ["Favourite", "Pick'em", "Underdog"],
    note: "Which side of the market the lean landed on.",
  },
  { label: "Market spread", cut: spreadSizeOf, order: SPREAD_BANDS },
  { label: "Tier", cut: tierMatchupOf, order: TIER_ORDER },
  { label: "Conference", cut: conferenceGameOf, order: ["Conference", "Non-conference"] },
  { label: "Site", cut: siteOf, order: ["Home field", "Neutral site"] },
];

export const TIMING_CUTS: readonly ModelCutSpec[] = [
  { label: "Day", cut: dayOf, order: DAYS, note: "Eastern time." },
  { label: "Window", cut: windowOf, order: ["Noon", "Afternoon", "Primetime", "Late"] },
];

export const TOTAL_CUTS: readonly ModelCutSpec[] = [
  { label: "Lean", cut: ouLeanOf, order: ["Over", "Under"] },
  { label: "Closing total", cut: totalSizeOf, order: TOTAL_BANDS },
];

export const VERSION_CUT: ModelCutSpec = { label: "Model version", cut: versionOf };

/** Group by a cut, then tally each bucket. Receipts the cut can't place are skipped. */
export function tallyModelBy(
  receipts: Iterable<GradedReceipt>,
  cut: ModelCut,
): Map<string, ModelTally> {
  const buckets = new Map<string, GradedReceipt[]>();
  for (const r of receipts) {
    const k = cut(r);
    if (k === null) continue;
    const arr = buckets.get(k);
    if (arr) arr.push(r);
    else buckets.set(k, [r]);
  }
  const out = new Map<string, ModelTally>();
  for (const [k, arr] of buckets) out.set(k, tallyModel(arr));
  return out;
}

const firstInt = (s: string): number => {
  const m = /-?\d+/.exec(s);
  return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
};

/** Tally map → display rows in the spec's order, empty buckets dropped. */
export function rowsFor(
  receipts: Iterable<GradedReceipt>,
  spec: ModelCutSpec,
): Array<[string, ModelTally]> {
  const rows = [...tallyModelBy(receipts, spec.cut).entries()].filter(([, t]) => t.n > 0);
  if (spec.order) {
    const order = spec.order;
    return rows.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }
  if (spec.numeric) {
    return rows.sort((a, b) => firstInt(a[0]) - firstInt(b[0]) || a[0].localeCompare(b[0]));
  }
  return rows.sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
}

/* ── What the season has earned ──────────────────────────────────────────── */

/**
 * A split is shown once one of its buckets has this many graded games.
 * Owner reaction to the first render (2026-09-04, 18 games in): "It looks
 * incredibly confusing" — forty rows of 0% and 100% on n=1. A table the
 * season hasn't earned is noise dressed as a finding.
 */
export const MIN_BUCKET = 10;
/** Buckets under this many games fold into one "Other" row. */
export const MIN_ROW = 5;
/** Roughly when the default splits start appearing; printed in the placeholder. */
export const SPLITS_AFTER = 40;

export const OTHER = "Other";

export interface SplitRows {
  /** False when no bucket has reached MIN_BUCKET — render a placeholder. */
  show: boolean;
  rows: Array<[string, ModelTally]>;
}

/**
 * `rowsFor` with the season's sample size applied: hidden until one bucket
 * has MIN_BUCKET games, and buckets under MIN_ROW folded into "Other" so a
 * 1-0 never prints as a row. Weeks (`numeric`) are never folded — a week in
 * progress is a real bucket that is simply not finished yet.
 */
export function splitRows(receipts: Iterable<GradedReceipt>, spec: ModelCutSpec): SplitRows {
  const finals = [...receipts].filter((r) => r.final);
  const groups = new Map<string, GradedReceipt[]>();
  for (const r of finals) {
    const k = spec.cut(r);
    if (k === null) continue;
    const arr = groups.get(k);
    if (arr) arr.push(r);
    else groups.set(k, [r]);
  }
  const show = [...groups.values()].some((g) => g.length >= MIN_BUCKET);
  if (!show) return { show, rows: [] };

  if (spec.numeric) return { show, rows: rowsFor(finals, spec) };

  const small: GradedReceipt[] = [];
  const kept: GradedReceipt[] = [];
  for (const [, g] of groups) (g.length < MIN_ROW ? small : kept).push(...g);
  const rows = rowsFor(kept, spec);
  if (small.length > 0) {
    // An "Other" made only of games with no line (the FCS buy games, in the
    // tier cut) would print "0-0 –". The table's footnote already says how
    // many games had no line; the row would say it worse.
    const other = tallyModel(small);
    const graded = (r: Record3) => r.wins + r.losses + r.pushes;
    if (graded(other.ats) + graded(other.ou) > 0) rows.push([OTHER, other]);
  }
  return { show, rows };
}

/* ── Win-probability calibration ─────────────────────────────────────────── */

export interface CalibrationRow {
  label: string;
  n: number;
  /** Mean favourite win probability in the band. */
  predicted: number;
  /** Share of favourites that won. */
  actual: number;
}

/**
 * SPEC §2.5's question — do 70% favourites win about 70%? — in the backtest's
 * five bands, over final games. The favourite's probability is
 * `max(p, 1 − p)`, so every game lands in one band.
 */
export function calibration(receipts: Iterable<GradedReceipt>): CalibrationRow[] {
  const bands: Array<[string, number, number]> = [
    ["50–60%", 0.5, 0.6],
    ["60–70%", 0.6, 0.7],
    ["70–80%", 0.7, 0.8],
    ["80–90%", 0.8, 0.9],
    ["90–100%", 0.9, 1.01],
  ];
  const out: CalibrationRow[] = [];
  const graded = [...receipts].filter((r) => r.final && r.su !== null);
  for (const [label, lo, hi] of bands) {
    const inBand = graded.filter((r) => {
      const p = Math.max(r.homeWinProb, 1 - r.homeWinProb);
      return p >= lo && p < hi;
    });
    if (inBand.length === 0) continue;
    const predicted =
      inBand.reduce((a, r) => a + Math.max(r.homeWinProb, 1 - r.homeWinProb), 0) / inBand.length;
    const actual = inBand.filter((r) => r.su).length / inBand.length;
    out.push({ label, n: inBand.length, predicted, actual });
  }
  return out;
}

/**
 * Whether a closing total counts. The grader nulls a close older than six
 * hours at kickoff (`STALE_CLOSE_MS` in scripts/lib/jobs-core.ts) rather than
 * grade against a days-old number; the same rule here, restated because the
 * dependency runs scripts → src and never back.
 */
export const STALE_CLOSE_MS = 6 * 3600 * 1000;

export function closingTotal(
  total: number | null,
  asOf: string | null,
  startTs: string | null,
): number | null {
  if (total === null || asOf === null || startTs === null) return null;
  const kick = Date.parse(startTs);
  const seen = Date.parse(asOf);
  if (!Number.isFinite(kick) || !Number.isFinite(seen)) return null;
  if (seen >= kick) return null;
  if (kick - seen > STALE_CLOSE_MS) return null;
  return total;
}
