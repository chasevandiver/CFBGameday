/**
 * How a ledger bet settles, and the write that settles it.
 *
 * SETTLE-1. Every path that graded a bet was driven by the GAME: the scoreboard
 * tick that saw it finish (GRADE-1), the sweep around that loop (GRADE-2), and
 * the scheduled `ratings-update` / `nfl-grade` backstop. Nothing was driven by
 * the BET, so a bet logged on a game that was already final had no trigger at
 * all — it waited for whichever sweep came next, which on a Sunday evening is
 * the top of the hour and on a Wednesday is the next night with football on.
 *
 * Owner report 2026-09-20: UCLA 52 Purdue 38. The ledger carried UCLA −14 and
 * settled it a push, which it is; the book had −13.5, which is a win. Deleting
 * the row and logging the real number is the right move and the only one
 * available — and the new row then sat open with the final score on the screen
 * beside it.
 *
 * So the decision and the write live here, in `src/lib/` rather than
 * `scripts/lib/`, for the reason `void.ts` states: jobs-core already imports
 * from src/lib, and a server action reaching into scripts/ would invert the
 * layering. `scripts/lib/jobs-core.ts` keeps its own batched reads — it settles
 * a whole season and has a read plan tuned for that — and calls `settleBet` and
 * `writeBetSettlement` for the per-row work. The action calls
 * `settleBetsOnFinalGame`, which reads one game's worth. One copy of the math,
 * two read plans, and the difference between them is only ever how many games
 * are in front of it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { closingConsensus, SNAPSHOT_COLS, type Consensus, type SnapshotLike } from "./consensus";
import { spreadClv, roundClv, totalClv } from "./clv";
import { coverMargin } from "./cover";
import { firstHalfScore, gradeTeamTotal, type HalfScore } from "./grade";
import { pageAll } from "./page-all";
import { payoutAt } from "./records";
import type { ScoringPlayRow } from "./scoring";

/** The game fields settlement reads. A final with both scores, or nothing. */
export interface SettleGame {
  id: number;
  home_points: number | null;
  away_points: number | null;
  status: string;
  start_ts: string | null;
}

/** The bet fields settlement reads — the grading query's select list. */
export interface SettleBet {
  id: number;
  game_id: number | null;
  bet_type: string;
  side: string | null;
  team_side: string | null;
  line_taken: number | string | null;
  odds: number | string | null;
  units: number | string;
}

export const SETTLE_BET_COLS =
  "id, game_id, bet_type, side, team_side, line_taken, odds, units";

export interface BetSettlement {
  result: "win" | "loss" | "push";
  clv: number | null;
  closingLine: number | null;
  payoutUnits: number;
}

/** True for a game a final score can settle a bet against. */
export function isGradableFinal(g: SettleGame): boolean {
  return g.status === "final" && g.home_points !== null && g.away_points !== null;
}

/**
 * What this bet settles to, or null for a row the grader cannot settle from a
 * final score — which stays ungraded for a manual result rather than banking a
 * guess. `future` has no branch here at all, by design.
 *
 * Pure: the caller supplies the closing consensus and, for a first-half bet,
 * the proven halftime score.
 */
export function settleBet(
  bet: SettleBet,
  game: SettleGame,
  close: Consensus,
  half: HalfScore | null,
): BetSettlement | null {
  // A moneyline bet has no line to take, so `line_taken` being null is
  // normal for it rather than a reason to skip. It used to be caught by
  // this guard and sat ungraded forever, quietly missing from the ledger's
  // record and units.
  if (!bet.side) return null;
  if (game.home_points === null || game.away_points === null) return null;
  const homePoints = game.home_points;
  const awayPoints = game.away_points;
  const margin = homePoints - awayPoints;
  const total = homePoints + awayPoints;
  const line = bet.line_taken === null ? null : Number(bet.line_taken);

  let result: BetSettlement["result"] | null = null;
  let clv: number | null = null;
  let closingLine: number | null = null;

  if (bet.bet_type === "spread" && line !== null && (bet.side === "home" || bet.side === "away")) {
    const cm = coverMargin(bet.side, line, homePoints, awayPoints);
    result = cm > 0 ? "win" : cm < 0 ? "loss" : "push";
    closingLine = close.spread;
    if (close.spread !== null) clv = roundClv(spreadClv(bet.side, line, close.spread));
  } else if (
    bet.bet_type === "total" &&
    line !== null &&
    (bet.side === "over" || bet.side === "under")
  ) {
    const diff = bet.side === "over" ? total - line : line - total;
    result = diff > 0 ? "win" : diff < 0 ? "loss" : "push";
    closingLine = close.total;
    if (close.total !== null) clv = roundClv(totalClv(bet.side, line, close.total));
  } else if (bet.bet_type === "moneyline" && (bet.side === "home" || bet.side === "away")) {
    // Who won, full stop. CLV on a moneyline is measured in cents against a
    // closing price we do not capture — spec §5.3 — so it stays null rather
    // than being invented from the spread.
    result = margin === 0 ? "push" : (margin > 0) === (bet.side === "home") ? "win" : "loss";
  } else if (
    bet.bet_type === "team_total" &&
    line !== null &&
    (bet.side === "over" || bet.side === "under") &&
    (bet.team_side === "home" || bet.team_side === "away")
  ) {
    // R2-A4. Legacy rows (team_side null — the subject team lives only in
    // the description) fall through ungraded for manual settle: skipping
    // beats guessing. No closing team-total is captured, so CLV stays null.
    const teamPts = bet.team_side === "home" ? homePoints : awayPoints;
    result = gradeTeamTotal(bet.side, line, teamPts);
  } else if (
    bet.bet_type === "first_half" &&
    line !== null &&
    (bet.side === "home" || bet.side === "away")
  ) {
    // R2-A4. Settles only when scoring_plays PROVE the halftime score
    // (see firstHalfScore); otherwise the row stays for manual settle.
    // No closing 1H line is captured, so CLV stays null.
    if (half) {
      const cm = coverMargin(bet.side, line, half.home, half.away);
      result = cm > 0 ? "win" : cm < 0 ? "loss" : "push";
    }
  }
  if (result === null) return null;

  // Correct for any American price, which is what makes a +2500 moneyline
  // pay what it should rather than -110. `payoutAt` is shared with the
  // live projection on the week-by-week lists (WEEK-3), so what a bet is
  // shown to be worth mid-game is what gets written here at settle; it
  // rounds to cents and answers 0 for a push, as this did inline.
  return {
    result,
    clv,
    closingLine,
    payoutUnits: payoutAt(bet.units, bet.odds, result) ?? 0,
  };
}

/** The settle write. Answers whether the row actually took it. */
export async function writeBetSettlement(
  db: SupabaseClient,
  betId: number,
  s: BetSettlement,
): Promise<boolean> {
  const { error } = await db
    .from("bets")
    .update({
      result: s.result,
      clv: s.clv,
      closing_line: s.closingLine,
      payout_units: s.payoutUnits,
    })
    .eq("id", betId);
  return !error;
}

/**
 * Settle every ungraded bet on ONE game, if that game is already final.
 *
 * The bet-driven entry point (SETTLE-1), for the moment a bet is logged rather
 * than the moment a game ends. Idempotent and safe to call on anything: a game
 * that is not a gradable final settles nothing, and the `result is null` filter
 * means a second call over the same game is a read and no writes — the same
 * property that lets the scheduled pass stay the backstop under it.
 *
 * Errors are the caller's to swallow. Logging a bet must not fail because the
 * settle after it did; the sweeps still run.
 */
export async function settleBetsOnFinalGame(
  db: SupabaseClient,
  gameId: number,
): Promise<number> {
  const { data: game, error: gameErr } = await db
    .from("games")
    .select("id, home_points, away_points, status, start_ts")
    .eq("id", gameId)
    .maybeSingle();
  if (gameErr) throw new Error(`settle: game read failed: ${gameErr.message}`);
  if (!game || !isGradableFinal(game as SettleGame)) return 0;
  const g = game as SettleGame;

  const { data: betRows, error: betsErr } = await db
    .from("bets")
    .select(SETTLE_BET_COLS)
    .eq("game_id", gameId)
    .is("result", null)
    .is("voided_at", null);
  if (betsErr) throw new Error(`settle: bets read failed: ${betsErr.message}`);
  const bets = (betRows ?? []) as SettleBet[];
  if (bets.length === 0) return 0;

  // Same order as the season pass: the ungraded rows decide whether the
  // priced reads happen at all, so a re-log on a game with nothing open
  // costs two queries and stops.
  const snaps = await pageAll<SnapshotLike>((from, to) =>
    db.from("line_snapshots").select(SNAPSHOT_COLS).eq("game_id", gameId).order("id").range(from, to),
  ).catch((e: Error) => {
    throw new Error(`settle: snapshots read failed: ${e.message}`);
  });
  const close = closingConsensus(snaps, g.start_ts);

  // Only for a first-half bet, and ordered by the table's own key
  // (game_id, sequence) — `scoring_plays` has no `id` column (GRADE-3).
  let half: HalfScore | null = null;
  if (bets.some((b) => b.bet_type === "first_half")) {
    const plays = await pageAll<ScoringPlayRow>((from, to) =>
      db
        .from("scoring_plays")
        .select(
          "game_id, sequence, period, clock, scoring_team_id, play_type, play_text, home_points, away_points, source",
        )
        .eq("game_id", gameId)
        .order("game_id")
        .order("sequence")
        .range(from, to),
    ).catch((e: Error) => {
      throw new Error(`settle: scoring plays read failed: ${e.message}`);
    });
    half = firstHalfScore(plays, g.home_points as number, g.away_points as number);
  }

  let settled = 0;
  for (const b of bets) {
    const s = settleBet(b, g, close, half);
    if (s === null) continue;
    if (await writeBetSettlement(db, b.id, s)) settled++;
  }
  return settled;
}
