/**
 * Logging a bet as somebody else (migration 0083).
 *
 * A betting-group admin can stand in for any member of that group — a real
 * account or a seat — and log bets that land on the member's ledger with the
 * admin's id in `logged_by`. The grant is one database function,
 * `can_log_bet_for`, and this module is the only place the app asks it: the
 * server actions ask before writing (the policy would refuse anyway, but a
 * refusal here has a message a person can read), and the pages ask before
 * rendering a slate or a form as someone else.
 *
 * **Fails closed**, the same way `isCurrentUserAdmin` does: an RPC error, a
 * missing function (the migration not yet applied), a signed-out caller, a
 * malformed id — all "no". Nothing in here can widen the grant; the database
 * decides, this only relays.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ActingBettor {
  id: string;
  name: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shaped like an id at all? A `?for=` is a URL, and URLs carry anything. */
export const isUuid = (s: string): boolean => UUID.test(s);

/** "May the signed-in caller log a bet for this person?" — the database's answer. */
export async function canLogBetFor(supabase: SupabaseClient, forUserId: string): Promise<boolean> {
  if (!isUuid(forUserId)) return false;
  const { data, error } = await supabase.rpc("can_log_bet_for", { p_user: forUserId });
  if (error) return false;
  return data === true;
}

/**
 * Resolve a `?for=` against the grant, for the pages that render as someone
 * else. Null means "yourself": no parameter, your own id, a stranger's id, a
 * signed-out reader, or a database that says no — every one of those renders
 * the page the ordinary way rather than as an error, because a stale link
 * from last week's text thread is not a fault.
 */
export async function resolveActingBettor(
  supabase: SupabaseClient,
  viewerId: string | null,
  forParam: string | null | undefined,
): Promise<ActingBettor | null> {
  if (!viewerId || !forParam || forParam === viewerId || !isUuid(forParam)) return null;
  if (!(await canLogBetFor(supabase, forParam))) return null;
  const { data } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", forParam)
    .maybeSingle();
  return { id: forParam, name: (data as { display_name: string | null } | null)?.display_name ?? "them" };
}
