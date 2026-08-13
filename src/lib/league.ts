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
 * Seasons are one row per (year, sport): CFB 2026 is id 2026, NFL 2026 is
 * id 102026. Keeping the leagues in separate season rows is what keeps every
 * season-scoped CFB job (model pricing, ratings replay, weather) blind to NFL
 * rows without a filter change.
 */

export type Sport = "cfb" | "nfl";

export const NFL_ID_OFFSET = 100_000;

export function nflSeasonId(year: number): number {
  return NFL_ID_OFFSET + year;
}

export function nflTeamId(espnTeamId: number): number {
  return NFL_ID_OFFSET + espnTeamId;
}

export function nflVenueId(espnVenueId: number): number {
  return NFL_ID_OFFSET + espnVenueId;
}

export function sportOfSeasonId(seasonId: number): Sport {
  return seasonId >= NFL_ID_OFFSET ? "nfl" : "cfb";
}

/** The calendar year of a season row id, either league. */
export function seasonYearOf(seasonId: number): number {
  return seasonId >= NFL_ID_OFFSET ? seasonId - NFL_ID_OFFSET : seasonId;
}

/** Both leagues' season ids for one calendar year — the cross-league read set. */
export function seasonIdsForYear(year: number): [number, number] {
  return [year, nflSeasonId(year)];
}

export function isSport(v: string | null | undefined): v is Sport {
  return v === "cfb" || v === "nfl";
}
