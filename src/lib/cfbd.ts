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

  callCount++;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new CfbdError(
      `CFBD ${endpoint} failed: ${res.status} ${res.statusText}`,
      res.status,
      endpoint,
    );
  }
  return (await res.json()) as T;
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
  homePoints: number | null;
  homePostgameWinProbability: number | null;
  awayId: number;
  awayTeam: string;
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

export interface CfbdScoreboardGame {
  id: number;
  startDate: string;
  status: string; // scheduled | in_progress | completed
  period: number | null;
  clock: string | null;
  situation: string | null;
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

  returningProduction: (year: number, team?: string) =>
    get<CfbdReturningProduction[]>("/player/returning", { year, team }),

  talent: (year: number) => get<CfbdTalent[]>("/talent", { year }),

  spRatings: (year: number) => get<CfbdSpRating[]>("/ratings/sp", { year }),
  eloRatings: (year: number, week?: number) => get<CfbdEloRating[]>("/ratings/elo", { year, week }),
  fpiRatings: (year: number) => get<CfbdFpiRating[]>("/ratings/fpi", { year }),

  portal: (year: number) => get<CfbdPortalEntry[]>("/player/portal", { year }),

  /** Requires Tier 1+. Live game states for the Saturday poll job. */
  scoreboard: (classification = "fbs") =>
    get<CfbdScoreboardGame[]>("/scoreboard", { classification }),
};
