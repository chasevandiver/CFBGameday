import { describe, expect, it } from "vitest";
import { EMPTY_DAILY, dailyStanding, dayBefore, recordDayResult } from "./daily-stats";

/**
 * The arithmetic here came from `gtg-stats.ts`, which already had these edge
 * cases right. These tests exist so the generalisation did not lose any of
 * them — the failure being guarded against is a fold that looks correct on the
 * happy path and quietly mis-counts across a month boundary.
 *
 * `gtg-stats.ts` is deliberately NOT refactored to sit on top of this. Guess
 * the Game is the control the three new games are being tried against, and
 * churning it during the trial buys nothing.
 */

describe("dayBefore", () => {
  it("crosses a month boundary", () => {
    expect(dayBefore("2026-09-01")).toBe("2026-08-31");
  });

  it("crosses a year boundary", () => {
    expect(dayBefore("2027-01-01")).toBe("2026-12-31");
  });

  it("returns empty on a string that is not a date, rather than NaN-ing onward", () => {
    expect(dayBefore("not-a-day")).toBe("");
  });
});

describe("recordDayResult", () => {
  it("starts a streak on the first win", () => {
    const s = recordDayResult(EMPTY_DAILY, "2026-08-18", true, 5);
    expect(s.streak).toBe(1);
    expect(s.played).toBe(1);
    expect(s.won).toBe(1);
  });

  it("extends only when the day directly follows the last one counted", () => {
    let s = recordDayResult(EMPTY_DAILY, "2026-08-17", true, 5);
    s = recordDayResult(s, "2026-08-18", true, 5);
    expect(s.streak).toBe(2);
  });

  it("restarts at one across a gap", () => {
    let s = recordDayResult(EMPTY_DAILY, "2026-08-14", true, 5);
    s = recordDayResult(s, "2026-08-18", true, 5);
    expect(s.streak).toBe(1);
    expect(s.bestStreak).toBe(1);
  });

  it("resets to zero on a loss but keeps the best", () => {
    let s = recordDayResult(EMPTY_DAILY, "2026-08-16", true, 5);
    s = recordDayResult(s, "2026-08-17", true, 5);
    s = recordDayResult(s, "2026-08-18", false, 2);
    expect(s.streak).toBe(0);
    expect(s.bestStreak).toBe(2);
  });

  /** Idempotent by day, so a replayed row cannot inflate a record. */
  it("refuses a day it has already passed", () => {
    const first = recordDayResult(EMPTY_DAILY, "2026-08-18", true, 5);
    expect(recordDayResult(first, "2026-08-18", true, 5)).toBe(first);
    expect(recordDayResult(first, "2026-08-17", true, 5)).toBe(first);
  });

  it("counts the distribution by score", () => {
    let s = recordDayResult(EMPTY_DAILY, "2026-08-17", false, 3);
    s = recordDayResult(s, "2026-08-18", true, 5);
    expect(s.dist[3]).toBe(1);
    expect(s.dist[5]).toBe(1);
  });

  /**
   * The distribution grows to fit. It was fixed at eight buckets when this was
   * lifted out of `gtg-stats.ts`, where six guesses is a hard ceiling — which
   * silently dropped every Chains run past seven. A distribution that quietly
   * omits the good days is worse than no distribution.
   */
  it("grows the distribution to fit a long run", () => {
    const s = recordDayResult(EMPTY_DAILY, "2026-08-18", true, 17);
    expect(s.dist[17]).toBe(1);
    expect(s.played).toBe(1);
  });

  it("refuses an absurd score rather than allocating for it", () => {
    const s = recordDayResult(EMPTY_DAILY, "2026-08-18", true, 10_000_000);
    expect(s.dist.length).toBeLessThan(1000);
    expect(s.played).toBe(1);
  });

  it("ignores a negative or fractional score", () => {
    expect(recordDayResult(EMPTY_DAILY, "2026-08-18", true, -1).dist.some((n) => n > 0)).toBe(false);
    expect(recordDayResult(EMPTY_DAILY, "2026-08-18", true, 1.5).dist.some((n) => n > 0)).toBe(false);
  });

  /**
   * Guess the Game counts guesses spent, where lower is better; The Tape counts
   * answers right, where higher is. One fold, the comparator chosen by the
   * caller — the alternative was two copies of everything above.
   */
  it("takes best as lowest when the caller says lower is better", () => {
    let s = recordDayResult(EMPTY_DAILY, "2026-08-17", true, 4, false);
    s = recordDayResult(s, "2026-08-18", true, 2, false);
    expect(s.best).toBe(2);
  });

  it("takes best as highest by default", () => {
    let s = recordDayResult(EMPTY_DAILY, "2026-08-17", true, 4);
    s = recordDayResult(s, "2026-08-18", true, 2);
    expect(s.best).toBe(4);
  });
});

describe("dailyStanding", () => {
  /**
   * The sort is inside the fold, not trusted from the query. `recordDayResult`
   * refuses a day it has already passed, so a newest-first feed would fold one
   * row and drop the rest — reporting "played once" rather than erroring, which
   * is the kind of wrong that never gets noticed.
   */
  it("survives rows arriving in any order", () => {
    const rows = [
      { day: "2026-08-18", won: true, score: 5 },
      { day: "2026-08-16", won: true, score: 5 },
      { day: "2026-08-17", won: true, score: 5 },
    ];
    const s = dailyStanding(rows);
    expect(s.played).toBe(3);
    expect(s.streak).toBe(3);
  });

  it("is empty on no rows", () => {
    expect(dailyStanding([])).toEqual(EMPTY_DAILY);
  });

  it("does not mutate its input", () => {
    const rows = [
      { day: "2026-08-18", won: true, score: 5 },
      { day: "2026-08-16", won: true, score: 5 },
    ];
    dailyStanding(rows);
    expect(rows[0]!.day).toBe("2026-08-18");
  });
});
