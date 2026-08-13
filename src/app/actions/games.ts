"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../../lib/supabase/server";
import { createServiceClient } from "../../lib/supabase/service";
import { isDeadStatus, nextGameStatus, voidWagersForGames, type VoidAction } from "../../lib/void";

export interface VoidResult {
  ok: boolean;
  message?: string;
  /** Wagers voided by this call, for the panel's confirmation line. */
  picks?: number;
  bets?: number;
}

/**
 * RLS stops a non-admin's write, but reports it as a zero-row no-op that the
 * action would then call success (audit 06/SEC-11). Same check as
 * `actions/adjustments.ts`; kept there too rather than shared, because both
 * are four lines and a shared helper would hide which client each one runs on.
 */
async function requireAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "Not signed in";
  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  return me?.is_admin ? null : "Admins only";
}

/**
 * Mark a game postponed or canceled, or restore one that was — League Rule #4
 * (P1-1). The grader has always honoured these statuses and nothing has ever
 * written them; CFBD publishes no cancellation signal, so a human is the only
 * source of truth there is.
 *
 * The void runs inline rather than waiting for Sunday's `ratings-update`. A
 * game postponed at noon on Saturday would otherwise show open picks on a game
 * that will never be played for up to a week, and `ratings-update` is the job
 * with the longest overdue horizon on the admin card. Both callers share
 * `voidWagersForGames` and both are idempotent, so the Sunday pass stays as
 * the backstop for a status set any other way.
 */
export async function setGameStatus(gameId: number, action: VoidAction): Promise<VoidResult> {
  const supabase = await createClient();
  const denied = await requireAdmin(supabase);
  if (denied) return { ok: false, message: denied };

  // `games` is SELECT-only under RLS (0001:297 authenticated, 0011:13 anon)
  // with no update policy at all, so a cookie-client write here would affect
  // zero rows and report success. Service role, behind the is_admin check
  // above, rather than opening the table every anonymous visitor reads.
  const service = createServiceClient();

  const { data: game, error: readErr } = await service
    .from("games")
    .select("id, status")
    .eq("id", gameId)
    .maybeSingle();
  if (readErr) return { ok: false, message: readErr.message };
  if (!game) return { ok: false, message: "Game not found" };

  const next = nextGameStatus(game.status, action);
  if (!next.ok) return { ok: false, message: next.reason };

  const { data, error } = await service
    .from("games")
    .update({ status: next.status })
    .eq("id", gameId)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) return { ok: false, message: "Game not found" };

  // Restoring deliberately does NOT un-void: the line has moved since, so
  // reinstating a pick at its old `line_at_pick` would be a false receipt.
  // Members re-pick, which since 0034 clears the void off the row.
  let counts = { picks: 0, bets: 0 };
  if (isDeadStatus(next.status)) {
    counts = await voidWagersForGames(service, [gameId]);
  }

  // A void changes chips on every surface that shows a pick, a bet or a card.
  revalidatePath("/admin");
  revalidatePath("/slate");
  revalidatePath("/ledger");
  revalidatePath("/");
  revalidatePath("/game", "layout");
  revalidatePath("/groups", "layout");

  return { ok: true, ...counts };
}
