/**
 * Which pool you're competing in, on the game layer (R3-E1).
 *
 * ## The scoping rule
 *
 * You play ONCE. `line_guesses`, `streak_picks`, `gtg_guesses` and
 * `six_pack_entries` are keyed by `user_id` and carry no `group_id` — the
 * roster IS the scope, exactly as `src/lib/betting-groups.ts` says of `bets`
 * ("a betting group stores nothing of its own beyond its roster"). A group
 * board is `WHERE user_id IN (roster)`, so one guess is ranked inside every
 * pool you're in and nobody answers the same question twice because they
 * joined three groups.
 *
 * That also makes this a **product filter, not a security boundary**. RLS
 * already decides what a viewer may read (own rows always; others' once the
 * game reveals); this narrows a readable set to the people you care about.
 * Nothing here may be relied on to hide anything.
 *
 * ## Any kind of group counts
 *
 * The arcade needs a roster, not a board — a survivor pool or a betting
 * group is a perfectly good set of people to beat. So this does NOT use
 * `activeOfKind`, which exists for surfaces that need a *pick'em* board.
 *
 * ## Two cookies, one writer each
 *
 * `cfb_games` (here, written only by `setGamesScope`) and `cfb_group` (the
 * slate/groups cookie, written only by `setActiveGroup`). They are separate
 * because the pool you play the arcade with and the pool you bet with are
 * legitimately different, and because the everyone-sentinel would make
 * `resolveActiveGroup` fall through to `mine[0]` on the slate. When
 * `cfb_games` is unset we fall back to `cfb_group`, so a one-group user gets
 * the right default having touched nothing.
 *
 * A `?g=` in a URL is a VIEW, never a choice: it selects for this render and
 * writes no cookie — following someone's shared board must not silently
 * re-home the pool you see tomorrow. Same rule the slate documents.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchGroupMembers, type GroupSummary } from "./groups";
import { fetchProfiles } from "./queries";

export const GAMES_SCOPE_COOKIE = "cfb_games";

/** The everyone sentinel. Slugs are `[a-z0-9-]`, so this can never be one. */
export const EVERYONE = "*";

export type GameScope =
  | { kind: "everyone" }
  | { kind: "group"; group: GroupSummary };

export const EVERYONE_SCOPE: GameScope = { kind: "everyone" };

/**
 * Which pool this render is scoped to. Pure — the caller supplies the
 * memberships, the `?g=` param and the remembered cookie value.
 *
 * Precedence, most explicit first:
 *  1. `?g=<slug>` naming a group you're in — a shared link opens its board.
 *  2. `?g=*` — everyone, explicitly asked for.
 *  3. The remembered cookie, when it still resolves to a group you're in.
 *  4. Your only group, when you have exactly one (the owner's ask: "it just
 *     defaults to your group if it's the only one").
 *  5. Your first group.
 *  6. Everyone — signed out, or in no groups at all.
 *
 * A `?g=` naming a group you are NOT in falls through rather than 404s: the
 * games are not a private board, and refusing to render a page because a
 * stale link named someone else's pool is worse than showing your own.
 */
export function resolveGameScope(
  mine: GroupSummary[],
  param: string | null,
  remembered: string | null,
): GameScope {
  if (param === EVERYONE) return EVERYONE_SCOPE;
  if (param) {
    const named = mine.find((g) => g.slug === param);
    if (named) return { kind: "group", group: named };
  }
  if (remembered === EVERYONE) return EVERYONE_SCOPE;
  if (remembered) {
    const kept = mine.find((g) => g.slug === remembered);
    if (kept) return { kind: "group", group: kept };
  }
  return mine.length > 0 ? { kind: "group", group: mine[0]! } : EVERYONE_SCOPE;
}

export interface ScopeRoster {
  /**
   * The user ids a board may show, or NULL for everyone. Null is not "none" —
   * it means "no filter", and callers take their pre-scoping code path, which
   * is what keeps the everyone view byte-identical to what shipped in R2-C.
   */
  userIds: string[] | null;
  nameById: Map<string, string>;
}

/**
 * The IO half: who is in scope, and their names.
 *
 * The group case reads the roster (`fetchGroupMembers`), which is both the
 * id filter and the name map in one call — the everyone case still uses the
 * site-wide `fetchProfiles`, as before. Names come from the roster rather
 * than every profile on the site, which is a smaller read and the correct
 * source. `fetchBettingSheet` has this exact shape.
 *
 * Note the ids: the game tables reference `auth.users(id)` and
 * `group_members` references `public.profiles(id)`. Same uuids, but there is
 * no FK between them — so filter with `.in("user_id", ids)`, never a
 * PostgREST embed, which would fail at runtime rather than at build.
 */
export async function scopeRoster(
  supabase: SupabaseClient,
  scope: GameScope,
): Promise<ScopeRoster> {
  if (scope.kind === "everyone") {
    const profiles = await fetchProfiles(supabase);
    return { userIds: null, nameById: new Map(profiles.map((p) => [p.id, p.display_name])) };
  }
  const members = await fetchGroupMembers(supabase, scope.group.id);
  return {
    userIds: members.map((m) => m.userId),
    nameById: new Map(members.map((m) => [m.userId, m.name])),
  };
}

/** The label a board puts on itself: "in Sunday Crew" / "everyone". */
export function scopeLabel(scope: GameScope): string {
  return scope.kind === "everyone" ? "everyone" : scope.group.name;
}

/** The `?g=` value that selects this scope, for links between game pages. */
export function scopeParam(scope: GameScope): string {
  return scope.kind === "everyone" ? EVERYONE : scope.group.slug;
}

/** `?g=…` query string for a scope, or "" when it is the default view. */
export function scopeQuery(scope: GameScope): string {
  return `?g=${encodeURIComponent(scopeParam(scope))}`;
}
