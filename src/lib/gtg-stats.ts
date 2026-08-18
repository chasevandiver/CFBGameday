/**
 * Guess the Game's player record — streak, best solve, win distribution.
 *
 * ## Where it comes from, and why that changed
 *
 * This started device-local (GTG-10): the end state wanted three numbers no
 * payload carried, `gtg_leaderboard()` aggregates per user and never per day,
 * and the redesign it was written for was presentation-only. So the fold ran
 * on the client and persisted to localStorage — which meant a second phone
 * started at zero, and clearing site data wiped a streak.
 *
 * It is now folded on the server from the caller's own `gtg_guesses` rows and
 * shipped in the payload. **No migration and no new RPC**: the daily route
 * already reads that table through the service client scoped to the session's
 * user, so this is one more read on a query path that was always the
 * caller's own data. Nothing here is authoritative for points — the board
 * still is — but the numbers now follow the account instead of the browser.
 *
 * The arithmetic did not move. `recordDay` is unchanged from the localStorage
 * version, because a fold that was correct one day at a time is correct
 * replayed over every day; `gtgStanding` is just that reduce with the rows
 * sorted. Keeping it that way is deliberate — it is the part with the edge
 * cases (month boundaries, busts, gaps) and it kept its tests.
 */

export const GTG_DIST_BUCKETS = 6;

export interface GtgStats {
  /** The last day folded in. Guards against double-counting. */
  lastDay: string | null;
  /** Consecutive solved days, ending at `lastDay`. */
  streak: number;
  /** Longest streak ever reached. */
  bestStreak: number;
  /** Fewest guesses on any solve, or null before the first one. */
  bestSolve: number | null;
  /** Solves by guess count: `dist[0]` is solved-in-one. */
  dist: number[];
  played: number;
  solved: number;
}

export const EMPTY_STATS: GtgStats = {
  lastDay: null,
  streak: 0,
  bestStreak: 0,
  bestSolve: null,
  dist: Array<number>(GTG_DIST_BUCKETS).fill(0),
  played: 0,
  solved: 0,
};

/** One finished day, as the row the route reads. */
export interface GtgDayResult {
  /** YYYY-MM-DD */
  day: string;
  attempts: number;
  solved: boolean;
}

/** The calendar day before a YYYY-MM-DD string. Date-only, so UTC is safe. */
function dayBefore(day: string): string {
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms)) return "";
  return new Date(ms - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Fold one finished day into a standing.
 *
 * Idempotent by day: a day at or before `lastDay` returns the input
 * untouched. A solve extends the streak only when it directly follows the
 * last day counted; any gap restarts at one, and a bust resets to zero — the
 * same rule `streakFold` uses for picks, applied one day at a time.
 */
export function recordDay(
  prev: GtgStats,
  day: string,
  solved: boolean,
  guesses: number,
): GtgStats {
  if (prev.lastDay !== null && day <= prev.lastDay) return prev;

  const continues = prev.lastDay !== null && dayBefore(day) === prev.lastDay;
  const streak = solved ? (continues ? prev.streak + 1 : 1) : 0;
  const dist = [...prev.dist];
  if (solved && guesses >= 1 && guesses <= GTG_DIST_BUCKETS) dist[guesses - 1]! += 1;

  return {
    lastDay: day,
    streak,
    bestStreak: Math.max(prev.bestStreak, streak),
    bestSolve:
      solved && (prev.bestSolve === null || guesses < prev.bestSolve) ? guesses : prev.bestSolve,
    dist,
    played: prev.played + 1,
    solved: prev.solved + (solved ? 1 : 0),
  };
}

/**
 * Every day the caller has played, folded into one standing.
 *
 * Sorted here rather than trusted from the query, because `recordDay` refuses
 * a day it has already passed — rows arriving newest-first would fold the
 * first row and silently drop the rest, which reads as "you have played once"
 * rather than as an error.
 */
export function gtgStanding(rows: GtgDayResult[]): GtgStats {
  return [...rows]
    .sort((a, b) => a.day.localeCompare(b.day))
    .reduce((acc, r) => recordDay(acc, r.day, r.solved, r.attempts), EMPTY_STATS);
}
