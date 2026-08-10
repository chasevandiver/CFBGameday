import Link from "next/link";
import { notFound } from "next/navigation";
import { AppNav } from "../../../../components/AppNav";
import { GroupAdmin } from "../../../../components/group/GroupAdmin";
import { RosterAdmin } from "../../../../components/group/RosterAdmin";
import { WeekConfigForm, type ConfigGame } from "../../../../components/group/WeekConfigForm";
import type { GameRow, PickRow, TeamRow } from "../../../../lib/db-types";
import { fetchGroupMembers, fetchGroupWeek, resolveActiveGroup } from "../../../../lib/groups";
import { DEFAULT_TZ, kickParts, tzLabel } from "../../../../lib/kick";
import { fetchCurrentSeasonWeek } from "../../../../lib/queries";
import { createClient } from "../../../../lib/supabase/server";

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
  searchParams: Promise<{ week?: string }>;
}) {
  const { slug } = await params;
  const { week: weekParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { active } = await resolveActiveGroup(supabase, user.id, slug);
  if (!active || active.slug !== slug) notFound();

  const { seasonId, week: currentWeek, seasonType } = await fetchCurrentSeasonWeek(supabase);
  const parsed = Number(weekParam);
  const week = Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : currentWeek;

  const [groupWeek, members, gamesRes, joinRes] = await Promise.all([
    fetchGroupWeek(supabase, active.id, seasonId, week, seasonType),
    fetchGroupMembers(supabase, active.id),
    supabase
      .from("games")
      .select("id, start_ts, home_team_id, away_team_id")
      .eq("season_id", seasonId)
      .eq("week", week)
      .eq("season_type", seasonType)
      .order("start_ts", { ascending: true, nullsFirst: false }),
    active.role === "admin"
      ? supabase.from("groups").select("join_code").eq("id", active.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const weekGames = (gamesRes.data ?? []) as Array<
    Pick<GameRow, "id" | "start_ts" | "home_team_id" | "away_team_id">
  >;
  const teamIds = [...new Set(weekGames.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const [{ data: teamRows }, { data: pickRows }] = await Promise.all([
    teamIds.length > 0
      ? supabase.from("teams").select("id, school, abbreviation, conference").in("id", teamIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from("picks")
      .select("game_id")
      .eq("group_id", active.id)
      .in("game_id", weekGames.length > 0 ? weekGames.map((g) => g.id) : [-1]),
  ]);

  const teams = new Map(
    ((teamRows ?? []) as TeamRow[]).map((t) => [
      t.id,
      { abbr: t.abbreviation ?? t.school.slice(0, 4).toUpperCase(), conference: t.conference },
    ]),
  );
  const pickCounts = new Map<number, number>();
  for (const p of (pickRows ?? []) as Array<Pick<PickRow, "game_id">>) {
    pickCounts.set(p.game_id, (pickCounts.get(p.game_id) ?? 0) + 1);
  }

  const configGames: ConfigGame[] = weekGames.map((g) => {
    const home = teams.get(g.home_team_id);
    const away = teams.get(g.away_team_id);
    const kick = g.start_ts ? kickParts(g.start_ts, DEFAULT_TZ) : null;
    return {
      id: g.id,
      label: `${away?.abbr ?? "?"} at ${home?.abbr ?? "?"}`,
      kick: kick ? `${kick.day} ${kick.time} ${tzLabel(DEFAULT_TZ)}` : "TBD",
      conferences: [home?.conference, away?.conference].filter((c): c is string => !!c),
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
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm text-accent">Week {week}</h2>
              <nav className="scroll-thin -mx-1 flex max-w-full gap-1 overflow-x-auto px-1">
                {/* 16 to match the slate's regular-season range — week 16 was
                    unreachable from the admin UI (audit 08/UX-17). */}
                {Array.from({ length: 16 }, (_, i) => i + 1).map((w) => (
                  <Link
                    key={w}
                    href={`/groups/${slug}/settings?week=${w}`}
                    aria-current={w === week ? "page" : undefined}
                    className={`stat flex min-h-11 w-9 shrink-0 items-center justify-center rounded-md text-xs ${
                      w === week ? "bg-accent/15 text-accent" : "text-dim hover:text-chalk"
                    }`}
                  >
                    {w}
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
              joinCode={joinCode}
            />
          </section>
        )}
      </main>
    </>
  );
}
