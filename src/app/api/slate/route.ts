import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ACTIVE_GROUP_COOKIE, activeOfKind, resolveActiveGroup } from "../../../lib/groups";
import { seasonYearOf } from "../../../lib/league";
import { fetchCurrentSeasonWeek, fetchLiveSlate, fetchSlateView } from "../../../lib/queries";
import { createClient } from "../../../lib/supabase/server";
import { parseWeekParam } from "../../../lib/week-range";

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

  // UX-36: `?sport=live` is a third view, not a league — it spans both and
  // every week, so it short-circuits the week resolution below entirely.
  const sportParam = request.nextUrl.searchParams.get("sport");
  const liveView = sportParam === "live";
  const sport = sportParam === "nfl" ? "nfl" : "cfb";
  const { seasonId, week: currentWeek, seasonType } = await fetchCurrentSeasonWeek(supabase, sport);
  const stParam = request.nextUrl.searchParams.get("st");
  /* `parseWeekParam`, not `Number(...)`. A missing `?week=` reads back as
     `null`, `Number(null)` is `0`, and Week 0 is a real addressable week
     (`MIN_WEEK`, the last Saturday of August) — so `isValidWeek` said yes and
     every parameterless call to this route served week 0 of the regular
     season instead of the current one. On the CFB side that returned the
     eight week-0 games and looked plausible; on the NFL side, which has no
     week 0, it returned an empty slate while five preseason games were live.
     `parseWeekParam` exists for exactly this and handles absent separately
     from zero. The slate's own poller always sends a week, which is why this
     survived: it only ever showed up on a bare request. */
  const weekParam = parseWeekParam(request.nextUrl.searchParams.get("week"));
  const hasWeek = weekParam !== null;
  const week = hasWeek ? weekParam : currentWeek;
  const st =
    stParam === "postseason" || stParam === "regular" || stParam === "preseason"
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

  if (liveView) {
    const live = await fetchLiveSlate(
      supabase,
      seasonYearOf(seasonId),
      user?.id ?? null,
      activeOfKind(mine, "pickem", remembered)?.id ?? null,
      activeOfKind(mine, "betting", remembered)?.id ?? null,
    );
    return NextResponse.json(live, { headers: { "cache-control": "no-store" } });
  }

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
