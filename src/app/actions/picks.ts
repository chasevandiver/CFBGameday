"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../../lib/supabase/server";

export interface PickResult {
  ok: boolean;
  message?: string;
}

/**
 * League Rules #1–#2: a pick locks with the line at the moment it's made, and
 * editing re-snapshots the line. The line is computed server-side inside the
 * make_pick() database function (migration 0013) — direct table writes are
 * revoked, so nobody can hand-pick a number the market never offered.
 */
export async function makePick(
  gameId: number,
  side: "home" | "away" | "over" | "under",
): Promise<PickResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to save your picks" };

  const { error } = await supabase.rpc("make_pick", {
    p_game_id: gameId,
    p_side: side,
  });

  if (error) {
    // make_pick raises human-readable messages; pass them through
    return { ok: false, message: error.message };
  }

  revalidatePath("/slate");
  revalidatePath(`/game/${gameId}`);
  return { ok: true };
}

export async function removePick(gameId: number): Promise<PickResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to save your picks" };

  const { data, error } = await supabase
    .from("picks")
    .delete()
    .eq("user_id", user.id)
    .eq("game_id", gameId)
    .select("id");

  // RLS silently filters post-kickoff deletes to zero rows — report the lock
  // honestly instead of pretending it worked (audit bug #9).
  if (error || (data ?? []).length === 0) {
    return { ok: false, message: "Kickoff — picks are locked for this game." };
  }
  revalidatePath("/slate");
  revalidatePath(`/game/${gameId}`);
  return { ok: true };
}
