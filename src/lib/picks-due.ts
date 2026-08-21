import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "How many picks does this person still owe?" — one definition, so the badge
 * on the Groups tab and the push that nags about the same thing can never
 * disagree about what "done" means.
 *
 * The rule, matching `notifyPicksDueJob` (scripts/lib/notify-jobs.ts): a game
 * counts as picked when the member has ANY pick on it. A pool board can carry
 * two markets for one game — the spread and the total — and requiring both
 * would badge someone who has done everything the board asked of them. Being
 * wrong in that direction is worse: a badge that will not clear is a badge
 * people learn to ignore, and then it is worth nothing on the Saturday it
 * matters.
 *
 * Kicked-off games are excluded because a pick you can no longer make is not
 * a pick you owe. `make_pick` refuses them at the database (`Kickoff — picks
 * are locked for this game`), so counting them would badge a debt the app
 * will not let anyone pay.
 */

export interface PicksDueInput {
  /** Every game on the viewer's group boards for the open week(s). */
  boardGameIds: number[];
  /** Games they already have at least one pick on. */
  pickedGameIds: Iterable<number>;
  /** Games whose kickoff has passed — locked, and no longer owed. */
  lockedGameIds: Iterable<number>;
}

export function openPickCount({
  boardGameIds,
  pickedGameIds,
  lockedGameIds,
}: PicksDueInput): number {
  const picked = new Set(pickedGameIds);
  const locked = new Set(lockedGameIds);
  return boardGameIds.filter((id) => !picked.has(id) && !locked.has(id)).length;
}

/**
 * What the badge shows. A number up to 9, then "9+" — past that the count has
 * stopped being information and started being a wall of digits in a 62px tab.
 */
export function badgeLabel(open: number): string | null {
  if (open <= 0) return null;
  return open > 9 ? "9+" : String(open);
}

/**
 * The count, read from the database. One implementation, so the home hub and
 * `/api/picks-due` cannot drift — the route existed first and the hub is where
 * the count actually belongs (owner call, 2026-08-21: a "9+" on a nav icon
 * says nothing about what it is counting).
 *
 * Returns 0 for a signed-out or group-less viewer rather than throwing: this
 * feeds a card's subtitle, and a hub that 500s because a badge could not be
 * computed is a worse product than a hub with no badge.
 */
export async function fetchOpenPickCount(
  supabase: SupabaseClient,
  userId: string | null,
): Promise<number> {
  if (!userId) return 0;
  const { data: memberships } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId);
  const groupIds = (memberships ?? []).map((m: { group_id: string }) => m.group_id);
  if (groupIds.length === 0) return 0;

  const { data: boardRows } = await supabase
    .from("group_week_games")
    .select("game_id")
    .in("group_id", groupIds);
  const boardGameIds = [...new Set((boardRows ?? []).map((r: { game_id: number }) => r.game_id))];
  if (boardGameIds.length === 0) return 0;

  const [{ data: mine }, { data: shut }] = await Promise.all([
    supabase.from("picks").select("game_id").eq("user_id", userId).in("game_id", boardGameIds),
    /* Not owed: kicked off, OR a TBD kickoff. Both are un-pickable and for the
       same reason — `make_pick` refuses a null `start_ts` with the same error
       it gives a game already under way (SEC-13: every branch fails closed). */
    supabase
      .from("games")
      .select("id")
      .in("id", boardGameIds)
      .or(`start_ts.is.null,start_ts.lte.${new Date().toISOString()}`),
  ]);

  return openPickCount({
    boardGameIds,
    pickedGameIds: (mine ?? []).map((p: { game_id: number }) => p.game_id),
    lockedGameIds: (shut ?? []).map((g: { id: number }) => g.id),
  });
}
