import { describe, expect, it } from "vitest";
import { EMPTY_CTX, earnedTrophies, longestDayRun, TROPHIES, type TrophyCtx } from "./trophies";
import type { StreakPickLike } from "./streak";

const ctx = (over: Partial<TrophyCtx> = {}): TrophyCtx => ({ ...EMPTY_CTX, ...over });

const run = (n: number, result: "win" | "loss" = "win"): StreakPickLike[] =>
  Array.from({ length: n }, (_, i) => ({
    day: `2026-09-${String(i + 1).padStart(2, "0")}`,
    result,
  }));

const has = (c: TrophyCtx, id: string) => earnedTrophies(c).some((t) => t.id === id);

describe("the catalogue", () => {
  it("earns nothing on an empty history", () => {
    expect(earnedTrophies(EMPTY_CTX)).toEqual([]);
  });
  it("every trophy has an id, a label and a blurb", () => {
    for (const t of TROPHIES) {
      expect(t.id.length).toBeGreaterThan(0);
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.blurb.length).toBeGreaterThan(0);
    }
    expect(new Set(TROPHIES.map((t) => t.id)).size).toBe(TROPHIES.length);
  });
});

describe("boundaries", () => {
  it("Iron Man wants ten, not nine", () => {
    expect(has(ctx({ streak: run(9) }), "iron-man")).toBe(false);
    expect(has(ctx({ streak: run(10) }), "iron-man")).toBe(true);
  });

  it("Unbroken wants five live, not four", () => {
    expect(has(ctx({ streak: run(4) }), "unbroken")).toBe(false);
    expect(has(ctx({ streak: run(5) }), "unbroken")).toBe(true);
  });

  it("Perfect Call wants an exact zero", () => {
    expect(has(ctx({ lineErrors: [0.5, 1] }), "perfect-call")).toBe(false);
    expect(has(ctx({ lineErrors: [0.5, 0] }), "perfect-call")).toBe(true);
  });

  it("Sharp Eye wants ten calls AND the average", () => {
    expect(has(ctx({ lineErrors: Array(9).fill(0.5) }), "sharp-eye")).toBe(false);
    expect(has(ctx({ lineErrors: Array(10).fill(2) }), "sharp-eye")).toBe(false);
    expect(has(ctx({ lineErrors: Array(10).fill(1.5) }), "sharp-eye")).toBe(true);
  });

  it("Ice Cold wants a first-guess solve", () => {
    expect(has(ctx({ gtgSolves: [2, 3] }), "ice-cold")).toBe(false);
    expect(has(ctx({ gtgSolves: [3, 1] }), "ice-cold")).toBe(true);
  });

  it("Six-Pack wants a genuinely perfect week, not just a good one", () => {
    expect(has(ctx({ sixPack: [{ correct: 5, gradable: 6, perfect: false }] }), "six-pack")).toBe(
      false,
    );
    // Five of five gradable IS perfect — a void must not deny the trophy.
    expect(has(ctx({ sixPack: [{ correct: 5, gradable: 5, perfect: true }] }), "six-pack")).toBe(
      true,
    );
  });

  it("Regular wants seven consecutive days", () => {
    const days = (n: number) =>
      Array.from({ length: n }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
    expect(has(ctx({ activeDays: days(6) }), "regular")).toBe(false);
    expect(has(ctx({ activeDays: days(7) }), "regular")).toBe(true);
  });
});

describe("longestDayRun", () => {
  it("counts consecutive calendar days, ignoring duplicates", () => {
    expect(longestDayRun([])).toBe(0);
    expect(longestDayRun(["2026-09-01"])).toBe(1);
    expect(longestDayRun(["2026-09-01", "2026-09-01", "2026-09-02"])).toBe(2);
  });
  it("breaks the run on a gap and keeps the best stretch", () => {
    expect(
      longestDayRun(["2026-09-01", "2026-09-02", "2026-09-05", "2026-09-06", "2026-09-07"]),
    ).toBe(3);
  });
  it("handles a month boundary", () => {
    expect(longestDayRun(["2026-09-29", "2026-09-30", "2026-10-01"])).toBe(3);
  });
  it("does not care what order it is given", () => {
    expect(longestDayRun(["2026-09-03", "2026-09-01", "2026-09-02"])).toBe(3);
  });
});

describe("derived, never stored", () => {
  /**
   * The proof that matters: a badge is a statement about the data, so when a
   * re-grade changes the data the badge changes with it. Nothing is stored,
   * so nothing can survive its own evidence.
   */
  it("a re-grade that shortens a run takes the trophy away, and restoring it gives it back", () => {
    const nine = run(10);
    expect(has(ctx({ streak: nine }), "iron-man")).toBe(true);

    const regraded = nine.map((p, i) => (i === 4 ? { ...p, result: "loss" as const } : p));
    expect(has(ctx({ streak: regraded }), "iron-man")).toBe(false);

    const restored = regraded.map((p, i) => (i === 4 ? { ...p, result: "win" as const } : p));
    expect(has(ctx({ streak: restored }), "iron-man")).toBe(true);
  });

  it("a void in the middle of a run does not break it", () => {
    const withVoid: StreakPickLike[] = [
      ...run(5),
      { day: "2026-09-06", result: "void" },
      ...run(5).map((p, i) => ({ ...p, day: `2026-09-0${i + 7}`.slice(0, 10) })),
    ];
    expect(has(ctx({ streak: withVoid }), "iron-man")).toBe(true);
  });
});
