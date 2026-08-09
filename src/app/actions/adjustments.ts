"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../../lib/supabase/server";

export interface AdjustmentResult {
  ok: boolean;
  message?: string;
}

/**
 * Manual rating adjustment (docs/SPEC.md §2.2): an admin docking or crediting
 * a team ahead of the Thursday freeze (QB out, suspension, coaching chaos).
 * Manual entries are confirmed on creation — the confirm step exists for
 * LLM-proposed adjustments, which land unconfirmed. RLS restricts every write
 * here to admins.
 */
export async function addAdjustment(
  teamId: number,
  points: number,
  reason: string,
): Promise<AdjustmentResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };

  if (!Number.isFinite(points) || points === 0 || Math.abs(points) > 14) {
    return { ok: false, message: "Points must be non-zero and within ±14" };
  }
  if (!reason.trim()) return { ok: false, message: "A reason is required — receipts culture" };

  const { data: season } = await supabase
    .from("seasons")
    .select("id")
    .eq("is_current", true)
    .maybeSingle();
  if (!season) return { ok: false, message: "No current season configured" };

  const { error } = await supabase.from("rating_adjustments").insert({
    season_id: season.id,
    team_id: teamId,
    game_id: null,
    points,
    reason: reason.trim(),
    source: "manual",
    confirmed_by: user.id,
    confirmed_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

export async function confirmAdjustment(id: number): Promise<AdjustmentResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };

  const { error } = await supabase
    .from("rating_adjustments")
    .update({ confirmed_by: user.id, confirmed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

export async function removeAdjustment(id: number): Promise<AdjustmentResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("rating_adjustments").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin");
  return { ok: true };
}
