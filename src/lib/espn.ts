/**
 * ESPN NFL API client — the ONLY module allowed to talk to site.api.espn.com.
 *
 * Hard rules (docs/SPEC.md §1 applies here as it does to cfbd.ts):
 *  - Server-side only. Pages never call this; scheduled jobs and scripts do,
 *    and they write results to Postgres.
 *  - Every call is counted. The API is free and unauthenticated, but an
 *    unmetered fetch loop is invisible in /admin, so calls land in
 *    api_call_log with source 'espn' like every other feed.
 *
 * The scoreboard endpoint is the whole integration: one response carries the
 * schedule, live status/scores/clock/situation, broadcasts, venue, and the
 * priority sportsbook's odds (spread/total/moneylines, with openers). Parsing
 * of that response lives here as pure exported functions so fixtures captured
 * from the live feed can pin the odds sign convention in espn.test.ts —
 * a silent inversion would poison the append-only line_snapshots table.
 */

const BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/";

export class EspnError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = "EspnError";
  }
}

let callCount = 0;
export function espnCallCount(): number {
  return callCount;
}

type Query = Record<string, string | number | boolean | undefined>;

async function get<T>(endpoint: string, query: Query = {}): Promise<T> {
  const url = new URL(endpoint, BASE_URL);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  // Same resilience shape as cfbd.ts (audit 07/OPS-10): one jittered retry on
  // 429/5xx/network plus a hard timeout so a hung fetch can't hold a job run.
  for (let attempt = 0; ; attempt++) {
    callCount++;
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt === 0) {
          await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
          continue;
        }
        throw new EspnError(
          `ESPN ${endpoint} failed: ${res.status} ${res.statusText}`,
          res.status,
          endpoint,
        );
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof EspnError || attempt > 0) throw err;
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
    }
  }
}

// ---------------------------------------------------------------------------
// Wire types (fields we consume; ESPN returns far more)
// ---------------------------------------------------------------------------

/** One side of the pointSpread/total market: close plus the true opener. */
interface EspnOddsQuote {
  open?: { line?: string | null } | null;
  close?: { line?: string | null } | null;
}

export interface EspnOdds {
  provider?: { name?: string | null; displayName?: string | null } | null;
  /** e.g. "CIN -7", "EVEN" — favorite abbreviation + line, used as cross-check */
  details?: string | null;
  /** Home-perspective spread, negative = home favored (verified vs. details) */
  spread?: number | null;
  overUnder?: number | null;
  pointSpread?: { home?: EspnOddsQuote | null } | null;
  total?: { over?: EspnOddsQuote | null } | null;
  moneyline?: {
    home?: { close?: { odds?: string | null } | null } | null;
    away?: { close?: { odds?: string | null } | null } | null;
  } | null;
  homeTeamOdds?: { favorite?: boolean | null } | null;
  awayTeamOdds?: { favorite?: boolean | null } | null;
}

export interface EspnCompetitor {
  homeAway: "home" | "away";
  score?: string | null;
  team: {
    id: string;
    abbreviation?: string | null;
    displayName?: string | null;
  };
}

export interface EspnEvent {
  id: string;
  name?: string | null;
  date: string;
  season?: { year?: number; type?: number } | null;
  week?: { number?: number } | null;
  competitions: Array<{
    neutralSite?: boolean | null;
    timeValid?: boolean | null;
    venue?: {
      id?: string | null;
      fullName?: string | null;
      address?: { city?: string | null; state?: string | null } | null;
      indoor?: boolean | null;
    } | null;
    broadcasts?: Array<{ market?: string | null; names?: string[] | null }> | null;
    status?: EspnStatus | null;
    situation?: {
      downDistanceText?: string | null;
      shortDownDistanceText?: string | null;
      possessionText?: string | null;
      possession?: string | null; // ESPN team id of the team with the ball
      lastPlay?: { text?: string | null } | null;
    } | null;
    odds?: EspnOdds[] | null;
    competitors: EspnCompetitor[];
  }>;
  status?: EspnStatus | null;
}

interface EspnStatus {
  displayClock?: string | null;
  period?: number | null;
  type?: {
    name?: string | null; // STATUS_SCHEDULED | STATUS_IN_PROGRESS | STATUS_FINAL | ...
    state?: string | null; // pre | in | post
    completed?: boolean | null;
  } | null;
}

export interface EspnScoreboard {
  season?: { year?: number; type?: number } | null;
  week?: { number?: number } | null;
  events: EspnEvent[];
}

interface EspnTeamsResponse {
  sports: Array<{
    leagues: Array<{
      teams: Array<{
        team: {
          id: string;
          displayName: string;
          location?: string | null;
          name?: string | null;
          abbreviation?: string | null;
          color?: string | null;
          alternateColor?: string | null;
          logos?: Array<{ href: string; rel?: string[] | null }> | null;
        };
      }>;
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// Parsed shapes
// ---------------------------------------------------------------------------

/** ESPN season type codes. Preseason is fetched only implicitly (current board). */
export const ESPN_SEASON_TYPE = { preseason: 1, regular: 2, postseason: 3 } as const;

export interface NflTeam {
  /** Raw ESPN id (1–34) — callers offset with nflTeamId() before storing. */
  espnId: number;
  displayName: string; // "Kansas City Chiefs"
  location: string | null; // "Kansas City"
  name: string | null; // "Chiefs"
  abbreviation: string | null;
  color: string | null; // normalized to "#rrggbb"
  altColor: string | null;
  logo: string | null;
}

/** One book's line, home-perspective spread (negative = home favored). */
export interface NflLine {
  provider: string;
  spread: number | null;
  spreadOpen: number | null;
  total: number | null;
  totalOpen: number | null;
  mlHome: number | null;
  mlAway: number | null;
}

export interface NflScoreboardGame {
  id: number; // ESPN event id — stored as games.id unchanged
  seasonYear: number;
  /** Raw ESPN season type code (1 pre / 2 regular / 3 post) */
  espnSeasonType: number;
  /** Raw ESPN week number within that season type */
  espnWeek: number;
  name: string;
  startDate: string;
  startTimeTbd: boolean;
  neutralSite: boolean;
  status: "scheduled" | "in_progress" | "final" | "postponed" | "canceled";
  period: number | null;
  clock: string | null;
  situation: string | null;
  lastPlay: string | null;
  possession: "home" | "away" | null;
  /** Raw ESPN team ids — callers offset with nflTeamId() before storing */
  homeEspnId: number;
  awayEspnId: number;
  homeAbbr: string | null;
  awayAbbr: string | null;
  homePoints: number | null;
  awayPoints: number | null;
  tv: string | null;
  venue: { espnId: number | null; name: string | null; city: string | null; state: string | null; indoor: boolean } | null;
  odds: NflLine | null;
}

// ---------------------------------------------------------------------------
// Pure parsers (fixture-tested in espn.test.ts)
// ---------------------------------------------------------------------------

/** "-278" → -278, "+225" → 225, "EVEN" → 100. Anything else → null. */
export function parseMoneyline(s: string | null | undefined): number | null {
  if (s == null) return null;
  const t = s.trim();
  if (/^even$/i.test(t)) return 100;
  const n = Number(t.replace(/^\+/, ""));
  return Number.isFinite(n) && Number.isInteger(n) && n !== 0 ? n : null;
}

/** "o38.5" / "u38.5" / "38.5" → 38.5. */
function parseTotalLine(s: string | null | undefined): number | null {
  if (s == null) return null;
  const n = Number(s.trim().replace(/^[ou]/i, ""));
  return Number.isFinite(n) ? n : null;
}

function parseSpreadLine(s: string | null | undefined): number | null {
  if (s == null) return null;
  const n = Number(s.trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * The home-perspective spread implied by the `details` string ("CIN -7",
 * "GB -2.5" where GB is away, "EVEN"), or null when it can't be read.
 * Used only as a cross-check against the numeric fields.
 */
export function spreadFromDetails(
  details: string | null | undefined,
  homeAbbr: string | null | undefined,
  awayAbbr: string | null | undefined,
): number | null {
  if (!details) return null;
  const t = details.trim();
  if (/^(even|pk|pick ?'?em)$/i.test(t)) return 0;
  const m = t.match(/^([A-Z]{2,4})\s+([+-]?\d+(?:\.\d+)?)$/i);
  if (!m) return null;
  const abbr = m[1].toUpperCase();
  const line = Number(m[2]);
  if (!Number.isFinite(line)) return null;
  if (homeAbbr && abbr === homeAbbr.toUpperCase()) return line;
  if (awayAbbr && abbr === awayAbbr.toUpperCase()) return -line;
  return null;
}

/**
 * One event's best line, or null when the board carries no odds (game started,
 * or the book hasn't posted). Convention: home perspective, negative = home
 * favored — the same convention as line_snapshots (0001) and CFBD.
 *
 * The numeric `spread` field is trusted only when every other reading of the
 * same object agrees with it: the `details` string and the favorite flags are
 * derived independently upstream, and when they disagree the object is
 * malformed in a way we can't adjudicate — so the spread is dropped rather
 * than stored possibly inverted. Poisoning an append-only table is the one
 * unrecoverable failure here; a missing snapshot costs nothing.
 */
export function parseEventOdds(
  odds: EspnOdds[] | null | undefined,
  homeAbbr: string | null | undefined,
  awayAbbr: string | null | undefined,
): NflLine | null {
  const o = odds?.[0];
  if (!o) return null;

  const fromDetails = spreadFromDetails(o.details, homeAbbr, awayAbbr);
  let spread =
    (typeof o.spread === "number" ? o.spread : null) ??
    parseSpreadLine(o.pointSpread?.home?.close?.line) ??
    fromDetails;
  if (spread !== null) {
    if (fromDetails !== null && fromDetails !== spread) spread = null;
    const fav = o.homeTeamOdds?.favorite;
    if (spread !== null && typeof fav === "boolean" && spread !== 0 && fav !== spread < 0) spread = null;
  }

  const total = typeof o.overUnder === "number" ? o.overUnder : parseTotalLine(o.total?.over?.close?.line);

  return {
    provider: o.provider?.name ?? o.provider?.displayName ?? "ESPN",
    spread,
    // openers only make sense alongside a trusted current line
    spreadOpen: spread === null ? null : parseSpreadLine(o.pointSpread?.home?.open?.line),
    total,
    totalOpen: total === null ? null : parseTotalLine(o.total?.over?.open?.line),
    mlHome: parseMoneyline(o.moneyline?.home?.close?.odds),
    mlAway: parseMoneyline(o.moneyline?.away?.close?.odds),
  };
}

function mapStatus(status: EspnStatus | null | undefined): NflScoreboardGame["status"] {
  const name = status?.type?.name ?? "";
  if (name === "STATUS_POSTPONED") return "postponed";
  if (name === "STATUS_CANCELED" || name === "STATUS_FORFEIT") return "canceled";
  const state = status?.type?.state;
  if (state === "in") return "in_progress";
  if (state === "post") return "final";
  return "scheduled";
}

function scoreOf(c: EspnCompetitor | undefined, started: boolean): number | null {
  if (!c || !started) return null;
  const n = Number(c.score);
  return Number.isFinite(n) ? n : null;
}

/** Every distinct broadcast network, "NBC" or "CBS/Paramount+" style. */
function tvOf(broadcasts: Array<{ names?: string[] | null }> | null | undefined): string | null {
  const names = [...new Set((broadcasts ?? []).flatMap((b) => b.names ?? []))];
  return names.length ? names.join("/") : null;
}

export function parseEvent(event: EspnEvent): NflScoreboardGame {
  const comp = event.competitions[0];
  const home = comp?.competitors.find((c) => c.homeAway === "home");
  const away = comp?.competitors.find((c) => c.homeAway === "away");
  const status = comp?.status ?? event.status;
  const mapped = mapStatus(status);
  const started = mapped !== "scheduled" && mapped !== "postponed" && mapped !== "canceled";
  const inProgress = mapped === "in_progress";
  const sit = comp?.situation;
  const possession =
    inProgress && sit?.possession
      ? sit.possession === home?.team.id
        ? "home"
        : sit.possession === away?.team.id
          ? "away"
          : null
      : null;
  const venue = comp?.venue;
  const venueId = venue?.id != null ? Number(venue.id) : null;

  return {
    id: Number(event.id),
    seasonYear: event.season?.year ?? 0,
    espnSeasonType: event.season?.type ?? 0,
    espnWeek: event.week?.number ?? 0,
    name: event.name ?? "",
    startDate: event.date,
    startTimeTbd: comp?.timeValid === false,
    neutralSite: comp?.neutralSite === true,
    status: mapped,
    period: inProgress ? (status?.period ?? null) : null,
    clock: inProgress ? (status?.displayClock ?? null) : null,
    situation: inProgress ? (sit?.shortDownDistanceText ?? sit?.downDistanceText ?? null) : null,
    lastPlay: inProgress ? (sit?.lastPlay?.text ?? null) : null,
    possession,
    homeEspnId: Number(home?.team.id ?? 0),
    awayEspnId: Number(away?.team.id ?? 0),
    homeAbbr: home?.team.abbreviation ?? null,
    awayAbbr: away?.team.abbreviation ?? null,
    homePoints: scoreOf(home, started),
    awayPoints: scoreOf(away, started),
    tv: tvOf(comp?.broadcasts),
    venue: venue
      ? {
          espnId: Number.isFinite(venueId) ? venueId : null,
          name: venue.fullName ?? null,
          city: venue.address?.city ?? null,
          state: venue.address?.state ?? null,
          indoor: venue.indoor === true,
        }
      : null,
    odds: parseEventOdds(comp?.odds, home?.team.abbreviation, away?.team.abbreviation),
  };
}

/**
 * The (season_type, week) an ESPN postseason event is stored under, or null
 * when the event isn't part of the bracket. ESPN's postseason weeks are
 * 1 Wild Card · 2 Divisional · 3 Conference · 4 Pro Bowl · 5 Super Bowl;
 * stored weeks are 1–4 with the Pro Bowl dropped and the Super Bowl at 4.
 */
export function nflStoredWeek(
  espnSeasonType: number,
  espnWeek: number,
  eventName: string,
): { seasonType: "regular" | "postseason"; week: number } | null {
  if (espnSeasonType === ESPN_SEASON_TYPE.regular) return { seasonType: "regular", week: espnWeek };
  if (espnSeasonType !== ESPN_SEASON_TYPE.postseason) return null; // preseason not stored
  if (espnWeek === 4 || /pro bowl/i.test(eventName)) return null;
  if (espnWeek === 5) return { seasonType: "postseason", week: 4 };
  if (espnWeek >= 1 && espnWeek <= 3) return { seasonType: "postseason", week: espnWeek };
  return null;
}

/** "a40227" → "#a40227"; passthrough for already-prefixed or null. */
function hexColor(c: string | null | undefined): string | null {
  if (!c) return null;
  return c.startsWith("#") ? c : `#${c}`;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const espn = {
  /**
   * One week's board (schedule + live state + odds). `dates` pins the season
   * year so historical/forward weeks resolve; omit all options for ESPN's
   * notion of the current board.
   */
  scoreboard: (opts: { year?: number; seasonType?: number; week?: number } = {}) =>
    get<EspnScoreboard>("scoreboard", {
      dates: opts.year,
      seasontype: opts.seasonType,
      week: opts.week,
    }),

  teams: async (): Promise<NflTeam[]> => {
    const res = await get<EspnTeamsResponse>("teams");
    const teams = res.sports?.[0]?.leagues?.[0]?.teams ?? [];
    return teams.map(({ team: t }) => ({
      espnId: Number(t.id),
      displayName: t.displayName,
      location: t.location ?? null,
      name: t.name ?? null,
      abbreviation: t.abbreviation ?? null,
      color: hexColor(t.color),
      altColor: hexColor(t.alternateColor),
      logo:
        t.logos?.find((l) => l.rel?.includes("default"))?.href ??
        t.logos?.[0]?.href ??
        null,
    }));
  },
};
