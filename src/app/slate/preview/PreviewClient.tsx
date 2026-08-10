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
import { MemberCard, WeekHero } from "../../../components/group/GroupHub";
import { PickBoard } from "../../../components/group/PickBoard";
import type { GroupWeek } from "../../../lib/groups";
import { EMPTY_TALLY, type Tally } from "../../../lib/records";
import { BetSlip } from "../../../components/slate/BetSlip";
import { GameCard } from "../../../components/slate/GameCard";
import { SkeletonCard } from "../../../components/slate/SkeletonCard";
import { DEFAULT_TZ } from "../../../lib/kick";
import type { GroupBetView, MemberStats } from "../../../lib/tailing";
import type { SheetMember } from "../../../lib/betting-groups";
import type {
  CrewPickView,
  GameView,
  MyBetView,
  RivalryView,
  SystemRatingView,
  TeamView,
} from "../../../lib/slate";

const logo = (id: number) => `https://a.espncdn.com/i/teamlogos/ncaa/500-dark/${id}.png`;

const team = (
  id: number,
  school: string,
  abbr: string,
  conference: string,
  color: string,
  rank: number | null,
  record: string,
  confRecord: string | null = null,
): TeamView => ({
  id,
  school,
  abbr,
  mascot: null,
  conference,
  color,
  altColor: null,
  logo: logo(id),
  rank,
  pollRank: rank,
  poll: rank === null ? null : "AP",
  record,
  confRecord,
});

const ALABAMA = team(333, "Alabama", "ALA", "SEC", "#9e1b32", 4, "8-1", "5-1");
const GEORGIA = team(61, "Georgia", "UGA", "SEC", "#ba0c2f", 2, "9-0", "6-0");
const OHIO_STATE = team(194, "Ohio State", "OSU", "Big Ten", "#bb0000", 1, "9-0", "6-0");
const MICHIGAN = team(130, "Michigan", "MICH", "Big Ten", "#00274c", 11, "7-2", "4-2");
const TEXAS = team(251, "Texas", "TEX", "SEC", "#bf5700", 6, "8-1", "5-1");
const OKLAHOMA = team(201, "Oklahoma", "OU", "SEC", "#841617", 18, "6-3", "3-3");
const OREGON = team(2483, "Oregon", "ORE", "Big Ten", "#154733", 3, "9-0", "6-0");
const PENN_STATE = team(213, "Penn State", "PSU", "Big Ten", "#041e42", 9, "7-2", "4-2");

// Fixed timestamps so server and client render identically (no Date.now()).
const BASE = Date.parse("2026-11-14T18:00:00Z"); // Sat, noon CT
const at = (hoursFromBase: number) => new Date(BASE + hoursFromBase * 3600_000).toISOString();

/** Sample group config + records for the hub preview. */
const GROUP_WEEK: GroupWeek = {
  markets: ["spread", "total"],
  gameIds: [],
  selectionMode: "handpicked",
  conference: null,
  locked: false,
  minPicks: 8,
};

/** Sample betting-group positions, so the sheet layer is reviewable too. */
const gb = (
  betId: number,
  name: string,
  side: string,
  line: number | null,
  relation: "origin" | "tail" | "fade",
  over: Partial<GroupBetView> = {},
): GroupBetView => ({
  betId,
  userId: name.toLowerCase(),
  name,
  betType: "spread",
  side,
  line,
  odds: -110,
  units: 1,
  relation,
  isViewer: false,
  record: "12-8",
  form: "level",
  sourceName: relation === "origin" ? null : "Jeff",
  tailedBy: 0,
  fadedBy: 0,
  result: null,
  ...over,
});

const sampleTally = (
  wins: number,
  losses: number,
  pushes: number,
  units: number,
  avgClv: number | null,
): Tally => ({
  wins,
  losses,
  pushes,
  decided: wins + losses + pushes,
  units,
  staked: wins + losses,
  roi: units / (wins + losses),
  avgClv,
  clvCount: wins + losses,
});
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
};

const kick = at(26);
const now = at(0);

const base = {
  week: 11,
  neutralSite: false,
  dome: false,
  myPicks: [],
  myBets: [] as MyBetView[],
  crewPicks: [] as CrewPickView[],
  groupBets: [] as GroupBetView[],
  situation: null as string | null,
  lastPlay: null as string | null,
  possession: null as "home" | "away" | null,
  weather: null,
  rivalry: null as RivalryView | null,
  // SP+/FPI/Elo in the same shape fetchSlateView builds (spec §2.4)
  systems: [
    { system: "sp", home: 18.4, away: 21.1 },
    { system: "fpi", home: 16.9, away: 19.8 },
    { system: "elo", home: 1888, away: 1934 },
  ] as SystemRatingView[],
};

const PREGAME: GameView = {
  ...base,
  id: 1,
  startTs: kick,
  status: "scheduled",
  period: null,
  clock: null,
  tv: "CBS",
  homePoints: null,
  awayPoints: null,
  home: ALABAMA,
  away: GEORGIA,
  lines: { spread: -1.5, spreadOpen: -3, total: 51.5, totalOpen: 49.5, mlHome: -125, mlAway: 105 },
  prediction: {
    spread: -4.5,
    total: 54,
    homeScore: 29.5,
    awayScore: 24.9,
    homeWinProb: 0.62,
    coverProb: null,
    vegasSpread: -1.5,
    edge: -3,
    edgeFlag: "EDGE",
    consensus: false,
    frozen: false,
  },
  myPicks: [{ market: "spread", side: "home", line: -1.5 }],
  groupBets: [
    gb(1, "Jeff", "home", -1.5, "origin", { units: 2, tailedBy: 1, fadedBy: 1, form: "hot" }),
    gb(2, "Mo", "home", -1.5, "tail"),
    gb(3, "Sam", "away", -1.5, "fade", { record: "9-11", form: "cold" }),
  ],
  crewPicks: [
    { name: "Jake", side: "home", record: "12-8" },
    { name: "Mo", side: "home", record: "10-10" },
    { name: "Sam", side: "away", record: "9-11" },
  ],
  weather: { tempF: 44, windMph: 18, precipProb: 20 },
};

const LIVE: GameView = {
  ...base,
  id: 2,
  startTs: now,
  status: "in_progress",
  period: 3,
  clock: "8:42",
  situation: "2nd & 8 at MICH 14",
  lastPlay: "Henderson rush up the middle for 12 yds to the MICH 14",
  possession: "away",
  tv: "FOX",
  homePoints: 24,
  awayPoints: 21,
  home: MICHIGAN,
  away: OHIO_STATE,
  rivalry: { name: "The Game", trophy: null },
  myPicks: [
    { market: "spread", side: "away", line: -3.5 },
    { market: "total", side: "over", line: 44.5 },
  ],
  myBets: [{ id: 1, betType: "total", side: "over", line: 44.5 }],
  groupBets: [
    gb(4, "Ty", "away", 3.5, "origin", { units: 3, tailedBy: 1 }),
    gb(5, "You", "away", 3.5, "tail", { isViewer: true, sourceName: "Ty" }),
  ],
  crewPicks: [
    { name: "Jake", side: "away", record: "12-8" },
    { name: "Ty", side: "away", record: "15-5" },
    { name: "Sam", side: "home", record: "9-11" },
  ],
  lines: { spread: 3.5, spreadOpen: 2.5, total: 44.5, totalOpen: 45.5, mlHome: 150, mlAway: -175 },
  prediction: {
    spread: 2.8,
    total: 46,
    homeScore: 21.5,
    awayScore: 24.3,
    homeWinProb: 0.41,
    coverProb: null,
    vegasSpread: 3.5,
    edge: -0.7,
    edgeFlag: null,
    consensus: false,
    frozen: false,
  },
};

const FINAL_GAME: GameView = {
  ...base,
  id: 3,
  startTs: at(-8),
  status: "final",
  period: null,
  clock: null,
  tv: "ABC",
  homePoints: 34,
  awayPoints: 24,
  home: TEXAS,
  away: OKLAHOMA,
  rivalry: { name: "Red River Rivalry", trophy: "Golden Hat" },
  lines: { spread: -6.5, spreadOpen: -7.5, total: 57.5, totalOpen: 58.5, mlHome: -260, mlAway: 210 },
  prediction: {
    spread: -9.2,
    total: 55.5,
    homeScore: 33.4,
    awayScore: 24.2,
    homeWinProb: 0.74,
    coverProb: null,
    vegasSpread: -6.5,
    edge: -2.7,
    edgeFlag: "EDGE",
    consensus: true,
    frozen: true,
  },
};

const FINAL_OT: GameView = {
  ...base,
  id: 4,
  startTs: at(-5),
  status: "final",
  period: 6,
  clock: null,
  tv: "NBC",
  homePoints: 30,
  awayPoints: 33,
  home: PENN_STATE,
  away: OREGON,
  lines: { spread: 2.5, spreadOpen: 3.5, total: 52.5, totalOpen: 51.5, mlHome: 125, mlAway: -145 },
  prediction: {
    spread: 1.9,
    total: 49.5,
    homeScore: 23.8,
    awayScore: 25.7,
    homeWinProb: 0.45,
    coverProb: null,
    vegasSpread: 2.5,
    edge: -0.6,
    edgeFlag: null,
    consensus: false,
    frozen: true,
  },
};

const NO_LINE: GameView = {
  ...base,
  id: 5,
  startTs: kick,
  status: "scheduled",
  period: null,
  clock: null,
  tv: null,
  homePoints: null,
  awayPoints: null,
  home: { ...team(2440, "Nevada", "NEV", "Mountain West", "#003366", null, "3-6"), logo: logo(2440) },
  away: { ...team(21, "San José State", "SJSU", "Mountain West", "#0055a2", null, "5-4"), logo: logo(21) },
  lines: { spread: null, spreadOpen: null, total: null, totalOpen: null, mlHome: null, mlAway: null },
  prediction: null,
};

const POSTPONED: GameView = {
  ...NO_LINE,
  id: 6,
  status: "postponed",
  home: OKLAHOMA,
  away: PENN_STATE,
  lines: { spread: -2.5, spreadOpen: -2.5, total: 48.5, totalOpen: 48.5, mlHome: -135, mlAway: 115 },
};

const HERO: GameView = { ...PREGAME, id: 7, home: OHIO_STATE, away: GEORGIA, myPicks: [], weather: null };

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

        {/* The group screens need a database, a group and a signed-in member
            before they draw anything, so their two card systems are previewed
            here against the same sample slate. */}
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
              week={12}
              currentWeek={12}
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
