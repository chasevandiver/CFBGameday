/**
 * Shared pieces of the NFL ingest (scripts/nfl-*.ts).
 *
 * The division table is editorial data keyed by ESPN abbreviation — ESPN's
 * site teams endpoint doesn't carry divisions, and eight divisions of four
 * change on the scale of decades (precedent: the rivalries seed, 0017).
 * `teams.conference` stores the division ("AFC West"), which is what makes
 * the slate's conference filter, confRecord, and the groups' conference mode
 * work for NFL without a query change.
 */

import { SEASON } from "./ingest";
import { nflSeasonId, nflVenueId } from "../../src/lib/league";

/** The NFL season being ingested rides the same year knob as CFB. */
export const NFL_SEASON = nflSeasonId(SEASON);

export const NFL_DIVISIONS: Record<string, string> = {
  BUF: "AFC East", MIA: "AFC East", NE: "AFC East", NYJ: "AFC East",
  BAL: "AFC North", CIN: "AFC North", CLE: "AFC North", PIT: "AFC North",
  HOU: "AFC South", IND: "AFC South", JAX: "AFC South", TEN: "AFC South",
  DEN: "AFC West", KC: "AFC West", LV: "AFC West", LAC: "AFC West",
  DAL: "NFC East", NYG: "NFC East", PHI: "NFC East", WSH: "NFC East",
  CHI: "NFC North", DET: "NFC North", GB: "NFC North", MIN: "NFC North",
  ATL: "NFC South", CAR: "NFC South", NO: "NFC South", TB: "NFC South",
  ARI: "NFC West", LAR: "NFC West", SF: "NFC West", SEA: "NFC West",
};

export function divisionOf(abbr: string | null | undefined): string | null {
  return abbr ? (NFL_DIVISIONS[abbr.toUpperCase()] ?? null) : null;
}

/** Same division ⇒ a division game, the NFL's notion of conference_game. */
export function isDivisionGame(homeAbbr: string | null, awayAbbr: string | null): boolean {
  const h = divisionOf(homeAbbr);
  return h !== null && h === divisionOf(awayAbbr);
}

/** The venue fields ESPN's scoreboard actually carries (src/lib/espn.ts). */
export interface EspnVenue {
  espnId: number | null;
  name: string | null;
  city: string | null;
  state: string | null;
  indoor: boolean;
}

export interface VenueRow {
  id: number;
  name: string;
  city: string | null;
  state: string | null;
  dome: boolean;
}

/**
 * A `venues` row from an ESPN venue, or null when there is no id to key on.
 *
 * Ids are offset like team ids (`nflVenueId`) because ESPN's venue id space and
 * CFBD's overlap — without it a Seattle stadium could land on a college one.
 *
 * **Coordinates are absent on purpose, not forgotten.** The scoreboard venue
 * carries `fullName`, `address.city/state` and `indoor` and nothing else, so
 * `latitude`/`longitude`/`elevation`/`capacity` stay null rather than invented.
 * That is why this closes the game page's venue line and leaves NFL weather
 * blocked — `weatherJob` needs coordinates, and no amount of care here supplies
 * them.
 */
export function nflVenueRow(venue: EspnVenue | null): VenueRow | null {
  if (!venue || venue.espnId === null) return null;
  const id = nflVenueId(venue.espnId);
  return {
    id,
    // NOT NULL in the schema, and a nameless venue is still worth the row —
    // the game page can say "somewhere" more usefully than it can say nothing.
    name: venue.name ?? `Venue ${id}`,
    city: venue.city,
    state: venue.state,
    dome: venue.indoor,
  };
}

/**
 * The one assumption the game-id scheme rests on: ESPN allocates event ids
 * globally, so an NFL event id can never equal a CFBD (= ESPN college) game
 * id. This makes it fail loud instead of silently overwriting a CFB game —
 * an upsert would clobber the row and every pick, bet and snapshot under it.
 */
export function assertNoCfbCollision(
  existing: Array<{ id: number; sport: string }>,
  incomingIds: ReadonlySet<number>,
): void {
  const clashes = existing.filter((g) => g.sport === "cfb" && incomingIds.has(g.id));
  if (clashes.length > 0) {
    throw new Error(
      `NFL ingest refused: event id(s) ${clashes.map((g) => g.id).join(", ")} ` +
        `already exist as CFB games — the global-event-id assumption is broken`,
    );
  }
}
