/**
 * CollegeFootballData.com API client — the ONLY module allowed to talk to CFBD.
 *
 * Hard rules (docs/SPEC.md §1):
 *  - Server-side only. Pages never call this; scheduled jobs and scripts do,
 *    and they write results to Postgres.
 *  - Every call is counted so we can watch the monthly tier budget.
 *
 * Requires CFBD_API_KEY in the environment (Tier 2–3 recommended).
 */

const BASE_URL = "https://api.collegefootballdata.com";

export class CfbdError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = "CfbdError";
  }
}

let callCount = 0;
export function cfbdCallCount(): number {
  return callCount;
}

type Query = Record<string, string | number | boolean | undefined>;

/** Works under Node (process.env) and the Deno edge runtime (Deno.env). */
function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (proc?.env?.[name]) return proc.env[name];
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  return deno?.env.get(name);
}

async function get<T>(endpoint: string, query: Query = {}): Promise<T> {
  const apiKey = readEnv("CFBD_API_KEY");
  if (!apiKey) throw new Error("CFBD_API_KEY is not set");

  const url = new URL(endpoint, BASE_URL);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  // One jittered retry on 429/5xx/network + a hard timeout: a hung fetch on a
  // Saturday morning used to hold the whole job run hostage, and a transient
  // CFBD hiccup failed it outright (audit 07/OPS-10).
  for (let attempt = 0; ; attempt++) {
    callCount++;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt === 0) {
          await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
          continue;
        }
        throw new CfbdError(
          `CFBD ${endpoint} failed: ${res.status} ${res.statusText}`,
          res.status,
          endpoint,
        );
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof CfbdError || attempt > 0) throw err;
      // network error / timeout — one more try
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
    }
  }
}

// ---------------------------------------------------------------------------
// Types (fields we consume; CFBD returns more)
// ---------------------------------------------------------------------------

export interface CfbdTeam {
  id: number;
  school: string;
  mascot: string | null;
  abbreviation: string | null;
  conference: string | null;
  division: string | null;
  classification: string | null; // fbs | fcs | ii | iii
  color: string | null;
  alternateColor: string | null;
  logos: string[] | null;
}

export interface CfbdVenue {
  id: number;
  name: string;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  elevation: string | null;
  capacity: number | null;
  dome: boolean | null;
  timezone: string | null;
}

/** One broadcast row from /games/media — a game can have several outlets. */
export interface CfbdGameMedia {
  id: number;
  /** tv | radio | web | ppv … only tv is rendered */
  mediaType: string | null;
  outlet: string | null;
}

export interface CfbdGame {
  id: number;
  season: number;
  week: number;
  seasonType: string;
  startDate: string;
  startTimeTBD: boolean;
  neutralSite: boolean;
  conferenceGame: boolean;
  venueId: number | null;
  homeId: number;
  homeTeam: string;
  /** Conference at game time — the season's alignment, not the current one.
   *  Optional: .backtest-cache season files written before this field was
   *  consumed don't carry it; readers must tolerate undefined. */
  homeConference?: string | null;
  homeClassification?: string | null; // fbs | fcs | ii | iii
  homePoints: number | null;
  homePostgameWinProbability: number | null;
  awayId: number;
  awayTeam: string;
  awayConference?: string | null;
  awayClassification?: string | null;
  awayPoints: number | null;
  completed: boolean;
  notes: string | null;
}

export interface CfbdLine {
  id: number; // game id
  homeTeam: string;
  awayTeam: string;
  lines: Array<{
    provider: string;
    spread: number | null;
    formattedSpread: string | null;
    spreadOpen: number | null;
    overUnder: number | null;
    overUnderOpen: number | null;
    homeMoneyline: number | null;
    awayMoneyline: number | null;
  }>;
}

export interface CfbdReturningProduction {
  season: number;
  team: string;
  conference: string;
  totalPPA: number | null;
  totalPassingPPA: number | null;
  totalRushingPPA: number | null;
  totalReceivingPPA: number | null;
  percentPPA: number | null;
  percentPassingPPA: number | null;
  percentRushingPPA: number | null;
  percentReceivingPPA: number | null;
  usage: number | null;
  passingUsage: number | null;
  rushingUsage: number | null;
  receivingUsage: number | null;
}

export interface CfbdTalent {
  year: number;
  /** CFBD returns the school name under `team` on this endpoint */
  team: string;
  talent: number;
}

export interface CfbdSpRating {
  year: number;
  team: string;
  conference: string | null;
  rating: number;
  ranking: number | null;
  offense: { rating: number } | null;
  defense: { rating: number } | null;
}

export interface CfbdEloRating {
  year: number;
  week: number | null;
  team: string;
  conference: string | null;
  elo: number;
}

export interface CfbdFpiRating {
  year: number;
  team: string;
  conference: string | null;
  fpi: number;
}

export interface CfbdPortalEntry {
  season: number;
  firstName: string;
  lastName: string;
  position: string | null;
  origin: string | null;
  destination: string | null;
  transferDate: string | null;
  rating: number | null;
  stars: number | null;
  eligibility: string | null;
}

export interface CfbdRankingWeek {
  season: number;
  seasonType: string;
  week: number;
  polls: Array<{
    poll: string; // "AP Top 25" | "Coaches Poll" | "Playoff Committee Rankings" | ...
    ranks: Array<{
      rank: number;
      school: string;
      conference: string | null;
      firstPlaceVotes: number | null;
      points: number | null;
    }>;
  }>;
}

/**
 * One season of a coach's tenure. CFBD has been inconsistent about casing on
 * this endpoint across versions, so the raw shape is normalized in
 * scripts/lib/coaching.ts rather than trusted here.
 */
export interface CfbdCoachSeason {
  school: string;
  year: number;
  games: number | null;
  wins: number | null;
  losses: number | null;
  srs: number | null;
  spOverall: number | null;
  spOffense: number | null;
  spDefense: number | null;
  preseasonRank: number | null;
  postseasonRank: number | null;
}

export interface CfbdCoach {
  firstName: string | null;
  lastName: string | null;
  seasons: CfbdCoachSeason[];
}

/**
 * Per-game advanced stats. The model has only ever seen final scores, which
 * are a noisy summary of ~150 plays — garbage time, a tipped interception and
 * a shanked punt all move the margin without saying much about the teams.
 * PPA (CFBD's expected-points-added) measures the plays themselves.
 */
export interface CfbdAdvancedGameStatSide {
  plays: number | null;
  drives: number | null;
  /** PPA per play */
  ppa: number | null;
  /** PPA summed over the game — points-equivalent production */
  totalPPA: number | null;
  successRate: number | null;
  explosiveness: number | null;
}

export interface CfbdAdvancedGameStat {
  gameId: number;
  week: number | null;
  team: string;
  opponent: string | null;
  offense: CfbdAdvancedGameStatSide | null;
  defense: CfbdAdvancedGameStatSide | null;
}

export interface CfbdScoreboardGame {
  id: number;
  startDate: string;
  status: string; // scheduled | in_progress | completed
  period: number | null;
  clock: string | null;
  situation: string | null;
  lastPlay: string | null;
  possession: string | null;
  homeTeam: { id: number; name: string; points: number | null };
  awayTeam: { id: number; name: string; points: number | null };
  tv: string | null;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const cfbd = {
  teams: (year?: number) => get<CfbdTeam[]>("/teams", { year }),
  fbsTeams: (year: number) => get<CfbdTeam[]>("/teams/fbs", { year }),
  venues: () => get<CfbdVenue[]>("/venues"),

  games: (year: number, opts: { week?: number; seasonType?: string; classification?: string } = {}) =>
    get<CfbdGame[]>("/games", {
      year,
      week: opts.week,
      seasonType: opts.seasonType ?? "regular",
      classification: opts.classification ?? "fbs",
    }),

  lines: (year: number, opts: { week?: number; seasonType?: string } = {}) =>
    get<CfbdLine[]>("/lines", { year, week: opts.week, seasonType: opts.seasonType }),

  /**
   * Broadcast assignments. The /scoreboard feed carries `tv` too, but only for
   * games it considers current — so before this existed, `games.tv` was null
   * for all 888 rows of the 2026 season and the card never showed a network
   * until a game was already playing, which is precisely too late.
   */
  gameMedia: (year: number, opts: { week?: number; seasonType?: string } = {}) =>
    get<CfbdGameMedia[]>("/games/media", {
      year,
      week: opts.week,
      seasonType: opts.seasonType ?? "regular",
      classification: "fbs",
    }),

  returningProduction: (year: number, team?: string) =>
    get<CfbdReturningProduction[]>("/player/returning", { year, team }),

  talent: (year: number) => get<CfbdTalent[]>("/talent", { year }),

  spRatings: (year: number) => get<CfbdSpRating[]>("/ratings/sp", { year }),
  eloRatings: (year: number, week?: number) => get<CfbdEloRating[]>("/ratings/elo", { year, week }),
  fpiRatings: (year: number) => get<CfbdFpiRating[]>("/ratings/fpi", { year }),

  portal: (year: number) => get<CfbdPortalEntry[]>("/player/portal", { year }),

  /**
   * Coaching histories — head coach per school-season with that season's
   * record and SP+ splits. One call with a minYear/maxYear window returns the
   * whole history, which is what the preseason coaching adjustment needs.
   */
  coaches: (
    opts: { year?: number; minYear?: number; maxYear?: number; team?: string } = {},
  ) =>
    get<CfbdCoach[]>("/coaches", {
      year: opts.year,
      minYear: opts.minYear,
      maxYear: opts.maxYear,
      team: opts.team,
    }),

  /**
   * Per-game advanced stats (PPA, success rate, explosiveness) — the
   * play-level signal the score alone throws away. One call covers a whole
   * season when `week` is omitted.
   */
  advancedGameStats: (year: number, opts: { week?: number; team?: string } = {}) =>
    get<CfbdAdvancedGameStat[]>("/stats/game/advanced", {
      year,
      week: opts.week,
      team: opts.team,
    }),

  /** Human polls (AP / Coaches / CFP). Returns school NAMES, not team ids. */
  rankings: (year: number, opts: { week?: number; seasonType?: string } = {}) =>
    get<CfbdRankingWeek[]>("/rankings", { year, week: opts.week, seasonType: opts.seasonType }),

  /** Requires Tier 1+. Live game states for the Saturday poll job. */
  scoreboard: (classification = "fbs") =>
    get<CfbdScoreboardGame[]>("/scoreboard", { classification }),
};
