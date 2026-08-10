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
import { fetchHomeData } from "../lib/home";
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
 * Public, like the rest of the site (see `lib/supabase/middleware.ts`) — a
 * signed-out visitor gets the week and the way in rather than a login wall.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const data = await fetchHomeData(supabase, user?.id ?? null);

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
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
          <>
            {/* ---- what you have riding ---- */}
            <section className="mt-6" aria-labelledby="positions-heading">
              <SectionHead
                id="positions-heading"
                title="Riding this week"
                href="/ledger"
                linkLabel="Your ledger"
              />
              {data.positions.length === 0 ? (
                <HubEmpty
                  line="Nothing riding this week yet."
                  hint="Picks and bets you make off the slate show up here, live."
                  href="/slate"
                  cta="Find something"
                />
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {data.positions.map((p) => (
                    <PositionRow key={p.game.id} position={p} />
                  ))}
                </ul>
              )}
            </section>

            {/* ---- your groups ---- */}
            <section className="mt-7" aria-labelledby="groups-heading">
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
          </>
        )}
      </main>
    </>
  );
}
