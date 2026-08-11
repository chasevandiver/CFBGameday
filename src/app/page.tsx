import Link from "next/link";
import { AppNav } from "../components/AppNav";
import {
  GroupStandingRow,
  HomeHero,
  HubEmpty,
  PositionRow,
  RecordBlock,
  SectionHead,
} from "../components/home/HomeHub";
import { fetchHomeData, splitPositions } from "../lib/home";
import { createClient } from "../lib/supabase/server";

export const dynamic = "force-dynamic";

// The layout's title template would make this "Home · The CFB Slate", which
// reads as a subpage of itself.
export const metadata = { title: { absolute: "The CFB Slate" } };

/**
 * The front door.
 *
 * This used to be `redirect("/slate")`, which meant opening the site dropped you
 * into sixty game cards with no answer to the question you actually opened it
 * with — what have I got riding, where do I stand, how is the season going.
 * Those answers existed, spread across `/groups`, each group's hub and
 * `/ledger`; none of them was the first thing you saw.
 *
 * So this page asks the four questions in order and then hands off. It is
 * deliberately short: the hub is somewhere you pass through on the way to the
 * slate, not somewhere to spend a Saturday, and the primary action says so.
 *
 * Money and the pool are two lists, never one. They are separate products with
 * separate arithmetic, which is why `/ledger` has two tabs — the hub's first
 * version rendered them as differently-tinted chips on one row, and a game
 * carrying both could not tell you what you had money on.
 *
 * Public, like the rest of the site (see `lib/supabase/middleware.ts`) — a
 * signed-out visitor gets the week and the way in rather than a login wall.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const data = await fetchHomeData(supabase, user?.id ?? null);
  const { bets: betPositions, picks: pickPositions } = splitPositions(data.positions);

  // Naming the pool on every pick is noise when there is only one to name.
  const showPool = data.groups.filter((g) => g.group.kind === "pickem").length > 1;

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <HomeHero
          week={data.week}
          positionCount={data.positions.length}
          weekGameCount={data.weekGameCount}
          liveCount={data.liveCount}
          firstKick={data.firstKick}
          progress={data.progress}
          signedIn={!!user}
        />

        {!user ? (
          <section className="card mt-6 px-5 py-6 text-center">
            <p className="text-sm text-chalk">This is where your Saturday lives.</p>
            <p className="mt-1 text-sm leading-relaxed text-dim">
              Sign in and this page carries the games you have money or a pick on, your groups and
              where you sit in them, and your season record.
            </p>
            <Link
              href="/login"
              className="stat mt-3 inline-flex min-h-11 items-center rounded-lg border border-chalk/20 px-3.5 text-sm text-chalk hover:border-chalk/50"
            >
              Sign in
            </Link>
          </section>
        ) : (
          /* Your action on the left, where you stand on the right — the hub is
             a column on a phone and a dashboard on anything wider. */
          <div className="mt-6 grid gap-7 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start">
            <div>
              {/* ---- money ---- */}
              <section aria-labelledby="bets-heading">
                <SectionHead
                  id="bets-heading"
                  title="Your bets"
                  count={
                    betPositions.length > 0
                      ? `${data.openBetCount} open · ${data.openBetUnits.toFixed(1)}u`
                      : undefined
                  }
                  href="/ledger"
                  linkLabel="Ledger"
                />
                {betPositions.length === 0 ? (
                  <HubEmpty
                    line="No money on this week yet."
                    hint="Bets you log off the slate show up here, live."
                    href="/slate"
                    cta="Find a number"
                  />
                ) : (
                  <ul className="flex flex-col gap-3.5">
                    {betPositions.map((p) => (
                      <PositionRow key={`bet-${p.game.id}`} position={p} />
                    ))}
                  </ul>
                )}
              </section>

              {/* ---- the pool ---- */}
              <section className="mt-7" aria-labelledby="picks-heading">
                <SectionHead
                  id="picks-heading"
                  title="Pool picks"
                  count={data.weekPickCount > 0 ? `${data.weekPickCount} in` : undefined}
                  href="/groups"
                  linkLabel="The board"
                />
                {pickPositions.length === 0 ? (
                  <HubEmpty
                    line={
                      data.progress.length === 0
                        ? "No pool board this week."
                        : "You haven’t made your picks yet."
                    }
                    hint={
                      data.progress.length === 0
                        ? "Your admin sets the games each week."
                        : "Picks save as you tap, and stay editable until each game kicks."
                    }
                    href={data.progress[0] ? `/groups/${data.progress[0].slug}/picks` : "/groups"}
                    cta={data.progress.length === 0 ? "Your groups" : "Make picks"}
                  />
                ) : (
                  <ul className="flex flex-col gap-3.5">
                    {pickPositions.map((p) => (
                      <PositionRow key={`pick-${p.game.id}`} position={p} showPool={showPool} />
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <div>
              {/* ---- your groups ---- */}
              <section aria-labelledby="groups-heading">
                <SectionHead
                  id="groups-heading"
                  title="Your groups"
                  href="/groups"
                  linkLabel="All groups"
                />
                {data.groups.length === 0 ? (
                  <HubEmpty
                    line="You’re not in a group yet."
                    hint="Create one and you’re its admin, or join with a code."
                    href="/groups"
                    cta="Start or join a group"
                  />
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {data.groups.map((s) => (
                      <GroupStandingRow key={s.group.id} standing={s} />
                    ))}
                  </ul>
                )}
              </section>

              {/* ---- your record ---- */}
              <section className="mt-7" aria-labelledby="record-heading">
                <SectionHead
                  id="record-heading"
                  title="Your season"
                  href="/ledger"
                  linkLabel="Full ledger"
                />
                {data.bets.decided === 0 && data.picks.decided === 0 ? (
                  <HubEmpty
                    line="Nothing has graded yet."
                    hint="Record, units, ROI and CLV land here once your first bet settles."
                    href="/ledger"
                    cta="Log a bet"
                  />
                ) : (
                  <RecordBlock
                    bets={data.bets}
                    picks={data.picks}
                    pickGroupCount={data.pickGroupCount}
                    curve={data.curve}
                  />
                )}
              </section>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
