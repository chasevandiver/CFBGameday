/**
 * ESPN men's college basketball — wire types and pure parsers.
 *
 * The fetches are `espnCbb` in `espn.ts` (the one module allowed to talk to
 * the host). Everything here is a pure function of a response body, so the
 * fixtures in `espn-cbb.test.ts` — trimmed from the live board on 2026-11-11 —
 * pin every field the ingest reads.
 *
 * What the scoreboard carries for basketball, and what it does not:
 *
 *  - schedule, status, period and clock, score, points by half, team records,
 *    AP rank, conference id, broadcasts, venue, the last play, and ESPN's own
 *    live win probability — all in the ONE call that covers the whole night;
 *  - **no team fouls.** The bonus needs fouls per half, and those exist only
 *    in the per-game `/summary` play-by-play. So the bonus is a game-page
 *    fact (one call when someone opens a game) and not a slate-card fact (one
 *    call per live game per tick, ~60 of them on a Saturday).
 */

import { hexColor, mapStatus, tvOf, type EspnStatus } from "./espn";
import { foulHalf } from "./cbb";

/* ---- wire shapes (the fields consumed; ESPN sends far more) --------------- */

interface WireRecord {
  type?: string | null;
  summary?: string | null;
}

interface WireTeam {
  id: string;
  abbreviation?: string | null;
  displayName?: string | null;
  shortDisplayName?: string | null;
  location?: string | null;
  name?: string | null;
  color?: string | null;
  alternateColor?: string | null;
  logo?: string | null;
  conferenceId?: string | null;
}

interface WireCompetitor {
  homeAway: "home" | "away";
  score?: string | null;
  team: WireTeam;
  linescores?: Array<{ value?: number | null; period?: number | null }> | null;
  curatedRank?: { current?: number | null } | null;
  records?: WireRecord[] | null;
}

export interface CbbWireEvent {
  id: string;
  name?: string | null;
  date: string;
  season?: { year?: number; type?: number } | null;
  competitions: Array<{
    neutralSite?: boolean | null;
    timeValid?: boolean | null;
    conferenceCompetition?: boolean | null;
    venue?: {
      id?: string | null;
      fullName?: string | null;
      address?: { city?: string | null; state?: string | null } | null;
      indoor?: boolean | null;
    } | null;
    broadcasts?: Array<{ names?: string[] | null }> | null;
    notes?: Array<{ headline?: string | null }> | null;
    status?: EspnStatus | null;
    situation?: {
      lastPlay?: {
        text?: string | null;
        type?: { text?: string | null } | null;
        scoreValue?: number | null;
        team?: { id?: string | null } | null;
        probability?: { homeWinPercentage?: number | null } | null;
      } | null;
    } | null;
    competitors: WireCompetitor[];
  }>;
  status?: EspnStatus | null;
}

export interface CbbWireScoreboard {
  events?: CbbWireEvent[] | null;
}

/* ---- parsed shapes -------------------------------------------------------- */

export interface CbbTeam {
  /** Raw ESPN id — callers offset with `cbbTeamId()` before storing. */
  espnId: number;
  displayName: string;
  /** "California" — the school, which is what `teams.school` holds. */
  location: string | null;
  /** "Golden Bears" */
  name: string | null;
  abbreviation: string | null;
  color: string | null;
  altColor: string | null;
  logo: string | null;
  conferenceId: string | null;
  /** AP rank 1–25, null when unranked (ESPN sends 99 for that). */
  rank: number | null;
  /** "2-1" overall and in conference, as ESPN states them. */
  record: string | null;
  confRecord: string | null;
}

export interface CbbGame {
  /** ESPN event id — stored as `games.id` unchanged. */
  id: number;
  /** ESPN's season year, the year the season ENDS (2027 for 2026-27). */
  seasonEndYear: number;
  startDate: string;
  startTimeTbd: boolean;
  neutralSite: boolean;
  conferenceGame: boolean;
  status: "scheduled" | "in_progress" | "final" | "postponed" | "canceled";
  /** 1–2 are the halves, 3+ overtime. Kept on a final so OT can be labelled. */
  period: number | null;
  clock: string | null;
  lastPlay: string | null;
  lastPlayType: string | null;
  /** The last play, when it was a basket: who and how many. For run tracking. */
  lastScorer: { side: "home" | "away"; pts: number } | null;
  home: CbbTeam;
  away: CbbTeam;
  homePoints: number | null;
  awayPoints: number | null;
  /** Points by period, halves then overtimes. Empty before tip. */
  homeLine: number[];
  awayLine: number[];
  /** ESPN's live home win probability, 0–1. */
  winProb: number | null;
  tv: string | null;
  /** "NCAA Tournament - 1st Round", "Veterans Classic" — the event's banner. */
  note: string | null;
  venue: {
    espnId: number | null;
    name: string | null;
    city: string | null;
    state: string | null;
    indoor: boolean;
  } | null;
}

const UNRANKED = 99;

function recordOf(records: WireRecord[] | null | undefined, type: string): string | null {
  const r = (records ?? []).find((x) => x.type === type)?.summary;
  return r && /^\d+-\d+$/.test(r) ? r : null;
}

function teamOf(c: WireCompetitor | undefined): CbbTeam {
  const t = c?.team;
  const rank = c?.curatedRank?.current;
  const conf = recordOf(c?.records, "vsconf");
  return {
    espnId: Number(t?.id ?? 0),
    displayName: t?.displayName ?? "",
    location: t?.location ?? t?.shortDisplayName ?? null,
    name: t?.name ?? null,
    abbreviation: t?.abbreviation ?? null,
    color: hexColor(t?.color),
    altColor: hexColor(t?.alternateColor),
    logo: t?.logo ?? null,
    conferenceId: t?.conferenceId ?? null,
    rank: typeof rank === "number" && rank >= 1 && rank < UNRANKED && rank <= 25 ? rank : null,
    record: recordOf(c?.records, "total"),
    // "0-0" before league play starts is a record nobody quotes.
    confRecord: conf === "0-0" ? null : conf,
  };
}

function lineOf(c: WireCompetitor | undefined): number[] {
  return (c?.linescores ?? [])
    .map((l) => (typeof l.value === "number" && Number.isFinite(l.value) ? Math.round(l.value) : null))
    .filter((v): v is number => v !== null);
}

function scoreOf(c: WireCompetitor | undefined, started: boolean): number | null {
  if (!c || !started) return null;
  const n = Number(c.score);
  return Number.isFinite(n) ? n : null;
}

export function parseCbbEvent(event: CbbWireEvent): CbbGame {
  const comp = event.competitions[0];
  const home = comp?.competitors.find((c) => c.homeAway === "home");
  const away = comp?.competitors.find((c) => c.homeAway === "away");
  const status = comp?.status ?? event.status;
  const mapped = mapStatus(status);
  const started = mapped === "in_progress" || mapped === "final";
  const inProgress = mapped === "in_progress";
  const lp = comp?.situation?.lastPlay;
  const venue = comp?.venue;
  const venueId = venue?.id != null ? Number(venue.id) : null;

  const scorerId = lp?.team?.id ?? null;
  const scoreValue = typeof lp?.scoreValue === "number" ? lp.scoreValue : 0;
  /* `scoreValue` is the play's WORTH, not proof it went in — a missed layup
     carries 2. ESPN names made baskets "made" in the text and a miss "misses",
     so the text decides; the type alone ("LayUpShot") is the same for both. */
  const made = inProgress && scoreValue > 0 && /\bmade\b|\bmakes\b/i.test(lp?.text ?? "");
  const lastScorer =
    made && scorerId !== null
      ? scorerId === home?.team.id
        ? { side: "home" as const, pts: scoreValue }
        : scorerId === away?.team.id
          ? { side: "away" as const, pts: scoreValue }
          : null
      : null;

  const wp = lp?.probability?.homeWinPercentage;

  return {
    id: Number(event.id),
    seasonEndYear: event.season?.year ?? 0,
    startDate: event.date,
    startTimeTbd: comp?.timeValid === false,
    neutralSite: comp?.neutralSite === true,
    conferenceGame: comp?.conferenceCompetition === true,
    status: mapped,
    period: started ? (status?.period ?? null) : null,
    clock: inProgress ? (status?.displayClock ?? null) : null,
    lastPlay: inProgress ? (lp?.text ?? null) : null,
    lastPlayType: inProgress ? (lp?.type?.text ?? null) : null,
    lastScorer,
    home: teamOf(home),
    away: teamOf(away),
    homePoints: scoreOf(home, started),
    awayPoints: scoreOf(away, started),
    homeLine: started ? lineOf(home) : [],
    awayLine: started ? lineOf(away) : [],
    winProb: inProgress && typeof wp === "number" && wp >= 0 && wp <= 1 ? wp : null,
    tv: tvOf(comp?.broadcasts),
    note: comp?.notes?.find((n) => n.headline)?.headline ?? null,
    venue: venue
      ? {
          espnId: venueId !== null && Number.isFinite(venueId) ? venueId : null,
          name: venue.fullName ?? null,
          city: venue.address?.city ?? null,
          state: venue.address?.state ?? null,
          indoor: venue.indoor !== false,
        }
      : null,
  };
}

export function parseCbbScoreboard(board: unknown): CbbGame[] {
  const events = (board as CbbWireScoreboard | null)?.events ?? [];
  return events.filter((e) => e?.competitions?.[0]).map(parseCbbEvent);
}

/**
 * Basketball's non-plays. Same rule as football's `isRealPlay`: a timeout or a
 * substitution must not erase the basket it follows, and the list is a
 * deny-list so an unrecognised type shows up rather than vanishing.
 */
const CBB_NON_PLAY = /timeout|substitution|end period|end game|end of|jumpball|challenge|official/i;

export function isRealCbbPlay(text: string | null, type: string | null): boolean {
  if (!text || !text.trim()) return false;
  return !CBB_NON_PLAY.test(type && type.trim() ? type : text);
}

/** `{ "7": "Big Ten", … }` from the conferences endpoint. Division I's own
 *  group (id 50) is not a conference and is left out. */
export function parseCbbConferences(body: unknown): Map<string, string> {
  const rows =
    (body as { conferences?: Array<{ groupId?: string; shortName?: string; name?: string }> } | null)
      ?.conferences ?? [];
  const out = new Map<string, string>();
  for (const r of rows) {
    if (!r.groupId || r.groupId === "50") continue;
    const name = r.shortName ?? r.name;
    if (name) out.set(String(r.groupId), name);
  }
  return out;
}

/* ---- the game page: box score from /summary -------------------------------- */

export interface HoopsTeamBox {
  /** "14-36" style made-attempted strings, exactly as ESPN prints them. */
  fg: string | null;
  three: string | null;
  ft: string | null;
  fgPct: number | null;
  threePct: number | null;
  ftPct: number | null;
  rebounds: number | null;
  offRebounds: number | null;
  assists: number | null;
  turnovers: number | null;
  steals: number | null;
  blocks: number | null;
  fouls: number | null;
  paintPoints: number | null;
  fastBreakPoints: number | null;
  largestLead: number | null;
  /** Team fouls by half: index 0 is the first half, 1 the second (plus OT). */
  foulsByHalf: [number, number];
  /** Points by period, halves then overtimes. */
  line: number[];
  players: HoopsPlayerLine[];
}

export interface HoopsPlayerLine {
  name: string;
  jersey: string | null;
  starter: boolean;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  fg: string;
  three: string;
  ft: string;
  pf: number;
}

export interface HoopsBox {
  period: number | null;
  clock: string | null;
  /** The half whose fouls are live — see `foulHalf`. */
  half: 1 | 2;
  leadChanges: number | null;
  home: HoopsTeamBox;
  away: HoopsTeamBox;
}

interface SummaryWire {
  boxscore?: {
    teams?: Array<{
      team?: { id?: string | null } | null;
      statistics?: Array<{ name?: string | null; displayValue?: string | null }> | null;
    }> | null;
    players?: Array<{
      team?: { id?: string | null } | null;
      statistics?: Array<{
        names?: string[] | null;
        athletes?: Array<{
          athlete?: { displayName?: string | null; shortName?: string | null; jersey?: string | null } | null;
          starter?: boolean | null;
          didNotPlay?: boolean | null;
          stats?: string[] | null;
        }> | null;
      }> | null;
    }> | null;
  } | null;
  plays?: Array<{
    type?: { text?: string | null } | null;
    period?: { number?: number | null } | null;
    team?: { id?: string | null } | null;
  }> | null;
  header?: {
    competitions?: Array<{
      status?: EspnStatus | null;
      competitors?: Array<{
        homeAway?: string | null;
        team?: { id?: string | null } | null;
        linescores?: Array<{ displayValue?: string | null }> | null;
      }> | null;
    }> | null;
  } | null;
}

const num = (s: string | null | undefined): number | null => {
  if (s == null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * Reduce a `/summary` response to the hoops game page's box.
 *
 * Returns null when the response has no box for both teams — before tip ESPN
 * sends the teams with empty statistics, and a box of dashes is not worth a
 * section. Fouls by half come from counting foul plays, checked against the
 * box score's own total on the capture this was written from (USC 7, Cal 9).
 */
export function parseHoopsBox(body: unknown): HoopsBox | null {
  const s = body as SummaryWire | null;
  const comp = s?.header?.competitions?.[0];
  const homeId = comp?.competitors?.find((c) => c.homeAway === "home")?.team?.id ?? null;
  const awayId = comp?.competitors?.find((c) => c.homeAway === "away")?.team?.id ?? null;
  if (!homeId || !awayId) return null;

  const teamBox = (id: string): HoopsTeamBox | null => {
    const t = s?.boxscore?.teams?.find((x) => x.team?.id === id);
    const stats = new Map((t?.statistics ?? []).map((x) => [x.name ?? "", x.displayValue ?? null]));
    if (stats.size === 0) return null;
    const fouls: [number, number] = [0, 0];
    for (const p of s?.plays ?? []) {
      if (p.team?.id !== id || !/foul/i.test(p.type?.text ?? "")) continue;
      fouls[foulHalf(p.period?.number ?? null) - 1] += 1;
    }
    const line = (comp?.competitors?.find((c) => c.team?.id === id)?.linescores ?? [])
      .map((l) => num(l.displayValue))
      .filter((v): v is number => v !== null);
    const block = s?.boxscore?.players?.find((x) => x.team?.id === id)?.statistics?.[0];
    const col = (name: string) => (block?.names ?? []).indexOf(name);
    const at = (stats_: string[] | null | undefined, name: string) => {
      const i = col(name);
      return i < 0 ? null : (stats_?.[i] ?? null);
    };
    const players: HoopsPlayerLine[] = (block?.athletes ?? [])
      .filter((a) => a.didNotPlay !== true && (a.stats?.length ?? 0) > 0)
      .map((a) => ({
        name: a.athlete?.shortName ?? a.athlete?.displayName ?? "",
        jersey: a.athlete?.jersey ?? null,
        starter: a.starter === true,
        min: num(at(a.stats, "MIN")) ?? 0,
        pts: num(at(a.stats, "PTS")) ?? 0,
        reb: num(at(a.stats, "REB")) ?? 0,
        ast: num(at(a.stats, "AST")) ?? 0,
        fg: at(a.stats, "FG") ?? "0-0",
        three: at(a.stats, "3PT") ?? "0-0",
        ft: at(a.stats, "FT") ?? "0-0",
        pf: num(at(a.stats, "PF")) ?? 0,
      }))
      .filter((p) => p.name !== "")
      // Scorers lead; minutes break ties so a starter with a quiet night
      // still sits above a walk-on's one made free throw.
      .sort((x, y) => y.pts - x.pts || y.min - x.min);
    return {
      fg: stats.get("fieldGoalsMade-fieldGoalsAttempted") ?? null,
      three: stats.get("threePointFieldGoalsMade-threePointFieldGoalsAttempted") ?? null,
      ft: stats.get("freeThrowsMade-freeThrowsAttempted") ?? null,
      fgPct: num(stats.get("fieldGoalPct")),
      threePct: num(stats.get("threePointFieldGoalPct")),
      ftPct: num(stats.get("freeThrowPct")),
      rebounds: num(stats.get("totalRebounds")),
      offRebounds: num(stats.get("offensiveRebounds")),
      assists: num(stats.get("assists")),
      turnovers: num(stats.get("totalTurnovers") ?? stats.get("turnovers")),
      steals: num(stats.get("steals")),
      blocks: num(stats.get("blocks")),
      fouls: num(stats.get("fouls")),
      paintPoints: num(stats.get("pointsInPaint")),
      fastBreakPoints: num(stats.get("fastBreakPoints")),
      largestLead: num(stats.get("largestLead")),
      foulsByHalf: fouls,
      line,
      players,
    };
  };

  const home = teamBox(homeId);
  const away = teamBox(awayId);
  if (!home || !away) return null;
  const leadStat = s?.boxscore?.teams?.[0]?.statistics?.find((x) => x.name === "leadChanges");
  const period = comp?.status?.period ?? null;
  return {
    period,
    clock: comp?.status?.displayClock ?? null,
    half: foulHalf(period),
    leadChanges: num(leadStat?.displayValue),
    home,
    away,
  };
}
