/**
 * The Streak's arithmetic (R2-C2) — derived, never stored. A counter column
 * would be a second source of truth that a re-grade or a corrected final
 * contradicts (the survivor lesson, 0053); these fold the whole history on
 * every read instead. Pure and client-safe.
 */

import { DEFAULT_TZ } from "./kick";

export interface StreakPickLike {
  /** YYYY-MM-DD */
  day: string;
  result: "win" | "loss" | "void" | null;
}

export interface StreakStanding {
  current: number;
  best: number;
  wins: number;
  losses: number;
}

/**
 * Fold graded picks into a standing. Chronological by day; a win extends,
 * a loss resets, a void or still-pending day passes through untouched —
 * a run is broken by a wrong answer, never by a cancelled game or one that
 * hasn't graded yet.
 */
export function streakFold(picks: StreakPickLike[]): StreakStanding {
  const ordered = [...picks].sort((a, b) => a.day.localeCompare(b.day));
  let current = 0;
  let best = 0;
  let wins = 0;
  let losses = 0;
  for (const p of ordered) {
    if (p.result === "win") {
      current += 1;
      wins += 1;
      if (current > best) best = current;
    } else if (p.result === "loss") {
      current = 0;
      losses += 1;
    }
    // void / null: pass through
  }
  return { current, best, wins, losses };
}

/** The calendar date (YYYY-MM-DD) of an instant in the product timezone. */
export function productDate(at: Date, tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** That date, shifted by whole days (day-level, DST-safe enough for dates). */
export function productDateOffset(at: Date, days: number, tz: string = DEFAULT_TZ): string {
  return productDate(new Date(at.getTime() + days * 86_400_000), tz);
}
