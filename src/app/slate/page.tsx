import { cookies } from "next/headers";
import { AppNav } from "../../components/AppNav";
import { SlateView } from "../../components/slate/SlateView";
import { ACTIVE_GROUP_COOKIE, resolveActiveGroup } from "../../lib/groups";
import { fetchCurrentSeasonWeek, fetchSlateView } from "../../lib/queries";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Slate" };

export default async function SlatePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; st?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { seasonId, week: currentWeek, seasonType } = await fetchCurrentSeasonWeek(supabase);

  const { week: weekParam, st: stParam } = await searchParams;
  const parsed = Number(weekParam);
  const hasWeekParam = Number.isInteger(parsed) && parsed >= 1 && parsed <= 20;
  // ?st=post pins the bowls/CFP view; an explicit ?week= means the regular
  // season; otherwise the default follows the calendar into the postseason.
  const st =
    stParam === "post" ? ("postseason" as const) : hasWeekParam ? ("regular" as const) : seasonType;
  const week =
    st === "postseason"
      ? seasonType === "postseason"
        ? currentWeek
        : 1
      : hasWeekParam
        ? parsed
        : currentWeek;

  const { active } = await resolveActiveGroup(
    supabase,
    user?.id ?? null,
    (await cookies()).get(ACTIVE_GROUP_COOKIE)?.value ?? null,
  );

  const [initial, favRes] = await Promise.all([
    fetchSlateView(supabase, seasonId, week, user?.id ?? null, st, active?.id ?? null),
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
