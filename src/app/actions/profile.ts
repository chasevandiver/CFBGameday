"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../../lib/supabase/server";
import { isSupportedTz } from "../../lib/kick";

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

/**
 * The reader's timezone (UX-25).
 *
 * Stored server-side rather than sniffed from the browser, because the point is
 * that it roams: the ledger's "today" and every kickoff label are rendered on
 * the server, and a client-side guess cannot reach them without a round trip
 * the page does not otherwise need.
 *
 * Validated against `TIMEZONES` rather than trusted. 0013 granted UPDATE on
 * this column, so an unvalidated write would let anyone store a string that
 * throws inside `Intl.DateTimeFormat` on every page that prints a kickoff —
 * turning a preference into a self-inflicted outage.
 */
export async function updateTimezone(formData: FormData): Promise<ProfileResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };

  const tz = String(formData.get("timezone") ?? "");
  if (!isSupportedTz(tz)) return { ok: false, message: "Unknown timezone" };

  const { error } = await supabase.from("profiles").update({ timezone: tz }).eq("id", user.id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/me");
  revalidatePath("/ledger");
  return { ok: true };
}
