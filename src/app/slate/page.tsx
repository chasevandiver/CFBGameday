import { AppNav } from "../../components/AppNav";
import { SlateView } from "../../components/slate/SlateView";
import { fetchCurrentSeasonWeek, fetchSlateView } from "../../lib/queries";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Slate" };

export default async function SlatePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { seasonId, week: currentWeek, seasonType } = await fetchCurrentSeasonWeek(supabase);

  const { week: weekParam } = await searchParams;
  const parsed = Number(weekParam);
  const hasWeekParam = Number.isInteger(parsed) && parsed >= 1 && parsed <= 20;
  const week = hasWeekParam ? parsed : currentWeek;
  // An explicit ?week= always means the regular season; the default view
  // follows the calendar into the postseason (bowls are the current slate).
  const st = hasWeekParam ? "regular" : seasonType;

  const [initial, favRes] = await Promise.all([
    fetchSlateView(supabase, seasonId, week, user?.id ?? null, st),
    user
      ? supabase.from("profiles").select("favorite_team_ids").eq("id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const favoriteTeamIds: number[] = favRes.data?.favorite_team_ids ?? [];

  return (
    <>
      <AppNav />
      <main id="main" className="w-full flex-1 px-4">
        <SlateView
          initial={initial}
          currentWeek={currentWeek}
          favoriteTeamIds={favoriteTeamIds}
        />
      </main>
    </>
  );
}
