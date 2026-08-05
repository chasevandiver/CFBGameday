/**
 * Live "is my bet winning right now?" math — pure, client-safe.
 *
 * Semantics are if-the-game-ended-now, matching the Sunday grader's cover
 * formulas (scripts/lib/jobs-core.ts), with one asymmetry: totals can clinch
 * mid-game, because points never come off the board — once the combined score
 * passes the line the over has won and the under is dead, whatever the clock.
 */

import type { GameView, MyBetView } from "./slate";

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

/* ---- cover strip (pick'em) --------------------------------------------- */

export type CoverTier = "covering" | "bubble" | "losing";

export interface PickCoverView {
  tier: CoverTier;
  /** Verdict word, e.g. "Covering" / "On the bubble" */
  word: string;
  /** Signed margin vs the number in broadcast halves ("+2½"); spread picks only */
  margin: string | null;
  /** Supporting text: the bubble hint, or the totals room label */
  sub: string | null;
}

/** Broadcast halves with a real minus sign: 2.5 → "+2½", -0.5 → "−½". */
const fmtHalves = (n: number): string => {
  const a = Math.abs(n);
  const whole = Math.trunc(a);
  const frac = a % 1 !== 0 ? "½" : "";
  return `${n > 0 ? "+" : "−"}${whole === 0 && frac ? frac : `${whole}${frac}`}`;
};

/**
 * The cover strip's view of a live pick. Bubble = within a field goal of the
 * number, on either side of it — the state where one score flips the result.
 */
export function pickCoverView(
  side: string,
  line: number,
  homePts: number,
  awayPts: number,
): PickCoverView | null {
  if (side === "home" || side === "away") {
    const margin = side === "home" ? homePts - awayPts : awayPts - homePts;
    const cm = margin + line;
    const tier: CoverTier = Math.abs(cm) <= 3 ? "bubble" : cm > 0 ? "covering" : "losing";
    const word =
      tier === "covering"
        ? "Covering"
        : tier === "losing"
          ? "Not covering"
          : cm === 0
            ? "On the number"
            : "On the bubble";
    return {
      tier,
      word,
      margin: cm === 0 ? null : fmtHalves(cm),
      sub: tier === "bubble" ? "a FG flips it" : null,
    };
  }
  if (side === "over" || side === "under") {
    const st = liveTotalStatus(side, line, homePts, awayPts);
    const room = line - (homePts + awayPts);
    const tier: CoverTier =
      st.state === "push" || (!st.clinched && Math.abs(room) <= 3)
        ? "bubble"
        : st.state === "winning"
          ? "covering"
          : "losing";
    return {
      tier,
      word: st.state === "winning" ? "Winning" : st.state === "losing" ? "Losing" : "On the number",
      margin: null,
      sub: st.label,
    };
  }
  return null;
}

/** Feed sort key for live games: bubble sweats first, then losing, covering, no pick. */
export function liveUrgency(g: GameView): number {
  if (!g.myPick) return 3;
  const v = pickCoverView(g.myPick.side, g.myPick.line, g.homePoints ?? 0, g.awayPoints ?? 0);
  if (!v) return 3;
  return v.tier === "bubble" ? 0 : v.tier === "losing" ? 1 : 2;
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
