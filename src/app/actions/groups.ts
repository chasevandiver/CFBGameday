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
  // Pick'em is the default because it is the one that needs setting up; a
  // betting group starts working the moment somebody logs a bet.
  const kind = formData.get("kind") === "betting" ? "betting" : "pickem";

  const { data, error } = await supabase.rpc("create_group", {
    p_name: name,
    p_visibility: visibility,
    p_kind: kind,
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
  // A null id is "no group with that code". 0039 stopped raising on that one
  // path deliberately: `raise` would roll back the attempt row its brute-force
  // throttle counts, so the miss is reported as a value and worded here.
  if (!data) return { ok: false, message: "No group with that code" };

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

/**
 * Someone an admin could add: an account, and where it already stands with
 * this group.
 *
 * `membership` is carried rather than filtered on, because an admin typing a
 * name they are sure about wants to be told "already in" instead of watching
 * the name return nothing.
 */
export interface GroupCandidate {
  id: string;
  name: string;
  membership: "member" | "removed" | "none";
}

/**
 * Names an admin could add, for the search box on the roster. Admin-gated in
 * the database (0064) — the action passes the refusal through rather than
 * predicting it.
 */
export async function searchGroupCandidates(
  groupId: string,
  query: string,
): Promise<ActionResult & { people: GroupCandidate[] }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in first", people: [] };

  const { data, error } = await supabase.rpc("search_group_candidates", {
    p_group: groupId,
    p_q: query,
  });
  if (error) return { ok: false, message: error.message, people: [] };

  type Row = { id: string; display_name: string; membership: GroupCandidate["membership"] };
  return {
    ok: true,
    people: ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      name: r.display_name,
      membership: r.membership,
    })),
  };
}

/**
 * Add an account to the group without the join code — the admin's half of
 * getting people in (0064). The code still exists for everyone the admin
 * cannot see yet; this covers the person who already has an account.
 */
export async function addGroupMember(groupId: string, userId: string): Promise<ActionResult> {
  return rpc("add_group_member", { p_group: groupId, p_user: userId });
}

/**
 * The same thing from a typed name rather than a picked row. The database
 * refuses a name two people share, so nobody is added by a coin flip.
 */
export async function addGroupMemberByName(groupId: string, name: string): Promise<ActionResult> {
  return rpc("add_group_member_by_name", { p_group: groupId, p_name: name });
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
  /** 0 = no minimum, which is the default. */
  minPicks: number;
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
    p_min_picks: input.minPicks,
  });
  if (res.ok) revalidatePath("/slate");
  return res;
}

/** Pick'em league scope (0042): which leagues this group's boards may use. */
export async function setGroupLeagues(
  groupId: string,
  leagues: Array<"cfb" | "nfl">,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in first" };

  const { error } = await supabase.rpc("set_group_leagues", {
    p_group: groupId,
    p_leagues: leagues,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/groups", "layout");
  return { ok: true };
}

/**
 * Rename a group, or open it up / close it off.
 *
 * The slug moves with the name, so the group's URL changes. That is the right
 * trade for a pool of friends who reach it from the Groups tab — the
 * alternative is a slug that contradicts the name forever.
 */
export async function updateGroup(
  groupId: string,
  name: string,
  visibility: "private" | "public",
  hidePicks: boolean,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in first" };

  const { data, error } = await supabase.rpc("update_group", {
    p_group: groupId,
    p_name: name,
    p_visibility: visibility,
    p_hide_picks: hidePicks,
  });
  if (error) return { ok: false, message: error.message };

  const slug = data as string;
  await setActiveGroup(slug);
  revalidatePath("/groups", "layout");
  return { ok: true, slug };
}
