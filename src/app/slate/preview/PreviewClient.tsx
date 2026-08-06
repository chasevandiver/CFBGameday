"use client";

/**
 * Design preview: the three game-card states (pregame / live / final), the
 * featured Game-of-the-Week treatment, and the loading skeleton — rendered
 * from sample data so the card system can be reviewed without live ingestion.
 */

import { useState } from "react";
import { AppNav } from "../../../components/AppNav";
import { BetSlip } from "../../../components/slate/BetSlip";
import { GameCard } from "../../../components/slate/GameCard";
import { SkeletonCard } from "../../../components/slate/SkeletonCard";
import { DEFAULT_TZ } from "../../../lib/kick";
import type { CrewPickView, GameView, MyBetView, TeamView } from "../../../lib/slate";

const logo = (id: number) => `https://a.espncdn.com/i/teamlogos/ncaa/500-dark/${id}.png`;

const team = (
  id: number,
  school: string,
  abbr: string,
  conference: string,
  color: string,
  rank: number | null,
  record: string,
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
});

const ALABAMA = team(333, "Alabama", "ALA", "SEC", "#9e1b32", 4, "8-1");
const GEORGIA = team(61, "Georgia", "UGA", "SEC", "#ba0c2f", 2, "9-0");
const OHIO_STATE = team(194, "Ohio State", "OSU", "Big Ten", "#bb0000", 1, "9-0");
const MICHIGAN = team(130, "Michigan", "MICH", "Big Ten", "#00274c", 11, "7-2");
const TEXAS = team(251, "Texas", "TEX", "SEC", "#bf5700", 6, "8-1");
const OKLAHOMA = team(201, "Oklahoma", "OU", "SEC", "#841617", 18, "6-3");
const OREGON = team(2483, "Oregon", "ORE", "Big Ten", "#154733", 3, "9-0");
const PENN_STATE = team(213, "Penn State", "PSU", "Big Ten", "#041e42", 9, "7-2");

// Fixed timestamps so server and client render identically (no Date.now()).
const BASE = Date.parse("2026-11-14T18:00:00Z"); // Sat, noon CT
const at = (hoursFromBase: number) => new Date(BASE + hoursFromBase * 3600_000).toISOString();
const kick = at(26);
const now = at(0);
const hist = (vals: number[]) => vals.map((v, i) => ({ t: at(-(vals.length - i) * 6), v }));

const base = {
  week: 11,
  neutralSite: false,
  dome: false,
  myPick: null,
  myBets: [] as MyBetView[],
  crewPicks: [] as CrewPickView[],
  situation: null as string | null,
  lastPlay: null as string | null,
  possession: null as "home" | "away" | null,
  weather: null,
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
  spreadHistory: hist([-3, -3, -2.5, -2.5, -2, -1.5]),
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
  myPick: { side: "home", line: -1.5 },
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
  myPick: { side: "away", line: 3.5 },
  myBets: [{ id: 1, betType: "total", side: "over", line: 44.5 }],
  crewPicks: [
    { name: "Jake", side: "away", record: "12-8" },
    { name: "Ty", side: "away", record: "15-5" },
    { name: "Sam", side: "home", record: "9-11" },
  ],
  lines: { spread: 3.5, spreadOpen: 2.5, total: 44.5, totalOpen: 45.5, mlHome: 150, mlAway: -175 },
  spreadHistory: hist([2.5, 3, 3, 3.5]),
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
  lines: { spread: -6.5, spreadOpen: -7.5, total: 57.5, totalOpen: 58.5, mlHome: -260, mlAway: 210 },
  spreadHistory: hist([-7.5, -7, -7, -6.5]),
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
  spreadHistory: hist([3.5, 3, 2.5]),
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
  spreadHistory: [],
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

const HERO: GameView = { ...PREGAME, id: 7, home: OHIO_STATE, away: GEORGIA, myPick: null, weather: null };

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

        <Section title="Loading skeleton">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </Section>
      </main>
      <BetSlip seasonId={0} />
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
