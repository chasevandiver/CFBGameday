/** Payload for the slim gameday score-ticker strip (spec §7). */

import { tintFor } from "./live-status";
import type { GameView, MyBetView, MyPickView } from "./slate";

/**
 * The viewer's stake in a ticker game. A verdict colour once the score can
 * produce one — the same vocabulary as the card aura — and "on" while it
 * can't (pregame, or a bet type a score alone can't grade). Null, or absent,
 * means they have nothing riding and the chip stays plain.
 */
export type TickerMine = "covering" | "losing" | "push" | "on";

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
  const tint = tintFor({ status, homePoints, awayPoints, myBets, myPicks } as GameView);
  return tint === "teams" ? "on" : tint;
}
