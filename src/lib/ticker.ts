/** Payload for the slim gameday score-ticker strip (spec §7). */

import { statusForBet, statusForPick, tintFor } from "./live-status";
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

/**
 * One ticket of possibly several on a game (TV-22). `stake` is the single
 * ticket the tile colour grades; this is every one of them, each with its own
 * verdict, so a side and a total on the same game can disagree in plain sight.
 */
export interface TickerTicket extends TickerStake {
  /** This ticket's own verdict; "on" while a score can't give one. */
  state: TickerMine;
  /** Final ledger bets only: what it paid, in units. Null for picks, and for
   *  a bet nothing can price yet. */
  units?: number | null;
}

/** A ledger bet with what `tickerTickets` needs to settle and price it. */
export interface TicketBet extends MyBetView {
  odds?: number | null;
  units?: number | null;
  /** `result` is MyBetView's: the grader's word, "void" included. */
  payoutUnits?: number | null;
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
  /** Every ticket on the game (TV-22), the one `stake` names first. */
  tickets?: TickerTicket[];
  /** Poll rank (TV-21): CFP, else AP, else Coaches for football; AP for
   *  basketball. Null or absent for an unranked team, and always for the NFL. */
  homeRank?: number | null;
  awayRank?: number | null;
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
   *  Dolphins on Sunday, and the chip has to say which. Absent = CFB.
   *  "cbb" since TV-20: a college basketball game the viewer has a bet on.
   *  It reads its clock in halves, carries no down or possession, and is
   *  never announced when it scores. */
  sport?: "nfl" | "cbb";
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

const verdictOf = (state: "winning" | "losing" | "push"): TickerMine =>
  state === "winning" ? "covering" : state === "losing" ? "losing" : "push";

/**
 * TV-22: every ticket the viewer holds on one game, each graded on its own.
 *
 * Ledger bets when there are any, else pick'em picks: the same "money outranks
 * a pick" rule `tintFor` applies, and it keeps a bet that mirrors a pick from
 * printing twice. Ordered so the first is the ticket `tickerStake` names — a
 * bet a score can grade before one it can't, the headline pick before the
 * others — which is what lets a narrow surface print the first and count the
 * rest.
 *
 * A final takes the grader's result when it has run, so a first-half or
 * team-total bet settles here once Sunday has settled it. Units are the
 * grader's payout, else the bet's own odds at that result.
 */
export function tickerTickets(
  status: string,
  homePoints: number | null,
  awayPoints: number | null,
  myBets: TicketBet[],
  myPicks: MyPickView[],
  homeAbbr: string,
  awayAbbr: string,
): TickerTicket[] {
  const sideOf = (s: string | null): TickerStake["side"] =>
    s === "home" || s === "away" || s === "over" || s === "under" ? s : null;
  const final = status === "final";
  const scored =
    (status === "in_progress" || final) && homePoints !== null && awayPoints !== null;

  // Not filtered for a void result: `tickerStake` doesn't either, and the two
  // must agree on which ticket is first. A voided one is drawn ungraded.
  const bets = myBets;
  if (bets.length > 0) {
    const gradable = (b: TicketBet) => statusForBet(b, 0, 0) !== null;
    const ordered = [...bets.filter(gradable), ...bets.filter((b) => !gradable(b))];
    return ordered.map((b) => {
      const live =
        scored && b.result !== "void"
          ? statusForBet(b, homePoints ?? 0, awayPoints ?? 0)
          : null;
      const stored = b.result === "win" || b.result === "loss" || b.result === "push";
      const result: WagerResult =
        final && stored
          ? (b.result as WagerResult)
          : final && live
            ? live.state === "winning"
              ? "win"
              : live.state === "losing"
                ? "loss"
                : "push"
            : null;
      const state: TickerMine = result
        ? result === "win"
          ? "covering"
          : result === "loss"
            ? "losing"
            : "push"
        : live
          ? verdictOf(live.state)
          : "on";
      const units =
        result === null
          ? null
          : (b.payoutUnits ??
            (b.units === null || b.units === undefined
              ? null
              : payoutAt(b.units, b.odds, result)));
      return {
        label: betSideLabel(b.betType, b.side, b.line, homeAbbr, awayAbbr),
        side: sideOf(b.side),
        state,
        units: units === null ? null : Math.round(Number(units) * 100) / 100,
      };
    });
  }

  const head = headlinePick(myPicks);
  const picks = head ? [head, ...myPicks.filter((p) => p !== head)] : [];
  return picks.map((p) => {
    const live = scored
      ? statusForPick(p.market, p.side, p.line, homePoints ?? 0, awayPoints ?? 0)
      : null;
    return {
      label: pickSideLabel(p.market, p.side, p.line, homeAbbr, awayAbbr, { compact: true }),
      side: sideOf(p.side),
      state: live ? verdictOf(live.state) : "on",
      units: null,
    };
  });
}

/**
 * The tickets a surface should draw: the feed's list, or — for a payload from
 * before TV-22, and for the demo — the one `stake` it always carried.
 */
export function ticketsOf(g: TickerGame): TickerTicket[] {
  if (g.tickets && g.tickets.length > 0) return g.tickets;
  return g.stake ? [{ ...g.stake, state: g.mine ?? "on" }] : [];
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
