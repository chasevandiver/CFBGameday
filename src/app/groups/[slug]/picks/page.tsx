import Link from "next/link";
import { notFound } from "next/navigation";
import { AppNav } from "../../../../components/AppNav";
import { PickBoard, type BoardEntry } from "../../../../components/group/PickBoard";
import type { PickRow } from "../../../../lib/db-types";
import { buildGroupShareContext } from "../../../../lib/group-share";
import { fetchGroupMembers, fetchGroupWeek, resolveActiveGroup } from "../../../../lib/groups";
import { fetchCurrentSeasonWeek, fetchSlateView } from "../../../../lib/queries";
import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: `${slug} — picks` };
}

/**
 * Where picks get made: this week's board, one card per game, and a footer
 * that says how many you have in and where to go when you're done.
 *
 * Split out of the group home page so the hub can be a hub. Everything about
 * the flow here is built around making eight picks in a row on a phone —
 * instant tap feedback (see PickButtons), a running total that doesn't wait on
 * the server, and an exit that lands on the full list of what you took.
 */
export default async function GroupPicksPage({
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

  const { active } = await resolveActiveGroup(supabase, user?.id ?? null, slug);
  if (!active || active.slug !== slug) notFound();

  const { seasonId, week: currentWeek, seasonType } = await fetchCurrentSeasonWeek(supabase);
  const parsed = Number(weekParam);
  const week = Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : currentWeek;

  const [groupWeek, members, slate, lifetimeRes] = await Promise.all([
    fetchGroupWeek(supabase, active.id, seasonId, week, seasonType),
    fetchGroupMembers(supabase, active.id),
    fetchSlateView(supabase, seasonId, week, user?.id ?? null, seasonType, active.id),
    user
      ? supabase
          .from("picks")
          .select("result, units, clv")
          .eq("group_id", active.id)
          .eq("user_id", user.id)
      : Promise.resolve({ data: [] }),
  ]);

  const inPlay = new Set(groupWeek?.gameIds ?? []);
  // Kickoff order: the board is worked top to bottom on a Saturday morning,
  // and the games that lock first are the ones that need picking first.
  const boardGames = slate.games
    .filter((g) => inPlay.has(g.id))
    .sort((a, b) => (a.startTs ?? "9999").localeCompare(b.startTs ?? "9999"));
  const gameById = new Map(slate.games.map((g) => [g.id, g]));

  const { data: weekPickRows } = await supabase
    .from("picks")
    .select("*")
    .eq("group_id", active.id)
    .in("game_id", boardGames.length > 0 ? boardGames.map((g) => g.id) : [-1]);
  const weekPicks = (weekPickRows ?? []) as PickRow[];
  const myWeekPicks = weekPicks.filter((p) => p.user_id === user?.id);

  const minePerGame = new Map<number, PickRow[]>();
  for (const p of myWeekPicks) {
    minePerGame.set(p.game_id, [...(minePerGame.get(p.game_id) ?? []), p]);
  }

  const entries: BoardEntry[] = boardGames.map((game) => ({
    game,
    myPicks: (minePerGame.get(game.id) ?? []).map((p) => ({
      market: p.market,
      side: p.side,
      line_at_pick: p.line_at_pick === null ? null : Number(p.line_at_pick),
      result: p.result,
      clv: p.clv === null ? null : Number(p.clv),
    })),
    // Under the blind, RLS only returns other members' rows after kickoff, so
    // a count taken from these rows would say "1 in" and mean "you". Null,
    // which the card renders as nothing at all.
    takers: active.picksHiddenUntilKickoff
      ? null
      : weekPicks.filter((p) => p.game_id === game.id).length,
  }));

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

  return (
    <>
      <AppNav />
      {/* Bottom padding clears the fixed footer bar as well as the nav. */}
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-6">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <span className="flex items-center gap-1">
            {week > 1 && (
              <Link
                href={`/groups/${slug}/picks?week=${week - 1}`}
                aria-label={`Week ${week - 1}`}
                className="stat inline-flex min-h-11 min-w-8 items-center justify-center text-sm text-accent hover:underline"
              >
                ‹
              </Link>
            )}
            <h1 className="text-2xl">Week {week} board</h1>
            {week < 20 && (
              <Link
                href={`/groups/${slug}/picks?week=${week + 1}`}
                aria-label={`Week ${week + 1}`}
                className="stat inline-flex min-h-11 min-w-8 items-center justify-center text-sm text-accent hover:underline"
              >
                ›
              </Link>
            )}
          </span>
          <Link
            href={`/groups/${slug}`}
            className="stat -my-2 inline-flex min-h-11 items-center text-xs text-accent hover:underline"
          >
            {active.name} →
          </Link>
        </div>
        <p className="mb-5 text-sm text-dim">
          {groupWeek === null
            ? "Nothing is set for this week yet."
            : `${boardGames.length} ${boardGames.length === 1 ? "game" : "games"} in play${
                groupWeek.minPicks > 0 ? ` · ${groupWeek.minPicks} pick minimum` : ""
              }. Your pick takes the line at the moment you tap it.`}
        </p>

        {!user && groupWeek !== null && boardGames.length > 0 && (
          <p className="card mb-3 px-4 py-3 text-sm text-dim">
            <Link
              href="/login"
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              Sign in
            </Link>{" "}
            to pick — the line snapshots the moment you tap.
          </p>
        )}

        {groupWeek === null ? (
          <section className="card px-6 py-10 text-center">
            <p className="text-sm text-chalk">Week {week} isn&rsquo;t set up yet.</p>
            <p className="mt-1 text-sm text-dim">
              {active.role === "admin" ? (
                <Link
                  href={`/groups/${slug}/settings?week=${week}`}
                  className="font-medium text-accent underline-offset-2 hover:underline"
                >
                  Choose the games and bet types
                </Link>
              ) : (
                "Your admin hasn't picked the games yet."
              )}
            </p>
          </section>
        ) : boardGames.length === 0 ? (
          <section className="card px-6 py-10 text-center">
            <p className="text-sm text-dim">No games in play for week {week}.</p>
          </section>
        ) : (
          <PickBoard
            groupId={active.id}
            slug={slug}
            week={week}
            markets={groupWeek.markets}
            entries={entries}
            minPicks={groupWeek.minPicks}
            signedIn={!!user}
            shareContext={shareContext}
          />
        )}
      </main>
    </>
  );
}
