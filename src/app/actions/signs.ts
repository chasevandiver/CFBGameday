"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../../lib/supabase/server";

/**
 * Crowd signs (FUN-10). A thin courier like reactions.ts — RLS is the
 * boundary (0075: crew-visible reads, own-row writes). One sign per member
 * per week, upserted in place; an empty body takes the sign down.
 */

export interface SignResult {
  ok: boolean;
  message?: string;
}

export async function setCrowdSign(
  seasonId: number,
  week: number,
  body: string,
): Promise<SignResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in first" };
  if (!Number.isInteger(seasonId) || !Number.isInteger(week)) {
    return { ok: false, message: "Bad week" };
  }

  const text = body.trim();
  if (text.length === 0) {
    const { error } = await supabase
      .from("crowd_signs")
      .delete()
      .eq("user_id", user.id)
      .eq("season_id", seasonId)
      .eq("week", week);
    if (error) return { ok: false, message: error.message };
  } else {
    if (text.length > 80) return { ok: false, message: "80 characters — it's a posterboard" };
    const { error } = await supabase.from("crowd_signs").upsert(
      {
        user_id: user.id,
        season_id: seasonId,
        week,
        body: text,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "season_id,week,user_id" },
    );
    if (error) return { ok: false, message: error.message };
  }
  revalidatePath("/slate");
  return { ok: true };
}
