/**
 * Trophies (R3-E3) — **derived, never stored.**
 *
 * The rule the survivor build and the streak both established: a stored
 * badge is a second source of truth that a re-grade or a corrected score
 * contradicts. So there is no table and no column here — every trophy is a
 * pure predicate over rows the arcade already fetched, recomputed on read.
 *
 * The consequence is deliberate and correct: a trophy can be TAKEN AWAY. If
 * a game is re-graded and your run was never really nine long, the badge
 * vanishes, because it was only ever a statement about the data.
 */

import { streakFold, type StreakPickLike } from "./streak";

export interface TrophyCtx {
  streak: StreakPickLike[];
  /** Absolute errors of graded line guesses. */
  lineErrors: number[];
  /** Attempts on each SOLVED Guess the Game day. */
  gtgSolves: number[];
  /** One entry per graded six-pack week. */
  sixPack: Array<{ correct: number; gradable: number; perfect: boolean }>;
  /** Distinct product days on which the member did anything, sorted ascending. */
  activeDays: string[];
}

export interface Trophy {
  id: string;
  label: string;
  blurb: string;
  earned: (ctx: TrophyCtx) => boolean;
}

export const EMPTY_CTX: TrophyCtx = {
  streak: [],
  lineErrors: [],
  gtgSolves: [],
  sixPack: [],
  activeDays: [],
};

/** The longest run of consecutive calendar days in a sorted YYYY-MM-DD list. */
export function longestDayRun(days: string[]): number {
  if (days.length === 0) return 0;
  const sorted = [...new Set(days)].sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = Date.parse(`${sorted[i - 1]}T00:00:00Z`);
    const cur = Date.parse(`${sorted[i]}T00:00:00Z`);
    if (cur - prev === 86_400_000) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }
  return best;
}

export const TROPHIES: Trophy[] = [
  {
    id: "perfect-call",
    label: "Perfect Call",
    blurb: "Called a line exactly right.",
    earned: (c) => c.lineErrors.some((e) => e === 0),
  },
  {
    id: "sharp-eye",
    label: "Sharp Eye",
    blurb: "Ten graded calls, averaging within a point and a half.",
    earned: (c) =>
      c.lineErrors.length >= 10 &&
      c.lineErrors.reduce((t, e) => t + e, 0) / c.lineErrors.length <= 1.5,
  },
  {
    id: "ice-cold",
    label: "Ice Cold",
    blurb: "Solved the daily puzzle on the first guess.",
    earned: (c) => c.gtgSolves.some((a) => a === 1),
  },
  {
    id: "iron-man",
    label: "Iron Man",
    blurb: "A streak of ten.",
    earned: (c) => streakFold(c.streak).best >= 10,
  },
  {
    id: "unbroken",
    label: "Unbroken",
    blurb: "Five in a row, right now — live, and losable.",
    earned: (c) => streakFold(c.streak).current >= 5,
  },
  {
    id: "six-pack",
    label: "Six-Pack",
    blurb: "Cleared a whole week's six.",
    earned: (c) => c.sixPack.some((w) => w.perfect),
  },
  {
    id: "regular",
    label: "Regular",
    blurb: "Played something seven days running.",
    earned: (c) => longestDayRun(c.activeDays) >= 7,
  },
];

/** Which trophies this context has earned, in catalogue order. */
export function earnedTrophies(ctx: TrophyCtx): Trophy[] {
  return TROPHIES.filter((t) => t.earned(ctx));
}
