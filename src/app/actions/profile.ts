"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../../lib/supabase/server";

export interface ProfileResult {
  ok: boolean;
  message?: string;
}

export async function updateDisplayName(formData: FormData): Promise<ProfileResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };

  const name = String(formData.get("display_name") ?? "").trim();
  if (name.length < 2 || name.length > 24) {
    return { ok: false, message: "Name must be 2–24 characters" };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: name })
    .eq("id", user.id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/me");
  revalidatePath("/groups", "layout");
  return { ok: true };
}

/** Toggle a favorite team (server-side, roams across devices). */
export async function toggleFavoriteTeam(teamId: number): Promise<ProfileResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };
  if (!Number.isInteger(teamId)) return { ok: false, message: "Bad team" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("favorite_team_ids")
    .eq("id", user.id)
    .maybeSingle();
  const current: number[] = profile?.favorite_team_ids ?? [];
  const next = current.includes(teamId)
    ? current.filter((id) => id !== teamId)
    : [...current, teamId].slice(0, 12);

  const { error } = await supabase
    .from("profiles")
    .update({ favorite_team_ids: next })
    .eq("id", user.id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/me");
  revalidatePath("/slate");
  return { ok: true };
}
