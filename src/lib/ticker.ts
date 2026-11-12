/** Payload for the slim gameday score-ticker strip (spec §7). */

import { statusForBet, tintFor } from "./live-status";
import { formatRecord, payoutAt, tally, type Wager, type WagerResult } from "./records";
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
  /** Full school names (TV-18), for the touchdown banner. */
  homeName?: string | null;
  awayName?: string | null;
  homePoints: number | null;
  awayPoints: number | null;
  /** Only present for a signed-in viewer with something on the game. */
  mine?: TickerMine | null;
  /** The ticket `mine` grades, same precedence (a ledger bet over a pick). */
  stake?: TickerStake | null;
  /** Consensus spread, home-perspective (negative = home favoured). */
  spread?: number | null;
  /** TV-10: school colour (#hex) and logo URL for the broadcast tiles. */
  homeColor?: string | null;
  awayColor?: string | null;
  homeLogo?: string | null;
  awayLogo?: string | null;
  /** Network as the feed gives it ("ESPN2", "The CW Network"). */
  tv?: string | null;
  /** Consensus total (TV-9). */
  total?: number | null;
  /** Live only (TV-8): who has the ball, and CFBD/ESPN's "2nd & 10 at OSU 34". */
  possession?: "home" | "away" | null;
  situation?: string | null;
  /** Present (as "nfl") on NFL chips — MIA is Miami on Saturday and the
   *  Dolphins on Sunday, and the chip has to say which. Absent = CFB. */
  sport?: "nfl";
}

/**
 * The viewer's ledger over the games in this payload (TV-9): finals graded by
 * the Sunday grader when it has run, else from the final score at the bet's
 * own line; units at the bet's real odds. Ledger bets only: picks are
 * pick'em, not money. Null with no viewer or no bets in the window.
 */
export interface TickerSummary {
  record: string;
  units: number;
  live: number;
  upcoming: number;
}

export interface TickerData {
  seasonId: number;
  week: number;
  games: TickerGame[];
  summary?: TickerSummary | null;
  /** The deploy that served this (TV-16); null off Vercel. */
  build?: string | null;
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

/**
 * TV-9: the viewer's ledger across the games in this payload. A final takes
 * the Sunday grader's result and payout when it has run, else is graded here
 * from the final score at the bet's own line and priced at its own odds, so a
 * Tuesday-night win counts Tuesday night. Bets a score can't grade (team
 * totals, halves) count once the grader settles them, not before.
 */
export function tickerSummary(
  bets: Array<{
    game_id: number;
    bet_type: string;
    side: string | null;
    line_taken: number | null;
    odds: number;
    units: number;
    result: WagerResult | "void" | null;
    payout_units: number | null;
  }>,
  games: Array<{
    id: number;
    status: string;
    home_points: number | null;
    away_points: number | null;
  }>,
): TickerSummary | null {
  if (bets.length === 0) return null;
  const byId = new Map(games.map((g) => [g.id, g]));
  const wagers: Wager[] = [];
  let live = 0;
  let upcoming = 0;
  for (const b of bets) {
    const g = byId.get(b.game_id);
    if (!g || b.result === "void") continue;
    if (g.status === "in_progress") live += 1;
    else if (g.status === "scheduled") upcoming += 1;
    if (g.status !== "final") continue;

    let result: WagerResult | null = b.result;
    if (result === null) {
      const v = statusForBet(
        {
          betType: b.bet_type,
          side: b.side,
          line: b.line_taken === null ? null : Number(b.line_taken),
        },
        g.home_points ?? 0,
        g.away_points ?? 0,
      );
      result =
        v === null ? null : v.state === "winning" ? "win" : v.state === "losing" ? "loss" : "push";
    }
    if (result === null) continue;
    wagers.push({
      result,
      units: b.units,
      payoutUnits: b.payout_units ?? payoutAt(b.units, b.odds, result),
    });
  }
  const t = tally(wagers);
  return { record: formatRecord(t), units: Math.round(t.units * 100) / 100, live, upcoming };
}

/**
 * TV-16: should a long-running overlay page reload itself? Only when it has
 * seen one deploy and the feed now names a different one. A missing id (local
 * dev, an early-return payload) never triggers it.
 */
export function newDeploy(seen: string | null, next: string | null | undefined): boolean {
  return Boolean(seen && next && seen !== next);
}
