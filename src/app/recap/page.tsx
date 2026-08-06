import { redirect } from "next/navigation";
import { fetchCurrentSeasonWeek } from "../../lib/queries";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

/** /recap → the most recent week with a final (usually last weekend). */
export default async function RecapIndex() {
  const supabase = await createClient();
  const { seasonId } = await fetchCurrentSeasonWeek(supabase);
  const { data: last } = await supabase
    .from("games")
    .select("week")
    .eq("season_id", seasonId)
    .eq("season_type", "regular")
    .eq("status", "final")
    .order("start_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  redirect(`/recap/${last?.week ?? 1}`);
}
