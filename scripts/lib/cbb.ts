/**
 * Shared pieces of the college basketball ingest (scripts/cbb-*.ts).
 *
 * Pure where it can be — the row builders take parsed feed objects and return
 * rows, so the collision guard, the id offsets and the day-as-week mapping are
 * unit-tested without a database (the `scripts/lib/nfl.ts` pattern).
 */

import { cbbDayIndex, isValidCbbDay } from "../../src/lib/cbb";
import type { CbbGame, CbbTeam } from "../../src/lib/espn-cbb";
import { cbbSeasonId, cbbTeamId, cbbVenueId } from "../../src/lib/league";
import type { CbbLive } from "../../src/lib/cbb";
import { envNum } from "./env-num";

/**
 * The autumn the current basketball season started in.
 *
 * Deliberately NOT `SEASON` (the CFB year knob): a basketball season runs
 * November to April, so in March the football knob may already have been
 * rolled forward for spring while this season is still being played. ESPN
 * opens a new season in mid-July, so July 1 is the boundary. `CBB_SEASON`
 * overrides for backfills.
 */
export function cbbStartYear(now: Date = new Date()): number {
  const fromEnv = process.env.CBB_SEASON;
  if (fromEnv !== undefined && fromEnv !== "") {
    return envNum("CBB_SEASON", now.getUTCFullYear(), { min: 2000, max: 2100 });
  }
  const y = now.getUTCFullYear();
  return now.getUTCMonth() >= 6 ? y : y - 1;
}

export const CBB_SEASON = cbbSeasonId(cbbStartYear());

/** "2026-27 CBB" */
export function cbbSeasonLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")} CBB`;
}

export interface CbbTeamRow {
  id: number;
  sport: "cbb";
  school: string;
  mascot: string | null;
  abbreviation: string | null;
  conference: string | null;
  division: null;
  classification: "d1" | "non-d1";
  color: string | null;
  alt_color: string | null;
  logo_url: string | null;
  record: string | null;
  conf_record: string | null;
  poll_rank: number | null;
}

/**
 * A `teams` row from a board competitor.
 *
 * `school` is ESPN's `location` ("California", "Long Beach State") — the
 * school on its own, which is what the column holds for CFB and what
 * `teamHeadline` prints. The mascot goes in `mascot`, as for both football
 * leagues.
 *
 * A team with no known conference is a non-Division-I opponent (an NAIA
 * school on a November guarantee game). It still gets a row — `games` has a
 * foreign key on both teams — and `classification` keeps it out of the
 * conference filter.
 */
export function cbbTeamRow(t: CbbTeam, conferences: ReadonlyMap<string, string>): CbbTeamRow {
  const conference = t.conferenceId ? (conferences.get(t.conferenceId) ?? null) : null;
  return {
    id: cbbTeamId(t.espnId),
    sport: "cbb",
    school: t.location ?? t.displayName,
    mascot: t.name,
    abbreviation: t.abbreviation,
    conference,
    division: null,
    classification: conference ? "d1" : "non-d1",
    color: t.color,
    alt_color: t.altColor,
    logo_url: t.logo,
    record: t.record,
    conf_record: t.confRecord,
    poll_rank: t.rank,
  };
}

export interface CbbVenueRow {
  id: number;
  name: string;
  city: string | null;
  state: string | null;
  dome: boolean;
}

export function cbbVenueRow(venue: CbbGame["venue"]): CbbVenueRow | null {
  if (!venue || venue.espnId === null) return null;
  const id = cbbVenueId(venue.espnId);
  return {
    id,
    name: venue.name ?? `Venue ${id}`,
    city: venue.city,
    state: venue.state,
    // `dome` is NOT NULL and is what suppresses the weather flag. A gym is
    // indoors; this is the one league where the answer is always yes.
    dome: true,
  };
}

/** The line score as stored on a final: no run, no win probability. */
export function finalHoops(g: CbbGame): CbbLive | null {
  if (g.homeLine.length === 0 && g.awayLine.length === 0) return null;
  return { h: g.homeLine, a: g.awayLine, run: null, wp: null };
}

/**
 * A `games` row from a board event, or null when the event is not stored:
 * a TBD bracket slot (team id 0), another season's event, or a date outside
 * the season's day range.
 *
 * `boardDate` — the date the board was ASKED for — decides the day, not
 * `start_ts`. ESPN files a 12:05am Eastern tip in Honolulu under the night it
 * belongs to, and so does the cbbmodel feed (`slate_date`); deriving the day
 * from the timestamp would put that game on tomorrow's slate here and today's
 * everywhere else.
 *
 * Follows sync-games' hard rule: only assert a status that cannot be wrong.
 * `final` and the two dead statuses are stated by ESPN outright; `scheduled`
 * is never written, so a slow sync can never knock a live game back to
 * pregame. Reviving a postponed game is the script's own explicit step.
 */
export function cbbGameRow(g: CbbGame, seasonId: number, startYear: number, boardDate: string) {
  if (g.home.espnId <= 0 || g.away.espnId <= 0) return null;
  if (g.seasonEndYear !== startYear + 1) return null;
  const day = cbbDayIndex(seasonId, boardDate);
  if (day === null || !isValidCbbDay(day)) return null;
  const venue = cbbVenueRow(g.venue);
  const settled = g.status === "final" || g.status === "postponed" || g.status === "canceled";
  const hoops = g.status === "final" ? finalHoops(g) : null;
  return {
    id: g.id,
    season_id: seasonId,
    sport: "cbb" as const,
    week: day,
    season_type: "regular" as const,
    start_ts: g.startDate,
    start_time_tbd: g.startTimeTbd,
    neutral_site: g.neutralSite,
    conference_game: g.conferenceGame,
    home_team_id: cbbTeamId(g.home.espnId),
    away_team_id: cbbTeamId(g.away.espnId),
    home_points: g.homePoints,
    away_points: g.awayPoints,
    ...(venue ? { venue_id: venue.id } : {}),
    ...(settled ? { status: g.status } : {}),
    // The period survives on a final so the card can say "Final / OT".
    ...(g.status === "final" ? { current_period: g.period, current_clock: null } : {}),
    ...(hoops ? { hoops } : {}),
    ...(g.tv !== null ? { tv: g.tv } : {}),
    ...(g.note !== null ? { notes: g.note } : {}),
  };
}

/**
 * The game-id assumption, made loud — `assertNoCfbCollision`'s twin.
 *
 * ESPN allocates event ids from one sequence across leagues, so a basketball
 * id can never equal a football one. If that ever stops being true an upsert
 * would overwrite a football game and every bet under it, so the ingest
 * refuses instead.
 */
export function assertNoForeignCollision(
  existing: Array<{ id: number; sport: string }>,
  incomingIds: ReadonlySet<number>,
): void {
  const clashes = existing.filter((g) => g.sport !== "cbb" && incomingIds.has(g.id));
  if (clashes.length > 0) {
    throw new Error(
      `CBB ingest refused: event id(s) ${clashes.map((g) => `${g.id} (${g.sport})`).join(", ")} ` +
        `already exist in another league — the global-event-id assumption is broken`,
    );
  }
}

/** Board dates from `from` to `to` inclusive, `YYYY-MM-DD`. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
