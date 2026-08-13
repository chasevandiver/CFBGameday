import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ACTIVE_GROUP_COOKIE, activeOfKind, resolveActiveGroup } from "../../../lib/groups";
import { fetchCurrentSeasonWeek, fetchSlateView } from "../../../lib/queries";
import { createClient } from "../../../lib/supabase/server";
import { isValidWeek } from "../../../lib/week-range";

export const dynamic = "force-dynamic";

/**
 * Fresh slate JSON for client auto-refresh (live scores, lines). RLS applies.
 * The site is public to browse (migration 0011) — signed-out visitors get the
 * same slate with pick/bet fields empty (audit bug #5: this used to 401 and
 * break week switching + live refresh for anon).
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const sport = request.nextUrl.searchParams.get("sport") === "nfl" ? "nfl" : "cfb";
  const { seasonId, week: currentWeek, seasonType } = await fetchCurrentSeasonWeek(supabase, sport);
  const stParam = request.nextUrl.searchParams.get("st");
  const weekParam = Number(request.nextUrl.searchParams.get("week"));
  const hasWeek = isValidWeek(weekParam);
  const week = hasWeek ? weekParam : currentWeek;
  const st =
    stParam === "postseason" || stParam === "regular"
      ? stParam
      : hasWeek
        ? "regular"
        : seasonType;

  // Pick state and the betting sheet are both group-scoped, so the refresh has
  // to agree with the server render about which groups are in view — resolved
  // the same way, or a poll would quietly blank the sheet off every card.
  const remembered =
    request.nextUrl.searchParams.get("g") ??
    (await cookies()).get(ACTIVE_GROUP_COOKIE)?.value ??
    null;
  const { mine } = await resolveActiveGroup(supabase, user?.id ?? null, remembered);

  const data = await fetchSlateView(
    supabase,
    seasonId,
    week,
    user?.id ?? null,
    st,
    activeOfKind(mine, "pickem", remembered)?.id ?? null,
    activeOfKind(mine, "betting", remembered)?.id ?? null,
  );
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
