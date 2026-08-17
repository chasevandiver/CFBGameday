import { describe, expect, it } from "vitest";
import {
  ARCADE,
  arcadeStandings,
  EMPTY_INPUTS,
  weeklyCeiling,
  type ArcadeGame,
  type ArcadeInputs,
} from "./arcade";
import { streakFold, type StreakPickLike } from "./streak";

const members = [
  { userId: "a", name: "Ann" },
  { userId: "b", name: "Bob" },
];

const inputs = (over: Partial<ArcadeInputs> = {}): ArcadeInputs => ({
  ...EMPTY_INPUTS,
  streak: new Map(),
  gtgPoints: new Map(),
  lines: new Map(),
  sixPack: new Map(),
  weeksPlayed: new Map(),
  ...over,
});

const wins = (n: number): StreakPickLike[] =>
  Array.from({ length: n }, (_, i) => ({
    day: `2026-09-${String(i + 1).padStart(2, "0")}`,
    result: "win" as const,
  }));

describe("weeklyCeiling — the equalisation", () => {
  /**
   * THE test this module exists for. Guess the Game is daily and cheap to
   * win; unweighted it decides the arcade inside a month. If a weight change
   * ever pushes one game outside this band, the arcade has quietly become
   * "whoever plays that one the most" — and this fails first.
   */
  it("puts every game's weekly ceiling inside [60, 70]", () => {
    const games: ArcadeGame[] = ["streak", "gtg", "lines", "sixPack"];
    for (const g of games) {
      expect(weeklyCeiling(g)).toBeGreaterThanOrEqual(60);
      expect(weeklyCeiling(g)).toBeLessThanOrEqual(70);
    }
  });

  it("no game can outscore another by more than ~17% in a week", () => {
    const all = (["streak", "gtg", "lines", "sixPack"] as ArcadeGame[]).map(weeklyCeiling);
    expect(Math.max(...all) / Math.min(...all)).toBeLessThan(1.2);
  });
});

describe("arcadeStandings — the components", () => {
  it("streak points fold through streakFold — the parity test", () => {
    // If this module ever grows its own idea of what a run is, this fails.
    const picks = [...wins(4), { day: "2026-09-09", result: "loss" as const }];
    const rows = arcadeStandings(members, inputs({ streak: new Map([["a", picks]]) }));
    const ann = rows.find((r) => r.userId === "a")!;
    expect(ann.parts.streak).toBe(streakFold(picks).wins * ARCADE.streakWin);
    expect(ann.parts.streak).toBe(40);
  });

  it("consumes GtG points from SQL rather than recomputing attempts", () => {
    const rows = arcadeStandings(members, inputs({ gtgPoints: new Map([["a", 18]]) }));
    expect(rows.find((r) => r.userId === "a")!.parts.gtg).toBe(
      Math.round(18 * ARCADE.gtgScale * 10) / 10,
    );
  });

  it("line points decay with error and never go negative", () => {
    const rows = arcadeStandings(
      members,
      inputs({ lines: new Map([["a", [0, 1, 5, 20]]]) }),
    );
    // 7.5 + 6 + 0 + 0
    expect(rows.find((r) => r.userId === "a")!.parts.lines).toBe(13.5);
    expect(ARCADE.linesGuess(50)).toBe(0);
  });

  it("six-pack pays per correct answer plus a clean-sheet bonus", () => {
    const rows = arcadeStandings(
      members,
      inputs({
        sixPack: new Map([["a", [{ correct: 6, perfect: true }, { correct: 3, perfect: false }]]]),
      }),
    );
    expect(rows.find((r) => r.userId === "a")!.parts.sixPack).toBe(6 * 8 + 12 + 3 * 8);
  });

  it("the parts always sum to the total — the audit the UI renders", () => {
    const rows = arcadeStandings(
      members,
      inputs({
        streak: new Map([["a", wins(3)]]),
        gtgPoints: new Map([["a", 12]]),
        lines: new Map([["a", [0.5, 2]]]),
        sixPack: new Map([["a", [{ correct: 4, perfect: false }]]]),
      }),
    );
    const ann = rows.find((r) => r.userId === "a")!;
    const summed = Object.values(ann.parts).reduce((t, v) => t + v, 0);
    expect(Math.abs(summed - ann.total)).toBeLessThan(0.05);
  });
});

describe("arcadeStandings — who appears, and in what order", () => {
  it("a member who has never played is still returned, at zero", () => {
    // A floor would make a November joiner unrankable; that is the failure
    // this design refuses.
    const rows = arcadeStandings(members, inputs());
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.total === 0)).toBe(true);
  });

  it("sorts by total, then by items played, then by name", () => {
    const rows = arcadeStandings(
      members,
      inputs({ streak: new Map([["b", wins(5)]]), gtgPoints: new Map([["a", 6]]) }),
    );
    expect(rows[0]!.userId).toBe("b");
  });

  it("reports a per-week rate without hiding anyone", () => {
    const rows = arcadeStandings(
      members,
      inputs({ streak: new Map([["a", wins(6)]]), weeksPlayed: new Map([["a", 2]]) }),
    );
    const ann = rows.find((r) => r.userId === "a")!;
    expect(ann.total).toBe(60);
    expect(ann.perWeek).toBe(30);
    expect(ann.n).toBe(6);
  });

  it("never divides by zero for a member with no weeks recorded", () => {
    const rows = arcadeStandings(members, inputs({ gtgPoints: new Map([["a", 6]]) }));
    expect(Number.isFinite(rows.find((r) => r.userId === "a")!.perWeek)).toBe(true);
  });
});

describe("arcadeStandings — monotonicity", () => {
  /**
   * Every component is non-decreasing, which is why `current + best` was
   * rejected for the streak: a cumulative total that can go DOWN is one
   * nobody trusts.
   */
  it("adding a graded result never lowers a total", () => {
    const base = inputs({ streak: new Map([["a", wins(3)]]) });
    const before = arcadeStandings(members, base).find((r) => r.userId === "a")!.total;

    for (const grown of [
      inputs({ streak: new Map([["a", [...wins(3), { day: "2026-09-20", result: "loss" as const }]]]) }),
      inputs({ streak: new Map([["a", wins(4)]]) }),
      inputs({ streak: new Map([["a", wins(3)]]), lines: new Map([["a", [9]]]) }),
      inputs({ streak: new Map([["a", wins(3)]]), gtgPoints: new Map([["a", 1]]) }),
    ]) {
      const after = arcadeStandings(members, grown).find((r) => r.userId === "a")!.total;
      expect(after).toBeGreaterThanOrEqual(before);
    }
  });
});
