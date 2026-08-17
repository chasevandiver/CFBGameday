import { cookies } from "next/headers";
import Link from "next/link";
import { AppNav } from "../../components/AppNav";
import { GamesScopePicker } from "../../components/games/GamesScopePicker";
import { GuessGamePlay } from "../../components/GuessGamePlay";
import {
  GAMES_SCOPE_COOKIE,
  resolveGameScope,
  scopeLabel,
  scopeParam,
  scopeRoster,
} from "../../lib/games-scope";
import { ACTIVE_GROUP_COOKIE, fetchMyGroups } from "../../lib/groups";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Guess the Game" };

/**
 * The daily puzzle (R2-C3): one game from the 2023–25 backfill, same for
 * everyone, six guesses at the home team, one clue bought per miss. The play
 * itself runs through /api/guess-game so the answer never ships to the
 * client early; this page is the shell and the leaderboard.
 */
export default async function GuessGamePage({
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

  // The board is the RPC's aggregates (0059) filtered to the pool in view.
  // Filtering here rather than adding a `p_group` argument to a
  // security-definer function is deliberate — see the changelog: a group arg
  // without a membership gate is a leak, with one it is a new signature plus
  // grants plus tests for a fifteen-row board. Revisit past ~100 accounts, or
  // if this board ever shows anything beyond aggregates.
  const [{ data: boardRows }, roster] = user
    ? await Promise.all([supabase.rpc("gtg_leaderboard"), scopeRoster(supabase, scope)])
    : [{ data: [] }, { userIds: null, nameById: new Map<string, string>() }];
  const { userIds, nameById } = roster;
  const board = ((boardRows ?? []) as Array<{
    user_id: string;
    solved: number;
    points: number;
    played: number;
  }>)
    .filter((r) => userIds === null || userIds.includes(r.user_id))
    .map((r) => ({ name: nameById.get(r.user_id) ?? "?", ...r }))
    .sort((a, b) => b.points - a.points || b.solved - a.solved);

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h1 className="text-2xl">Guess the Game</h1>
          <Link href="/games" className="stat text-xs text-dim hover:text-chalk">
            ← Games
          </Link>
        </div>
        <p className="mb-4 text-sm text-dim">
          One game from the archives, every day. Six guesses at the home team; every miss buys a
          clue. Fewer guesses, more points.
        </p>

        {user && (
          <GamesScopePicker
            groups={myGroups.map((m) => ({ slug: m.slug, name: m.name }))}
            activeParam={scopeParam(scope)}
          />
        )}

        {user ? (
          <GuessGamePlay />
        ) : (
          <div className="card px-6 py-12 text-center">
            <p className="display text-lg text-chalk/80">Today&rsquo;s puzzle is waiting</p>
            <p className="mt-1 text-sm text-dim">
              <Link href="/login" className="text-accent underline-offset-2 hover:underline">
                Sign in
              </Link>{" "}
              to play — same game for everyone, no spoilers here.
            </p>
          </div>
        )}

        {user && (
          <section className="card mt-4 p-4">
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
                    {b.points} pts · {b.solved}/{b.played} solved
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
