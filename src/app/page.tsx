import { AppNav } from "../components/AppNav";
import { GamedayCover } from "../components/home/GamedayCover";
import { SignOff } from "../components/home/SignOff";
import { HomeAutoRefresh } from "../components/home/HomeAutoRefresh";
import { HomeDashboard } from "../components/home/HomeHub";
import { fetchHomeData, homeRefreshTier } from "../lib/home";
import { createClient } from "../lib/supabase/server";

export const dynamic = "force-dynamic";

// The layout's title template would make this "Home · The Slate", which
// reads as a subpage of itself.
export const metadata = { title: { absolute: "The Slate" } };

/**
 * The front door.
 *
 * This used to be `redirect("/slate")`, which meant opening the site dropped you
 * into sixty game cards with no answer to the question you actually opened it
 * with — what have I got riding, where do I stand, how is the season going.
 * Those answers existed, spread across `/groups`, each group's hub and
 * `/ledger`; none of them was the first thing you saw.
 *
 * So this page asks the four questions in order and then hands off. It is
 * deliberately short: the hub is somewhere you pass through on the way to the
 * slate, not somewhere to spend a Saturday, and the primary action says so.
 *
 * Money and the pool are two lists, never one. They are separate products with
 * separate arithmetic, which is why `/ledger` has two tabs — the hub's first
 * version rendered them as differently-tinted chips on one row, and a game
 * carrying both could not tell you what you had money on.
 *
 * Public, like the rest of the site (see `lib/supabase/middleware.ts`) — a
 * signed-out visitor gets the week and the way in rather than a login wall.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const data = await fetchHomeData(supabase, user?.id ?? null);

  /* Decided from the positions on the page, not from the CFB week. This used
     to read `data.liveCount > 0`, which counts CFB games only — so with the
     college season still fifteen days out, a live NFL game the viewer had
     money on left the hub on its five-minute idle tier. See homeRefreshTier. */
  const { live, imminent } = homeRefreshTier(data);

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <HomeDashboard data={data} signedIn={!!user} />
      </main>
      <HomeAutoRefresh live={live} imminent={imminent} />
      {/* Fun Mode (FUN-8/FUN-16): the day's bookends — the Cover opens a
          gameday morning, the Sign-Off closes it after the last final. */}
      <GamedayCover />
      <SignOff />
    </>
  );
}
