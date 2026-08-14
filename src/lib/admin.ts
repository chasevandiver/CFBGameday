/**
 * "Is the caller an admin?" — one implementation, seven callers.
 *
 * Every admin gate in the app used to answer this the same way, by SELECTing
 * `profiles.is_admin` as the signed-in user. That worked, and it also meant
 * any member could read the flag for anyone: RLS restricts rows, not columns,
 * and both SELECT policies on `profiles` are `using (true)`.
 *
 * Migration 0050 takes the column away from `authenticated` and puts the
 * question behind `is_current_user_admin()`, a SECURITY DEFINER function that
 * returns one boolean about the caller and nothing about anybody else. This
 * module is the only place that calls it — the same reasoning as `records.ts`
 * and `void.ts`, and it matters more here: seven copies of an authorization
 * check is seven chances to get one of them backwards.
 *
 * **Fails closed.** An RPC error, a missing profile row, a signed-out caller —
 * all false. A gate that cannot determine your rights must not grant them, and
 * `coalesce(..., false)` inside the function plus this `=== true` outside it
 * mean neither a null nor an undefined can be mistaken for a yes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export async function isCurrentUserAdmin(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_current_user_admin");
  if (error) return false;
  return data === true;
}

/**
 * The server-action shape: null when allowed, a message when not.
 *
 * Five actions had this exact three-step (get user → read flag → return a
 * string) copy-pasted with only the refusal wording different, so the wording
 * is the parameter and the logic is shared.
 */
export async function requireAdmin(
  supabase: SupabaseClient,
  denial = "Admins only",
): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "Not signed in";
  return (await isCurrentUserAdmin(supabase)) ? null : denial;
}
