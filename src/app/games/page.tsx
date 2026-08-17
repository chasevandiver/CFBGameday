import { cookies } from "next/headers";
import { AppNav } from "../../components/AppNav";
import { GamesHub } from "../../components/games/GamesHub";
import { fetchGamesHub } from "../../lib/games-hub";
import {
  GAMES_SCOPE_COOKIE,
  resolveGameScope,
  scopeLabel,
  scopeParam,
} from "../../lib/games-scope";
import { ACTIVE_GROUP_COOKIE, fetchMyGroups } from "../../lib/groups";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Games" };

/**
 * The Games tab (R3-E1): every game and what you owe it today.
 *
 * The loader half — reads and scope resolution only; `GamesHub` renders.
 * Scope precedence lives in `games-scope.ts` and is unit-tested there; this
 * page's only job is to hand it the three inputs. `?g=` never writes a
 * cookie (a shared link is a view, not a choice) — `setGamesScope` is the
 * only writer, and only a chip tap calls it.
 */
export default async function GamesPage({
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
  // cfb_games first; cfb_group is the fallback so a one-group member who has
  // never touched a chip still lands on their pool.
  const remembered =
    jar.get(GAMES_SCOPE_COOKIE)?.value ?? jar.get(ACTIVE_GROUP_COOKIE)?.value ?? null;

  const [mine, state] = await Promise.all([
    fetchMyGroups(supabase, user?.id ?? null),
    fetchGamesHub(supabase, user?.id ?? null),
  ]);
  const scope = resolveGameScope(mine, groupParam ?? null, remembered);

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <GamesHub
          state={state}
          groups={mine.map((m) => ({ slug: m.slug, name: m.name }))}
          activeParam={scopeParam(scope)}
          scopeName={scopeLabel(scope)}
          signedIn={!!user}
        />
      </main>
    </>
  );
}
