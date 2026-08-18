/**
 * Guess the Game's player stats — streak, best solve, win distribution.
 *
 * **Device-local, and that is a compromise rather than a design.** The end
 * state wants three numbers the server does not send: `gtg_leaderboard()`
 * returns points / solved / played per user and nothing per-day, so a streak
 * and a distribution cannot be derived from any payload the client currently
 * receives. Recomputing them from `gtg_guesses` is a route change, and this
 * pass is presentation only. So the fold below runs on what the client
 * already knows — the day it just finished — and persists to localStorage.
 *
 * The consequences are real and worth stating rather than hiding behind a
 * label: a second phone starts at zero, clearing site data resets it, and
 * nothing here is authoritative for points (the board still is). The UI says
 * "on this device" for exactly that reason.
 *
 * The fold is pure and separate from the storage so it can be tested without
 * a DOM, and so it can be pointed at a server payload unchanged the day one
 * exists — `recordDay` is the whole of the arithmetic.
 */

import { GTG_MAX_ATTEMPTS } from "./guess-game";

const KEY = "gtg:stats:v1";

export interface GtgStats {
  /** The last day folded in. Guards against double-counting a re-render. */
  lastDay: string | null;
  /** Consecutive solved days, ending at `lastDay`. */
  streak: number;
  /** Longest streak ever reached on this device. */
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
  dist: Array<number>(GTG_MAX_ATTEMPTS).fill(0),
  played: 0,
  solved: 0,
};

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
 * untouched, which is what makes it safe to call from an effect that reruns
 * on every payload. A solve extends the streak only when it directly follows
 * the last day counted; any gap restarts at one, and a bust resets to zero —
 * the same rule `streakFold` uses for picks, applied one day at a time
 * because that is all the client ever sees.
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
  if (solved && guesses >= 1 && guesses <= GTG_MAX_ATTEMPTS) dist[guesses - 1]! += 1;

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

/** Read the stored standing. Any unreadable or malformed value reads empty. */
export function loadStats(): GtgStats {
  if (typeof window === "undefined") return EMPTY_STATS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY_STATS;
    const p = JSON.parse(raw) as Partial<GtgStats>;
    const dist = Array.isArray(p.dist) ? p.dist : [];
    return {
      lastDay: typeof p.lastDay === "string" ? p.lastDay : null,
      streak: Number(p.streak) || 0,
      bestStreak: Number(p.bestStreak) || 0,
      bestSolve: typeof p.bestSolve === "number" ? p.bestSolve : null,
      dist: Array.from({ length: GTG_MAX_ATTEMPTS }, (_, i) => Number(dist[i]) || 0),
      played: Number(p.played) || 0,
      solved: Number(p.solved) || 0,
    };
  } catch {
    return EMPTY_STATS;
  }
}

/** Persist. A denied or full store is not worth breaking the end screen for. */
export function saveStats(stats: GtgStats): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {
    /* private mode / quota — the screen still renders from memory */
  }
}

/* ---- The store ---------------------------------------------------------
 *
 * `useSyncExternalStore`'s three functions, so the end state can read the
 * record without a `setState` inside an effect. localStorage IS an external
 * store; treating it as one is both what the lint rule asks for and what
 * keeps two mounted components (the daily puzzle and, one day, anything else
 * that shows a streak) from disagreeing about the same value.
 *
 * The snapshot is memoised because `useSyncExternalStore` compares it by
 * identity — reparsing the JSON on every render would return a new object
 * every time and re-render forever.
 */

let cache: GtgStats | null = null;
const listeners = new Set<() => void>();

export function subscribeStats(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getStatsSnapshot(): GtgStats {
  cache ??= loadStats();
  return cache;
}

/** The server has no device to read, so it renders the empty standing. */
export function getServerStatsSnapshot(): GtgStats {
  return EMPTY_STATS;
}

/**
 * Fold a finished day in and persist it. Idempotent through `recordDay`, so
 * an effect that reruns on every payload is safe to point at this.
 */
export function commitDay(day: string, solved: boolean, guesses: number): void {
  const next = recordDay(getStatsSnapshot(), day, solved, guesses);
  if (next === cache) return;
  cache = next;
  saveStats(next);
  for (const fn of listeners) fn();
}
