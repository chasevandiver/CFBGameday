/**
 * Live "is my bet winning right now?" math — pure, client-safe.
 *
 * Semantics are if-the-game-ended-now, matching the Sunday grader's cover
 * formulas (scripts/lib/jobs-core.ts), with one asymmetry: totals can clinch
 * mid-game, because points never come off the board — once the combined score
 * passes the line the over has won and the under is dead, whatever the clock.
 */

import type { PickMarket } from "./grade";
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

/**
 * Pick'em picks, live. Routed by market rather than by side: straight-up shares
 * home/away with the spread and carries no line, so reading `side` alone would
 * grade a winner pick against a number it never took (see `grade.ts`, which
 * makes the same distinction at settlement).
 */
export function statusForPick(
  market: PickMarket,
  side: string,
  line: number | null,
  homePts: number,
  awayPts: number,
): LiveBetStatus | null {
  if (market === "straight_up") {
    if (side !== "home" && side !== "away") return null;
    return liveMoneylineStatus(side, homePts, awayPts);
  }
  if (line === null) return null;
  if (market === "spread" && (side === "home" || side === "away"))
    return liveSpreadStatus(side, line, homePts, awayPts);
  if (market === "total" && (side === "over" || side === "under"))
    return liveTotalStatus(side, line, homePts, awayPts);
  return null;
}

/* ---- cover strip (pick'em) --------------------------------------------- */

export type CoverTier = "covering" | "bubble" | "losing";

export interface PickCoverView {
  tier: CoverTier;
  /** Verdict word by sign, e.g. "Covering" / "Not covering" / "On the number" */
  word: string;
  /** Signed margin vs the number in broadcast halves ("+2½"); spread picks only */
  margin: string | null;
  /** Supporting text: the totals room label. Always null for spread picks. */
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
 *
 * The tier is the colour and the sort key (see liveUrgency); it is deliberately
 * not the wording. `word` reports which side of the number you are on, and the
 * amber reserved for `bubble` reports how close that number is.
 */
export function pickCoverView(
  market: PickMarket,
  side: string,
  line: number | null,
  homePts: number,
  awayPts: number,
): PickCoverView | null {
  if (market === "straight_up") {
    if (side !== "home" && side !== "away") return null;
    const margin = side === "home" ? homePts - awayPts : awayPts - homePts;
    // One score is the sweat for a winner pick — there is no number to be
    // near, so the bubble is "a touchdown and two flips it".
    const tier: CoverTier = Math.abs(margin) <= 8 ? "bubble" : margin > 0 ? "covering" : "losing";
    return {
      tier,
      word: margin === 0 ? "Tied" : margin > 0 ? "Winning" : "Losing",
      margin: null,
      sub: margin === 0 ? null : `${margin > 0 ? "Up" : "Down"} ${Math.abs(margin)}`,
    };
  }
  if (line === null) return null;
  if (market === "spread" && (side === "home" || side === "away")) {
    const margin = side === "home" ? homePts - awayPts : awayPts - homePts;
    const cm = margin + line;
    const tier: CoverTier = Math.abs(cm) <= 3 ? "bubble" : cm > 0 ? "covering" : "losing";
    // The word tracks the sign, not the tier — amber already says "bubble", so
    // saying it again spends the strip's one loud slot on what the colour has
    // covered. Which side of the number you're on is the part colour can't tell
    // you: green COVERING is comfortable, amber COVERING +½ is a knife edge.
    const word = cm === 0 ? "On the number" : cm > 0 ? "Covering" : "Not covering";
    return {
      tier,
      word,
      margin: cm === 0 ? null : fmtHalves(cm),
      sub: null,
    };
  }
  if (market === "total" && (side === "over" || side === "under")) {
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
  const v = pickCoverView(
    g.myPick.market,
    g.myPick.side,
    g.myPick.line,
    g.homePoints ?? 0,
    g.awayPoints ?? 0,
  );
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

/* ---- card tint (the Liquid Glass aura) --------------------------------- */

/**
 * What the card's ambient glow is saying:
 *   covering / losing / bubble — you have money or a pick on this game
 *   teams                      — you don't, so the aura is the team colours
 *
 * Ledger bets outrank pick'em picks: if you have both, the one with real
 * units on it decides the colour. Pushes and ungraded states fall back to
 * "teams" rather than inventing a verdict.
 */
export type CardTint = "covering" | "losing" | "bubble" | "teams";

const tierFromMargin = (coverMargin: number, live: boolean): CardTint => {
  // the bubble only exists while the game can still flip it
  if (live && Math.abs(coverMargin) <= 3) return "bubble";
  if (coverMargin > 0) return "covering";
  if (coverMargin < 0) return "losing";
  return "teams";
};

export function tintFor(g: GameView): CardTint {
  const live = g.status === "in_progress";
  const final = g.status === "final";
  if (!live && !final) return "teams";
  if (g.homePoints === null || g.awayPoints === null) return "teams";

  // a ledger bet wins over a pick'em pick
  for (const bet of g.myBets) {
    const status = statusForBet(bet, g.homePoints, g.awayPoints);
    if (!status) continue;
    if (status.state === "push") return "teams";
    if (status.state === "winning") return live && !status.clinched ? nearNumber(g, bet) : "covering";
    return live && !status.clinched ? nearNumber(g, bet) : "losing";
  }

  if (g.myPick && (g.myPick.side === "home" || g.myPick.side === "away")) {
    const margin =
      g.myPick.side === "home" ? g.homePoints - g.awayPoints : g.awayPoints - g.homePoints;
    // Straight-up has no number to be near, so the raw margin is the verdict.
    if (g.myPick.market === "straight_up") return tierFromMargin(margin, live);
    if (g.myPick.line !== null) return tierFromMargin(margin + g.myPick.line, live);
  }
  return "teams";
}

/** Spread bets get the bubble tier; other bet types just win or lose. */
function nearNumber(g: GameView, bet: MyBetView): CardTint {
  if (bet.betType !== "spread" || bet.line === null) {
    return statusForBet(bet, g.homePoints ?? 0, g.awayPoints ?? 0)?.state === "winning"
      ? "covering"
      : "losing";
  }
  const margin =
    bet.side === "home"
      ? (g.homePoints ?? 0) - (g.awayPoints ?? 0)
      : (g.awayPoints ?? 0) - (g.homePoints ?? 0);
  return tierFromMargin(margin + bet.line, true);
}
