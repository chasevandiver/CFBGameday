import { NextResponse } from "next/server";
import { openPickCount } from "../../../lib/picks-due";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * How many picks the signed-in viewer still owes across every group they are
 * in. Feeds the Groups tab badge (`PicksDueBadge`).
 *
 * Its own route rather than page data: `AppNav` renders on every page, and
 * threading this through each one would make every route pay for a query most
 * of them do not otherwise need. One small fetch after paint, instead.
 *
 * Signed out is `{ open: 0 }` rather than a 401 — the site is public to browse
 * (migration 0011), and a nav badge is not worth an error path.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ open: 0 });

  const { data: memberships } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", user.id);
  const groupIds = (memberships ?? []).map((m: { group_id: string }) => m.group_id);
  if (groupIds.length === 0) return NextResponse.json({ open: 0 });

  /* Every game on their boards. RLS already limits this to groups they belong
     to; the explicit filter is what makes the query narrow rather than what
     makes it safe. */
  const { data: boardRows } = await supabase
    .from("group_week_games")
    .select("game_id")
    .in("group_id", groupIds);
  const boardGameIds = [...new Set((boardRows ?? []).map((r: { game_id: number }) => r.game_id))];
  if (boardGameIds.length === 0) return NextResponse.json({ open: 0 });

  const [{ data: mine }, { data: kicked }] = await Promise.all([
    supabase.from("picks").select("game_id").eq("user_id", user.id).in("game_id", boardGameIds),
    /* Not owed: kicked off, OR a TBD kickoff. Both are un-pickable and for the
       same reason — `make_pick` refuses a null `start_ts` with the same error
       it gives a game already under way (SEC-13: every branch fails closed).
       Counting either would badge a debt the app will not let anyone pay.
       (Written first as `not is null` + `lte`, which had the TBD case exactly
       backwards and made an unpickable game the one thing keeping the badge
       lit.) */
    supabase
      .from("games")
      .select("id")
      .in("id", boardGameIds)
      .or(`start_ts.is.null,start_ts.lte.${new Date().toISOString()}`),
  ]);

  const open = openPickCount({
    boardGameIds,
    pickedGameIds: (mine ?? []).map((p: { game_id: number }) => p.game_id),
    lockedGameIds: (kicked ?? []).map((g: { id: number }) => g.id),
  });
  return NextResponse.json({ open });
}
