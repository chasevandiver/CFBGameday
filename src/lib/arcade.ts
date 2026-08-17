/**
 * The Arcade (R3-E3): one standing across all four games, per pool.
 *
 * ## It imports scoring; it does not re-implement it
 *
 * `pool-machine.ts`'s discipline, for the same reason. Streak points fold
 * through `streakFold` (one definition of what a run is), and Guess the
 * Game's points arrive as the number `gtg_leaderboard()` already computed in
 * SQL — there is deliberately **no `7 - attempts` arithmetic in this file**,
 * because a copy of that formula in a second language is the kind of thing
 * that drifts silently and re-scores a season.
 *
 * ## The weights, and the one test that matters
 *
 * Each game's WEEKLY CEILING is equalised into [60, 70]:
 *
 *   The Streak      7 days × 10                      = 70
 *   Guess the Game  7 days × 6 max × 1.67            ≈ 70
 *   Guess the Lines 8 slate games × 7.5 max          = 60
 *   The Six-Pack    6 × 8 + 12 perfect bonus         = 60
 *
 * Without that, Guess the Game — daily and cheap to win — decides the arcade
 * inside a month. `weeklyCeiling()` is exported and its test is what stops
 * the total quietly becoming "whoever plays one game the most".
 *
 * ## No participation floor
 *
 * The total is cumulative, so somebody who joins in November is rankable from
 * their first day — they simply have fewer points, exactly like a late-joining
 * pick'em member has fewer wins. A floor would make them literally unrankable,
 * which is the failure to avoid. `n` and `perWeek` ride along so a strong
 * newcomer is visible without distorting the season total. Floors belong on
 * RATE boards (the "sharpest eye" mean-error list, n ≥ 5) — the same sentence
 * `records.ts` already applies to `avgClv`.
 *
 * ## Rejected, and why (do not re-propose)
 *
 *   * **`current + best` for the streak.** It double-counts a live run, and
 *     it can go DOWN when you lose. A cumulative total that decreases is one
 *     nobody trusts, and every other component here is monotone. `current`
 *     and `best` stay visible in the Streak column, where they are the game's
 *     own currency.
 *   * **A run multiplier** (`10 + 2·min(current−1, 5)`). It compounds for
 *     whoever is already ahead, which is exactly wrong for a 5–15 person
 *     crew where the point is that everyone keeps playing.
 */

import { streakFold, type StreakPickLike } from "./streak";

export const ARCADE = {
  /** One streak win. Flat, deliberately — see the rejections above. */
  streakWin: 10,
  /**
   * Guess the Game's SQL points (7 − attempts on a solve), scaled so a
   * perfect week of one-guess solves matches the streak's ceiling.
   */
  gtgScale: 1.67,
  /** A graded line guess: exact = 7.5, worthless past 5 points of error. */
  linesGuess: (absError: number) => Math.max(0, 7.5 - 1.5 * absError),
  /** Six-Pack: per correct answer, plus a bonus for a clean sheet. */
  sixPackCorrect: 8,
  sixPackPerfect: 12,
} as const;

export type ArcadeGame = "streak" | "gtg" | "lines" | "sixPack";

/**
 * The most one player can score in one week at each game — the equalisation
 * the ceiling test pins. Change a weight and this must move with it.
 */
export function weeklyCeiling(game: ArcadeGame): number {
  switch (game) {
    case "streak":
      return 7 * ARCADE.streakWin;
    case "gtg":
      // 7 days × the best SQL points (7 − 1 attempt = 6), scaled.
      return Math.round(7 * 6 * ARCADE.gtgScale);
    case "lines":
      // A full eight-game guess slate, every call exact.
      return 8 * ARCADE.linesGuess(0);
    case "sixPack":
      return 6 * ARCADE.sixPackCorrect + ARCADE.sixPackPerfect;
    default: {
      const exhaustive: never = game;
      return exhaustive;
    }
  }
}

export interface ArcadeInputs {
  /** Every streak pick in scope, by user. */
  streak: Map<string, StreakPickLike[]>;
  /** `gtg_leaderboard()`'s own points column, by user. Never recomputed here. */
  gtgPoints: Map<string, number>;
  /** Graded line guesses' absolute errors, by user. */
  lines: Map<string, number[]>;
  /** Per user, one entry per graded six-pack week. */
  sixPack: Map<string, Array<{ correct: number; perfect: boolean }>>;
  /** Weeks each user has been playing, for the rate column. Min 1. */
  weeksPlayed: Map<string, number>;
}

export interface ArcadeRow {
  userId: string;
  name: string;
  total: number;
  /** The four components, rendered — this is how anyone audits the total. */
  parts: Record<ArcadeGame, number>;
  /** Scored items across all four games. */
  n: number;
  perWeek: number;
}

export const EMPTY_INPUTS: ArcadeInputs = {
  streak: new Map(),
  gtgPoints: new Map(),
  lines: new Map(),
  sixPack: new Map(),
  weeksPlayed: new Map(),
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The standing. Every member is returned — a zero row is rankable, and
 * dropping people who have not played yet is how a board stops being a
 * roster.
 */
export function arcadeStandings(
  members: Array<{ userId: string; name: string }>,
  inputs: ArcadeInputs,
): ArcadeRow[] {
  return members
    .map(({ userId, name }) => {
      const picks = inputs.streak.get(userId) ?? [];
      const fold = streakFold(picks);
      const streak = fold.wins * ARCADE.streakWin;

      const gtg = round1((inputs.gtgPoints.get(userId) ?? 0) * ARCADE.gtgScale);

      const errors = inputs.lines.get(userId) ?? [];
      const lines = round1(errors.reduce((t, e) => t + ARCADE.linesGuess(e), 0));

      const weeks = inputs.sixPack.get(userId) ?? [];
      const sixPack = weeks.reduce(
        (t, w) => t + w.correct * ARCADE.sixPackCorrect + (w.perfect ? ARCADE.sixPackPerfect : 0),
        0,
      );

      const parts: Record<ArcadeGame, number> = { streak, gtg, lines, sixPack };
      const total = round1(streak + gtg + lines + sixPack);
      const n = fold.wins + fold.losses + errors.length + weeks.length;
      const weeksPlayed = Math.max(1, inputs.weeksPlayed.get(userId) ?? 1);
      return { userId, name, total, parts, n, perWeek: round1(total / weeksPlayed) };
    })
    .sort((a, b) => b.total - a.total || b.n - a.n || a.name.localeCompare(b.name));
}
