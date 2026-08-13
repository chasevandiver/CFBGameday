import { Crown, Settings, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppNav } from "../../../components/AppNav";
import { BettingHome } from "./BettingHome";
import { GroupSwitcher, JoinCode } from "../../../components/group/GroupForms";
import { MemberCard, WeekHero } from "../../../components/group/GroupHub";
import type { PickRow } from "../../../lib/db-types";
import { buildGroupShareContext } from "../../../lib/group-share";
import {
  fetchGroupMembers,
  groupLeague,
  hasPricedMarket,
  fetchGroupWeek,
  resolveActiveGroup,
} from "../../../lib/groups";
import { seasonIdsForYear, seasonYearOf, sportOfSeasonId } from "../../../lib/league";
import { fetchCurrentSeasonWeek, fetchSlateView } from "../../../lib/queries";
import { byLeagueRules, EMPTY_TALLY, tallyBy } from "../../../lib/records";
import { pickableSlots } from "../../../lib/slate";
import { createClient } from "../../../lib/supabase/server";
import { isValidWeek } from "../../../lib/week-range";

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
  searchParams: Promise<{ week?: string; league?: string }>;
}) {
  const { slug } = await params;
  const { week: weekParam, league: leagueParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { active, mine } = await resolveActiveGroup(supabase, user?.id ?? null, slug);
  // RLS hides a private group from a non-member, so "not found" and "not yours"
  // are deliberately the same answer.
  if (!active || active.slug !== slug) notFound();

  // A both-league group holds one board per league per week (they are separate
  // group_week_config rows under separate season ids); ?league= says which is
  // in view. Betting groups always resolve CFB here — their home reads both.
  const league = groupLeague(leagueParam, active.kind === "betting" ? ["cfb"] : active.leagues);
  const { seasonId, week: currentWeek, seasonType } = await fetchCurrentSeasonWeek(
    supabase,
    league,
  );
  const parsed = Number(weekParam);
  const week = isValidWeek(parsed) ? parsed : currentWeek;

  // Two kinds of group, two entirely different homes. A betting group has no
  // board to configure, no picks and no minimum — it reads its members'
  // ledgers — so it branches before any of the pick'em queries below run.
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

  const { data: weekPickRows } = await supabase
    .from("picks")
    .select("*")
    .eq("group_id", active.id)
    .in("game_id", boardGames.length > 0 ? boardGames.map((g) => g.id) : [-1]);
  const weekPicks = (weekPickRows ?? []) as PickRow[];
  const myWeekPicks = weekPicks.filter((p) => p.user_id === user?.id);

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
            {members.length} {members.length === 1 ? "member" : "members"}
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
          week={week}
          currentWeek={currentWeek}
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
              href={`/groups/${slug}/week/${week}?view=person`}
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
                  href={`/groups/${slug}/settings?week=${week}`}
                  className="stat inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-semibold text-accent-ink"
                >
                  <Settings size={14} aria-hidden />
                  Set week {week}
                </Link>
                <Link
                  href={`/groups/${slug}/settings?week=${week}`}
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
