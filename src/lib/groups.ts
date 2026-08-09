/**
 * Reading a group's context: which groups you're in, which one you're looking
 * at, and what its admin turned on for a given week.
 *
 * Every write lives in a security-definer RPC (migration 0020) — nothing here
 * mutates. These are the read helpers the pages share so "the active group" is
 * resolved one way rather than five.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GroupMemberRow, GroupRow, GroupWeekConfigRow, PickMarket } from "./db-types";
import type { SeasonType } from "./season";

/**
 * Which group the viewer is looking at, remembered between visits. A cookie
 * rather than client state because server components render the board, and a
 * `?g=` in the URL always wins so a shared link opens the group it names.
 */
export const ACTIVE_GROUP_COOKIE = "cfb_group";

export interface GroupSummary {
  id: string;
  name: string;
  slug: string;
  visibility: "private" | "public";
  /** Others' picks stay unreadable until each game kicks off (migration 0023). */
  picksHiddenUntilKickoff: boolean;
  /** The viewer's role, or null when they are only looking at a public group. */
  role: "admin" | "member" | null;
}

const toSummary = (g: GroupRow, role: GroupSummary["role"]): GroupSummary => ({
  id: g.id,
  name: g.name,
  slug: g.slug,
  visibility: g.visibility,
  picksHiddenUntilKickoff: g.picks_hidden_until_kickoff ?? false,
  role,
});

/** The viewer's groups, newest membership last. Empty for signed-out visitors. */
export async function fetchMyGroups(
  supabase: SupabaseClient,
  userId: string | null,
): Promise<GroupSummary[]> {
  if (!userId) return [];
  const { data } = await supabase
    .from("group_members")
    .select(
      "role, joined_at, groups!inner(id, name, slug, visibility, picks_hidden_until_kickoff, archived_at)",
    )
    .eq("user_id", userId)
    .is("removed_at", null)
    .order("joined_at", { ascending: true });

  type Row = Pick<GroupMemberRow, "role"> & { groups: GroupRow };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.groups && r.groups.archived_at === null)
    .map((r) => toSummary(r.groups, r.role));
}

/**
 * The group whose board to render: the one named by `slug` if the viewer can
 * see it, else their remembered group, else their first. Null when they belong
 * to none — which is the state a brand-new account is in, and the pages say so
 * rather than pretending an empty board is a board.
 */
export async function resolveActiveGroup(
  supabase: SupabaseClient,
  userId: string | null,
  slug?: string | null,
): Promise<{ active: GroupSummary | null; mine: GroupSummary[] }> {
  const mine = await fetchMyGroups(supabase, userId);

  if (slug) {
    const owned = mine.find((g) => g.slug === slug);
    if (owned) return { active: owned, mine };
    // Not a member — RLS returns the row only if the group is public, so this
    // doubles as the visibility check.
    const { data } = await supabase
      .from("groups")
      .select("id, name, slug, visibility, picks_hidden_until_kickoff, archived_at")
      .eq("slug", slug)
      .is("archived_at", null)
      .maybeSingle();
    if (data) return { active: toSummary(data as GroupRow, null), mine };
  }

  return { active: mine[0] ?? null, mine };
}

/**
 * A group's configuration for one week: which markets are live and which games
 * are in play. `gameIds` comes from the database function so the three
 * selection modes — and the freeze — resolve in exactly one place.
 *
 * `null` means the admin has not set this week up yet, which is different from
 * an empty board and reads differently in the UI.
 */
export interface GroupWeek {
  markets: PickMarket[];
  gameIds: number[];
  selectionMode: GroupWeekConfigRow["selection_mode"];
  conference: string | null;
  /** True once the week's first game has kicked off; config is read-only then. */
  locked: boolean;
  /** League Rules #6, per group. 0 means no minimum. Displayed, not enforced. */
  minPicks: number;
}

/**
 * Whether any enabled market carries a price.
 *
 * Straight-up takes no number, so a winners-only week grades no units, no ROI
 * and no CLV. Those columns are then not empty, they are inapplicable — and a
 * column of dashes is a question the reader has to answer.
 */
export const hasPricedMarket = (markets: PickMarket[]): boolean =>
  markets.some((m) => m === "spread" || m === "total");

export interface GroupMemberView {
  userId: string;
  name: string;
  role: "admin" | "member";
}

/** Active roster, admins first then alphabetical. Removed members are excluded. */
export async function fetchGroupMembers(
  supabase: SupabaseClient,
  groupId: string,
): Promise<GroupMemberView[]> {
  const { data } = await supabase
    .from("group_members")
    .select("user_id, role, profiles!inner(id, display_name)")
    .eq("group_id", groupId)
    .is("removed_at", null);

  type Row = Pick<GroupMemberRow, "user_id" | "role"> & { profiles: { display_name: string } };
  return ((data ?? []) as unknown as Row[])
    .map((r) => ({ userId: r.user_id, name: r.profiles.display_name, role: r.role }))
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "admin" ? -1 : 1));
}

export async function fetchGroupWeek(
  supabase: SupabaseClient,
  groupId: string,
  seasonId: number,
  week: number,
  seasonType: SeasonType = "regular",
): Promise<GroupWeek | null> {
  const args = {
    p_group: groupId,
    p_season: seasonId,
    p_week: week,
    p_season_type: seasonType,
  };
  const [{ data: cfg }, { data: ids }, { data: locked }] = await Promise.all([
    supabase
      .from("group_week_config")
      .select("markets, selection_mode, conference, min_picks_per_week")
      .eq("group_id", groupId)
      .eq("season_id", seasonId)
      .eq("week", week)
      .eq("season_type", seasonType)
      .maybeSingle(),
    supabase.rpc("group_week_game_ids", args),
    supabase.rpc("group_week_is_locked", args),
  ]);
  if (!cfg) return null;

  const row = cfg as Pick<
    GroupWeekConfigRow,
    "markets" | "selection_mode" | "conference" | "min_picks_per_week"
  >;
  return {
    markets: row.markets ?? [],
    minPicks: row.min_picks_per_week ?? 0,
    // The RPC returns a setof integer, which PostgREST hands back as an array
    // of scalars.
    gameIds: ((ids ?? []) as number[]).map(Number),
    selectionMode: row.selection_mode,
    conference: row.conference,
    locked: locked === true,
  };
}
