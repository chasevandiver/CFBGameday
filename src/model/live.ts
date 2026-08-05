/**
 * Live in-game win probability — pure functions, no I/O.
 *
 * Blends the pregame model margin with the current score as time runs out:
 * expected final margin = live margin + pregame margin × f, where f is the
 * fraction of regulation remaining, and the dispersion around it shrinks with
 * √f. At f = 1 this reproduces (a normal approximation of) the pregame win
 * prob; at f → 0 it snaps toward whoever leads.
 */

import { DEFAULT_PARAMS, normalCdf, type ModelParams } from "./ratings";

export interface LiveWinProbInput {
  /** Home-perspective pregame model margin (positive = home favored); 0 if unknown */
  pregameMargin: number;
  homePoints: number;
  awayPoints: number;
  period: number | null;
  /** "MM:SS" remaining in the period; unparseable → full period remaining */
  clock: string | null;
  params?: ModelParams;
}

/** Fraction of regulation remaining, 0..1. Overtime → a small constant. */
export function fractionRemaining(period: number | null, clock: string | null): number {
  if (period === null || period < 1) return 1;
  if (period > 4) return 0.04;
  const m = clock ? /^(\d{1,2}):(\d{2})$/.exec(clock.trim()) : null;
  const secsInPeriod = m ? Math.min(Number(m[1]) * 60 + Number(m[2]), 900) : 900;
  const remaining = (4 - period) * 900 + secsInPeriod;
  return Math.min(Math.max(remaining / 3600, 0), 1);
}

export function liveWinProb(inp: LiveWinProbInput): number {
  const p = inp.params ?? DEFAULT_PARAMS;
  const f = fractionRemaining(inp.period, inp.clock);
  const liveMargin = inp.homePoints - inp.awayPoints;
  const expected = liveMargin + inp.pregameMargin * f;
  // floor keeps a sliver of uncertainty even at 0:00 (game isn't final yet)
  const sigma = p.marginSigma * Math.sqrt(Math.max(f, 0.02));
  const prob = 1 - normalCdf(0, expected, sigma);
  return Math.min(Math.max(prob, 0.001), 0.999);
}
