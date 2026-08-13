/**
 * League Rule #4 — a postponed or canceled game voids every wager on it.
 *
 * The grader has implemented this correctly since 0013. Nothing ever wrote the
 * statuses, so it had never once run: `sync-games` only asserts `final`, the
 * scoreboard patch maps to `in_progress`/`final`, and CFBD's `CfbdGame` carries
 * a bare `completed: boolean` with no cancellation signal at all. A human is
 * the only available source of truth, which is what the /admin control is for
 * (P1-1).
 *
 * This module is the shared half: the state machine the admin action asks
 * before writing, and the void write itself, which the Sunday `ratings-update`
 * pass and the action both call so the rule cannot drift into two versions.
 *
 * It lives in `src/lib/` rather than `scripts/lib/` because the dependency runs
 * that way — `scripts/lib/jobs-core.ts` already imports from `src/lib/`, and a
 * server action reaching into `scripts/` would invert the layering.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** The two statuses that mean "this game will not be played". */
export const DEAD_STATUSES = ["postponed", "canceled"] as const;

/**
 * Every status the schema comment at `0001_core_schema.sql:75` allows. The
 * column is plain `text` and was unconstrained until 0034; nothing writes an
 * unlisted value (`scoreboardPatch` is a closed mapping, `sync-games` only ever
 * asserts `final`), so the constraint documents rather than changes behaviour.
 */
export const GAME_STATUSES = ["scheduled", "in_progress", "final", ...DEAD_STATUSES] as const;

export type GameStatus = (typeof GAME_STATUSES)[number];
export type VoidAction = "postpone" | "cancel" | "restore";

/**
 * Fails closed on an unknown string: a status nobody recognises is not a
 * reason to void somebody's picks.
 */
export function isDeadStatus(status: string | null | undefined): boolean {
  return status === "postponed" || status === "canceled";
}

/**
 * What an admin action does to a game in a given state, or why it refuses.
 *
 * The refusals are the substance here. Voiding is destructive to other
 * people's picks and there is no undo that restores them, so each transition
 * that could be reached by a mis-tap is named and blocked rather than left to
 * the operator's care.
 */
export function nextGameStatus(
  current: string,
  action: VoidAction,
): { ok: true; status: GameStatus } | { ok: false; reason: string } {
  if (!(GAME_STATUSES as readonly string[]).includes(current))
    return { ok: false, reason: `Unrecognised status "${current}" — not touching this game.` };

  if (action === "restore") {
    if (!isDeadStatus(current))
      return { ok: false, reason: "That game is not postponed or canceled." };
    // Back to `scheduled`, never to `final`: if the game has since been played
    // the next sync asserts `final` on its own, from the feed rather than from
    // an admin's guess.
    return { ok: true, status: "scheduled" };
  }

  const target: GameStatus = action === "postpone" ? "postponed" : "canceled";
  if (current === target) return { ok: false, reason: `Already ${target}.` };

  // A graded Saturday is not re-openable. Grading has already written results,
  // CLV and units against this game; flipping it dead would void nothing
  // (every row has a result) while making the card read POSTPONED over a final
  // score.
  if (current === "final")
    return { ok: false, reason: "That game is final — voiding it would not undo its grading." };

  // The scoreboard loop polls every 30s and writes `in_progress` from the
  // feed, so a postponement set mid-game is overwritten within a tick while
  // the picks it voided stay voided. Abandonment mid-game is real but rare,
  // and `canceled` is the honest word for it.
  if (current === "in_progress" && action === "postpone")
    return {
      ok: false,
      reason: "That game is in progress — the scoreboard will overwrite this within a minute. Use Cancel if it has been abandoned.",
    };

  return { ok: true, status: target };
}

export interface AdminGame {
  id: number;
  status: string;
  start_ts: string | null;
}

/**
 * Split the admin's game list into what can be voided and what is already
 * dead, both in kickoff order. Finals are dropped entirely — `nextGameStatus`
 * would refuse them anyway, and offering a control that always errors is worse
 * than not offering it.
 */
export function partitionAdminGames<T extends AdminGame>(games: T[]): { open: T[]; dead: T[] } {
  // A null start_ts is a TBD kickoff, which sorts last rather than throwing.
  const byKickoff = (a: T, b: T) =>
    (a.start_ts === null ? Infinity : Date.parse(a.start_ts)) -
    (b.start_ts === null ? Infinity : Date.parse(b.start_ts));
  return {
    open: games.filter((g) => g.status === "scheduled" || g.status === "in_progress").sort(byKickoff),
    dead: games.filter((g) => isDeadStatus(g.status)).sort(byKickoff),
  };
}

/**
 * Void every ungraded pick and bet on these games.
 *
 * Idempotent by construction — both writes filter on the result still being
 * null — so the admin action and the Sunday pass can both run over the same
 * game without double-counting or overwriting a settled row. Throws rather
 * than returning an error: a swallowed failure here is a game the crew thinks
 * was voided and wasn't.
 */
export async function voidWagersForGames(
  db: SupabaseClient,
  gameIds: number[],
): Promise<{ picks: number; bets: number }> {
  if (gameIds.length === 0) return { picks: 0, bets: 0 };

  const { data: vp, error: vpErr } = await db
    .from("picks")
    .update({ result: "void" })
    .in("game_id", gameIds)
    .is("result", null)
    .select("id");
  if (vpErr) throw new Error(`voiding picks failed: ${vpErr.message}`);

  const { data: vb, error: vbErr } = await db
    .from("bets")
    .update({ result: "void", voided_at: new Date().toISOString() })
    .in("game_id", gameIds)
    .is("result", null)
    .is("voided_at", null)
    .select("id");
  if (vbErr) throw new Error(`voiding bets failed: ${vbErr.message}`);

  return { picks: vp?.length ?? 0, bets: vb?.length ?? 0 };
}
