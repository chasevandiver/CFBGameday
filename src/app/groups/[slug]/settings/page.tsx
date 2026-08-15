import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppNav } from "../../../../components/AppNav";
import { GroupAdmin } from "../../../../components/group/GroupAdmin";
import { RosterAdmin } from "../../../../components/group/RosterAdmin";
import { WeekConfigForm, type ConfigGame } from "../../../../components/group/WeekConfigForm";
import type { PickRow } from "../../../../lib/db-types";
import { fetchGroupMembers, fetchGroupWeek, groupLeague, resolveActiveGroup } from "../../../../lib/groups";
import { DEFAULT_TZ, kickParts, tzLabel } from "../../../../lib/kick";
import { fetchCurrentSeasonWeek, fetchSlateView } from "../../../../lib/queries";
import { createClient } from "../../../../lib/supabase/server";
import {
  boardRunsIn,
  firstRegular,
  parseWeekRef,
  sameWeek,
  seasonWeeks,
  shortWeekLabel,
  weekLabel,
  weekQuery,
} from "../../../../lib/group-weeks";

export const dynamic = "force-dynamic";

export const metadata = { title: "Group settings" };

/**
 * Where the admin builds the week: which games are in play, which bet types
 * members may pick, and who is in the group.
 */
export default async function GroupSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ week?: string; st?: string; league?: string }>;
}) {
  const { slug } = await params;
  const { week: weekParam, st: stRaw, league: leagueParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { active } = await resolveActiveGroup(supabase, user.id, slug);
  if (!active || active.slug !== slug) notFound();

  // A betting group has no board: send them to the one page it does have
  // rather than rendering an empty week.
  if (active.kind !== "pickem") redirect(`/groups/${slug}`);

  // Each league runs its own week calendar; ?league= picks which board is
  // being configured, and only leagues the group plays are reachable.
  const league = groupLeague(leagueParam, active.leagues);
  const {
    seasonId,
    week: currentWeek,
    seasonType: currentType,
    minWeek,
  } = await fetchCurrentSeasonWeek(supabase, league);

  /* Only the weeks a board can exist for. `set_group_week_config` refuses
     `preseason` outright, so offering those weeks here is offering a control
     that throws — and in August the live pointer IS a preseason week, which is
     how an admin ended up on a page that could not save anything. The default
     falls forward to the season opener instead. */
  const weeks = seasonWeeks(league, minWeek).filter(boardRunsIn);
  const fallback = boardRunsIn({ seasonType: currentType, week: currentWeek })
    ? { seasonType: currentType, week: currentWeek }
    : (firstRegular(weeks) ?? weeks[0]);
  const ref = parseWeekRef(weekParam, stRaw, weeks, fallback);
  const { week, seasonType } = ref;

  // The same slate the board renders, so the admin picks games from rows that
  // look like the rows their members will see — logos, poll ranks and records
  // included, rather than a list of abbreviation pairs.
  const [groupWeek, members, slate, joinRes] = await Promise.all([
    fetchGroupWeek(supabase, active.id, seasonId, week, seasonType),
    fetchGroupMembers(supabase, active.id),
    fetchSlateView(supabase, seasonId, week, user.id, seasonType, active.id),
    active.role === "admin"
      ? supabase.from("groups").select("join_code").eq("id", active.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const weekGames = [...slate.games].sort((a, b) =>
    (a.startTs ?? "9999").localeCompare(b.startTs ?? "9999"),
  );
  const { data: pickRows } = await supabase
    .from("picks")
    .select("game_id")
    .eq("group_id", active.id)
    .in("game_id", weekGames.length > 0 ? weekGames.map((g) => g.id) : [-1]);

  const pickCounts = new Map<number, number>();
  for (const p of (pickRows ?? []) as Array<Pick<PickRow, "game_id">>) {
    pickCounts.set(p.game_id, (pickCounts.get(p.game_id) ?? 0) + 1);
  }

  const configGames: ConfigGame[] = weekGames.map((g) => {
    const kick = g.startTs ? kickParts(g.startTs, DEFAULT_TZ) : null;
    return {
      id: g.id,
      label: `${g.away.school} at ${g.home.school}`,
      away: g.away,
      home: g.home,
      kick: kick ? `${kick.day} ${kick.time} ${tzLabel(DEFAULT_TZ)}` : "TBD",
      conferences: [g.home.conference, g.away.conference].filter((c): c is string => !!c),
      pickCount: pickCounts.get(g.id) ?? 0,
    };
  });
  const conferences = [...new Set(configGames.flatMap((g) => g.conferences))].sort();
  const joinCode = (joinRes.data as { join_code: string } | null)?.join_code ?? null;

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl">{active.name}</h1>
          <Link href={`/groups/${slug}`} className="stat text-xs text-accent hover:underline">
            Board →
          </Link>
        </div>
        <p className="mb-5 text-sm text-dim">
          {active.role === "admin"
            ? "You run this group."
            : "Only an admin can change the week."}
        </p>

        {active.role === "admin" && (
          <section className="card mb-4 px-4 py-4">
            {active.leagues.length > 1 && (
              <nav aria-label="League" className="mb-3 flex items-center gap-1">
                {active.leagues.includes("cfb") && (
                  <Link
                    href={`/groups/${slug}/settings`}
                    aria-current={league === "cfb" ? "page" : undefined}
                    className={`stat flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold ${
                      league === "cfb" ? "bg-accent/15 text-accent" : "text-dim hover:text-chalk"
                    }`}
                  >
                    CFB
                  </Link>
                )}
                {active.leagues.includes("nfl") && (
                  <Link
                    href={`/groups/${slug}/settings?league=nfl`}
                    aria-current={league === "nfl" ? "page" : undefined}
                    className={`stat flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold ${
                      league === "nfl" ? "bg-accent/15 text-accent" : "text-dim hover:text-chalk"
                    }`}
                  >
                    NFL
                  </Link>
                )}
              </nav>
            )}
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm text-accent">{weekLabel(ref, league)}</h2>
              <nav className="scroll-thin -mx-1 flex max-w-full gap-1 overflow-x-auto px-1">
                {/* Each league's own board weeks, in playing order: the regular
                    season (CFB stops at 16 — audit 08/UX-17 — the NFL runs to
                    18) and then the postseason rounds. The preseason is absent
                    because no board can be set for it. */}
                {weeks.map((w) => (
                  <Link
                    key={`${w.seasonType}-${w.week}`}
                    href={`/groups/${slug}/settings${weekQuery(w, { league: league === "nfl" ? "nfl" : null })}`}
                    aria-current={sameWeek(w, ref) ? "page" : undefined}
                    aria-label={weekLabel(w, league)}
                    className={`stat flex min-h-11 shrink-0 items-center justify-center rounded-md px-2 text-xs ${
                      sameWeek(w, ref) ? "bg-accent/15 text-accent" : "text-dim hover:text-chalk"
                    } ${w.seasonType === "regular" ? "w-9" : ""}`}
                  >
                    {w.seasonType === "regular" ? w.week : shortWeekLabel(w, league)}
                  </Link>
                ))}
              </nav>
            </div>
            <WeekConfigForm
              groupId={active.id}
              seasonId={seasonId}
              week={week}
              seasonType={seasonType}
              games={configGames}
              conferences={conferences}
              locked={groupWeek?.locked ?? false}
              initial={
                groupWeek
                  ? {
                      mode: groupWeek.selectionMode,
                      conference: groupWeek.conference,
                      markets: groupWeek.markets,
                      gameIds: groupWeek.gameIds,
                      minPicks: groupWeek.minPicks,
                    }
                  : null
              }
            />
          </section>
        )}

        <section className="card mb-4 px-4 py-4">
          <h2 className="mb-3 text-sm text-accent">Members</h2>
          <RosterAdmin
            groupId={active.id}
            members={members}
            viewerId={user.id}
            viewerIsAdmin={active.role === "admin"}
          />
        </section>

        {joinCode && (
          <section className="card px-4 py-4">
            <h2 className="mb-3 text-sm text-accent">The group</h2>
            <GroupAdmin
              groupId={active.id}
              name={active.name}
              visibility={active.visibility}
              hidePicks={active.picksHiddenUntilKickoff}
              leagues={active.leagues}
              joinCode={joinCode}
            />
          </section>
        )}
      </main>
    </>
  );
}
