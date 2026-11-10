/** Payload for the slim gameday score-ticker strip (spec §7). */

import { statusForBet, tintFor } from "./live-status";
import {
  betSideLabel,
  headlinePick,
  pickSideLabel,
  type GameView,
  type MyBetView,
  type MyPickView,
} from "./slate";

/**
 * The viewer's stake in a ticker game. A verdict colour once the score can
 * produce one — the same vocabulary as the card aura — and "on" while it
 * can't (pregame, or a bet type a score alone can't grade). Null, or absent,
 * means they have nothing riding and the chip stays plain.
 */
export type TickerMine = "covering" | "losing" | "push" | "on";

/**
 * The ticket behind `mine`, as the TV overlay prints it (TV-3): the line the
 * viewer holds ("ALA -3.5", "O 54.5", "OSU ML") and which side it is on, so
 * the strip can colour the team they're on rather than tint the whole chip.
 */
export interface TickerStake {
  label: string;
  side: "home" | "away" | "over" | "under" | null;
}

export interface TickerGame {
  id: number;
  status: string;
  startTs: string | null;
  period: number | null;
  clock: string | null;
  homeAbbr: string;
  awayAbbr: string;
  homePoints: number | null;
  awayPoints: number | null;
  /** Only present for a signed-in viewer with something on the game. */
  mine?: TickerMine | null;
  /** The ticket `mine` grades, same precedence (a ledger bet over a pick). */
  stake?: TickerStake | null;
  /** Consensus spread, home-perspective (negative = home favoured). */
  spread?: number | null;
  /** Present (as "nfl") on NFL chips — MIA is Miami on Saturday and the
   *  Dolphins on Sunday, and the chip has to say which. Absent = CFB. */
  sport?: "nfl";
}

export interface TickerData {
  seasonId: number;
  week: number;
  games: TickerGame[];
}

/**
 * One implementation of "are you on this game, and how is it going" for both
 * the API route and the demo, so the ticker can never disagree with the aura:
 * it IS the aura's verdict, read off `tintFor`. Lines are home-perspective,
 * the same convention every grader and status helper reads.
 */
export function tickerMine(
  status: string,
  homePoints: number | null,
  awayPoints: number | null,
  myBets: MyBetView[],
  myPicks: MyPickView[],
): TickerMine | null {
  if (myBets.length === 0 && myPicks.length === 0) return null;
  // tintFor only reads these five fields; the cast keeps that contract in one
  // place instead of forcing callers to fabricate a whole GameView.
  const tint = tintFor({
    status,
    homePoints,
    awayPoints,
    myBets,
    myPicks,
  } as GameView);
  return tint === "teams" ? "on" : tint;
}

/**
 * The ticket `tickerMine` is grading, labelled. Same precedence as `tintFor`:
 * the first ledger bet a score can grade, else the first bet, else the
 * headline pick. Labels come from the shared formatters, which own the
 * away-spread sign flip.
 */
export function tickerStake(
  myBets: MyBetView[],
  myPicks: MyPickView[],
  homeAbbr: string,
  awayAbbr: string,
): TickerStake | null {
  const sideOf = (s: string | null): TickerStake["side"] =>
    s === "home" || s === "away" || s === "over" || s === "under" ? s : null;
  const bet = myBets.find((b) => statusForBet(b, 0, 0) !== null) ?? myBets[0];
  if (bet) {
    return {
      label: betSideLabel(bet.betType, bet.side, bet.line, homeAbbr, awayAbbr),
      side: sideOf(bet.side),
    };
  }
  const pick = headlinePick(myPicks);
  if (pick) {
    return {
      label: pickSideLabel(pick.market, pick.side, pick.line, homeAbbr, awayAbbr, {
        compact: true,
      }),
      side: sideOf(pick.side),
    };
  }
  return null;
}
