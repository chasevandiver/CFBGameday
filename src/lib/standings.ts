import type { Sport } from "./league";

/**
 * The W-L fold behind /standings, extracted pure so the NFL branch is
 * testable. Two rules differ by sport:
 *  - Ties: an NFL game can end tied and counts half a win for both sides;
 *    a tied CFB final is data noise (FBS overtime has settled games since
 *    1996) and is skipped rather than counted.
 *  - Preseason: NFL August finals are exhibitions and never touch a record.
 *    CFB has no preseason rows, so the filter is harmless applied to both.
 */

export interface FinalForStandings {
  home_team_id: number;
  away_team_id: number;
  home_points: number | null;
  away_points: number | null;
  conference_game: boolean | null;
  season_type: string;
}

export interface TeamRecord {
  w: number;
  l: number;
  t: number;
  confW: number;
  confL: number;
  confT: number;
}

const EMPTY: TeamRecord = { w: 0, l: 0, t: 0, confW: 0, confL: 0, confT: 0 };

export function foldRecords(finals: FinalForStandings[], sport: Sport): Map<number, TeamRecord> {
  const rec = new Map<number, TeamRecord>();
  const get = (id: number) => {
    const r = rec.get(id) ?? { ...EMPTY };
    rec.set(id, r);
    return r;
  };
  for (const g of finals) {
    if (g.season_type === "preseason") continue;
    if (g.home_points === null || g.away_points === null) continue;
    if (g.home_points === g.away_points) {
      if (sport !== "nfl") continue;
      for (const id of [g.home_team_id, g.away_team_id]) {
        const r = get(id);
        r.t += 1;
        if (g.conference_game) r.confT += 1;
      }
      continue;
    }
    const winner = g.home_points > g.away_points ? g.home_team_id : g.away_team_id;
    const loser = winner === g.home_team_id ? g.away_team_id : g.home_team_id;
    const wr = get(winner);
    const lr = get(loser);
    wr.w += 1;
    lr.l += 1;
    if (g.conference_game) {
      wr.confW += 1;
      lr.confL += 1;
    }
  }
  return rec;
}

/** NFL win percentage: ties count half. Zero games is 0, not NaN. */
export function winPct(w: number, l: number, t = 0): number {
  const n = w + l + t;
  return n === 0 ? 0 : (w + t / 2) / n;
}

/** W-L, with the tie tail only when it exists — "10-6" and "10-6-1". */
export function formatRecord(w: number, l: number, t = 0): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

/**
 * Fixed presentation order for NFL divisions — `teams.conference` holds the
 * division name ("AFC West"), and alphabetical order would interleave the
 * conferences.
 */
export const NFL_DIVISION_ORDER = [
  "AFC East",
  "AFC North",
  "AFC South",
  "AFC West",
  "NFC East",
  "NFC North",
  "NFC South",
  "NFC West",
];
