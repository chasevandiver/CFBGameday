import { JumbotronView } from "../../components/jumbotron/JumbotronView";
import { seasonYearOf } from "../../lib/league";
import { fetchCurrentSeasonWeek, fetchLiveSlate, fetchSlateView } from "../../lib/queries";
import type { GameView } from "../../lib/slate";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Jumbotron",
  description: "The live slate as a stadium board — prop it up and let it run.",
};

/**
 * The Jumbotron (R5-A): a takeover surface, deliberately navless — the
 * board owns the whole screen the way it owns the end of a stadium. Data is
 * the Live view's (`fetchLiveSlate`); when nothing is live the page loads
 * both leagues' current weeks once so the countdown board has kickoffs to
 * count to.
 */
export default async function JumbotronPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { seasonId } = await fetchCurrentSeasonWeek(supabase, "cfb");
  const live = await fetchLiveSlate(supabase, seasonYearOf(seasonId), user?.id ?? null);

  let upcoming: GameView[] = [];
  if (live.games.length === 0) {
    const [cfb, nfl] = await Promise.all([
      fetchCurrentSeasonWeek(supabase, "cfb"),
      fetchCurrentSeasonWeek(supabase, "nfl"),
    ]);
    const [cfbSlate, nflSlate] = await Promise.all([
      fetchSlateView(supabase, cfb.seasonId, cfb.week, null, cfb.seasonType),
      fetchSlateView(supabase, nfl.seasonId, nfl.week, null, nfl.seasonType),
    ]);
    upcoming = [...cfbSlate.games, ...nflSlate.games];
  }

  return <JumbotronView initial={live} upcoming={upcoming} />;
}
