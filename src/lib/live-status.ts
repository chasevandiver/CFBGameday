/**
 * Live "is my bet winning right now?" math — pure, client-safe.
 *
 * Semantics are if-the-game-ended-now, matching the Sunday grader's cover
 * formulas (scripts/lib/jobs-core.ts), with one asymmetry: totals can clinch
 * mid-game, because points never come off the board — once the combined score
 * passes the line the over has won and the under is dead, whatever the clock.
 */

import { coverMargin } from "./cover";
import type { PickMarket } from "./grade";
import { headlinePick, type GameView, type MyBetView } from "./slate";

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
  // same cover formula as the grader — literally, via cover.ts
  const cm = coverMargin(side, line, homePts, awayPts);
  if (cm > 0) return { state: "winning", clinched: false, label: `Covering by ${fmtPts(cm)}` };
  if (cm < 0) return { state: "losing", clinched: false, label: `Down ${fmtPts(-cm)} ATS` };
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

export type CoverTier = "covering" | "push" | "losing";

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
 * The cover strip's view of a live pick. The tier is the colour, and it tracks
 * the sign alone: green covering, red not, amber only when the game sits
 * exactly on the number. There used to be a third "bubble" tier (within a
 * field goal, either side) but it made amber ambiguous — a glance couldn't
 * tell "close" from "push", which is the one distinction the colour exists to
 * make. How close the number is now lives in `margin`, not in the hue.
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
    const tier: CoverTier = margin === 0 ? "push" : margin > 0 ? "covering" : "losing";
    return {
      tier,
      word: margin === 0 ? "Tied" : margin > 0 ? "Winning" : "Losing",
      margin: null,
      sub: margin === 0 ? null : `${margin > 0 ? "Up" : "Down"} ${Math.abs(margin)}`,
    };
  }
  if (line === null) return null;
  if (market === "spread" && (side === "home" || side === "away")) {
    // Same cover formula as the grader and the chips. This branch used to
    // hand-roll `sideMargin + line`, which reads the home-perspective
    // `line_at_pick` with the sign flipped for away picks — the strip could
    // say "Covering" while the chip on the same card said "Down 7 ATS".
    const cm = coverMargin(side, line, homePts, awayPts);
    const tier: CoverTier = cm === 0 ? "push" : cm > 0 ? "covering" : "losing";
    // The margin rides along with the word — the colour says which side of the
    // number you are on, the margin says how close: green COVERING +10½ is
    // comfortable, green COVERING +½ is a knife edge.
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
    const tier: CoverTier =
      st.state === "push" ? "push" : st.state === "winning" ? "covering" : "losing";
    return {
      tier,
      word: st.state === "winning" ? "Winning" : st.state === "losing" ? "Losing" : "On the number",
      margin: null,
      sub: st.label,
    };
  }
  return null;
}

/**
 * Feed sort key for live games: closest sweats first. The old key led with the
 * bubble tier; with amber now meaning push alone, closeness is measured
 * directly — distance from the number, ascending, so an on-the-number game
 * sorts hardest. At equal distance a losing position edges out a covering one,
 * and games you have nothing on go last.
 *
 * Reads the same stake the aura does — a ledger bet first, a pick otherwise —
 * so the card the sort leads with is the card whose glow is loudest.
 */
export function liveUrgency(g: GameView): number {
  const NOTHING_RIDING = 1_000_000;
  const h = g.homePoints ?? 0;
  const a = g.awayPoints ?? 0;

  const spreadDistance = (side: "home" | "away", line: number) =>
    Math.abs(coverMargin(side, line, h, a));
  const totalDistance = (side: "over" | "under", line: number) => {
    // a clinched total can't flip, so it stops being a sweat entirely
    const st = liveTotalStatus(side, line, h, a);
    return st.clinched ? NOTHING_RIDING / 2 : Math.abs(line - (h + a));
  };

  for (const bet of g.myBets) {
    const status = statusForBet(bet, h, a);
    if (!status) continue;
    const distance =
      bet.betType === "spread" && (bet.side === "home" || bet.side === "away") && bet.line !== null
        ? spreadDistance(bet.side, bet.line)
        : bet.betType === "total" && (bet.side === "over" || bet.side === "under") && bet.line !== null
          ? totalDistance(bet.side, bet.line)
          : Math.abs(h - a);
    return distance * 2 + (status.state === "winning" ? 1 : 0);
  }

  const my = headlinePick(g.myPicks);
  if (!my) return NOTHING_RIDING;
  const v = pickCoverView(my.market, my.side, my.line, h, a);
  if (!v) return NOTHING_RIDING;
  const distance =
    my.market === "spread" && (my.side === "home" || my.side === "away") && my.line !== null
      ? spreadDistance(my.side, my.line)
      : my.market === "total" && (my.side === "over" || my.side === "under") && my.line !== null
        ? totalDistance(my.side, my.line)
        : Math.abs(h - a);
  return distance * 2 + (v.tier === "covering" ? 1 : 0);
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
 *   covering / losing / push — you have money or a pick on this game
 *   teams                    — you don't, so the aura is the team colours
 *
 * Ledger bets outrank pick'em picks: if you have both, the one with real
 * units on it decides the colour. The verdict is sign-based: green covering,
 * red losing, and amber reserved for a game sitting exactly on the number —
 * live or graded, a push is the one state that is neither. Ungraded states
 * fall back to "teams" rather than inventing a verdict.
 */
export type CardTint = "covering" | "losing" | "push" | "teams";

const tierFromMargin = (coverMargin: number): CardTint => {
  if (coverMargin > 0) return "covering";
  if (coverMargin < 0) return "losing";
  return "push";
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
    if (status.state === "push") return "push";
    return status.state === "winning" ? "covering" : "losing";
  }

  const my = headlinePick(g.myPicks);
  if (my && (my.side === "home" || my.side === "away")) {
    // Straight-up has no number to be near, so the raw margin is the verdict.
    // Spreads go through coverMargin — lines are home-perspective, and the
    // old `sideMargin + line` here glowed away picks the wrong colour.
    if (my.market === "straight_up") {
      const margin = my.side === "home" ? g.homePoints - g.awayPoints : g.awayPoints - g.homePoints;
      return tierFromMargin(margin);
    }
    if (my.line !== null)
      return tierFromMargin(coverMargin(my.side, my.line, g.homePoints, g.awayPoints));
  }
  return "teams";
}
