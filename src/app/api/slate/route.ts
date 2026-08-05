import { NextResponse, type NextRequest } from "next/server";
import { fetchCurrentSeasonWeek, fetchSlateView } from "../../../lib/queries";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

/** Fresh slate JSON for client auto-refresh (live scores, lines). RLS applies. */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { seasonId, week: currentWeek } = await fetchCurrentSeasonWeek(supabase);
  const weekParam = Number(request.nextUrl.searchParams.get("week"));
  const week =
    Number.isInteger(weekParam) && weekParam >= 1 && weekParam <= 20 ? weekParam : currentWeek;

  const data = await fetchSlateView(supabase, seasonId, week, user.id);
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
