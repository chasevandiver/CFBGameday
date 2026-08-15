"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../../lib/supabase/server";
import { setActiveGroup, type ActionResult } from "./groups";

/**
 * Thin wrappers over migration 0053's security-definer RPCs.
 *
 * Every rule the pool has — the team is in the game, the team is in the
 * conference, no team twice, nothing after kickoff — is enforced in the
 * database, for the reason 0020 states: a server action is not a security
 * boundary. These exist to carry the RPC's message back to the form.
 */

export async function createSurvivorGroup(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to create a pool" };

  const sport = formData.get("sport") === "nfl" ? "nfl" : "cfb";
  const conference = String(formData.get("conference") ?? "").trim();
  const strikes = Number(formData.get("strikes") ?? 1);

  const { data, error } = await supabase.rpc("create_survivor_group", {
    p_name: String(formData.get("name") ?? ""),
    p_visibility: formData.get("visibility") === "public" ? "public" : "private",
    p_sport: sport,
    // The NFL is one league-wide pool; the RPC refuses a conference there, so
    // the form's value is dropped rather than sent to be rejected.
    p_conference: sport === "nfl" || conference === "" ? null : conference,
    p_strikes: Number.isInteger(strikes) && strikes >= 1 && strikes <= 3 ? strikes : 1,
    p_reuse_teams: formData.get("reuse") === "on",
  });
  if (error) return { ok: false, message: error.message };

  const { data: group } = await supabase
    .from("groups")
    .select("slug")
    .eq("id", data as string)
    .maybeSingle();
  const slug = (group as { slug: string } | null)?.slug;
  if (slug) await setActiveGroup(slug);
  revalidatePath("/groups", "layout");
  return { ok: true, slug };
}

export async function makeSurvivorPick(
  groupId: string,
  gameId: number,
  teamId: number,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("make_survivor_pick", {
    p_group: groupId,
    p_game: gameId,
    p_team: teamId,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/groups", "layout");
  return { ok: true };
}

export async function removeSurvivorPick(
  groupId: string,
  week: number,
  seasonType: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_survivor_pick", {
    p_group: groupId,
    p_week: week,
    p_season_type: seasonType,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/groups", "layout");
  return { ok: true };
}
