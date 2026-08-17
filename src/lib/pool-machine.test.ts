import { describe, expect, it } from "vitest";
import { projectWeek, type MachinePick } from "./pool-machine";
import { impliedHomeProb, mulberry32, weekWinOdds } from "./pool-odds";
import { EMPTY_TALLY, PICKEM_WIN_PAYOUT, tally, type Tally } from "./records";

const members = [
  { userId: "a", name: "Ann" },
  { userId: "b", name: "Bob" },
];
const baseTally = (units: number): Tally => ({ ...EMPTY_TALLY, units, decided: 1 });

const pick = (over: Partial<MachinePick>): MachinePick => ({
  userId: "a",
  gameId: 1,
  market: "spread",
  side: "home",
  units: 1,
  ...over,
});

describe("projectWeek (R2-D2)", () => {
  it("no toggles reproduces the graded standings exactly — the drift alarm", () => {
    const base = new Map([
      ["a", baseTally(2.5)],
      ["b", baseTally(1)],
    ]);
    const rows = projectWeek(members, base, [pick({})], new Map());
    expect(rows.map((r) => [r.userId, r.units, r.delta])).toEqual([
      ["a", 2.5, 0],
      ["b", 1, 0],
    ]);
  });

  it("a toggle settles spread and straight-up picks at records.ts prices", () => {
    const base = new Map([
      ["a", baseTally(0)],
      ["b", baseTally(0)],
    ]);
    const pending = [
      pick({ userId: "a", side: "home" }),
      pick({ userId: "b", side: "away" }),
    ];
    const rows = projectWeek(members, base, pending, new Map([[1, "home" as const]]));
    const ann = rows.find((r) => r.userId === "a")!;
    const bob = rows.find((r) => r.userId === "b")!;
    // The prices must come from records.ts, not a re-implementation.
    expect(ann.delta).toBe(tally([{ result: "win", units: 1 }]).units);
    expect(ann.delta).toBe(PICKEM_WIN_PAYOUT);
    expect(bob.delta).toBe(-1);
    expect(rows[0]!.userId).toBe("a"); // re-sorted
  });

  it("a total pick stays pending under any toggle — a side cannot answer it", () => {
    const base = new Map([["a", baseTally(0)]]);
    const rows = projectWeek(
      members,
      base,
      [pick({ market: "total", side: "over" })],
      new Map([[1, "home" as const]]),
    );
    expect(rows.find((r) => r.userId === "a")!.delta).toBe(0);
  });
});

describe("weekWinOdds (R2-D3)", () => {
  it("is deterministic under a seed", () => {
    const base = new Map([
      ["a", baseTally(0)],
      ["b", baseTally(0)],
    ]);
    const pending = [pick({ userId: "a", market: "straight_up" })];
    const games = [{ id: 1, homeWinProb: 0.7 }];
    const one = weekWinOdds(members, base, pending, games, 500);
    const two = weekWinOdds(members, base, pending, games, 500);
    expect(one).toEqual(two);
  });

  it("zero games left = the current standings at certainty", () => {
    const base = new Map([
      ["a", baseTally(3)],
      ["b", baseTally(1)],
    ]);
    const odds = weekWinOdds(members, base, [], [], 200);
    expect(odds.get("a")).toBe(1);
    expect(odds.get("b")).toBe(0);
  });

  it("one live pick tracks its game's probability (closed form)", () => {
    // Ann leads by nothing; her SU pick on a 70% home team decides the week.
    const base = new Map([
      ["a", baseTally(0)],
      ["b", baseTally(0.5)],
    ]);
    const pending = [pick({ userId: "a", market: "straight_up", units: 1 })];
    const games = [{ id: 1, homeWinProb: 0.7 }];
    const odds = weekWinOdds(members, base, pending, games, 4000);
    // Win → 0.909 units beats 0.5; loss → −1 loses. P(Ann) ≈ 0.7.
    expect(odds.get("a")!).toBeGreaterThan(0.65);
    expect(odds.get("a")!).toBeLessThan(0.75);
    expect(odds.get("a")! + odds.get("b")!).toBeCloseTo(1, 5);
  });

  it("a dead-even tie splits the week", () => {
    const base = new Map([
      ["a", baseTally(1)],
      ["b", baseTally(1)],
    ]);
    const odds = weekWinOdds(members, base, [], [], 100);
    expect(odds.get("a")).toBeCloseTo(0.5, 5);
    expect(odds.get("b")).toBeCloseTo(0.5, 5);
  });
});

describe("impliedHomeProb", () => {
  it("favored home > 50%, dog home < 50%, no line = coin flip", () => {
    expect(impliedHomeProb(-7)).toBeGreaterThan(0.6);
    expect(impliedHomeProb(7)).toBeLessThan(0.4);
    expect(impliedHomeProb(null)).toBe(0.5);
    expect(impliedHomeProb(-3)).toBeCloseTo(1 - impliedHomeProb(3), 10);
  });
});

describe("mulberry32", () => {
  it("same seed, same stream", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
