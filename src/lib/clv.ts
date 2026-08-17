/**
 * Closing line value.
 *
 * CLV is positive when the number you got is BETTER for your side than the
 * number available at kickoff. It is the lowest-variance evidence that a
 * prediction carried information: a side can lose and still have been right
 * about the price, and over a season CLV converges far faster than a win rate.
 *
 * That matters more here than it usually would. The 2023–25 backtest found the
 * model's flagged edges going 49.2% ATS against a 52.4% break-even, and the
 * encompassing regression put the model's coefficient at 0.035 (t=0.84) beside
 * the market's 0.987 — so the leans are published as information, not as bets
 * (see docs/CHANGELOG.md). CLV is the honest scoreboard for that claim: it asks
 * whether the market moves toward us after we commit, which is answerable on
 * one season of data in a way that an ATS record is not.
 *
 * ## Sign convention
 *
 * Spreads are home-perspective throughout this codebase: negative means the
 * home team is favored. So a home backer wants the number to go DOWN after they
 * commit (−3 → −6 means they laid less than the close), and an away backer
 * wants it to go UP.
 *
 * Totals run the other way round for the over: an over backer wants the number
 * to go UP (bought 50, closes 54).
 *
 * Getting this backwards is silent — the magnitudes are right, every value just
 * carries the wrong sign, and the page renders a good bettor in red. It was
 * backwards in `jobs-core.ts` for picks and bets until 2026-08-07, in all four
 * branches, with no test on it. Hence this module: one implementation, four
 * worked examples in the tests, used by every caller.
 */

/**
 * Negation that doesn't produce `-0`. An unmoved line is worth zero to both
 * sides, and `-0` survives into the database and renders as "−0.00".
 */
const flip = (v: number): number => (v === 0 ? 0 : -v);

/**
 * CLV on a spread. `lineTaken` and `close` are both home-perspective.
 *
 * Home −3 closing −6 is +3: you laid three when the close lays six.
 * Away +3 (home −3) closing home −6 is −3: you took three when the close gives six.
 */
export function spreadClv(side: "home" | "away", lineTaken: number, close: number): number {
  const value = lineTaken - close;
  return side === "home" ? value : flip(value);
}

/**
 * CLV on a total.
 *
 * Over 50 closing 54 is +4: you bought the over four points cheaper than the
 * close. Under 50 closing 54 is −4.
 */
export function totalClv(side: "over" | "under", lineTaken: number, close: number): number {
  const value = close - lineTaken;
  return side === "over" ? value : flip(value);
}

/**
 * CLV for a frozen model prediction.
 *
 * The model does not place a bet, so its "side" is the direction of its
 * disagreement with the market: `edge = model spread − market spread`, and a
 * negative edge means the model likes the home team more than the market did
 * (the same convention `modelSideOf` uses in src/lib/slate.ts).
 *
 * Returns null when there is nothing to measure — no market line at freeze, no
 * closing line, or a model that agreed with the market exactly and therefore
 * took no side.
 */
export function modelClv(
  edge: number | null,
  frozenSpread: number | null,
  closeSpread: number | null,
): number | null {
  if (edge === null || edge === 0 || frozenSpread === null || closeSpread === null) return null;
  return spreadClv(edge < 0 ? "home" : "away", frozenSpread, closeSpread);
}

/**
 * CLV of the model's lean measured from the OPENER to the close (03:M-5).
 *
 * `modelClv` above grades the freeze-time number. This one asks the earlier
 * question: had you taken the model's side of the OPENING line, what was that
 * price worth by kickoff? The side is therefore the model's disagreement with
 * the opener, not with the freeze-time market — the two can differ when the
 * line crosses the model's number mid-week.
 *
 * Why it exists: the one real residual from the 2023–25 edge post-mortem is
 * that the market drifts toward the model after the opener — the 4+ bucket
 * went 51.8% with avg CLV +0.27, and every bucket was positive — and the
 * close absorbs all of it. The pre-registered in-season rule lives on the
 * Receipts surface that renders this number.
 *
 * Null when any number is missing or the model sat exactly on the opener.
 */
export function openerClv(
  modelSpread: number | null,
  openSpread: number | null,
  closeSpread: number | null,
): number | null {
  if (modelSpread === null || openSpread === null || closeSpread === null) return null;
  const edgeVsOpen = modelSpread - openSpread;
  if (edgeVsOpen === 0) return null;
  return spreadClv(edgeVsOpen < 0 ? "home" : "away", openSpread, closeSpread);
}

/** Rounded to the hundredth for numeric(5,2) storage. */
export function roundClv(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface ClvSummary {
  /** Games with a measurable CLV. */
  n: number;
  /** Mean signed CLV in points. */
  avg: number | null;
  /** Count that beat the close outright (CLV > 0). */
  beat: number;
  /** Count that landed exactly on the closing number. */
  flat: number;
}

/**
 * Aggregate for the Receipts strip. Ties are reported separately rather than
 * folded into either side: on a market that moves in half-points, landing on
 * the closing number is common and calling it a loss understates the model.
 */
export function summarizeClv(values: Array<number | null>): ClvSummary {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length === 0) return { n: 0, avg: null, beat: 0, flat: 0 };
  return {
    n: nums.length,
    avg: nums.reduce((a, b) => a + b, 0) / nums.length,
    beat: nums.filter((v) => v > 0).length,
    flat: nums.filter((v) => v === 0).length,
  };
}
