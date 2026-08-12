import { cookies } from "next/headers";
import { AppNav } from "../../components/AppNav";
import { SlateView } from "../../components/slate/SlateView";
import { ACTIVE_GROUP_COOKIE, activeOfKind, resolveActiveGroup } from "../../lib/groups";
import { fetchCurrentSeasonWeek, fetchSlateView } from "../../lib/queries";
import { createClient } from "../../lib/supabase/server";
import { isValidWeek } from "../../lib/week-range";

export const dynamic = "force-dynamic";

export const metadata = { title: "Slate" };

export default async function SlatePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; st?: string; g?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { seasonId, week: currentWeek, seasonType, minWeek } = await fetchCurrentSeasonWeek(supabase);

  const { week: weekParam, st: stParam, g: groupParam } = await searchParams;
  const parsed = Number(weekParam);
  const hasWeekParam = isValidWeek(parsed);
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

  // Two layers, two groups. The pool's picks are scoped to a pick'em group and
  // the sheet to a betting group; someone can be in one, both or neither, and
  // the remembered group only decides which of its own kind is in view.
  // `?g=<slug>` is what a shared sheet links to: it opens the slate with that
  // group's positions on the cards, whatever the reader last looked at. It
  // does not overwrite the cookie — following someone's link should not
  // silently re-home the group they see tomorrow.
  const remembered = groupParam ?? (await cookies()).get(ACTIVE_GROUP_COOKIE)?.value ?? null;
  const { mine } = await resolveActiveGroup(supabase, user?.id ?? null, remembered);
  const pickemGroup = activeOfKind(mine, "pickem", remembered);
  const bettingGroup = activeOfKind(mine, "betting", remembered);

  const [initial, favRes] = await Promise.all([
    fetchSlateView(
      supabase,
      seasonId,
      week,
      user?.id ?? null,
      st,
      pickemGroup?.id ?? null,
      bettingGroup?.id ?? null,
    ),
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
          minWeek={minWeek}
          favoriteTeamIds={favoriteTeamIds}
        />
      </main>
    </>
  );
}
