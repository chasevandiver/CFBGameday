"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../../lib/supabase/server";
import { requireAdmin } from "../../lib/admin";

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

/* The admin gate is `lib/admin.ts`'s `requireAdmin`. RLS already stops a
   non-admin's write — but as a zero-row no-op, which the action then reported
   as `ok: true` (audit 06/SEC-11). The app-level check turns that silent
   nothing into an answer. */

export async function confirmAdjustment(id: number): Promise<AdjustmentResult> {
  const supabase = await createClient();
  const denied = await requireAdmin(supabase);
  if (denied) return { ok: false, message: denied };
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("rating_adjustments")
    .update({ confirmed_by: user!.id, confirmed_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) return { ok: false, message: "Adjustment not found" };

  revalidatePath("/admin");
  return { ok: true };
}

export async function removeAdjustment(id: number): Promise<AdjustmentResult> {
  const supabase = await createClient();
  const denied = await requireAdmin(supabase);
  if (denied) return { ok: false, message: denied };
  const { data, error } = await supabase
    .from("rating_adjustments")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) return { ok: false, message: "Adjustment not found" };

  revalidatePath("/admin");
  return { ok: true };
}
