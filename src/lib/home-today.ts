/**
 * The day-aware "today" block (R2-B1) — the hub leading with the day's
 * question, per docs/ROADMAP.md §1 and SPEC §7's "homepage by day".
 *
 * Pure planner: decides WHICH block today gets; `TodayCard` renders it from
 * data the hub already carries. Priority is deliberate — live football beats
 * the calendar (Monday Night Football is a Monday), the calendar beats the
 * fallback, and a week with nothing at all renders nothing rather than a box
 * of filler. The hub stays a pass-through.
 *
 * Day-of-week is computed in a fixed product timezone (`DEFAULT_TZ`), never
 * server UTC: Tuesday 00:30 UTC is Monday evening in Chicago, and a block
 * that flips a night early answers tomorrow's question today.
 */

import { DEFAULT_TZ } from "./kick";

export interface TodayPickProgress {
  name: string;
  slug: string;
  made: number;
  target: number | null;
}

export interface TodayInput {
  /** The payload's own stamp — planners run during render and must be stable. */
  fetchedAt: string;
  /** Live games on the CFB slate plus live positions in either league. */
  liveCount: number;
  /** Next future kickoff: the CFB week's, or a scheduled position's, whichever
   *  the caller found earliest. Null once everything has started or nothing is
   *  scheduled. */
  nextKick: string | null;
  /** Games on the current CFB week's slate. */
  weekGameCount: number;
  /** The viewer's boards, for the picks-due line. */
  progress: TodayPickProgress[];
  /** This week's Tuesday Drop row exists (rating_drops, R2-B2). */
  hasDrop: boolean;
  /** Signed-out visitors get the calendar blocks but not "your" copy. */
  signedIn: boolean;
}

export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

export type TodayBlock =
  | { kind: "live"; liveCount: number }
  | { kind: "results" }
  | { kind: "drop"; hasDrop: boolean }
  | { kind: "board"; due: TodayPickProgress[] }
  | { kind: "kickoff"; at: string }
  | { kind: "quiet" };

/** The weekday of an ISO instant, in a named timezone. */
export function weekdayIn(iso: string, tz: string = DEFAULT_TZ): Weekday {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(
    new Date(iso),
  ) as Weekday;
}

export function planToday(input: TodayInput, tz: string = DEFAULT_TZ): TodayBlock {
  const day = weekdayIn(input.fetchedAt, tz);

  // Live football beats the calendar, every day of the week.
  if (input.liveCount > 0) return { kind: "live", liveCount: input.liveCount };

  // Boards with picks still owed — the Wednesday block, and the fallback on
  // any game day before kickoff when something is due.
  const due = input.progress.filter((p) => p.target !== null && p.made < p.target);

  switch (day) {
    case "Mon":
      return { kind: "results" };
    case "Tue":
      return { kind: "drop", hasDrop: input.hasDrop };
    case "Wed":
      return { kind: "board", due };
    default: {
      // Thu–Sun: the day is about the next game. Due picks outrank a kickoff
      // that is still hours out — lock beats watch.
      if (due.length > 0 && input.signedIn) return { kind: "board", due };
      if (input.nextKick !== null) return { kind: "kickoff", at: input.nextKick };
      if (input.weekGameCount > 0) return { kind: "results" };
      return { kind: "quiet" };
    }
  }
}
