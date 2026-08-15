/**
 * The line score — points by quarter — derived, not ingested.
 *
 * Owner request 2026-08-15: "on the game cards before kick off, during the game
 * and post game — can we add the box scores when you click into a game card".
 *
 * ## Why nothing new is fetched
 *
 * `scoring_plays` (migration 0048) already stores, for every score in every
 * game in both leagues, the period it happened in and **the score after it**.
 * That is exactly enough to reconstruct a line score: the points a team scored
 * in a quarter are the difference between their running total at the end of it
 * and at the end of the one before. So this needs no new table, no new feed
 * call and no new job — the same ~1-call-per-score ingest that draws the
 * scoring timeline draws the box too.
 *
 * The alternative was a `game_team_stats` table fed by ESPN's `/summary`
 * boxscore block and CFBD's `/games/teams`, which is where total yards, first
 * downs and turnovers live. That is a real feature and a real ingest; it is not
 * this one, and it is queued in docs/STATUS.md rather than half-built here.
 *
 * ## Where it can disagree with the scoreboard
 *
 * A feed occasionally reports a score whose play we never captured — the reason
 * `scoring_plays` stores the running total instead of accumulating one. When
 * that happens the derived quarters sum to less than `games.home_points`, and
 * the honest thing is to say so rather than to quietly park the difference in
 * the fourth quarter. `unaccounted` carries it and the UI footnotes it; the
 * TOTAL column always shows the real score.
 *
 * Pure and client-safe.
 */

import type { ScoringPlayRow } from "./scoring";

export interface BoxScoreRow {
  /** Points in each period of `periods`; null for a period not yet played. */
  cells: Array<number | null>;
  /** The scoreboard's number, not the sum of the cells. */
  total: number;
  /** Points in `total` that no stored play accounts for. 0 in the normal case. */
  unaccounted: number;
}

export interface BoxScore {
  /** Period numbers in column order: 1–4 always, plus any overtime reached. */
  periods: number[];
  home: BoxScoreRow;
  away: BoxScoreRow;
  /** True once any cell holds a number — i.e. the game has actually started. */
  started: boolean;
}

/** Regulation is always four columns wide, even at 0–0 in the first quarter. */
const REGULATION = 4;

/**
 * Build the line score.
 *
 * `period` is the live period (`games.current_period`) and decides how much of
 * the grid is filled in: a game in the second quarter shows Q1 and Q2 and
 * leaves Q3/Q4 blank, because 0 there would claim a quarter was played
 * scorelessly. A final fills every column it has.
 */
export function buildBoxScore(
  plays: ScoringPlayRow[],
  homePoints: number | null,
  awayPoints: number | null,
  status: string,
  period: number | null,
): BoxScore {
  const final = status === "final";
  const live = status === "in_progress";

  const ordered = [...plays].sort((a, b) => a.sequence - b.sequence);
  const homeBy = new Map<number, number>();
  const awayBy = new Map<number, number>();
  let runHome = 0;
  let runAway = 0;
  let maxPeriod = 0;


  for (const p of ordered) {
    // A feed that omits the period cannot be placed in a column. Its points
    // still land in `unaccounted` below via the running totals, which is the
    // one place they can be shown without inventing a quarter for them.
    const inPeriod = p.period ?? null;
    const dHome = p.home_points - runHome;
    const dAway = p.away_points - runAway;
    runHome = p.home_points;
    runAway = p.away_points;
    if (inPeriod === null) continue;
    maxPeriod = Math.max(maxPeriod, inPeriod);
    if (dHome !== 0) homeBy.set(inPeriod, (homeBy.get(inPeriod) ?? 0) + dHome);
    if (dAway !== 0) awayBy.set(inPeriod, (awayBy.get(inPeriod) ?? 0) + dAway);
  }

  // How far the grid runs, and how far of it is filled. A live game's own
  // period wins over the last scoring play's: a scoreless third quarter is
  // still a quarter that was played.
  const reached = Math.max(maxPeriod, live || final ? (period ?? 0) : 0);
  const columns = Math.max(REGULATION, reached);
  const periods = Array.from({ length: columns }, (_, i) => i + 1);
  // A final is complete through its last column; a live game only through the
  // period it is in; a scheduled game through nothing.
  const playedThrough = final ? columns : live ? Math.max(0, reached) : 0;

  const row = (by: Map<number, number>, total: number | null): BoxScoreRow => ({
    cells: periods.map((n) => (n <= playedThrough ? (by.get(n) ?? 0) : null)),
    total: total ?? 0,
    // Against the scoreboard, not against the running total: a play we never
    // saw is missing from both, and it is the scoreboard that is authoritative.
    unaccounted: Math.max(0, (total ?? 0) - sum(by)),
  });

  return {
    periods,
    home: row(homeBy, homePoints),
    away: row(awayBy, awayPoints),
    started: playedThrough > 0,
  };
}

const sum = (m: Map<number, number>): number => {
  let t = 0;
  for (const v of m.values()) t += v;
  return t;
};
