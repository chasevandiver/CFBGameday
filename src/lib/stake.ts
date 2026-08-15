/**
 * "What do I have on this game, and how is it doing?" — one answer, for every
 * card that asks.
 *
 * The slate's `GameCard` and the home hub's `PositionRow` are the same question
 * at two sizes, and until now only the slate had the answer: the cover strip
 * lived inside `GameCard` along with the two label formatters and the
 * bet-outranks-pick ordering. The hub rendered the aura from `tintFor` and no
 * word at all, so a card glowed green with nothing on it saying why.
 *
 * Everything here is pure and client-safe. The cover formulas are not
 * re-implemented — `pickCoverView` and `settledCoverView` own them, and a bet's
 * type maps onto a pick market exactly (a `moneyline` is the pool's
 * `straight_up`), which is what lets one view function serve both.
 */

import {
  pickCoverView,
  settledCoverView,
  settledResult,
  statusForBet,
  statusForPick,
  type PickCoverView,
} from "./live-status";
import type { PickMarket } from "./grade";
import {
  fmtSpread,
  fmtTotal,
  headlinePick,
  lineForSide,
  pickSideLabel,
  type GameView,
  type MyBetView,
  type MyPickView,
} from "./slate";

/** "OSU -3.5" / "O 54.5" / "OSU ML" — the one formatter all three card states share. */
export function pickPrefix(
  g: GameView,
  p: MyPickView | null = headlinePick(g.myPicks),
): string {
  if (!p) return "";
  return pickSideLabel(p.market, p.side, p.line, g.home.abbr, g.away.abbr, { compact: true });
}

/** The same, for a ledger bet. Lines are stored home-perspective. */
export function betPrefix(g: GameView, b: MyBetView): string {
  const team = b.side === "home" ? g.home : g.away;
  if (b.betType === "spread") return `${team.abbr} ${fmtSpread(lineForSide(b.side ?? "home", b.line))}`;
  if (b.betType === "total") return `${b.side === "over" ? "O" : "U"} ${fmtTotal(b.line)}`;
  return `${team.abbr} ML`;
}

/** A bet type as the pick market whose cover formula settles it, or null. */
const marketForBet = (betType: MyBetView["betType"]): PickMarket | null =>
  betType === "spread"
    ? "spread"
    : betType === "total"
      ? "total"
      : betType === "moneyline"
        ? "straight_up"
        : null;

export interface CardStake {
  /** The verdict word and its tier — the strip's colour and its sentence. */
  cover: PickCoverView;
  /** What the verdict is about: "UTAH +3.5", "O 54.5", "Pick OSU -4". */
  label: string;
}

/**
 * The strip's verdict for a game in progress.
 *
 * Bets first, picks second — the order `tintFor` ranks them in, so the word on
 * the strip and the colour of the glow are never about two different wagers.
 * `team_total`, `first_half` and `future` have no full-game formula, so they
 * fall through to the pick rather than inventing one.
 */
export function liveStake(g: GameView): CardStake | null {
  const h = g.homePoints ?? 0;
  const a = g.awayPoints ?? 0;
  for (const bet of g.myBets) {
    if (bet.side === null) continue;
    const market = marketForBet(bet.betType);
    if (market === null) continue;
    const cover = pickCoverView(market, bet.side, bet.line, h, a);
    if (cover) return { cover, label: betPrefix(g, bet) };
  }
  const pick = headlinePick(g.myPicks);
  if (!pick) return null;
  const cover = pickCoverView(pick.market, pick.side, pick.line, h, a);
  return cover ? { cover, label: `Pick ${pickPrefix(g, pick)}` } : null;
}

/**
 * The same, once it is over (NFL-21): the grader's word if it has one, the
 * final score if it does not, and nothing at all for a wager neither can
 * settle — in which case the card keeps its team-colour edge.
 */
export function settledStake(g: GameView): CardStake | null {
  const h = g.homePoints ?? 0;
  const a = g.awayPoints ?? 0;
  for (const bet of g.myBets) {
    const verdict = settledResult(bet.result, statusForBet(bet, h, a));
    if (verdict) return { cover: settledCoverView(verdict), label: betPrefix(g, bet) };
  }
  const pick = headlinePick(g.myPicks);
  if (pick && g.homePoints !== null && g.awayPoints !== null) {
    const verdict = settledResult(null, statusForPick(pick.market, pick.side, pick.line, h, a));
    if (verdict) return { cover: settledCoverView(verdict), label: `Pick ${pickPrefix(g, pick)}` };
  }
  return null;
}

/**
 * The strip for whatever state the game is in. Null before kickoff — there is
 * no verdict on a game that has not started, and the card says what you hold in
 * its footer chips instead.
 */
export function cardStake(g: GameView): CardStake | null {
  if (g.status === "in_progress") return liveStake(g);
  if (g.status === "final") return settledStake(g);
  return null;
}
