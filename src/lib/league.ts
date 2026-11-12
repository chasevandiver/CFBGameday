/**
 * League identity — the one place the CFB/NFL split is encoded in ids.
 *
 * NFL rows live in the same tables as CFB rows (docs/SPEC.md §8: every domain
 * table carries season_id), distinguished two ways:
 *  - a `sport` column on seasons/teams/games (migration 0042), and
 *  - offset integer ids where the two feeds' id spaces collide.
 *
 * CFBD team ids are ESPN *college* ids and include 1–34 (Auburn is 2, USC is
 * 30); ESPN NFL team ids are 1–34. Same for venues. So NFL team and venue ids
 * are stored as `NFL_ID_OFFSET + espnId`. Game ids are NOT offset: CFBD game
 * ids are ESPN event ids, and ESPN allocates event ids from one global
 * sequence across leagues, so they cannot collide — and the NFL ingest guards
 * that assumption by refusing to overwrite a row whose sport is 'cfb'.
 *
 * College basketball (0084) is the third league and takes the next block:
 * `CBB_ID_OFFSET + espnId` for teams and venues. That offset is not optional
 * the way it nearly is for the NFL — ESPN gives a school ONE id across its
 * sports, so Auburn basketball is team 2 exactly as Auburn football is, and
 * without it the basketball sync would overwrite the football row's record,
 * conference and colours. Game ids stay raw for the same global-sequence
 * reason, guarded the same way.
 *
 * Seasons are one row per (year, sport): CFB 2026 is id 2026, NFL 2026 is
 * id 102026, CBB 2026-27 is id 202026. A basketball season spans two calendar
 * years and is keyed by the year it STARTS, so that `seasonIdsForYear(2026)`
 * names the three seasons that share an autumn. (Barttorvik, ESPN and the
 * cbbmodel feed all label the same season 2027, by the year it ends —
 * `cbbSeasonIdFromEndYear` is the one place that difference is converted.) Keeping the leagues in separate season rows is what keeps every
 * season-scoped CFB job (model pricing, ratings replay, weather) blind to NFL
 * rows without a filter change.
 */

export type Sport = "cfb" | "nfl" | "cbb";

export const NFL_ID_OFFSET = 100_000;
export const CBB_ID_OFFSET = 200_000;

export function nflSeasonId(year: number): number {
  return NFL_ID_OFFSET + year;
}

export function nflTeamId(espnTeamId: number): number {
  return NFL_ID_OFFSET + espnTeamId;
}

export function nflVenueId(espnVenueId: number): number {
  return NFL_ID_OFFSET + espnVenueId;
}

/** `startYear` is the autumn the season tips off in: 2026 for 2026-27. */
export function cbbSeasonId(startYear: number): number {
  return CBB_ID_OFFSET + startYear;
}

/** ESPN, Barttorvik and the cbbmodel feed say 2027 for 2026-27. */
export function cbbSeasonIdFromEndYear(endYear: number): number {
  return cbbSeasonId(endYear - 1);
}

export function cbbTeamId(espnTeamId: number): number {
  return CBB_ID_OFFSET + espnTeamId;
}

export function cbbVenueId(espnVenueId: number): number {
  return CBB_ID_OFFSET + espnVenueId;
}

export function sportOfSeasonId(seasonId: number): Sport {
  return seasonId >= CBB_ID_OFFSET ? "cbb" : seasonId >= NFL_ID_OFFSET ? "nfl" : "cfb";
}

/** The calendar year of a season row id, any league (CBB: its start year). */
export function seasonYearOf(seasonId: number): number {
  return seasonId % NFL_ID_OFFSET;
}

/**
 * Every league's season id for one calendar year — the cross-league read set.
 * CFB first: callers that need "a" season for the year read index 0.
 */
export function seasonIdsForYear(year: number): number[] {
  return [year, nflSeasonId(year), cbbSeasonId(year)];
}

/**
 * The two football seasons for a year, and only those.
 *
 * For the callers whose question is about FOOTBALL's machinery — the
 * scoreboard loop's liveness, the weekly notify jobs. Basketball is live most
 * evenings for five months on a writer of its own; folding it into "is a game
 * live?" would arm football's alarms every night with nothing wrong.
 */
export function footballSeasonIdsForYear(year: number): [number, number] {
  return [year, nflSeasonId(year)];
}

export function isSport(v: string | null | undefined): v is Sport {
  return v === "cfb" || v === "nfl" || v === "cbb";
}

/**
 * The two leagues a pick'em group or survivor pool can play. College
 * basketball is deliberately not one of them (owner call, 2026-11-12: the
 * only group that follows CBB is the betting group, and a betting group has
 * no league scope at all — its sheet follows the bets). Kept as its own type
 * so widening `Sport` could not quietly widen `groups.leagues` with it.
 */
export type GroupLeague = "cfb" | "nfl";

export function isGroupLeague(v: string | null | undefined): v is GroupLeague {
  return v === "cfb" || v === "nfl";
}

/** "CFB" / "NFL" / "CBB" — the label every league tag prints. */
export function sportLabel(sport: Sport): string {
  return sport.toUpperCase();
}
