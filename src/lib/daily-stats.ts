/**
 * A player's record at a once-a-day game — streak, best, distribution.
 *
 * Generalised out of `gtg-stats.ts` when the three replacement games each
 * needed the same fold. The arithmetic did not move: this is that module's
 * `recordDay`/`gtgStanding` with the bucket count as a parameter, and its
 * tests came with it. That matters more than it looks — the edge cases here
 * (month boundaries, busts, gaps, and the sort that makes the reduce correct)
 * are the part that was already right, and re-deriving them for three new
 * games would have been three new chances to get the same thing wrong.
 *
 * The one rule worth restating: **an unfinished day is not a result.** Callers
 * filter days still in progress out before folding, because counting today's
 * two wrong answers as a bust would zero the streak of anyone who opened the
 * puzzle and walked away.
 */

export interface DailyStats {
  /** The last day folded in. Guards against double-counting. */
  lastDay: string | null;
  /** Consecutive winning days, ending at `lastDay`. */
  streak: number;
  bestStreak: number;
  /** The best score reached on any day, or null before the first one. */
  best: number | null;
  /** Days by score: `dist[i]` is how many days scored `i`. */
  dist: number[];
  played: number;
  won: number;
}

export const DAILY_BUCKETS = 8;

export const EMPTY_DAILY: DailyStats = {
  lastDay: null,
  streak: 0,
  bestStreak: 0,
  best: null,
  dist: Array<number>(DAILY_BUCKETS).fill(0),
  played: 0,
  won: 0,
};

/** The calendar day before a YYYY-MM-DD string. Date-only, so UTC is safe. */
export function dayBefore(day: string): string {
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms)) return "";
  return new Date(ms - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Fold one finished day into a standing.
 *
 * Idempotent by day: a day at or before `lastDay` returns the input untouched.
 * A win extends the streak only when it directly follows the last day counted;
 * any gap restarts at one, and a loss resets to zero — the same rule
 * `streakFold` uses for picks, applied a day at a time.
 *
 * `score` indexes the distribution and drives `best`, so each game decides what
 * its own scale means (The Tape counts 0–5 correct; Guess the Game counts
 * guesses spent, where LOWER is better — which is why `best` is chosen by the
 * caller's comparator rather than assumed here).
 */
export function recordDayResult(
  prev: DailyStats,
  day: string,
  won: boolean,
  score: number,
  betterIsHigher = true,
): DailyStats {
  if (prev.lastDay !== null && day <= prev.lastDay) return prev;

  const continues = prev.lastDay !== null && dayBefore(day) === prev.lastDay;
  const streak = won ? (continues ? prev.streak + 1 : 1) : 0;

  const dist = [...prev.dist];
  if (Number.isInteger(score) && score >= 0 && score < DAILY_BUCKETS) dist[score]! += 1;

  const best =
    prev.best === null
      ? score
      : betterIsHigher
        ? Math.max(prev.best, score)
        : Math.min(prev.best, score);

  return {
    lastDay: day,
    streak,
    bestStreak: Math.max(prev.bestStreak, streak),
    best,
    dist,
    played: prev.played + 1,
    won: prev.won + (won ? 1 : 0),
  };
}

/**
 * Every finished day, folded.
 *
 * Sorted here rather than trusted from the query, because `recordDayResult`
 * refuses a day it has already passed — rows arriving newest-first would fold
 * the first and silently drop the rest, which reads as "you have played once"
 * rather than as an error. That failure is silent, which is why the sort is
 * inside the fold and has its own test.
 */
export function dailyStanding(
  rows: Array<{ day: string; won: boolean; score: number }>,
  betterIsHigher = true,
): DailyStats {
  return [...rows]
    .sort((a, b) => a.day.localeCompare(b.day))
    .reduce(
      (acc, r) => recordDayResult(acc, r.day, r.won, r.score, betterIsHigher),
      EMPTY_DAILY,
    );
}
