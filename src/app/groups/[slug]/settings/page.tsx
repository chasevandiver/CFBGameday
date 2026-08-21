import Link from "next/link";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppNav } from "../../../../components/AppNav";
import { GroupAdmin } from "../../../../components/group/GroupAdmin";
import { RosterAdmin } from "../../../../components/group/RosterAdmin";
import { WeekConfigForm, type ConfigGame } from "../../../../components/group/WeekConfigForm";
import type { PickRow } from "../../../../lib/db-types";
import {
  fetchGroupMembers,
  fetchGroupWeek,
  groupLeague,
  resolveActiveGroup,
  type GroupSummary,
  type GroupWeek,
} from "../../../../lib/groups";
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
  type WeekRef,
} from "../../../../lib/group-weeks";

export const dynamic = "force-dynamic";

export const metadata = { title: "Group settings" };

interface Board {
  league: "cfb" | "nfl";
  seasonId: number;
  ref: WeekRef;
  weeks: WeekRef[];
  games: ConfigGame[];
  conferences: string[];
  week: GroupWeek | null;
}

/**
 * Everything the board section needs, and nothing anyone else does.
 *
 * Split out because two of the three group kinds have no board at all: a
 * betting group reads its members' ledgers and a survivor pool has one pick a
 * week, so the slate query, the pick counts and the week calendar below are
 * pick'em's alone. Loading them for a betting group was the reason this page
 * used to redirect rather than render.
 */
async function loadBoard(
  supabase: SupabaseClient,
  active: GroupSummary,
  userId: string,
  q: { week?: string; st?: string; league?: string },
): Promise<Board> {
  // Each league runs its own week calendar; ?league= picks which board is
  // being configured, and only leagues the group plays are reachable.
  const league = groupLeague(q.league, active.leagues);
  const { seasonId, week: currentWeek, seasonType: currentType, minWeek } =
    await fetchCurrentSeasonWeek(supabase, league);

  /* Only the weeks a board can exist for. `set_group_week_config` refuses
     `preseason` outright, so offering those weeks here is offering a control
     that throws — and in August the live pointer IS a preseason week, which is
     how an admin ended up on a page that could not save anything. The default
     falls forward to the season opener instead. */
  const weeks = seasonWeeks(league, minWeek).filter(boardRunsIn);
  const fallback = boardRunsIn({ seasonType: currentType, week: currentWeek })
    ? { seasonType: currentType, week: currentWeek }
    : (firstRegular(weeks) ?? weeks[0]);
  const ref = parseWeekRef(q.week, q.st, weeks, fallback);
  const { week, seasonType } = ref;

  // The same slate the board renders, so the admin picks games from rows that
  // look like the rows their members will see — logos, poll ranks and records
  // included, rather than a list of abbreviation pairs.
  const [groupWeek, slate] = await Promise.all([
    fetchGroupWeek(supabase, active.id, seasonId, week, seasonType),
    fetchSlateView(supabase, seasonId, week, userId, seasonType, active.id),
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

  const games: ConfigGame[] = weekGames.map((g) => {
    const kick = g.startTs ? kickParts(g.startTs, DEFAULT_TZ) : null;
    return {
      id: g.id,
      label: `${g.away.school} at ${g.home.school}`,
      away: g.away,
      home: g.home,
      kick: kick ? `${kick.day} ${kick.time} ${tzLabel(DEFAULT_TZ)}` : "TBD",
      conferences: [g.home.conference, g.away.conference].filter((c): c is string => !!c),
      pickCount: pickCounts.get(g.id) ?? 0,
      // The consensus the slate renders, not a book's own number — same source,
      // so the admin's view of "is this competitive" matches what the members
      // will see on the board.
      spread: g.lines.spread,
      total: g.lines.total,
    };
  });

  return {
    league,
    seasonId,
    ref,
    weeks,
    games,
    conferences: [...new Set(games.flatMap((g) => g.conferences))].sort(),
    week: groupWeek,
  };
}

/**
 * Where the admin builds the week: which games are in play, which bet types
 * members may pick, and who is in the group.
 *
 * All three kinds of group land here, not just pick'em. The board section is
 * pick'em's and renders for nobody else, but the roster, the name, the join
 * code and archiving belong to every group — and a betting group's admin had
 * no page for any of them until this stopped redirecting.
 */
export default async function GroupSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ week?: string; st?: string; league?: string }>;
}) {
  const { slug } = await params;
  const q = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { active } = await resolveActiveGroup(supabase, user.id, slug);
  if (!active || active.slug !== slug) notFound();

  const isAdmin = active.role === "admin";
  const [members, joinRes, board] = await Promise.all([
    fetchGroupMembers(supabase, active.id),
    isAdmin
      ? supabase.from("groups").select("join_code").eq("id", active.id).maybeSingle()
      : Promise.resolve({ data: null }),
    isAdmin && active.kind === "pickem"
      ? loadBoard(supabase, active, user.id, q)
      : Promise.resolve(null),
  ]);

  const joinCode = (joinRes.data as { join_code: string } | null)?.join_code ?? null;

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl">{active.name}</h1>
          <Link href={`/groups/${slug}`} className="stat text-xs text-accent hover:underline">
            {active.kind === "pickem" ? "Board →" : "Group →"}
          </Link>
        </div>
        <p className="mb-5 text-sm text-dim">
          {isAdmin
            ? "You run this group."
            : active.kind === "pickem"
              ? "Only an admin can change the week."
              : "Only an admin can change the group."}
        </p>

        {board && (
          <section className="card mb-4 px-4 py-4">
            {active.leagues.length > 1 && (
              <nav aria-label="League" className="mb-3 flex items-center gap-1">
                {active.leagues.includes("cfb") && (
                  <Link
                    href={`/groups/${slug}/settings`}
                    aria-current={board.league === "cfb" ? "page" : undefined}
                    className={`stat flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold ${
                      board.league === "cfb"
                        ? "bg-accent/15 text-accent"
                        : "text-dim hover:text-chalk"
                    }`}
                  >
                    CFB
                  </Link>
                )}
                {active.leagues.includes("nfl") && (
                  <Link
                    href={`/groups/${slug}/settings?league=nfl`}
                    aria-current={board.league === "nfl" ? "page" : undefined}
                    className={`stat flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold ${
                      board.league === "nfl"
                        ? "bg-accent/15 text-accent"
                        : "text-dim hover:text-chalk"
                    }`}
                  >
                    NFL
                  </Link>
                )}
              </nav>
            )}
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm text-accent">{weekLabel(board.ref, board.league)}</h2>
              <nav className="scroll-thin -mx-1 flex max-w-full gap-1 overflow-x-auto px-1">
                {/* Each league's own board weeks, in playing order: the regular
                    season (CFB stops at 16 — audit 08/UX-17 — the NFL runs to
                    18) and then the postseason rounds. The preseason is absent
                    because no board can be set for it. */}
                {board.weeks.map((w) => (
                  <Link
                    key={`${w.seasonType}-${w.week}`}
                    href={`/groups/${slug}/settings${weekQuery(w, { league: board.league === "nfl" ? "nfl" : null })}`}
                    aria-current={sameWeek(w, board.ref) ? "page" : undefined}
                    aria-label={weekLabel(w, board.league)}
                    className={`stat flex min-h-11 shrink-0 items-center justify-center rounded-md px-2 text-xs ${
                      sameWeek(w, board.ref) ? "bg-accent/15 text-accent" : "text-dim hover:text-chalk"
                    } ${w.seasonType === "regular" ? "w-9" : ""}`}
                  >
                    {w.seasonType === "regular" ? w.week : shortWeekLabel(w, board.league)}
                  </Link>
                ))}
              </nav>
            </div>
            <WeekConfigForm
              groupId={active.id}
              seasonId={board.seasonId}
              week={board.ref.week}
              seasonType={board.ref.seasonType}
              games={board.games}
              conferences={board.conferences}
              locked={board.week?.locked ?? false}
              initial={
                board.week
                  ? {
                      mode: board.week.selectionMode,
                      conference: board.week.conference,
                      markets: board.week.markets,
                      gameIds: board.week.gameIds,
                      minPicks: board.week.minPicks,
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
            viewerIsAdmin={isAdmin}
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
              kind={active.kind}
              leagues={active.leagues}
              joinCode={joinCode}
            />
          </section>
        )}
      </main>
    </>
  );
}
