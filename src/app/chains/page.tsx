import { cookies } from "next/headers";
import Link from "next/link";
import { AppNav } from "../../components/AppNav";
import { ChainsPlay } from "../../components/ChainsPlay";
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

export const metadata = { title: "Chains" };

/**
 * Chains (CHAIN-2): a daily run of higher-or-lower over the archive.
 *
 * The deck lives behind /api/chains — `chains_cards` carries both compared
 * values and the answer, and it has no select policy at all. This page owns
 * the shell, the crests, and the board.
 *
 * Crest art is fetched for the whole day's deck rather than per card, because
 * fetching it per card would tell the client how many cards there are and
 * which teams are still to come. A team id is not an answer, and the deck's
 * teams are the least of what the route is protecting — but the request
 * pattern would be.
 */
export default async function ChainsPage({
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

  /* Crests for whichever teams the day's cards name. `chains_cards` is not
     readable from here, so this goes through the teams the day's PUZZLE row
     implies — which is why the deck stores a team id per side rather than the
     page re-deriving one. */
  let crests: Record<
    number,
    { school: string; abbr: string; color: string | null; logo: string | null }
  > = {};
  const { data: puzzle } = await supabase
    .from("chains_puzzles")
    .select("day")
    .eq("day", day)
    .maybeSingle();
  if (puzzle && user) {
    const { data: teams } = await supabase
      .from("teams")
      .select("id, school, abbreviation, color, logo_url")
      .eq("sport", "cfb");
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
    ? await Promise.all([supabase.rpc("chains_leaderboard"), scopeRoster(supabase, scope)])
    : [{ data: [] }, { userIds: null, nameById: new Map<string, string>() }];
  const { userIds, nameById } = roster;
  const board = ((boardRows ?? []) as Array<{
    user_id: string;
    played: number;
    best: number;
    total: number;
    cleared: number;
  }>)
    .filter((r) => userIds === null || userIds.includes(r.user_id))
    .map((r) => ({ name: nameById.get(r.user_id) ?? "?", ...r }))
    .sort((a, b) => b.total - a.total || b.best - a.best);

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h1 className="text-2xl">Chains</h1>
          <Link href="/games" className="stat text-xs text-dim hover:text-chalk">
            ← Games
          </Link>
        </div>
        <p className="mb-4 text-sm text-dim">
          Two games, one question, every day. Call it right and the chains move. Call it wrong and
          the drive is over.
        </p>

        {user ? (
          <ChainsPlay crests={crests} />
        ) : (
          <div className="card px-6 py-12 text-center">
            <p className="display text-lg text-chalk/80">Today&rsquo;s run is waiting</p>
            <p className="mt-1 text-sm text-dim">
              <Link href="/login" className="text-accent underline-offset-2 hover:underline">
                Sign in
              </Link>{" "}
              to play — same cards, same order, for everyone.
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
                    {b.total} links · best {b.best}
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
              A different deck, unscored. Nothing here touches your record or the board.
            </p>
            <ChainsPlay crests={{}} practice />
          </section>
        )}
      </main>
    </>
  );
}
