/**
 * Live "is my bet winning right now?" math — pure, client-safe.
 *
 * Semantics are if-the-game-ended-now, matching the Sunday grader's cover
 * formulas (scripts/lib/jobs-core.ts), with one asymmetry: totals can clinch
 * mid-game, because points never come off the board — once the combined score
 * passes the line the over has won and the under is dead, whatever the clock.
 */

import type { MyBetView } from "./slate";

export interface LiveBetStatus {
  state: "winning" | "losing" | "push";
  /** Outcome can no longer flip (totals once points pass the line) */
  clinched: boolean;
  label: string;
}

const fmtPts = (n: number): string => `${Math.round(n * 10) / 10}`;

export function liveSpreadStatus(
  side: "home" | "away",
  line: number,
  homePts: number,
  awayPts: number,
): LiveBetStatus {
  const margin = homePts - awayPts;
  // same cover formula as the grader
  const coverMargin = side === "home" ? margin + line : -margin - line;
  if (coverMargin > 0)
    return { state: "winning", clinched: false, label: `Covering by ${fmtPts(coverMargin)}` };
  if (coverMargin < 0)
    return { state: "losing", clinched: false, label: `Down ${fmtPts(-coverMargin)} ATS` };
  return { state: "push", clinched: false, label: "On the number" };
}

export function liveTotalStatus(
  side: "over" | "under",
  line: number,
  homePts: number,
  awayPts: number,
): LiveBetStatus {
  const pts = homePts + awayPts;
  if (pts > line) {
    return side === "over"
      ? { state: "winning", clinched: true, label: "Over hit" }
      : { state: "losing", clinched: true, label: "Under dead" };
  }
  if (pts === line) {
    // any score wins the over / kills the under; a scoreless finish pushes
    return { state: "push", clinched: false, label: "On the number" };
  }
  const needToWin = Math.floor(line - pts) + 1;
  return side === "over"
    ? { state: "losing", clinched: false, label: `Needs ${needToWin} more` }
    : { state: "winning", clinched: false, label: `${fmtPts(line - pts)} pts of room` };
}

export function liveMoneylineStatus(
  side: "home" | "away",
  homePts: number,
  awayPts: number,
): LiveBetStatus {
  const margin = side === "home" ? homePts - awayPts : awayPts - homePts;
  if (margin > 0) return { state: "winning", clinched: false, label: `Leading by ${margin}` };
  if (margin < 0) return { state: "losing", clinched: false, label: `Trailing by ${-margin}` };
  return { state: "push", clinched: false, label: "Tied" };
}

/** Pick'em picks: home/away are spread picks against line_at_pick; over/under totals. */
export function statusForPick(
  side: string,
  line: number,
  homePts: number,
  awayPts: number,
): LiveBetStatus | null {
  if (side === "home" || side === "away") return liveSpreadStatus(side, line, homePts, awayPts);
  if (side === "over" || side === "under") return liveTotalStatus(side, line, homePts, awayPts);
  return null;
}

/**
 * Ledger bets: only types a full-game score can settle. team_total /
 * first_half / future — and bets missing a side or a needed line — return null.
 */
export function statusForBet(
  bet: MyBetView,
  homePts: number,
  awayPts: number,
): LiveBetStatus | null {
  const { betType, side, line } = bet;
  if (betType === "spread" && (side === "home" || side === "away") && line !== null) {
    return liveSpreadStatus(side, line, homePts, awayPts);
  }
  if (betType === "total" && (side === "over" || side === "under") && line !== null) {
    return liveTotalStatus(side, line, homePts, awayPts);
  }
  if (betType === "moneyline" && (side === "home" || side === "away")) {
    return liveMoneylineStatus(side, homePts, awayPts);
  }
  return null;
}
