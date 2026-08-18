/**
 * Reading a group's context: which groups you're in, which one you're looking
 * at, and what its admin turned on for a given week.
 *
 * Every write lives in a security-definer RPC (migration 0020) — nothing here
 * mutates. These are the read helpers the pages share so "the active group" is
 * resolved one way rather than five.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  GroupKind,
  GroupMemberRow,
  GroupRow,
  GroupWeekConfigRow,
  PickMarket,
} from "./db-types";
import { DEFAULT_TZ, dayKey } from "./kick";
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
  /**
   * What kind of group this is (migration 0027).
   *
   * `pickem` has a board an admin configures and picks made against it.
   * `betting` has neither: it reads its members' own ledgers and shows who
   * got to each game first. The two share membership, join codes and slugs,
   * and nothing else — every screen branches on this.
   */
  kind: GroupKind;
  /** Others' picks stay unreadable until each game kicks off (migration 0023). */
  picksHiddenUntilKickoff: boolean;
  /** Pick'em league scope (0042). Betting groups always read both leagues. */
  leagues: Array<"cfb" | "nfl">;
  /** The viewer's role, or null when they are only looking at a public group. */
  role: "admin" | "member" | null;
}

const toSummary = (g: GroupRow, role: GroupSummary["role"]): GroupSummary => ({
  id: g.id,
  name: g.name,
  slug: g.slug,
  visibility: g.visibility,
  // Rows written before 0027 have no kind; they are all pick'em by history.
  kind: g.kind ?? "pickem",
  picksHiddenUntilKickoff: g.picks_hidden_until_kickoff ?? false,
  // Rows written before 0042 have no leagues; they are all CFB by history.
  leagues: g.leagues ?? ["cfb"],
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
      "role, joined_at, groups!inner(id, name, slug, visibility, kind, picks_hidden_until_kickoff, leagues, archived_at)",
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
      .select("id, name, slug, visibility, kind, picks_hidden_until_kickoff, leagues, archived_at")
      .eq("slug", slug)
      .is("archived_at", null)
      .maybeSingle();
    if (data) return { active: toSummary(data as GroupRow, null), mine };
  }

  return { active: mine[0] ?? null, mine };
}

/**
 * Which league board a group page is showing: the `?league=` param when it
 * names a league the group actually plays, else the group's first league.
 * CFB wins the tie for a both-league group — it is the product's spine.
 */
export function groupLeague(
  param: string | undefined | null,
  leagues: Array<"cfb" | "nfl">,
): "cfb" | "nfl" {
  if (param === "nfl" && leagues.includes("nfl")) return "nfl";
  return leagues.includes("cfb") ? "cfb" : "nfl";
}

/**
 * The group of one kind the viewer is looking at.
 *
 * The slate needs both at once — a pick'em group to scope its picks and a
 * betting group to scope its sheet — and `resolveActiveGroup` can only answer
 * for one. The remembered slug wins when it happens to be of the right kind;
 * otherwise the viewer's first group of that kind stands in, and null means
 * they are in none, which every caller renders as an absence rather than as an
 * empty board.
 */
export function activeOfKind(
  mine: GroupSummary[],
  kind: GroupKind,
  preferSlug?: string | null,
): GroupSummary | null {
  const preferred = preferSlug ? mine.find((g) => g.slug === preferSlug) : undefined;
  if (preferred && preferred.kind === kind) return preferred;
  return mine.find((g) => g.kind === kind) ?? null;
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
  /** When this membership began. Restored memberships keep their first date. */
  joinedAt: string;
}

/**
 * "joined today" / "joined yesterday" / "joined Aug 12".
 *
 * The roster exists to answer "is that person actually in?", and the answer is
 * most in doubt in the minute after somebody was added — so the recent days get
 * words rather than a date, which is what makes a just-added member visibly
 * just-added instead of one more name in a list.
 *
 * Compared by calendar day in the group's timezone rather than by elapsed
 * hours: someone added at 11pm was added *today*, not twenty-three hours ago.
 */
export function joinedLabel(iso: string, tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  const day = dayKey(iso, tz);
  if (day === dayKey(now.toISOString(), tz)) return "joined today";
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (day === dayKey(yesterday.toISOString(), tz)) return "joined yesterday";
  return `joined ${new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
  }).format(new Date(iso))}`;
}

/**
 * Active roster, admins first then alphabetical. Removed members are excluded.
 *
 * ## The embed names its foreign key, and has to
 *
 * `group_members` has TWO foreign keys to `profiles`: `user_id` from 0020 and
 * `removed_by` from 0038. From the moment the second one landed, PostgREST
 * could no longer tell which relationship `profiles!inner(…)` meant, and
 * answered every call with PGRST201 — "Could not embed because more than one
 * relationship was found" — instead of rows.
 *
 * This function swallowed the error and returned an empty array, so for five
 * days every roster in the product was empty and said so confidently: "0
 * bettors" on a group with two, empty standings, an empty week grid, and an
 * admin who added somebody by name with nowhere that showed it. Naming the
 * constraint is the whole fix; the `throw` below is what stops the next one
 * lasting five days.
 */
export async function fetchGroupMembers(
  supabase: SupabaseClient,
  groupId: string,
): Promise<GroupMemberView[]> {
  const { data, error } = await supabase
    .from("group_members")
    .select("user_id, role, joined_at, profiles!group_members_user_id_fkey(id, display_name)")
    .eq("group_id", groupId)
    .is("removed_at", null);

  // Loud on purpose. A group always has at least one member — the deferred
  // keep-admin trigger (0020) guarantees it — so "no rows" is never a truthful
  // answer here, and a page that renders a roster it could not read is telling
  // the reader something false about who is in their group. An error page is
  // worse to look at and better to have: somebody reports it the same day.
  if (error) throw new Error(`group roster: ${error.message}`);

  type Row = Pick<GroupMemberRow, "user_id" | "role" | "joined_at"> & {
    profiles: { display_name: string };
  };
  return ((data ?? []) as unknown as Row[])
    .map((r) => ({
      userId: r.user_id,
      name: r.profiles.display_name,
      role: r.role,
      joinedAt: r.joined_at,
    }))
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
