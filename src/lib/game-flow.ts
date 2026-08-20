/**
 * The Game Flow river (R5-B): the full win-probability curve of a finished
 * game, reconstructed from stored scoring plays and the pregame number —
 * pure derivation, no I/O, nothing invented.
 *
 * Every evaluated point runs the same `liveWinProb` the live surfaces use,
 * at a moment the database actually observed: the pregame anchor (0–0, full
 * clock), each clocked scoring play at its score-AFTER (that is what the
 * rows store), and synthetic clock samples BETWEEN plays holding the score
 * that stood — the drift toward the leader as the clock runs is computable,
 * not imagined. The terminal point is pinned to the outcome, because a final
 * is a fact, not a probability (a tie — NFL — pins to 0.5).
 *
 * Fail-closed rules: no clocked plays or no pregame number → no chart; an
 * unclocked play (null period) never moves the curve and is only counted.
 * Overtime is drawn in a compressed band past x=1 — `fractionRemaining`
 * treats all OT as one small constant, so OT points are spaced by order,
 * not by a clock nobody stored.
 */

import { liveWinProb } from "../model/live";
import type { ScoringPlayRow } from "./scoring";

export interface FlowPoint {
  /** 0..1 fraction of regulation elapsed; OT sits in (1, OT_BAND_END]. */
  x: number;
  prob: number;
  homePoints: number;
  awayPoints: number;
  period: number | null;
  clock: string | null;
  /** True for an actual scoring play; false for anchors and clock samples. */
  mark: boolean;
  scoringTeamId: number | null;
  playText: string | null;
}

export interface GameFlow {
  points: FlowPoint[];
  /** Plays that carried no period and therefore never moved the curve. */
  unclocked: number;
  /** True when any play landed in overtime (the x domain extends past 1). */
  overtime: boolean;
}

/** Where the compressed OT band ends on the x axis. */
export const OT_BAND_END = 1.12;

/**
 * Which pregame number anchors the curve, and what to call it. CFB leads
 * with the frozen model spread (the receipts number); the market close is
 * the fallback — and for the NFL it is the ONLY number, because there is no
 * NFL model by design (SPEC §10.5): the market is what the product shows
 * there, so a market prior is the honest one. Spreads are home-perspective
 * (negative = home favored); `liveWinProb` wants positive = home favored —
 * the same negation `liveHomeWinProb` applies.
 */
export function pregameMarginFor(opts: {
  frozenSpread: number | null;
  marketClose: number | null;
  sport: "cfb" | "nfl";
}): { margin: number; source: "model" | "market" } | null {
  if (opts.sport === "cfb" && opts.frozenSpread !== null) {
    return { margin: -opts.frozenSpread, source: "model" };
  }
  if (opts.marketClose !== null) return { margin: -opts.marketClose, source: "market" };
  return null;
}

/** Reconstruct a (period, clock) pair for a target fraction REMAINING. */
function clockFor(f: number): { period: number; clock: string } {
  const remaining = Math.round(Math.min(Math.max(f, 0), 1) * 3600);
  if (remaining >= 3600) return { period: 1, clock: "15:00" };
  const period = Math.min(4, 4 - Math.floor(remaining / 900));
  const inPeriod = remaining - (4 - period) * 900;
  const mm = Math.floor(inPeriod / 60);
  const ss = inPeriod % 60;
  return { period, clock: `${mm}:${String(ss).padStart(2, "0")}` };
}

function elapsedOf(period: number, clock: string | null): number {
  // Mirrors fractionRemaining's parsing: unparseable clock = full period left.
  const m = clock ? /^(\d{1,2}):(\d{2})$/.exec(clock.trim()) : null;
  const secsInPeriod = m ? Math.min(Number(m[1]) * 60 + Number(m[2]), 900) : 900;
  const remaining = (4 - Math.min(period, 4)) * 900 + secsInPeriod;
  return 1 - Math.min(Math.max(remaining / 3600, 0), 1);
}

/** Clock samples every ~2 game-minutes between plays — the river's water. */
const SAMPLE_STEP = 1 / 30;

export function gameFlowPoints(input: {
  plays: ScoringPlayRow[];
  pregameMargin: number;
  finalHome: number;
  finalAway: number;
}): GameFlow {
  const clocked = input.plays
    .filter((p) => p.period !== null)
    .sort((a, b) => a.sequence - b.sequence);
  const unclocked = input.plays.length - clocked.length;
  if (clocked.length === 0) return { points: [], unclocked, overtime: false };

  const lp = (h: number, a: number, period: number | null, clock: string | null) =>
    liveWinProb({
      pregameMargin: input.pregameMargin,
      homePoints: h,
      awayPoints: a,
      period,
      clock,
    });

  const points: FlowPoint[] = [
    {
      x: 0,
      prob: lp(0, 0, null, null),
      homePoints: 0,
      awayPoints: 0,
      period: null,
      clock: null,
      mark: false,
      scoringTeamId: null,
      playText: null,
    },
  ];

  const regulation = clocked.filter((p) => (p.period as number) <= 4);
  const otPlays = clocked.filter((p) => (p.period as number) > 4);
  const overtime = otPlays.length > 0;

  let prevX = 0;
  let prevH = 0;
  let prevA = 0;
  for (const play of regulation) {
    let xPlay = elapsedOf(play.period as number, play.clock);
    // A TD and its extra point share a clock reading; keep x strictly rising.
    if (xPlay <= prevX) xPlay = Math.min(prevX + 0.004, 1);
    // The river between plays: the standing score, the advancing clock.
    for (let xs = prevX + SAMPLE_STEP; xs < xPlay - SAMPLE_STEP / 2; xs += SAMPLE_STEP) {
      const { period, clock } = clockFor(1 - xs);
      points.push({
        x: xs,
        prob: lp(prevH, prevA, period, clock),
        homePoints: prevH,
        awayPoints: prevA,
        period,
        clock,
        mark: false,
        scoringTeamId: null,
        playText: null,
      });
    }
    points.push({
      x: xPlay,
      prob: lp(play.home_points, play.away_points, play.period, play.clock),
      homePoints: play.home_points,
      awayPoints: play.away_points,
      period: play.period,
      clock: play.clock,
      mark: true,
      scoringTeamId: play.scoring_team_id,
      playText: play.play_text,
    });
    prevX = xPlay;
    prevH = play.home_points;
    prevA = play.away_points;
  }

  // OT: fractionRemaining flattens all of it to one constant, so points are
  // spaced by order through a fixed band rather than by an unstored clock.
  otPlays.forEach((play, i) => {
    const x = 1 + ((i + 1) / (otPlays.length + 1)) * (OT_BAND_END - 1);
    points.push({
      x,
      prob: lp(play.home_points, play.away_points, play.period, play.clock),
      homePoints: play.home_points,
      awayPoints: play.away_points,
      period: play.period,
      clock: play.clock,
      mark: true,
      scoringTeamId: play.scoring_team_id,
      playText: play.play_text,
    });
    prevH = play.home_points;
    prevA = play.away_points;
  });

  // The outcome, pinned: a final is a fact. (An NFL tie pins to the middle.)
  const end = overtime ? OT_BAND_END : 1;
  points.push({
    x: end,
    prob: input.finalHome > input.finalAway ? 1 : input.finalHome < input.finalAway ? 0 : 0.5,
    homePoints: input.finalHome,
    awayPoints: input.finalAway,
    period: null,
    clock: null,
    mark: false,
    scoringTeamId: null,
    playText: null,
  });

  return { points, unclocked, overtime };
}

/** The story numbers the caption (and the recap, later) reads off the river. */
export function flowExtremes(points: FlowPoint[]): {
  flips: number;
  maxSwing: number;
  low: FlowPoint;
  high: FlowPoint;
} {
  let flips = 0;
  let maxSwing = 0;
  let low = points[0];
  let high = points[0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].prob - 0.5;
    const b = points[i].prob - 0.5;
    if (a !== 0 && b !== 0 && Math.sign(a) !== Math.sign(b)) flips++;
    maxSwing = Math.max(maxSwing, Math.abs(points[i].prob - points[i - 1].prob));
    if (points[i].prob < low.prob) low = points[i];
    if (points[i].prob > high.prob) high = points[i];
  }
  return { flips, maxSwing, low, high };
}
