import { Crown, Settings, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppNav } from "../../../components/AppNav";
import { BettingHome } from "./BettingHome";
import { SurvivorHome } from "./SurvivorHome";
import { GroupArcade } from "../../../components/games/GroupArcade";
import { GroupSwitcher, JoinCode } from "../../../components/group/GroupForms";
import { GroupRoster } from "../../../components/group/GroupRoster";
import { MemberCard, WeekHero } from "../../../components/group/GroupHub";
import type { PickRow } from "../../../lib/db-types";
import { buildGroupShareContext, type MyWeekPick } from "../../../lib/group-share";
import {
  fetchGroupMembers,
  groupLeague,
  hasPricedMarket,
  fetchGroupWeek,
  resolveActiveGroup,
} from "../../../lib/groups";
import {
  parseWeekRef,
  seasonWeeks,
  stQuery,
  weekLabel,
  weekQuery,
  type WeekRef,
} from "../../../lib/group-weeks";
import { seasonIdsForYear, seasonYearOf, sportOfSeasonId } from "../../../lib/league";
import { fetchSurvivorPool } from "../../../lib/survivor-data";
import { fetchCurrentSeasonWeek, fetchSlateView } from "../../../lib/queries";
import { byLeagueRules, EMPTY_TALLY, tallyBy } from "../../../lib/records";
import { pickableSlots } from "../../../lib/slate";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: slug };
}

/**
 * A group's home: the hub, not the board.
 *
 * This page used to be both — standings on top, then the pick controls for
 * every game, then nothing. That made the one thing you came to do (get this
 * week's picks in) something you scrolled past a table to reach, and it made
 * the group itself — who's in it, who's winning, who runs it — a header line.
 *
 * So the picking moved to `/groups/[slug]/picks` and this page answers the
 * three questions a hub is for: what do I owe this week, where do I stand, and
 * (if it's mine) how do I run it.
 */
export default async function GroupHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ week?: string; st?: string; league?: string; for?: string }>;
}) {
  const { slug } = await params;
  const { week: weekParam, st: stRaw, league: leagueParam, for: forParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { active, mine } = await resolveActiveGroup(supabase, user?.id ?? null, slug);
  // RLS hides a private group from a non-member, so "not found" and "not yours"
  // are deliberately the same answer.
  if (!active || active.slug !== slug) notFound();

  /* A both-league group holds one board per league per week (separate
     group_week_config rows under separate season ids); ?league= says which is
     in view. A survivor pool carries its single league in the same column, so
     it resolves the same way. A betting group always resolves CFB — its home
     reads both leagues' ledgers regardless. */
  const league = groupLeague(
    leagueParam,
    active.kind === "betting" ? ["cfb"] : active.leagues,
  );
  const {
    seasonId,
    week: currentWeek,
    seasonType: currentType,
    minWeek,
  } = await fetchCurrentSeasonWeek(supabase, league);

  /* The week in view, season type included.
     This used to be `?week=` alone with the season type inherited from the live
     calendar pointer, which in August means `preseason` — so a group page in
     mid-August called NFL preseason week 2 "Week 2", every week link stayed
     inside the preseason, and the regular season was unreachable. See
     lib/group-weeks.ts. */
  const weeks = seasonWeeks(league, minWeek);
  const currentRef: WeekRef = { seasonType: currentType, week: currentWeek };
  const ref = parseWeekRef(weekParam, stRaw, weeks, currentRef);
  const { week, seasonType } = ref;

  // Three kinds of group, three entirely different homes. A survivor pool and a
  // betting group both branch before any of the pick'em queries below run —
  // neither has a board, a minimum, or a row in `picks`.
  if (active.kind === "survivor") {
    const pool = await fetchSurvivorPool(supabase, active.id);
    // A survivor group with no pool row cannot happen through
    // `create_survivor_group`, which writes both in one transaction. If it
    // somehow does, the hub is the honest answer, not a crash.
    if (pool) {
      return (
        <>
          <AppNav />
          <SurvivorHome
            supabase={supabase}
            group={active}
            pool={pool}
            mine={mine}
            userId={user?.id ?? null}
            weekRef={ref}
            weeks={weeks}
            forParam={forParam ?? null}
          />
        </>
      );
    }
  }

  if (active.kind === "betting") {
    return (
      <>
        <AppNav />
        <BettingHome
          supabase={supabase}
          group={active}
          mine={mine}
          userId={user?.id ?? null}
          seasonId={seasonId}
          week={week}
          seasonType={seasonType}
          weeks={weeks}
          weekRef={ref}
        />
      </>
    );
  }

  const [groupWeek, members, slate, joinRes, seasonPicksRes, lifetimeRes] = await Promise.all([
    fetchGroupWeek(supabase, active.id, seasonId, week, seasonType),
    fetchGroupMembers(supabase, active.id),
    fetchSlateView(supabase, seasonId, week, user?.id ?? null, seasonType, active.id),
    active.role === "admin"
      ? supabase.from("groups").select("join_code").eq("id", active.id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("picks")
      // Standings span the group's leagues: this year's CFB and NFL picks
      // both count, and the split below says who is doing better where.
      .select("user_id, season_id, result, units, clv")
      .eq("group_id", active.id)
      .in("season_id", seasonIdsForYear(seasonYearOf(seasonId))),
    // Lifetime spans seasons — a group has no season_id precisely so this
    // question stays answerable across them.
    user
      ? supabase
          .from("picks")
          .select("result, units, clv")
          .eq("group_id", active.id)
          .eq("user_id", user.id)
      : Promise.resolve({ data: [] }),
  ]);

  const inPlay = new Set(groupWeek?.gameIds ?? []);
  const boardGames = slate.games.filter((g) => inPlay.has(g.id));
  const gameById = new Map(slate.games.map((g) => [g.id, g]));

  // 09:P-10. This read the whole crew's picks on every board game with
  // `select("*")` and then threw all but one member's away — `weekPicks`
  // existed only to be filtered to `myWeekPicks` on the very next line. It is
  // now scoped to the viewer and to the seven columns the share context reads
  // (four it touches directly, three more that `tally` reads for the day and
  // week records — the type caught those, a grep for `p.` did not).
  //
  // On a full-slate board that is the difference between "every member × every
  // game × every column" and "my picks, five columns": the Week 1 NFL board
  // resolves to 91 games (DB-7), so the old shape grew with the crew as well as
  // with the slate.
  //
  // Still sequential, and unavoidably so — it filters on the board, which is
  // only known once `fetchGroupWeek` and `fetchSlateView` have both answered.
  const { data: weekPickRows } =
    user && boardGames.length > 0
      ? await supabase
          .from("picks")
          .select("game_id, line_at_pick, market, side, result, units, clv")
          .eq("group_id", active.id)
          .eq("user_id", user.id)
          .in(
            "game_id",
            boardGames.map((g) => g.id),
          )
      : { data: [] };
  const myWeekPicks = (weekPickRows ?? []) as MyWeekPick[];

  const shareContext = user
    ? buildGroupShareContext({
        groupName: active.name,
        userName: members.find((m) => m.userId === user.id)?.name ?? "Me",
        week,
        myWeekPicks,
        gameById,
        lifetime: (lifetimeRes.data ?? []) as Array<Pick<PickRow, "result" | "units" | "clv">>,
      })
    : null;

  const seasonPicks = (seasonPicksRes.data ?? []) as Array<
    Pick<PickRow, "user_id" | "season_id" | "result" | "units" | "clv">
  >;
  const tallies = tallyBy(seasonPicks, (p) => p.user_id);
  // Who's doing better where — only computed for a group that plays both.
  const splitTallies =
    active.leagues.length > 1
      ? tallyBy(seasonPicks, (p) => `${p.user_id}|${sportOfSeasonId(p.season_id)}`)
      : null;
  const standings = members
    .map((m) => ({
      ...m,
      ...(tallies.get(m.userId) ?? EMPTY_TALLY),
      split: splitTallies
        ? {
            cfb: splitTallies.get(`${m.userId}|cfb`) ?? EMPTY_TALLY,
            nfl: splitTallies.get(`${m.userId}|nfl`) ?? EMPTY_TALLY,
          }
        : null,
    }))
    .sort(byLeagueRules);

  const joinCode = (joinRes.data as { join_code: string } | null)?.join_code ?? null;

  // Straight-up takes no number, so a winners-only week grades no units, no ROI
  // and no CLV. Those columns are inapplicable rather than empty, and a column
  // of dashes is a question the reader has to answer.
  const priced = groupWeek === null || hasPricedMarket(groupWeek.markets);
  const myPickCount = myWeekPicks.length;
  const minPicks = groupWeek?.minPicks ?? 0;

  const upcoming = boardGames
    .map((g) => g.startTs)
    .filter((ts): ts is string => ts !== null)
    .sort();
  const firstKick = upcoming.find((ts) => new Date(ts) > new Date()) ?? null;

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <GroupSwitcher groups={mine} activeSlug={slug} />

        <div className="mt-3 mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl">{active.name}</h1>
          <p className="stat flex items-center gap-1.5 text-xs text-chalk/50">
            <Users size={12} aria-hidden />
            {/* The count was a dead end — it said how many and never who. */}
            <a href="#members" className="hover:text-chalk hover:underline">
              {members.length} {members.length === 1 ? "member" : "members"}
            </a>
            {active.visibility === "public" ? " · public" : " · members only"}
          </p>
        </div>

        {active.leagues.length > 1 && (
          <nav aria-label="League" className="mb-3 flex items-center gap-1">
            {(
              [
                ["cfb", `/groups/${slug}`],
                ["nfl", `/groups/${slug}?league=nfl`],
              ] as const
            ).map(([l, href]) => (
              <Link
                key={l}
                href={href}
                aria-current={league === l ? "page" : undefined}
                className={`stat flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold ${
                  league === l ? "bg-accent/15 text-accent" : "text-dim hover:text-chalk"
                }`}
              >
                {l.toUpperCase()}
              </Link>
            ))}
          </nav>
        )}

        <WeekHero
          slug={slug}
          weekRef={ref}
          weeks={weeks}
          currentRef={currentRef}
          groupWeek={groupWeek}
          gameCount={boardGames.length}
          pickSlots={pickableSlots(boardGames, groupWeek?.markets ?? [])}
          myPickCount={myPickCount}
          minPicks={minPicks}
          firstKick={firstKick}
          isAdmin={active.role === "admin"}
          signedIn={!!user}
          share={shareContext}
          league={league}
        />

        {/* ---- standings ---- */}
        <section className="mt-6" aria-labelledby="standings-heading">
          <div className="mb-2.5 flex items-baseline gap-2">
            <h2 id="standings-heading" className="text-sm text-accent">
              Season standings
            </h2>
            <span className="h-px flex-1 bg-chalk/10" aria-hidden />
            <Link
              href={`/groups/${slug}/week/${week}?view=person${stQuery(ref)}${league === "nfl" ? "&league=nfl" : ""}`}
              className="stat text-[11px] text-dim hover:text-chalk"
            >
              Everyone&rsquo;s picks →
            </Link>
          </div>
          <ul className="flex flex-col gap-2">
            {standings.map((r, i) => (
              <MemberCard
                key={r.userId}
                place={i + 1}
                name={r.name}
                isAdmin={r.role === "admin"}
                isMe={r.userId === user?.id}
                tally={r}
                priced={priced}
                split={r.split}
              />
            ))}
          </ul>
        </section>

        <GroupRoster
          members={members}
          viewerId={user?.id ?? null}
          slug={slug}
          isAdmin={active.role === "admin"}
        />

        {/* ---- the arcade ---- */}
        <GroupArcade
          supabase={supabase}
          groupId={active.id}
          groupName={active.name}
          slug={slug}
          userId={user?.id ?? null}
          members={members}
        />

        {/* ---- admin ---- */}
        {active.role === "admin" && (
          <section className="mt-7" aria-labelledby="admin-heading">
            <div className="mb-2.5 flex items-baseline gap-2">
              <h2 id="admin-heading" className="flex items-center gap-1.5 text-sm text-accent">
                <Crown size={13} aria-hidden />
                Admin
              </h2>
              <span className="h-px flex-1 bg-chalk/10" aria-hidden />
              <span className="stat text-[11px] text-dim">only you see this</span>
            </div>
            <div className="card p-3.5">
              <p className="mb-3 text-xs leading-relaxed text-dim">
                You choose which games are in play and which bet types count, week by week. The
                format locks itself when the week&rsquo;s first game kicks off.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/groups/${slug}/settings${weekQuery(ref, { league: league === "nfl" ? "nfl" : null })}`}
                  className="stat inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-semibold text-accent-ink"
                >
                  <Settings size={14} aria-hidden />
                  Set {weekLabel(ref, league).toLowerCase()}
                </Link>
                <Link
                  href={`/groups/${slug}/settings${weekQuery(ref, { league: league === "nfl" ? "nfl" : null })}`}
                  className="stat inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-chalk/20 px-3.5 text-sm text-chalk hover:border-chalk/50"
                >
                  <Users size={14} aria-hidden />
                  Members
                </Link>
                {joinCode && <JoinCode code={joinCode} />}
              </div>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
