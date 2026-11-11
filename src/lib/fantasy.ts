/**
 * ESPN fantasy football on the TV strip (TV-12).
 *
 * Reads ESPN's league feed (lm-api-reads.fantasy.espn.com, unofficial and
 * undocumented: the same one every fantasy bot uses). Public leagues need no
 * login. Everything ESPN-shaped is translated here so the cards only ever see
 * `FantasyData`.
 */

export interface FantasySide {
  teamId: number;
  name: string;
  abbrev: string;
  logo: string | null;
  record: string;
  score: number;
  projected: number;
  /** 0..1, ESPN's own number. Null once the matchup is decided. */
  winProb: number | null;
  /** Starters whose NFL game hasn't kicked, is on now, or is over. */
  toPlay: number;
  playing: number;
  done: number;
}

export interface FantasyMatchup {
  id: number;
  /** For the viewer's matchup, `a` is always the viewer's team. */
  a: FantasySide;
  b: FantasySide;
  final: boolean;
  mine: boolean;
}

export interface FantasyData {
  week: number;
  matchups: FantasyMatchup[];
  /** Any NFL game in this scoring period on right now. */
  live: boolean;
}

// ── ESPN shapes (only what's read) ─────────────────────────────────────────

interface EspnEntry {
  lineupSlotId: number;
  playerPoolEntry: { appliedStatTotal?: number; player: { proTeamId: number } };
}
interface EspnSide {
  teamId: number;
  totalPoints?: number;
  totalPointsLive?: number;
  totalProjectedPointsLive?: number;
  winProbability?: number;
  rosterForCurrentScoringPeriod?: { entries: EspnEntry[] };
}
interface EspnMatchup {
  id: number;
  matchupPeriodId: number;
  home: EspnSide;
  away?: EspnSide;
  winner: string;
}
interface EspnTeam {
  id: number;
  name?: string;
  location?: string;
  nickname?: string;
  abbrev: string;
  logo?: string;
  record?: { overall?: { wins: number; losses: number; ties: number } };
}
export interface EspnLeague {
  scoringPeriodId: number;
  status: { currentMatchupPeriod: number };
  teams: EspnTeam[];
  schedule: EspnMatchup[];
}
export interface EspnProGame {
  date: number;
  homeProTeamId: number;
  awayProTeamId: number;
}
export interface EspnProSchedules {
  settings: {
    proTeams: Array<{ id: number; proGamesByScoringPeriod?: Record<string, EspnProGame[]> }>;
  };
}

/** Bench and IR don't count toward the matchup. */
const BENCH = new Set([20, 21]);
/** An NFL game is treated as over this long after kickoff. */
const GAME_MS = 3.5 * 60 * 60 * 1000;

export function teamName(t: EspnTeam): string {
  return (t.name ?? [t.location, t.nickname].filter(Boolean).join(" ")).trim() || t.abbrev;
}

/**
 * The matchup period's games in one shape. `nowMs` is a parameter so the
 * yet-to-play arithmetic is testable.
 */
export function toFantasy(
  league: EspnLeague,
  pro: EspnProSchedules | null,
  myTeamId: number | null,
  nowMs: number,
): FantasyData {
  const period = league.status.currentMatchupPeriod;
  const scoring = String(league.scoringPeriodId);
  const kickoff = new Map<number, number>();
  for (const t of pro?.settings.proTeams ?? []) {
    const g = t.proGamesByScoringPeriod?.[scoring]?.[0];
    if (g) kickoff.set(t.id, g.date);
  }
  const live = [...kickoff.values()].some((d) => nowMs >= d && nowMs < d + GAME_MS);
  const teams = new Map(league.teams.map((t) => [t.id, t]));

  const side = (s: EspnSide, decided: boolean): FantasySide => {
    const t = teams.get(s.teamId);
    const r = t?.record?.overall;
    let toPlay = 0;
    let playing = 0;
    let done = 0;
    for (const e of s.rosterForCurrentScoringPeriod?.entries ?? []) {
      if (BENCH.has(e.lineupSlotId)) continue;
      const k = kickoff.get(e.playerPoolEntry.player.proTeamId);
      if (k === undefined || nowMs >= k + GAME_MS)
        done += 1; // bye counts as done
      else if (nowMs >= k) playing += 1;
      else toPlay += 1;
    }
    return {
      teamId: s.teamId,
      name: t ? teamName(t) : `Team ${s.teamId}`,
      abbrev: t?.abbrev ?? "",
      logo: t?.logo ?? null,
      record: r ? `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}` : "",
      score: Math.round((s.totalPointsLive ?? s.totalPoints ?? 0) * 100) / 100,
      projected: Math.round((s.totalProjectedPointsLive ?? 0) * 10) / 10,
      winProb: decided ? null : (s.winProbability ?? null),
      toPlay,
      playing,
      done,
    };
  };

  const matchups: FantasyMatchup[] = [];
  for (const m of league.schedule) {
    if (m.matchupPeriodId !== period || !m.away) continue; // byes have no away side
    const decided = m.winner !== "UNDECIDED";
    const home = side(m.home, decided);
    const away = side(m.away, decided);
    const mine = myTeamId !== null && (home.teamId === myTeamId || away.teamId === myTeamId);
    const [a, b] = mine && home.teamId === myTeamId ? [home, away] : [away, home];
    matchups.push({ id: m.id, a, b, final: decided, mine });
  }
  matchups.sort((x, y) => Number(y.mine) - Number(x.mine));
  return { week: period, matchups, live };
}
