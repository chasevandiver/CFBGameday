/**
 * The two decisions every bet write shares, stated once.
 *
 * They lived in `app/actions/bets.ts` until the Jarvis door (JARVIS-1) became
 * a second caller: a `"use server"` file can only export actions, so a route
 * handler could not reach them, and a second copy of the away-spread sign
 * flip is a second chance to reintroduce a bug this codebase has already had
 * (see `lineForSide` in `slate.ts`). Moved, not changed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { canLogBetFor } from "./log-for";
import { homeLineForSide } from "./slate";

/**
 * Bet forms and the slip speak in the bettor's number ("UNC +6.5"); the
 * `bets` table stores spread-style lines home-perspective (−6.5), which is
 * what the grader (`jobs-core`), `liveSpreadStatus` and `spreadClv` all read.
 * Totals are side-agnostic and pass through.
 */
const SPREAD_STYLE = new Set(["spread", "first_half"]);
export function storedLine(
  betType: string,
  side: string | null,
  line: number | null,
): number | null {
  if (line === null || side === null || !SPREAD_STYLE.has(betType)) return line;
  return homeLineForSide(side, line);
}

/**
 * Whose row this is (0083).
 *
 * Every write is the caller's own by default. A betting-group admin may
 * instead name a member of that group, and the row lands as that member's bet
 * with the admin's id in `logged_by`. The policy on `bets` would refuse an
 * unauthorised proxy row on its own; asking first turns a bare RLS error into
 * a sentence, and keeps the "who" decision in one place for every caller.
 */
export type Bettor = { userId: string; loggedBy: string | null };

export async function resolveBettor(
  supabase: SupabaseClient,
  callerId: string,
  forUserId: string | null,
): Promise<Bettor | { refused: string }> {
  if (!forUserId || forUserId === callerId) return { userId: callerId, loggedBy: null };
  if (!(await canLogBetFor(supabase, forUserId))) {
    return { refused: "You can only log bets for a member of a betting group you run" };
  }
  return { userId: forUserId, loggedBy: callerId };
}
