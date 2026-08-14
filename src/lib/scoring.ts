/**
 * The scoring timeline, feed-agnostic (SCORE-1).
 *
 * Two feeds publish scores in two shapes and neither is the shape a card wants
 * to render. ESPN gives a ready-made `scoringPlays` array per game; CFBD gives
 * every play of a whole week and expects you to filter. This module is where
 * both become the same row, and where the reading side gets its grouping.
 *
 * Pure — no client, no fetch. The ingest lives in `scripts/lib/jobs-core.ts`
 * where every other write does, and the parsing lives here so it can be pinned
 * against captured fixtures without a network.
 */

import type { CfbdPlay } from "./cfbd";
import type { ScoringPlay } from "./espn";

/** A stored row, as the page reads it back. */
export interface ScoringPlayRow {
  game_id: number;
  sequence: number;
  period: number | null;
  clock: string | null;
  scoring_team_id: number | null;
  play_type: string | null;
  play_text: string;
  home_points: number;
  away_points: number;
  source: string;
}

/**
 * CFBD's plays for one game, reduced to the scoring ones.
 *
 * Three shapes have to be absorbed rather than assumed. CFBD's JSON keys have
 * appeared in both snake_case and camelCase across versions of the API and the
 * two are mixed within a single response in the wild, so each field is read
 * through both names. The clock is an object of minutes/seconds rather than a
 * string. And there is no play *type* at all, which is why `play_type` is
 * nullable in the schema — the deny-list in `live-play.ts` had to solve the
 * same absence for `last_play`.
 *
 * Ordering is the array's, matching the ESPN side, for the reason stated
 * there: a game clock counts down, resets each quarter and stops, so it cannot
 * order anything, and a touchdown and its extra point routinely share a value.
 */
export function cfbdScoringPlays(plays: CfbdPlay[], gameId: number): ScoringPlay[] {
  const out: ScoringPlay[] = [];
  let seq = 0;
  for (const p of plays) {
    const pGame = p.game_id ?? p.gameId ?? null;
    if (pGame !== gameId) continue;
    if (p.scoring !== true) continue;
    const text = (p.play_text ?? p.playText ?? "").trim();
    if (!text) continue;
    out.push({
      sequence: seq++,
      period: p.period ?? null,
      clock: formatClock(p.clock),
      // CFBD names the offense as a school string, not an id. Resolving it to
      // a team is the writer's job, since only it holds the game's two teams.
      espnTeamId: null,
      playType: p.play_type ?? p.playType ?? null,
      text,
      homePoints: p.home_score ?? p.homeScore ?? 0,
      awayPoints: p.away_score ?? p.awayScore ?? 0,
    });
  }
  return out;
}

/** The school on offense for a CFBD scoring play, so the writer can map it. */
export function cfbdScoringOffense(plays: CfbdPlay[], gameId: number): Array<string | null> {
  return plays
    .filter((p) => (p.game_id ?? p.gameId ?? null) === gameId && p.scoring === true)
    .filter((p) => ((p.play_text ?? p.playText ?? "").trim() !== ""))
    .map((p) => p.offense ?? null);
}

/** "12:34" from CFBD's {minutes, seconds}; null when the feed omits it. */
export function formatClock(clock: CfbdPlay["clock"]): string | null {
  if (!clock) return null;
  const m = clock.minutes;
  const sec = clock.seconds;
  if (m === null || m === undefined || sec === null || sec === undefined) return null;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/* ---- the reading side --------------------------------------------------- */

export interface ScoringPeriod {
  period: number | null;
  plays: ScoringPlayRow[];
}

/**
 * Group a game's scoring into periods, in order, for the timeline.
 *
 * The request described it quarter by quarter — "first quarter Texas WR caught
 * a 17 yard touchdown… " — so the headings are the structure, not decoration.
 * Stored order is preserved inside each period rather than re-sorted by clock:
 * the feed's order is the only thing that knows a PAT followed its touchdown
 * when both are stamped at the same second.
 *
 * A null period sorts last. It means the feed did not say, which is rare and
 * is not a reason to drop a score.
 */
export function byPeriod(rows: ScoringPlayRow[]): ScoringPeriod[] {
  const ordered = [...rows].sort((a, b) => a.sequence - b.sequence);
  const out: ScoringPeriod[] = [];
  for (const r of ordered) {
    const last = out[out.length - 1];
    if (last && last.period === r.period) last.plays.push(r);
    else out.push({ period: r.period, plays: [r] });
  }
  return out;
}
