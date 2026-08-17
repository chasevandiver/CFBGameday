"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../../lib/supabase/server";

/**
 * One-tap reactions (R2-D4). A thin courier — RLS is the boundary (0061's
 * invoker-visibility policies), the same posture as survivor.ts. Toggle
 * semantics: a second tap of the same emoji takes it back.
 */

const EMOJI = new Set(["fire", "skull", "ice", "dart"]);
const SUBJECTS = new Set(["pick", "bet"]);

export interface ReactionResult {
  ok: boolean;
  message?: string;
}

export async function toggleReaction(
  subject: "pick" | "bet",
  subjectId: number,
  emoji: string,
): Promise<ReactionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in first" };
  if (!SUBJECTS.has(subject) || !Number.isInteger(subjectId) || !EMOJI.has(emoji)) {
    return { ok: false, message: "Bad reaction" };
  }

  const { error } = await supabase.from("reactions").insert({
    user_id: user.id,
    subject,
    subject_id: subjectId,
    emoji,
  });
  if (error) {
    // Unique violation = already reacted → the tap means take it back.
    if (error.code === "23505") {
      const { error: delErr } = await supabase
        .from("reactions")
        .delete()
        .eq("user_id", user.id)
        .eq("subject", subject)
        .eq("subject_id", subjectId)
        .eq("emoji", emoji);
      if (delErr) return { ok: false, message: delErr.message };
    } else {
      return { ok: false, message: error.message };
    }
  }
  revalidatePath("/game/[id]", "page");
  return { ok: true };
}
