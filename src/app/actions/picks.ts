"use server";

import { revalidatePath } from "next/cache";
import { consensusFromSnapshots } from "../../lib/queries";
import { createClient } from "../../lib/supabase/server";
import type { LineSnapshotRow } from "../../lib/db-types";

export interface PickResult {
  ok: boolean;
  message?: string;
}

/**
 * League Rules #1–#2: a pick locks with the line at the moment it's made,
 * and editing re-snapshots the line. RLS blocks post-kickoff writes — we just
 * translate that failure into a friendly message.
 */
export async function makePick(
  gameId: number,
  side: "home" | "away" | "over" | "under",
): Promise<PickResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };

  const [{ data: game }, { data: snapshots }] = await Promise.all([
    supabase.from("games").select("id, season_id, start_ts").eq("id", gameId).maybeSingle(),
    supabase.from("line_snapshots").select("*").eq("game_id", gameId),
  ]);
  if (!game) return { ok: false, message: "Game not found" };

  const consensus = consensusFromSnapshots((snapshots ?? []) as LineSnapshotRow[]);
  const isTotalPick = side === "over" || side === "under";
  const line = isTotalPick ? consensus.total : consensus.spread;
  if (line === null) return { ok: false, message: "No line posted yet for this game" };

  const { error } = await supabase.from("picks").upsert(
    {
      season_id: game.season_id,
      user_id: user.id,
      game_id: gameId,
      side,
      line_at_pick: line,
      locked_at: new Date().toISOString(),
    },
    { onConflict: "user_id,game_id" },
  );

  if (error) {
    const locked = error.code === "42501" || /policy/i.test(error.message);
    return {
      ok: false,
      message: locked ? "Kickoff — picks are locked for this game." : error.message,
    };
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
  if (!user) return { ok: false, message: "Not signed in" };

  const { error } = await supabase
    .from("picks")
    .delete()
    .eq("user_id", user.id)
    .eq("game_id", gameId);

  if (error) {
    return { ok: false, message: "Kickoff — picks are locked for this game." };
  }
  revalidatePath("/slate");
  revalidatePath(`/game/${gameId}`);
  return { ok: true };
}
