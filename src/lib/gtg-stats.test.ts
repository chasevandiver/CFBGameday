import { describe, expect, it } from "vitest";
import { EMPTY_STATS, gtgStanding, recordDay } from "./gtg-stats";

describe("recordDay", () => {
  it("a first solve starts the streak and records the distribution", () => {
    const s = recordDay(EMPTY_STATS, "2026-09-01", true, 3);
    expect(s.streak).toBe(1);
    expect(s.bestStreak).toBe(1);
    expect(s.bestSolve).toBe(3);
    expect(s.dist).toEqual([0, 0, 1, 0, 0, 0]);
    expect(s.played).toBe(1);
    expect(s.solved).toBe(1);
  });

  it("consecutive days extend; a gap restarts at one", () => {
    const a = recordDay(EMPTY_STATS, "2026-09-01", true, 3);
    const b = recordDay(a, "2026-09-02", true, 2);
    expect(b.streak).toBe(2);
    const c = recordDay(b, "2026-09-05", true, 5);
    expect(c.streak).toBe(1);
    // the peak survives the reset — that is the whole point of best
    expect(c.bestStreak).toBe(2);
    expect(c.bestSolve).toBe(2);
  });

  it("a bust resets the streak but still counts as played", () => {
    const a = recordDay(EMPTY_STATS, "2026-09-01", true, 3);
    const b = recordDay(a, "2026-09-02", false, 6);
    expect(b.streak).toBe(0);
    expect(b.played).toBe(2);
    expect(b.solved).toBe(1);
    // a bust adds nothing to the solve distribution
    expect(b.dist).toEqual([0, 0, 1, 0, 0, 0]);
  });

  it("is idempotent by day: an effect that reruns cannot count twice", () => {
    const a = recordDay(EMPTY_STATS, "2026-09-01", true, 3);
    expect(recordDay(a, "2026-09-01", true, 3)).toBe(a);
    // and an older day never rewrites history backwards
    expect(recordDay(a, "2026-08-30", false, 6)).toBe(a);
  });

  it("crosses a month boundary", () => {
    const a = recordDay(EMPTY_STATS, "2026-08-31", true, 4);
    expect(recordDay(a, "2026-09-01", true, 4).streak).toBe(2);
  });
});

describe("gtgStanding", () => {
  it("folds a whole history, whatever order the rows arrive in", () => {
    const rows = [
      { day: "2026-09-03", attempts: 2, solved: true },
      { day: "2026-09-01", attempts: 4, solved: true },
      { day: "2026-09-02", attempts: 6, solved: false },
    ];
    const s = gtgStanding(rows);
    expect(s.played).toBe(3);
    expect(s.solved).toBe(2);
    // 1st solved, 2nd bust (reset), 3rd solved -> current streak 1
    expect(s.streak).toBe(1);
    expect(s.bestStreak).toBe(1);
    expect(s.bestSolve).toBe(2);
    expect(s.dist).toEqual([0, 1, 0, 1, 0, 0]);
  });

  it("an unsorted feed cannot silently drop every row after the first", () => {
    // recordDay refuses a day it has already passed; newest-first without the
    // sort would fold one row and report "played once".
    const rows = [
      { day: "2026-09-05", attempts: 3, solved: true },
      { day: "2026-09-04", attempts: 3, solved: true },
    ];
    expect(gtgStanding(rows).played).toBe(2);
    expect(gtgStanding(rows).streak).toBe(2);
  });

  it("no history is the empty standing", () => {
    expect(gtgStanding([])).toEqual(EMPTY_STATS);
  });
});
