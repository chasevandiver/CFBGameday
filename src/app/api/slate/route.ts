import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ACTIVE_GROUP_COOKIE, resolveActiveGroup } from "../../../lib/groups";
import { fetchCurrentSeasonWeek, fetchSlateView } from "../../../lib/queries";
import { createClient } from "../../../lib/supabase/server";

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

  const { seasonId, week: currentWeek, seasonType } = await fetchCurrentSeasonWeek(supabase);
  const stParam = request.nextUrl.searchParams.get("st");
  const weekParam = Number(request.nextUrl.searchParams.get("week"));
  const hasWeek = Number.isInteger(weekParam) && weekParam >= 1 && weekParam <= 20;
  const week = hasWeek ? weekParam : currentWeek;
  const st =
    stParam === "postseason" || stParam === "regular"
      ? stParam
      : hasWeek
        ? "regular"
        : seasonType;

  // Pick state on a card is group-scoped, so the refresh has to agree with the
  // server render about which group is in view.
  const { active } = await resolveActiveGroup(
    supabase,
    user?.id ?? null,
    request.nextUrl.searchParams.get("g") ?? (await cookies()).get(ACTIVE_GROUP_COOKIE)?.value ?? null,
  );

  const data = await fetchSlateView(
    supabase,
    seasonId,
    week,
    user?.id ?? null,
    st,
    active?.id ?? null,
  );
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
