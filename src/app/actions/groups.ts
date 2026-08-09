"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { PickMarket, SelectionMode } from "../../lib/db-types";
import { ACTIVE_GROUP_COOKIE } from "../../lib/groups";
import type { SeasonType } from "../../lib/season";
import { createClient } from "../../lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  message?: string;
  /** Slug of the group the caller should be sent to, when one applies. */
  slug?: string;
}

/**
 * Thin wrappers over the security-definer RPCs in migration 0020. Every rule —
 * who may configure a week, whether a group still has an admin, whether the
 * week has frozen — is enforced in the database, because a server action is
 * not a security boundary. These exist to carry the RPC's message back to the
 * form and to invalidate the right paths.
 */

const A_YEAR = 60 * 60 * 24 * 365;

async function rpc(fn: string, args: Record<string, unknown>): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in first" };

  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/groups", "layout");
  return { ok: true };
}

/** Remember which group the viewer is looking at, so server components can read it. */
export async function setActiveGroup(slug: string): Promise<void> {
  (await cookies()).set(ACTIVE_GROUP_COOKIE, slug, {
    path: "/",
    maxAge: A_YEAR,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}

export async function createGroup(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to create a group" };

  const name = String(formData.get("name") ?? "");
  const visibility = formData.get("visibility") === "public" ? "public" : "private";

  const { data, error } = await supabase.rpc("create_group", {
    p_name: name,
    p_visibility: visibility,
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

export async function joinGroup(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to join a group" };

  const { data, error } = await supabase.rpc("join_group", {
    p_code: String(formData.get("code") ?? ""),
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

// Each of these has to be a declared async function, not an arrow const: in a
// "use server" module the compiler only recognises function declarations as
// actions, and an arrow export fails at build time with "export was not found"
// rather than at typecheck.

export async function leaveGroup(groupId: string): Promise<ActionResult> {
  return rpc("leave_group", { p_group: groupId });
}

export async function removeGroupMember(groupId: string, userId: string): Promise<ActionResult> {
  return rpc("remove_group_member", { p_group: groupId, p_user: userId });
}

export async function setGroupRole(
  groupId: string,
  userId: string,
  role: "admin" | "member",
): Promise<ActionResult> {
  return rpc("set_group_role", { p_group: groupId, p_user: userId, p_role: role });
}

export async function archiveGroup(groupId: string): Promise<ActionResult> {
  return rpc("archive_group", { p_group: groupId });
}

export async function regenerateJoinCode(groupId: string): Promise<ActionResult> {
  return rpc("regenerate_join_code", { p_group: groupId });
}

/**
 * The admin's format for one week: which games and which markets.
 *
 * `gameIds` is only read for handpicked — full_slate and conference resolve
 * live in the database until the week's first kickoff freezes them, which is
 * what lets a late schedule addition join the board on its own.
 */
export async function setGroupWeekConfig(input: {
  groupId: string;
  seasonId: number;
  week: number;
  seasonType: SeasonType;
  mode: SelectionMode;
  conference: string | null;
  markets: PickMarket[];
  gameIds: number[];
}): Promise<ActionResult> {
  const res = await rpc("set_group_week_config", {
    p_group: input.groupId,
    p_season: input.seasonId,
    p_week: input.week,
    p_season_type: input.seasonType,
    p_mode: input.mode,
    p_conference: input.conference,
    p_markets: input.markets,
    p_game_ids: input.mode === "handpicked" ? input.gameIds : null,
  });
  if (res.ok) revalidatePath("/slate");
  return res;
}
