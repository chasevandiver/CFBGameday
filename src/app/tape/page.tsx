import { cookies } from "next/headers";
import Link from "next/link";
import { AppNav } from "../../components/AppNav";
import { GamesScopePicker } from "../../components/games/GamesScopePicker";
import { TapePlay } from "../../components/TapePlay";
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

export const metadata = { title: "The Tape" };

/**
 * The Tape (TAPE-2): one game from the archive a day, named up front, then
 * five questions about it.
 *
 * The play runs through /api/tape, because `tape_questions` is the answer key
 * and carries no select policy — this page cannot read it and neither can the
 * client. What the page owns is the shell, the crest art for the fixture, and
 * the board.
 *
 * The crests are fetched here rather than in the route so the route's payload
 * stays about the round. It is not a spoiler: the fixture is named on the first
 * frame, which is the entire hook.
 */
export default async function TapePage({
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

  /* The day's two teams, for their crests. `tape_puzzles` is readable once the
     day has arrived (the policy converts to America/Chicago explicitly — see
     0068; `current_date` would be UTC and would hand out tomorrow's fixture
     for six hours every night). */
  const { data: puzzle } = await supabase
    .from("tape_puzzles")
    .select("game_id")
    .eq("day", day)
    .maybeSingle();

  let crests: Record<
    number,
    { school: string; abbr: string; color: string | null; logo: string | null }
  > = {};
  if (puzzle) {
    const { data: game } = await supabase
      .from("games")
      .select("home_team_id, away_team_id")
      .eq("id", (puzzle as { game_id: number }).game_id)
      .maybeSingle();
    if (game) {
      const { data: teams } = await supabase
        .from("teams")
        .select("id, school, abbreviation, color, logo_url")
        .in("id", [game.home_team_id, game.away_team_id]);
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
  }

  /* The board is the RPC's aggregates (0068) filtered to the pool in view —
     the same shape and the same reasoning as Guess the Game's: a `p_group`
     argument on a security-definer function is a leak without a membership
     gate and a new signature plus grants plus tests with one. */
  const [{ data: boardRows }, roster] = user
    ? await Promise.all([supabase.rpc("tape_leaderboard"), scopeRoster(supabase, scope)])
    : [{ data: [] }, { userIds: null, nameById: new Map<string, string>() }];
  const { userIds, nameById } = roster;
  const board = ((boardRows ?? []) as Array<{
    user_id: string;
    played: number;
    correct: number;
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
          <h1 className="text-2xl">The Tape</h1>
          <Link href="/games" className="stat text-xs text-dim hover:text-chalk">
            ← Games
          </Link>
        </div>
        <p className="mb-4 text-sm text-dim">
          One game from the archive, every day. We tell you which one — you tell us what happened.
          Five questions, no going back.
        </p>

        {user ? (
          <TapePlay crests={crests} />
        ) : (
          <div className="card px-6 py-12 text-center">
            <p className="display text-lg text-chalk/80">Today&rsquo;s round is waiting</p>
            <p className="mt-1 text-sm text-dim">
              <Link href="/login" className="text-accent underline-offset-2 hover:underline">
                Sign in
              </Link>{" "}
              to play — same five questions for everyone.
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
                    {b.points} pts · {b.clean} clean of {b.played}
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
              Another game from the archive, unscored. Nothing here touches your record or the board.
            </p>
            <TapePlay crests={{}} practice />
          </section>
        )}
      </main>
    </>
  );
}
