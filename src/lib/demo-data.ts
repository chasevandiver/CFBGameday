/**
 * Sample data for the public demo at `/demo`.
 *
 * The demo exists because the site can't show anyone what it is: `/` and
 * `/slate` are public to browse, but signed out they render a week header and a
 * sign-in card. This module supplies the payloads `fetchHomeData` and
 * `fetchSlateView` would have returned, so the real components can be pointed
 * at a Saturday that is entirely invented and touches no database.
 *
 * Two rules hold this file together:
 *
 * 1. **Times are anchored to the viewer's own week, not frozen.** The design
 *    preview at `/slate/preview` freezes its clock to a constant so a component
 *    gallery renders identically every time; a demo someone opens on a Tuesday
 *    in March must still read as a Saturday. Everything is placed against the
 *    coming Saturday in Eastern time, which is what makes the kickoff slots
 *    ("Noon", "Primetime") and the day tabs come out right — `kickSlot` reads
 *    absolute ET hours, so offsets from `now` would drift into the wrong slot.
 *    `now` is passed in rather than read here: the demo routes are
 *    `force-dynamic`, the server stamps it once, and the client hydrates the
 *    serialized result, so there is no server/client mismatch.
 *
 * 2. **Game states are fixed, not derived from `now`.** The slate is posed at a
 *    notional mid-afternoon: the Friday and noon games are final, the 3:30s are
 *    live, the night games haven't kicked. Deriving that from the actual clock
 *    would mean the link shows an empty pregame board most of the week, which
 *    is precisely the screenshot nobody wants.
 *
 * Nothing here is real. The records, the standings and the ledger are invented,
 * which is what the "sample data" marker on both demo screens is for.
 */

import { buildPositions, type GroupStanding, type HomeBet, type HomeData, type HomePick, type Position, type WeekProgress } from "./home";
import type { GroupSummary } from "./groups";
import { EMPTY_TALLY, type Tally } from "./records";
import type {
  CrewPickView,
  GameView,
  PredictionView,
  RivalryView,
  SlateData,
  SystemRatingView,
  TeamView,
} from "./slate";
import type { GroupBetView } from "./tailing";

export const DEMO_SEASON = 2026;
export const DEMO_WEEK = 12;

/* ---- the clock ---------------------------------------------------------- */

const ET = "America/New_York";

/** ET calendar date at a given instant. */
function etDate(at: number): { y: number; m: number; d: number } {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(at));
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { y: v("year"), m: v("month"), d: v("day") };
}

/**
 * How far ET sits from UTC at a given instant, in ms (negative — ET is behind).
 *
 * Read off `Intl` rather than hardcoded because the season straddles the
 * November DST change: −4h in September, −5h by the Playoff.
 */
function etOffsetMs(at: number): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  const wall = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return wall - Math.floor(at / 1000) * 1000;
}

/**
 * The instant an ET wall-clock time falls on.
 *
 * Two passes: the offset is itself a function of the instant we're solving for,
 * so the first pass uses a nearby offset and the second uses the answer's own.
 * Exact except inside the one ambiguous hour a fall-back repeats, which no
 * kickoff in here lands on.
 */
function etInstant(y: number, m: number, d: number, hour: number, minute: number, near: number): number {
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  return wall - etOffsetMs(wall - etOffsetMs(near));
}

/** The coming Saturday in ET — today, when today is one. */
export function demoSaturday(now: number): { y: number; m: number; d: number } {
  const { y, m, d } = etDate(now);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const shifted = new Date(Date.UTC(y, m - 1, d + ((6 - dow + 7) % 7)));
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

/** Kickoff at an ET wall time, `dayOffset` days from the demo Saturday. */
function kickoff(now: number, dayOffset: number, hour: number, minute: number): string {
  const sat = demoSaturday(now);
  return new Date(etInstant(sat.y, sat.m, sat.d + dayOffset, hour, minute, now)).toISOString();
}

/* ---- teams -------------------------------------------------------------- */

const logo = (id: number) => `https://a.espncdn.com/i/teamlogos/ncaa/500-dark/${id}.png`;

/** ESPN ids, abbreviations and colors are the real ones — only results are made up. */
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

export const ALABAMA = team(333, "Alabama", "ALA", "SEC", "#9e1b32", 4, "8-1", "5-1");
export const GEORGIA = team(61, "Georgia", "UGA", "SEC", "#ba0c2f", 2, "9-0", "6-0");
export const OHIO_STATE = team(194, "Ohio State", "OSU", "Big Ten", "#bb0000", 1, "9-0", "6-0");
export const MICHIGAN = team(130, "Michigan", "MICH", "Big Ten", "#00274c", 11, "7-2", "4-2");
export const TEXAS = team(251, "Texas", "TEX", "SEC", "#bf5700", 6, "8-1", "5-1");
export const OKLAHOMA = team(201, "Oklahoma", "OU", "SEC", "#841617", 18, "6-3", "3-3");
export const OREGON = team(2483, "Oregon", "ORE", "Big Ten", "#154733", 3, "9-0", "6-0");
export const PENN_STATE = team(213, "Penn State", "PSU", "Big Ten", "#041e42", 9, "7-2", "4-2");
const LSU = team(99, "LSU", "LSU", "SEC", "#461d76", 13, "7-2", "4-2");
const OLE_MISS = team(145, "Ole Miss", "MISS", "SEC", "#13294b", 8, "8-1", "4-1");
const NOTRE_DAME = team(87, "Notre Dame", "ND", "Independent", "#062340", 7, "8-1");
const USC = team(30, "USC", "USC", "Big Ten", "#9d2235", null, "5-4", "3-3");
const WASHINGTON = team(264, "Washington", "WASH", "Big Ten", "#33006f", 22, "7-2", "4-2");
const IOWA = team(2294, "Iowa", "IOWA", "Big Ten", "#231f20", null, "6-3", "4-2");
const WISCONSIN = team(275, "Wisconsin", "WIS", "Big Ten", "#a00000", null, "4-5", "2-4");
const INDIANA = team(84, "Indiana", "IU", "Big Ten", "#970310", 15, "8-1", "5-1");
const CLEMSON = team(228, "Clemson", "CLEM", "ACC", "#f56600", 12, "7-2", "5-1");
const FLORIDA_STATE = team(52, "Florida State", "FSU", "ACC", "#782f40", null, "4-5", "2-4");
const UTAH = team(254, "Utah", "UTAH", "Big 12", "#be0000", null, "5-4", "3-3");
const BYU = team(252, "BYU", "BYU", "Big 12", "#0047ba", 19, "8-1", "5-1");
const MISSOURI = team(142, "Missouri", "MIZ", "SEC", "#f1b82d", null, "6-3", "2-3");
const TEXAS_AM = team(245, "Texas A&M", "TA&M", "SEC", "#500000", 16, "7-2", "4-2");
const TOLEDO = team(2649, "Toledo", "TOL", "MAC", "#0b2240", null, "7-2", "5-0");
const NIU = team(2459, "Northern Illinois", "NIU", "MAC", "#c8102e", null, "4-5", "3-2");
const SAN_DIEGO_STATE = team(21, "San Diego State", "SDSU", "Mountain West", "#a6192e", null, "4-5", "3-2");
const NEVADA = team(2440, "Nevada", "NEV", "Mountain West", "#041e42", null, "3-6", "2-3");

/* ---- builders ----------------------------------------------------------- */

const systems = (spHome: number, spAway: number): SystemRatingView[] => [
  { system: "sp", home: spHome, away: spAway },
  { system: "fpi", home: spHome - 1.5, away: spAway - 1.3 },
  { system: "elo", home: 1850 + spHome * 4, away: 1850 + spAway * 4 },
];

const crew = (...rows: Array<[string, string, string]>): CrewPickView[] =>
  rows.map(([name, side, record]) => ({ name, side, record }));

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

const prediction = (
  spread: number,
  total: number,
  homeScore: number,
  awayScore: number,
  homeWinProb: number,
  vegasSpread: number | null,
  over: Partial<PredictionView> = {},
): PredictionView => ({
  spread,
  total,
  homeScore,
  awayScore,
  homeWinProb,
  coverProb: null,
  vegasSpread,
  // Model minus market, home perspective (spec §2.4). Kept derived so a hand
  // edit to either number can't leave the flag contradicting the arithmetic.
  edge: vegasSpread === null ? null : Math.round((spread - vegasSpread) * 10) / 10,
  edgeFlag:
    vegasSpread === null
      ? null
      : Math.abs(spread - vegasSpread) >= 4
        ? "BIG_EDGE"
        : Math.abs(spread - vegasSpread) >= 2
          ? "EDGE"
          : null,
  consensus: false,
  frozen: false,
  ...over,
});

const base = {
  week: DEMO_WEEK,
  neutralSite: false,
  dome: false,
  period: null as number | null,
  clock: null as string | null,
  situation: null as string | null,
  lastPlay: null as string | null,
  possession: null as "home" | "away" | null,
  homePoints: null as number | null,
  awayPoints: null as number | null,
  myPicks: [],
  myBets: [],
  crewPicks: [] as CrewPickView[],
  groupBets: [] as GroupBetView[],
  weather: null,
  rivalry: null as RivalryView | null,
  systems: systems(18.4, 21.1),
};

/**
 * The week's board: twelve games across Friday night and the four Saturday
 * windows, posed at a notional mid-afternoon — three finished, three in
 * progress, six still to come.
 *
 * The spread convention is the codebase's everywhere: home perspective,
 * negative means the home team is favored.
 */
export function demoGames(now: number): GameView[] {
  const at = (dayOffset: number, hour: number, minute: number) => kickoff(now, dayOffset, hour, minute);

  return [
    /* ---- Friday night, done ---------------------------------------------- */
    {
      ...base,
      id: 9101,
      startTs: at(-1, 20, 0),
      status: "final",
      tv: "CBSSN",
      homePoints: 17,
      awayPoints: 31,
      home: NIU,
      away: TOLEDO,
      lines: { spread: 3.5, spreadOpen: 2.5, total: 44.5, totalOpen: 46.5, mlHome: 145, mlAway: -170 },
      // The MACtion soft spot the model is supposed to be good at (spec §5.1).
      prediction: prediction(6.5, 43, 21.2, 27.7, 0.35, 3.5, { frozen: true, consensus: true }),
      systems: systems(-4.2, -0.8),
      crewPicks: crew(["Jake", "away", "12-8"], ["Mo", "away", "10-10"]),
    },

    /* ---- the noon window, done ------------------------------------------- */
    {
      ...base,
      id: 9102,
      startTs: at(0, 12, 0),
      status: "final",
      tv: "FS1",
      homePoints: 13,
      awayPoints: 17,
      home: WISCONSIN,
      away: IOWA,
      lines: { spread: 1.5, spreadOpen: 3.5, total: 34.5, totalOpen: 36.5, mlHome: 105, mlAway: -125 },
      prediction: prediction(2.4, 33.5, 17.8, 15.4, 0.44, 1.5, { frozen: true }),
      systems: systems(6.1, 8.5),
      crewPicks: crew(["Jake", "home", "12-8"], ["Ty", "away", "15-5"], ["Sam", "home", "9-11"]),
      weather: { tempF: 34, windMph: 21, precipProb: 40 },
    },
    {
      ...base,
      id: 9103,
      startTs: at(0, 12, 0),
      status: "final",
      tv: "ESPN",
      homePoints: 38,
      awayPoints: 24,
      home: TEXAS_AM,
      away: MISSOURI,
      lines: { spread: -7.5, spreadOpen: -6.5, total: 51.5, totalOpen: 49.5, mlHome: -290, mlAway: 235 },
      prediction: prediction(-9.8, 54, 31.9, 22.1, 0.76, -7.5, { frozen: true, consensus: true }),
      systems: systems(17.2, 8.9),
      crewPicks: crew(["Mo", "home", "10-10"], ["Sam", "away", "9-11"]),
    },

    /* ---- the afternoon window, live -------------------------------------- */
    {
      ...base,
      id: 9104,
      startTs: at(0, 15, 30),
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
      lines: { spread: 3.5, spreadOpen: 2.5, total: 44.5, totalOpen: 45.5, mlHome: 150, mlAway: -175 },
      prediction: prediction(2.8, 46, 21.5, 24.3, 0.41, 3.5),
      systems: systems(19.8, 23.4),
      crewPicks: crew(["Jake", "away", "12-8"], ["Ty", "away", "15-5"], ["Sam", "home", "9-11"]),
      groupBets: [
        gb(4, "Ty", "away", 3.5, "origin", { units: 3, tailedBy: 1, form: "hot", record: "15-5" }),
        gb(5, "You", "away", 3.5, "tail", { isViewer: true, sourceName: "Ty" }),
      ],
    },
    {
      ...base,
      id: 9105,
      startTs: at(0, 15, 30),
      status: "in_progress",
      period: 2,
      clock: "2:11",
      situation: "3rd & 3 at UGA 41",
      lastPlay: "Pass incomplete to the left",
      possession: "away",
      tv: "CBS",
      homePoints: 14,
      awayPoints: 10,
      home: GEORGIA,
      away: OLE_MISS,
      lines: { spread: -6.5, spreadOpen: -8.5, total: 48.5, totalOpen: 50.5, mlHome: -240, mlAway: 195 },
      prediction: prediction(-4.1, 47, 25.4, 21.3, 0.62, -6.5),
      systems: systems(24.9, 20.1),
      crewPicks: crew(["Jake", "away", "12-8"], ["Mo", "home", "10-10"]),
      groupBets: [gb(6, "Jeff", "away", 6.5, "origin", { units: 2, tailedBy: 1, form: "hot" })],
    },
    {
      ...base,
      id: 9106,
      startTs: at(0, 16, 0),
      status: "in_progress",
      period: 1,
      clock: "5:57",
      situation: "1st & 10 at BYU 25",
      lastPlay: "Kickoff touchback",
      possession: "home",
      tv: "ESPN2",
      homePoints: 3,
      awayPoints: 0,
      home: BYU,
      away: UTAH,
      rivalry: { name: "Holy War", trophy: null },
      lines: { spread: -3.5, spreadOpen: -2.5, total: 45.5, totalOpen: 44.5, mlHome: -165, mlAway: 140 },
      prediction: prediction(-1.2, 46.5, 23.9, 22.7, 0.53, -3.5, { consensus: true }),
      systems: systems(12.4, 11.1),
      crewPicks: crew(["Ty", "away", "15-5"]),
    },

    /* ---- primetime, to come ---------------------------------------------- */
    {
      ...base,
      id: 9107,
      startTs: at(0, 19, 0),
      status: "scheduled",
      tv: "ABC",
      home: LSU,
      away: ALABAMA,
      lines: { spread: 2.5, spreadOpen: 4.5, total: 49.5, totalOpen: 51.5, mlHome: 120, mlAway: -142 },
      prediction: prediction(-0.4, 52, 26.2, 25.8, 0.51, 2.5),
      systems: systems(19.1, 22.6),
      crewPicks: crew(["Jake", "home", "12-8"], ["Mo", "away", "10-10"], ["Ty", "home", "15-5"]),
      groupBets: [
        gb(7, "Jeff", "home", 2.5, "origin", { units: 2, tailedBy: 1, fadedBy: 1, form: "hot" }),
        gb(8, "Mo", "home", 2.5, "tail"),
        gb(9, "Sam", "away", 2.5, "fade", { record: "9-11", form: "cold" }),
      ],
      weather: { tempF: 61, windMph: 8, precipProb: 10 },
    },
    {
      ...base,
      id: 9108,
      startTs: at(0, 19, 0),
      status: "scheduled",
      tv: "NBC",
      home: INDIANA,
      away: PENN_STATE,
      // The disagreement the model exists to have: four points clear of the
      // market, with SP+ and FPI on the same side of it.
      lines: { spread: -1.5, spreadOpen: -3.5, total: 47.5, totalOpen: 45.5, mlHome: -125, mlAway: 105 },
      prediction: prediction(-6.2, 46, 26.1, 19.9, 0.68, -1.5, { consensus: true }),
      systems: systems(21.7, 16.2),
      crewPicks: crew(["Jake", "home", "12-8"], ["Ty", "home", "15-5"]),
    },
    {
      ...base,
      id: 9109,
      startTs: at(0, 19, 30),
      status: "scheduled",
      tv: "ESPN",
      home: FLORIDA_STATE,
      away: CLEMSON,
      lines: { spread: 9.5, spreadOpen: 10.5, total: 52.5, totalOpen: 54.5, mlHome: 320, mlAway: -420 },
      prediction: prediction(8.1, 51, 20.4, 28.5, 0.26, 9.5),
      systems: systems(4.8, 15.6),
      crewPicks: crew(["Sam", "home", "9-11"]),
    },
    {
      ...base,
      id: 9110,
      startTs: at(0, 19, 30),
      status: "scheduled",
      tv: "FOX",
      home: USC,
      away: NOTRE_DAME,
      lines: { spread: 6.5, spreadOpen: 5.5, total: 55.5, totalOpen: 54.5, mlHome: 215, mlAway: -265 },
      prediction: prediction(5.9, 56.5, 24.8, 30.7, 0.32, 6.5),
      systems: systems(11.9, 18.4),
      crewPicks: crew(["Mo", "away", "10-10"], ["Ty", "away", "15-5"]),
    },

    /* ---- the late window -------------------------------------------------- */
    {
      ...base,
      id: 9111,
      startTs: at(0, 22, 15),
      status: "scheduled",
      tv: "FOX",
      home: WASHINGTON,
      away: OREGON,
      lines: { spread: 7.5, spreadOpen: 6.5, total: 53.5, totalOpen: 52.5, mlHome: 240, mlAway: -300 },
      prediction: prediction(6.9, 54.5, 23.1, 30.0, 0.29, 7.5),
      systems: systems(13.2, 21.8),
      crewPicks: crew(["Jake", "away", "12-8"]),
    },
    {
      // No line yet — the state a card has to survive, and the one a Mountain
      // West late game is genuinely in on a Saturday morning.
      ...base,
      id: 9112,
      startTs: at(0, 22, 30),
      status: "scheduled",
      tv: null,
      home: NEVADA,
      away: SAN_DIEGO_STATE,
      lines: { spread: null, spreadOpen: null, total: null, totalOpen: null, mlHome: null, mlAway: null },
      prediction: null,
      systems: [],
    },
  ];
}

/* ---- the slate ---------------------------------------------------------- */

export function demoSlateData(now: number): SlateData {
  return {
    seasonId: DEMO_SEASON,
    week: DEMO_WEEK,
    seasonType: "regular",
    fetchedAt: new Date(now).toISOString(),
    // Lines are captured by a job on its own cadence, not at page load, and the
    // slate says so rather than dressing one up as the other.
    linesAsOf: new Date(now - 41 * 60_000).toISOString(),
    games: demoGames(now),
  };
}

/* ---- the hub ------------------------------------------------------------- */

const group = (
  id: string,
  name: string,
  slug: string,
  kind: GroupSummary["kind"],
  role: GroupSummary["role"] = "member",
): GroupSummary => ({
  id,
  name,
  slug,
  kind,
  role,
  visibility: "private",
  picksHiddenUntilKickoff: false,
});

const SATURDAY_BOYS = group("g1", "Saturday Boys", "saturday-boys", "pickem", "admin");
const THE_SHEET = group("g2", "The Sheet", "the-sheet", "betting");
const WORK_POOL = group("g3", "Work Pool", "work-pool", "pickem");

const SATURDAY: [string, string, string] = ["g1", "Saturday Boys", "saturday-boys"];
const WORK: [string, string, string] = ["g3", "Work Pool", "work-pool"];

const homePick = (
  gameId: number,
  market: HomePick["market"],
  side: HomePick["side"],
  line: number | null,
  pool: [string, string, string] = SATURDAY,
  result: HomePick["result"] = null,
): HomePick => ({
  gameId,
  market,
  side,
  line,
  result,
  groupId: pool[0],
  groupName: pool[1],
  groupSlug: pool[2],
});

export const sampleTally = (
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

export const DEMO_GROUPS: GroupStanding[] = [
  { group: SATURDAY_BOYS, place: 2, field: 9, tally: sampleTally(31, 19, 1, 6.4, 0.31) },
  { group: THE_SHEET, place: 1, field: 5, tally: sampleTally(24, 18, 0, 8.2, 0.22) },
  { group: WORK_POOL, place: null, field: 12, tally: EMPTY_TALLY },
];

/** A season that went up, came back, and is still ahead. */
export const DEMO_CURVE = [0.9, 1.8, 0.8, 2.6, 1.6, 0.6, 1.5, 3.3, 2.3, 3.2, 4.9, 3.9, 5.7];

const DEMO_PROGRESS: WeekProgress[] = [
  { name: "Saturday Boys", slug: "saturday-boys", made: 3, target: 8 },
  { name: "Work Pool", slug: "work-pool", made: 1, target: null },
];

/**
 * The viewer's action this week.
 *
 * Assembled through the real `buildPositions` rather than by hand, because that
 * is what writes the picks and bets back onto each `GameView` — `tintFor` and
 * the verdict chips read them off the game, so a hand-built `Position` renders
 * with the aura silently switched off.
 *
 * Covers the states a row has: a live game carrying both layers and the same
 * side held twice at different numbers, a pregame game picked in two different
 * pools, and settled positions on both ledgers.
 */
export function demoPositions(now: number): Position[] {
  const games = demoGames(now);
  const picks: HomePick[] = [
    // Picked at 4 and bet at 3 on the same game: the pick is now the worse
    // number and the bet the better one, which is the whole point of showing
    // held-against-now on both layers.
    homePick(9104, "spread", "away", 4),
    // The same game in two pools, on two markets — what `showPool` is for.
    homePick(9107, "spread", "home", 2.5),
    homePick(9107, "total", "under", 49.5, WORK),
    homePick(9101, "spread", "away", 2.5, SATURDAY, "win"),
  ];
  const bets: HomeBet[] = [
    { id: 1, gameId: 9104, betType: "total", side: "over", line: 44.5, result: null },
    // The same game held twice at different numbers — the case the money/pool
    // split exists for, and a half-point apart the way a real re-bet is.
    { id: 2, gameId: 9104, betType: "spread", side: "away", line: 3, result: null },
    { id: 3, gameId: 9105, betType: "spread", side: "away", line: 6.5, result: null },
    { id: 4, gameId: 9102, betType: "spread", side: "away", line: 3.5, result: "win" },
  ];
  return buildPositions(games, picks, bets);
}

export function demoHomeData(now: number): HomeData {
  const games = demoGames(now);
  const positions = demoPositions(now);
  const firstKick = games.find((g) => g.status === "scheduled")?.startTs ?? null;

  return {
    seasonId: DEMO_SEASON,
    week: DEMO_WEEK,
    seasonType: "regular",
    firstKick,
    liveCount: games.filter((g) => g.status === "in_progress").length,
    weekGameCount: games.length,
    positions,
    openBetCount: 3,
    openBetUnits: 3.0,
    weekPickCount: 4,
    groups: DEMO_GROUPS,
    progress: DEMO_PROGRESS,
    bets: sampleTally(24, 18, 1, 5.7, 0.19),
    picks: sampleTally(31, 19, 1, 6.4, 0.31),
    pickGroupCount: 2,
    curve: DEMO_CURVE,
  };
}
