import { redirect } from "next/navigation";
import { isSport, type Sport } from "../../lib/league";
import { fetchCurrentSeasonWeek } from "../../lib/queries";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

/** /recap → the most recent week with a final (usually last weekend). Carries
 *  `?sport=nfl` through to the week page (R2-A2). */
export default async function RecapIndex({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string }>;
}) {
  const { sport: sportParam } = await searchParams;
  const sport: Sport = isSport(sportParam) ? sportParam : "cfb";
  const supabase = await createClient();
  const { seasonId } = await fetchCurrentSeasonWeek(supabase, sport);
  const { data: last } = await supabase
    .from("games")
    .select("week")
    .eq("season_id", seasonId)
    .eq("season_type", "regular")
    .eq("status", "final")
    .order("start_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  redirect(`/recap/${last?.week ?? 1}${sport === "nfl" ? "?sport=nfl" : ""}`);
}
