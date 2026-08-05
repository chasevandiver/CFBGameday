"use server";

import { revalidatePath } from "next/cache";
import { REASON_TAGS } from "../../lib/db-types";
import { createClient } from "../../lib/supabase/server";

export interface BetActionResult {
  ok: boolean;
  message?: string;
}

export async function logBet(formData: FormData): Promise<BetActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };

  const description = String(formData.get("description") ?? "").trim();
  const betType = String(formData.get("bet_type") ?? "spread");
  const reasonTag = String(formData.get("reason_tag") ?? "");
  const units = Number(formData.get("units"));
  const odds = Number(formData.get("odds") || -110);
  const lineRaw = String(formData.get("line_taken") ?? "").trim();
  const book = String(formData.get("book") ?? "").trim();
  const seasonId = Number(formData.get("season_id"));

  if (!description) return { ok: false, message: "Describe the bet (e.g. “Michigan -3.5”)" };
  if (!REASON_TAGS.includes(reasonTag as (typeof REASON_TAGS)[number])) {
    return { ok: false, message: "Pick a reason tag — that's the whole point of the audit" };
  }
  if (!Number.isFinite(units) || units <= 0) return { ok: false, message: "Units must be > 0" };

  const { error } = await supabase.from("bets").insert({
    season_id: seasonId,
    user_id: user.id,
    bet_type: betType,
    description,
    line_taken: lineRaw === "" ? null : Number(lineRaw),
    odds,
    units,
    book: book || null,
    reason_tag: reasonTag,
  });

  if (error) return { ok: false, message: error.message };
  revalidatePath("/ledger");
  return { ok: true };
}

/** Append-only ledger: voiding is the only "delete" (docs/SPEC.md §5.3). */
export async function voidBet(betId: number): Promise<BetActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };

  const { error } = await supabase
    .from("bets")
    .update({ voided_at: new Date().toISOString(), result: "void" })
    .eq("id", betId)
    .eq("user_id", user.id);

  if (error) return { ok: false, message: error.message };
  revalidatePath("/ledger");
  return { ok: true };
}
