import { cookies } from "next/headers";
import Link from "next/link";
import { AppNav } from "../../components/AppNav";
import { DepthChartPlay } from "../../components/DepthChartPlay";
import { GamesScopePicker } from "../../components/games/GamesScopePicker";
import {
  GAMES_SCOPE_COOKIE,
  resolveGameScope,
  scopeLabel,
  scopeParam,
  scopeRoster,
} from "../../lib/games-scope";
import { ACTIVE_GROUP_COOKIE, fetchMyGroups } from "../../lib/groups";
import { productDate } from "../../lib/streak";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Depth Chart" };

/**
 * Depth Chart (DC-2): sixteen teams, four hidden groups of four.
 *
 * The tiles are read here rather than through the route, because they are not
 * the answer — sixteen school names narrow nothing, and the board has to render
 * before the first guess. `dc_puzzle_groups` is the answer and is unreadable
 * from anywhere but /api/depth-chart.
 */
export default async function DepthChartPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string }>;
}) {
  const { g: groupParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const jar = await cookies();
  const remembered =
    jar.get(GAMES_SCOPE_COOKIE)?.value ?? jar.get(ACTIVE_GROUP_COOKIE)?.value ?? null;
  const myGroups = await fetchMyGroups(supabase, user?.id ?? null);
  const scope = resolveGameScope(myGroups, groupParam ?? null, remembered);
  const day = productDate(new Date());

  const { data: tileRows } = await supabase
    .from("dc_puzzle_tiles")
    .select("team_id")
    .eq("day", day);
  const tileIds = ((tileRows ?? []) as Array<{ team_id: number }>).map((t) => t.team_id);

  let crests: Record<
    number,
    { school: string; abbr: string; color: string | null; logo: string | null }
  > = {};
  if (tileIds.length > 0) {
    const { data: teams } = await supabase
      .from("teams")
      .select("id, school, abbreviation, color, logo_url")
      .in("id", tileIds);
    crests = Object.fromEntries(
      ((teams ?? []) as Array<{
        id: number;
        school: string;
        abbreviation: string | null;
        color: string | null;
        logo_url: string | null;
      }>).map((t) => [
        t.id,
        { school: t.school, abbr: t.abbreviation ?? "", color: t.color, logo: t.logo_url },
      ]),
    );
  }

  const [{ data: boardRows }, roster] = user
    ? await Promise.all([supabase.rpc("dc_leaderboard"), scopeRoster(supabase, scope)])
    : [{ data: [] }, { userIds: null, nameById: new Map<string, string>() }];
  const { userIds, nameById } = roster;
  const board = ((boardRows ?? []) as Array<{
    user_id: string;
    played: number;
    solved: number;
    clean: number;
    points: number;
  }>)
    .filter((r) => userIds === null || userIds.includes(r.user_id))
    .map((r) => ({ name: nameById.get(r.user_id) ?? "?", ...r }))
    .sort((a, b) => b.points - a.points || b.clean - a.clean);

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h1 className="text-2xl">Depth Chart</h1>
          <Link href="/games" className="stat text-xs text-dim hover:text-chalk">
            ← Games
          </Link>
        </div>
        <p className="mb-4 text-sm text-dim">
          Sixteen teams, four things they have in common. Find all four groups — you get four
          mistakes.
        </p>

        {user ? (
          <DepthChartPlay crests={crests} />
        ) : (
          <div className="card px-6 py-12 text-center">
            <p className="display text-lg text-chalk/80">Today&rsquo;s board is waiting</p>
            <p className="mt-1 text-sm text-dim">
              <Link href="/login" className="text-accent underline-offset-2 hover:underline">
                Sign in
              </Link>{" "}
              to play — same sixteen for everyone.
            </p>
          </div>
        )}

        {user && (
          <section className="card mt-4 p-4">
            <GamesScopePicker
              groups={myGroups.map((m) => ({ slug: m.slug, name: m.name }))}
              activeParam={scopeParam(scope)}
            />
            <h2 className="mb-2 text-sm text-accent">The board — {scopeLabel(scope)}</h2>
            {board.length === 0 && (
              <p className="text-sm text-dim">
                {scope.kind === "group"
                  ? `Nobody in ${scope.group.name} has played yet.`
                  : "Nobody has played yet."}
              </p>
            )}
            <ul className="flex flex-col gap-1">
              {board.map((b, i) => (
                <li key={b.user_id} className="stat flex items-center justify-between text-sm">
                  <span className="font-sans text-chalk">
                    {i + 1}. {b.name}
                  </span>
                  <span className="text-dim">
                    {b.points} pts · {b.clean} perfect of {b.played}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* PRAC-1. Same component as above with `practice`, so practice cannot
            drift into practising a slightly different game — and the practice
            route has no write path at all, which is what makes "nothing
            recorded" a property of the code rather than a claim here. */}
        {user && (
          <section className="mt-6">
            <h2 className="mb-1 text-sm text-accent">Practice</h2>
            <p className="mb-3 text-xs text-dim">
              A different board, unscored — generated and validated exactly like the daily one.
            </p>
            <DepthChartPlay crests={{}} practice />
          </section>
        )}
      </main>
    </>
  );
}
