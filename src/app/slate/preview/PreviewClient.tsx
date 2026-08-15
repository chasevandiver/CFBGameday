"use client";

/**
 * Design preview: the three game-card states (pregame / live / final), the
 * featured Game-of-the-Week treatment, and the loading skeleton — rendered
 * from sample data so the card system can be reviewed without live ingestion.
 */

import { useState } from "react";
import { AppNav } from "../../../components/AppNav";
import { PairPanel, SheetGameRow, SourceCard } from "../../../components/group/BettingHub";
import { CreateGroupForm, GroupSwitcher } from "../../../components/group/GroupForms";
import { seasonWeeks } from "../../../lib/group-weeks";
import { MemberCard, WeekHero } from "../../../components/group/GroupHub";
import { PickBoard } from "../../../components/group/PickBoard";
import { HomeDashboard, HubEmpty, SectionHead } from "../../../components/home/HomeHub";
import { BetSlip } from "../../../components/slate/BetSlip";
import { GameCard } from "../../../components/slate/GameCard";
import { SkeletonCard } from "../../../components/slate/SkeletonCard";
import {
  demoGames,
  demoHomeData,
  sampleTally,
  GEORGIA,
  OHIO_STATE,
} from "../../../lib/demo-data";
import type { GroupWeek } from "../../../lib/groups";
import { DEFAULT_TZ } from "../../../lib/kick";
import { EMPTY_TALLY, type Tally } from "../../../lib/records";
import type { GameView } from "../../../lib/slate";
import type { MemberStats } from "../../../lib/tailing";
import type { SheetMember } from "../../../lib/betting-groups";

/* ---- sample data -------------------------------------------------------- */

/**
 * The demo's fixtures, frozen.
 *
 * `/demo` anchors its Saturday to whenever someone opens it, which is what
 * makes a link worth sending. A design harness wants the opposite — the same
 * pixels every time, so that a diff in a screenshot is a change to a card and
 * never a change to the clock. Passing a constant `now` gives that, and keeps
 * one set of teams, lines and predictions behind both surfaces instead of two
 * that drift.
 */
const NOW = Date.parse("2026-11-14T18:00:00Z"); // Sat, noon CT
const at = (hoursFromNow: number) => new Date(NOW + hoursFromNow * 3600_000).toISOString();

const GAMES = demoGames(NOW);
const game = (id: number): GameView => GAMES.find((g) => g.id === id)!;

/** Sample group config, for the group hub's week hero. */
const GROUP_WEEK: GroupWeek = {
  markets: ["spread", "total"],
  gameIds: [],
  selectionMode: "handpicked",
  conference: null,
  locked: false,
  minPicks: 8,
};

const memberStats = (
  userId: string,
  overall: Tally,
  originated: Tally,
  tailedByOthers: Tally,
  fadedByOthers: Tally,
  timesFollowed: number,
): MemberStats => ({
  userId,
  overall,
  originated,
  tailing: sampleTally(6, 4, 0, 1.4, 0.11),
  fading: sampleTally(3, 3, 0, -0.1, 0.02),
  tailedByOthers,
  fadedByOthers,
  timesFollowed,
});

const SAMPLE_SOURCE: SheetMember = {
  userId: "chase",
  name: "Chase",
  role: "admin",
  stats: memberStats(
    "chase",
    sampleTally(31, 22, 1, 6.4, 0.31),
    sampleTally(18, 11, 0, 5.2, 0.34),
    sampleTally(9, 4, 0, 3.6, 0.28),
    sampleTally(2, 6, 0, -3.8, -0.2),
    22,
  ),
  form: { results: ["win", "win", "loss", "win", "win"], wins: 7, losses: 3, units: 2.9, label: "hot" },
  leagueSplit: { cfb: sampleTally(31, 22, 1, 6.4, 0.31), nfl: EMPTY_TALLY },
};

const SAMPLE_SOURCE_2: SheetMember = {
  userId: "sam",
  name: "Sam",
  role: "member",
  stats: memberStats(
    "sam",
    sampleTally(19, 26, 0, -8.1, -0.12),
    sampleTally(8, 14, 0, -6.4, -0.18),
    sampleTally(3, 9, 0, -6.0, -0.22),
    sampleTally(8, 3, 0, 4.5, 0.3),
    23,
  ),
  form: { results: ["loss", "loss", "win", "loss", "loss"], wins: 3, losses: 7, units: -4.1, label: "cold" },
  leagueSplit: { cfb: sampleTally(19, 26, 0, -8.1, -0.12), nfl: EMPTY_TALLY },
};

/* ---- the card states ----------------------------------------------------- */

/** Picked and bet, so the card's own pick and bet chips are on screen. */
const PREGAME: GameView = {
  ...game(9107),
  myPicks: [{ market: "spread", side: "home", line: 2.5 }],
};

const LIVE: GameView = {
  ...game(9104),
  myPicks: [
    { market: "spread", side: "away", line: 4 },
    { market: "total", side: "over", line: 44.5 },
  ],
  myBets: [{ id: 1, betType: "total", side: "over", line: 44.5 }],
};

const FINAL_GAME: GameView = game(9103);
const NO_LINE: GameView = game(9112);

/* The two states the demo slate has no room for, kept because a card still has
   to survive them: overtime, and a game that never kicked. */
const FINAL_OT: GameView = {
  ...game(9102),
  id: 4,
  period: 6,
  homePoints: 30,
  awayPoints: 33,
};

const POSTPONED: GameView = {
  ...game(9112),
  id: 6,
  status: "postponed",
  lines: { spread: -2.5, spreadOpen: -2.5, total: 48.5, totalOpen: 48.5, mlHome: -135, mlAway: 115 },
};

/** The featured treatment, on the biggest pairing available. */
const HERO: GameView = {
  ...game(9107),
  id: 7,
  home: OHIO_STATE,
  away: GEORGIA,
  myPicks: [],
  weather: null,
};

/* ---- home hub ------------------------------------------------------------ */

const HOME_DATA = demoHomeData(NOW);

export function SlatePreviewClient() {
  const [starred, setStarred] = useState<number[]>([OHIO_STATE.id]);
  const toggle = (id: number) =>
    setStarred((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const tz = DEFAULT_TZ;

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16">
        <div className="mb-6 mt-6">
          <h1 className="text-2xl text-chalk">Card states preview</h1>
          <p className="mt-1 text-sm text-dim">
            Sample data only — pregame, live, and final states plus the featured card, edge cases,
            and loading skeleton. Tap the odds cells to build a bet slip.
          </p>
        </div>

        <Section title="Game of the Week — featured card">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            <GameCard game={HERO} tz={tz} starred={starred} onStar={toggle} featured />
          </div>
        </Section>

        <Section title="Pregame · Live · Final">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            <GameCard game={PREGAME} tz={tz} starred={starred} onStar={toggle} />
            <GameCard game={LIVE} tz={tz} starred={starred} onStar={toggle} />
            <GameCard game={FINAL_GAME} tz={tz} starred={starred} onStar={toggle} />
          </div>
        </Section>

        <Section title="Edge cases — OT final, no line, postponed">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            <GameCard game={FINAL_OT} tz={tz} starred={starred} onStar={toggle} />
            <GameCard game={NO_LINE} tz={tz} starred={starred} onStar={toggle} />
            <GameCard game={POSTPONED} tz={tz} starred={starred} onStar={toggle} />
          </div>
        </Section>

        {/* The hub needs a database, a season, a group and a signed-in member
            before it draws anything, so it is previewed here against the same
            sample slate — through `HomeDashboard`, the component the real page
            renders, rather than a second copy of its layout. */}
        <Section title="Home hub">
          <div className="mx-auto w-full max-w-6xl">
            <HomeDashboard data={HOME_DATA} signedIn />
          </div>
        </Section>

        {/* First run: what a brand-new account actually lands on. The hub above
            is the full case, so these two are the only states it can't show. */}
        <Section title="Home hub — first run">
          <div className="mx-auto flex max-w-6xl flex-col gap-2.5">
            <SectionHead id="preview-empty" title="Nothing yet" />
            <HubEmpty
              line="Nothing riding this week yet."
              hint="Picks and bets you make off the slate show up here, live."
              href="/slate"
              cta="Find something"
            />
            <HubEmpty
              line="You’re not in a group yet."
              hint="Create one and you’re its admin, or join with a code."
              href="/groups"
              cta="Start or join a group"
            />
          </div>
        </Section>

        <Section title="Group hub — switcher, week hero, standings">
          <div className="mx-auto max-w-3xl">
            <div className="mb-3">
              <GroupSwitcher
                activeSlug="saturday-boys"
                groups={[
                  { slug: "saturday-boys", name: "Saturday Boys", kind: "pickem" },
                  { slug: "the-sheet", name: "The Sheet", kind: "betting" },
                  { slug: "work-pool", name: "Work Pool", kind: "pickem" },
                ]}
              />
            </div>
            <WeekHero
              slug="saturday-boys"
              weekRef={{ seasonType: "regular", week: 12 }}
              weeks={seasonWeeks("cfb", 0)}
              currentRef={{ seasonType: "regular", week: 12 }}
              groupWeek={GROUP_WEEK}
              gameCount={4}
              pickSlots={8}
              myPickCount={5}
              minPicks={0}
              firstKick={at(20)}
              isAdmin
              signedIn
              share={null}
            />
            <ul className="mt-4 flex flex-col gap-2">
              <MemberCard
                place={1}
                name="Chase"
                isAdmin
                isMe
                priced
                tally={sampleTally(31, 19, 1, 6.4, 0.31)}
              />
              <MemberCard
                place={2}
                name="Mo"
                isAdmin={false}
                isMe={false}
                priced
                tally={sampleTally(28, 22, 0, -1.2, -0.08)}
              />
              <MemberCard
                place={3}
                name="Sam"
                isAdmin={false}
                isMe={false}
                priced
                tally={EMPTY_TALLY}
              />
            </ul>
          </div>
        </Section>

        <Section title="Group board — pick cards">
          <div className="mx-auto max-w-3xl">
            <PickBoard
              groupId="preview"
              slug="saturday-boys"
              week={12}
              markets={["spread", "total"]}
              minPicks={8}
              signedIn
              shareContext={null}
              entries={[
                { game: HERO, myPicks: [{ market: "spread", side: "home", line_at_pick: -1.5 }], takers: 4 },
                { game: PREGAME, myPicks: [], takers: 2 },
                { game: LIVE, myPicks: [{ market: "total", side: "over", line_at_pick: 44.5 }], takers: 6 },
              ]}
            />
          </div>
        </Section>

        <Section title="Create a group — the kind is the first choice">
          <div className="mx-auto max-w-sm">
            <div className="card px-4 py-4">
              <h3 className="mb-3 text-sm text-accent">Start a group</h3>
              <CreateGroupForm />
            </div>
          </div>
        </Section>

        <Section title="Betting group — sheet, sources, tail/fade">
          <div className="mx-auto max-w-3xl">
            <ul className="mb-4 flex flex-col gap-2.5">
              <SheetGameRow game={HERO} />
            </ul>
            <ul className="mb-4 flex flex-col gap-2">
              <SourceCard place={1} isMe member={SAMPLE_SOURCE} />
              <SourceCard place={2} isMe={false} member={SAMPLE_SOURCE_2} />
            </ul>
            <PairPanel
              pairs={[
                {
                  otherId: "jeff",
                  tailing: sampleTally(9, 4, 0, 3.6, 0.22),
                  fading: sampleTally(1, 4, 0, -3.1, -0.4),
                },
                {
                  otherId: "sam",
                  tailing: sampleTally(2, 5, 0, -3.2, -0.1),
                  fading: sampleTally(6, 2, 1, 3.4, 0.18),
                },
              ]}
              nameById={new Map([["jeff", "Jeff"], ["sam", "Sam"]])}
            />
          </div>
        </Section>

        <Section title="Loading skeleton">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </Section>
      </main>
      <BetSlip seasonId={0} week={12} />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm text-accent">{title}</h2>
      {children}
    </section>
  );
}
