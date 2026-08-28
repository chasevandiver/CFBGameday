"use server";

import { revalidatePath } from "next/cache";
import type { PickMarket } from "../../lib/grade";
import { createClient } from "../../lib/supabase/server";

export interface PickResult {
  ok: boolean;
  message?: string;
}

/**
 * League Rules #1–#2: a pick locks with the line at the moment it's made, and
 * editing re-snapshots the line. The line is computed server-side inside the
 * make_pick() database function (migrations 0013, 0021) — direct table writes
 * are revoked, so nobody can hand-pick a number the market never offered.
 *
 * Picks are per group: the same user may hold opposite sides of one game in two
 * pools, and the group's admin decides which games and markets are in play at
 * all. All of that is checked inside make_pick rather than here, because a
 * server action is not a security boundary — the RPC is.
 */
export async function makePick(
  groupId: string,
  gameId: number,
  market: PickMarket,
  side: "home" | "away" | "over" | "under",
  /** A seat to pick for (0081). Admin-gated in the RPC, not here. */
  forUser?: string | null,
): Promise<PickResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to save your picks" };

  const { error } = await supabase.rpc("make_pick", {
    p_group_id: groupId,
    p_game_id: gameId,
    p_market: market,
    p_side: side,
    p_for: forUser ?? null,
  });

  if (error) {
    // make_pick raises human-readable messages; pass them through
    return { ok: false, message: error.message };
  }

  revalidatePath("/slate");
  revalidatePath(`/game/${gameId}`);
  return { ok: true };
}

/**
 * Removal is an RPC too as of 0021. It used to be a direct DELETE that reported
 * the kickoff lock by affecting zero rows, leaving the caller to infer why
 * (audit bug #9); with `market` in the key that predicate only got harder to
 * express in a policy, so the lock now says so itself.
 *
 * As of 0038 it also refuses a non-member and returns the number of rows it
 * deleted. Zero is still reported here as success, now deliberately: removal is
 * idempotent, and the second tap of a double-tap asks for a state the pick is
 * already in. Every reason it could legitimately fail raises instead (P2-5).
 */
export async function removePick(
  groupId: string,
  gameId: number,
  market: PickMarket,
  /** A seat to clear for (0081). Admin-gated in the RPC, not here. */
  forUser?: string | null,
): Promise<PickResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to save your picks" };

  const { error } = await supabase.rpc("remove_pick", {
    p_group_id: groupId,
    p_game_id: gameId,
    p_market: market,
    p_for: forUser ?? null,
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/slate");
  revalidatePath(`/game/${gameId}`);
  return { ok: true };
}
