"use server";

import { revalidatePath } from "next/cache";
import type { PickMarket } from "../../lib/grade";
import { createClient } from "../../lib/supabase/server";
import { createServiceClient } from "../../lib/supabase/service";

export interface AdminWagerResult {
  ok: boolean;
  message?: string;
  /** Rows removed. Zero is a success — see the idempotence note below. */
  removed?: number;
}

/**
 * Same four lines as `actions/games.ts` and `actions/adjustments.ts`, and kept
 * here rather than shared for the reason stated there: each copy sits beside
 * the client it guards, and a shared helper would hide which one that is.
 *
 * RLS alone is not enough for this file. A cookie-client DELETE on `bets` is
 * revoked outright (0001:360), so it would fail loudly — but the service client
 * below bypasses RLS entirely, which is exactly why the check has to happen
 * before it is constructed.
 */
async function requireAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ denied: string } | { userId: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { denied: "Not signed in" };
  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  return me?.is_admin ? { userId: user.id } : { denied: "Admins only" };
}

/** Every surface that can show a bet or a pick. A deletion changes all of them. */
function revalidateWagerSurfaces(): void {
  revalidatePath("/admin");
  revalidatePath("/ledger");
  revalidatePath("/slate");
  revalidatePath("/");
  revalidatePath("/game", "layout");
  revalidatePath("/groups", "layout");
}

/**
 * ADM-1 — delete a bet outright, at any point in its life.
 *
 * ## Why this is a delete and not a void
 *
 * `voidBet` already exists and is the wrong tool for what was asked. A voided
 * bet is still a row: it renders in the ledger at 40% opacity forever
 * (`ledger/page.tsx:445`), which is precisely the complaint — "the voided bets
 * still sit in the ledger". Voiding is the right answer for a bet that was
 * really placed and then taken back; it is the wrong answer for a test row that
 * should never have existed.
 *
 * ## The append-only exception
 *
 * `0001:210` opens the table with "Append-only ledger: no deletes; voided_at
 * instead", and `docs/SPEC.md` §5.3 agrees. This is a deliberate exception,
 * narrowed rather than waved through: every deletion copies the whole row into
 * `deleted_wagers` first (migration 0046), so the invariant goes from "nothing
 * is ever removed" to "nothing is removed without a record". A row can always
 * be reconstructed by hand, which is the property the original rule existed to
 * protect.
 *
 * ## Why the service role
 *
 * `revoke delete on bets from authenticated, anon` (0001:360) and no delete
 * policy exists, so a cookie-client call would fail — and the alternative,
 * opening a delete policy on the ledger, would hand every signed-in user a
 * power only an admin should have. Same trade `setGameStatus` made for `games`
 * (`actions/games.ts:55-58`).
 *
 * No status or kickoff gate, deliberately. Deleting a *graded* bet is the
 * central case: a test bet on a game that has already finished is exactly what
 * this was asked for. The 0045 trigger that freezes a settled bet passes the
 * service role through (`0045:75-77`), and DELETE has no trigger at all.
 */
export async function adminDeleteBet(betId: number): Promise<AdminWagerResult> {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if ("denied" in auth) return { ok: false, message: auth.denied };

  const service = createServiceClient();

  // Read first, archive second, delete third. If the archive write fails the
  // row is still there — the ordering is the whole guarantee, so it is not an
  // optimisation to fold these into one round trip.
  const { data: bet, error: readErr } = await service
    .from("bets")
    .select("*")
    .eq("id", betId)
    .maybeSingle();
  if (readErr) return { ok: false, message: readErr.message };
  if (!bet) return { ok: true, removed: 0 };

  const { error: archiveErr } = await service.from("deleted_wagers").insert({
    kind: "bet",
    payload: bet,
    deleted_by: auth.userId,
    note: "adminDeleteBet",
  });
  if (archiveErr) {
    return { ok: false, message: `Not deleted — the archive write failed: ${archiveErr.message}` };
  }

  const { data: gone, error: delErr } = await service
    .from("bets")
    .delete()
    .eq("id", betId)
    .select("id");
  if (delErr) return { ok: false, message: delErr.message };

  revalidateWagerSurfaces();
  return { ok: true, removed: gone?.length ?? 0 };
}

/**
 * ADM-1's other half: the same, for a pick, reached from `/admin` rather than
 * from a group. A site admin is not a group admin (see `admin_remove_pick` in
 * 0046, which refuses them on purpose), so this is the path that clears a test
 * pick in a pool the operator does not belong to.
 */
export async function adminDeletePick(pickId: number): Promise<AdminWagerResult> {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if ("denied" in auth) return { ok: false, message: auth.denied };

  const service = createServiceClient();

  const { data: pick, error: readErr } = await service
    .from("picks")
    .select("*")
    .eq("id", pickId)
    .maybeSingle();
  if (readErr) return { ok: false, message: readErr.message };
  if (!pick) return { ok: true, removed: 0 };

  const { error: archiveErr } = await service.from("deleted_wagers").insert({
    kind: "pick",
    payload: pick,
    deleted_by: auth.userId,
    note: "adminDeletePick",
  });
  if (archiveErr) {
    return { ok: false, message: `Not deleted — the archive write failed: ${archiveErr.message}` };
  }

  const { data: gone, error: delErr } = await service
    .from("picks")
    .delete()
    .eq("id", pickId)
    .select("id");
  if (delErr) return { ok: false, message: delErr.message };

  revalidateWagerSurfaces();
  return { ok: true, removed: gone?.length ?? 0 };
}

/**
 * ADM-2 — a group admin cancels a member's pick, before or after kickoff.
 *
 * Runs on the *cookie* client, not the service role, because the authority here
 * is per-group and the database is the only place that knows it. The check, the
 * archive and the delete all live in `admin_remove_pick` (0046) for the reason
 * `actions/picks.ts:20-21` gives: a server action is not a security boundary,
 * the RPC is.
 *
 * `remove_pick` could not be reused for this in two independent ways. It
 * deletes `user_id = auth.uid()`, so an admin calling it removes their own pick
 * and cheerfully reports one row; and it raises at kickoff (`0038:62-64`),
 * which is the case an admin most needs.
 *
 * Zero rows is a success, matching `removePick` and for the same reason: the
 * second tap of a double-tap asks for a state the pick is already in. The count
 * comes back so the caller can tell which happened.
 */
export async function adminRemovePick(
  groupId: string,
  userId: string,
  gameId: number,
  market: PickMarket,
): Promise<AdminWagerResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to manage picks" };

  const { data, error } = await supabase.rpc("admin_remove_pick", {
    p_group_id: groupId,
    p_user_id: userId,
    p_game_id: gameId,
    p_market: market,
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/groups", "layout");
  revalidatePath("/slate");
  revalidatePath(`/game/${gameId}`);
  return { ok: true, removed: typeof data === "number" ? data : 0 };
}
