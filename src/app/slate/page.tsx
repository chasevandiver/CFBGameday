import { cookies } from "next/headers";
import { AppNav } from "../../components/AppNav";
import type { SignView } from "../../components/slate/CrowdSigns";
import { SlateView } from "../../components/slate/SlateView";
import { ACTIVE_GROUP_COOKIE, activeOfKind, resolveActiveGroup } from "../../lib/groups";
import { seasonYearOf } from "../../lib/league";
import { fetchCurrentSeasonWeek, fetchLiveSlate, fetchSlateView } from "../../lib/queries";
import { createClient } from "../../lib/supabase/server";
import { isValidWeek } from "../../lib/week-range";

export const dynamic = "force-dynamic";

export const metadata = { title: "Slate" };

export default async function SlatePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; st?: string; g?: string; sport?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { week: weekParam, st: stParam, g: groupParam, sport: sportParam } = await searchParams;
  // Three views now (UX-36): `live` spans both leagues and every week, the
  // other two are one league's week. Anything unrecognised is the default
  // league, as before.
  const liveView = sportParam === "live";
  const sport = sportParam === "nfl" ? ("nfl" as const) : ("cfb" as const);
  const { seasonId, week: currentWeek, seasonType, minWeek } = await fetchCurrentSeasonWeek(
    supabase,
    sport,
  );
  const parsed = Number(weekParam);
  const hasWeekParam = isValidWeek(parsed);
  // ?st=post pins the bowls/CFP (or NFL playoffs) view; ?st=pre pins an NFL
  // preseason week; an explicit ?week= alone means the regular season;
  // otherwise the default follows the calendar through pre → regular → post.
  const st =
    stParam === "post"
      ? ("postseason" as const)
      : stParam === "pre"
        ? ("preseason" as const)
        : hasWeekParam
          ? ("regular" as const)
          : seasonType;
  const week =
    st === "postseason"
      ? // NFL-6: the round is the week, so an explicit `?week=` has to win here.
        // Without this, `?st=post&week=3` opened on Wild Card and every round
        // link pointed at the same page — the client selector said "Conference"
        // only because it had been clicked, never because it was asked for.
        hasWeekParam
        ? parsed
        : seasonType === "postseason"
          ? currentWeek
          : 1
      : st === "preseason"
        ? hasWeekParam
          ? parsed
          : seasonType === "preseason"
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
    liveView
      ? fetchLiveSlate(
          supabase,
          seasonYearOf(seasonId),
          user?.id ?? null,
          pickemGroup?.id ?? null,
          bettingGroup?.id ?? null,
        )
      : fetchSlateView(
          supabase,
          seasonId,
          week,
          user?.id ?? null,
          st,
          pickemGroup?.id ?? null,
          bettingGroup?.id ?? null,
        ),
    user
      ? supabase.from("profiles").select("favorite_team_ids, display_name").eq("id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const favoriteTeamIds: number[] = favRes.data?.favorite_team_ids ?? [];
  // The share card is titled "<display_name> Bets", so the slip needs the name.
  const displayName: string = favRes.data?.display_name ?? "";

  // Fun Mode's crowd signs (FUN-10): the week's wall, names resolved in a
  // second pass (crowd_signs has no FK into profiles for PostgREST to walk).
  // Signed-in and week-scoped only — the live view spans weeks and the wall
  // does not. Missing table (migration not applied yet) degrades to no wall.
  let signs: SignView[] = [];
  if (user && !liveView) {
    const { data: signRows } = await supabase
      .from("crowd_signs")
      .select("user_id, body")
      .eq("season_id", seasonId)
      .eq("week", week);
    const rows = (signRows ?? []) as { user_id: string; body: string }[];
    if (rows.length > 0) {
      const { data: profRows } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in(
          "id",
          rows.map((r) => r.user_id),
        );
      const names = new Map(
        ((profRows ?? []) as { id: string; display_name: string | null }[]).map((p) => [
          p.id,
          p.display_name,
        ]),
      );
      signs = rows.map((r) => ({
        name: names.get(r.user_id) ?? "Crew",
        body: r.body,
        mine: r.user_id === user.id,
      }));
    }
  }

  return (
    <>
      <AppNav />
      <main id="main" className="w-full flex-1 px-4">
        <SlateView
          initial={initial}
          currentWeek={currentWeek}
          minWeek={minWeek}
          favoriteTeamIds={favoriteTeamIds}
          displayName={displayName}
          signs={user && !liveView ? signs : null}
          signsWeek={week}
          poolName={pickemGroup?.name ?? null}
        />
      </main>
    </>
  );
}
