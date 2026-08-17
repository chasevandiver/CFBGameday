import { describe, expect, it } from "vitest";
import { planToday, weekdayIn, type TodayInput } from "./home-today";

/* Frozen instants, one per weekday, chosen mid-afternoon Chicago time so no
   test sits near a date line. 2026-08-17 is a Monday. */
const DAY: Record<string, string> = {
  Mon: "2026-08-17T19:00:00Z",
  Tue: "2026-08-18T19:00:00Z",
  Wed: "2026-08-19T19:00:00Z",
  Thu: "2026-08-20T19:00:00Z",
  Fri: "2026-08-21T19:00:00Z",
  Sat: "2026-08-22T19:00:00Z",
  Sun: "2026-08-23T19:00:00Z",
};

const base = (over: Partial<TodayInput>): TodayInput => ({
  fetchedAt: DAY.Sat!,
  liveCount: 0,
  nextKick: null,
  weekGameCount: 12,
  progress: [],
  hasDrop: false,
  signedIn: true,
  ...over,
});

describe("weekdayIn", () => {
  it("computes the weekday in the product timezone, not UTC", () => {
    // 00:30 UTC Tuesday is 19:30 Monday in Chicago — the case the planner
    // exists to get right.
    expect(weekdayIn("2026-08-18T00:30:00Z", "America/Chicago")).toBe("Mon");
    expect(weekdayIn("2026-08-18T00:30:00Z", "UTC")).toBe("Tue");
  });
});

describe("planToday — the calendar", () => {
  it("Monday is results", () => {
    expect(planToday(base({ fetchedAt: DAY.Mon }))).toEqual({ kind: "results" });
  });
  it("Tuesday is the Drop, and carries whether it has landed", () => {
    expect(planToday(base({ fetchedAt: DAY.Tue, hasDrop: true }))).toEqual({
      kind: "drop",
      hasDrop: true,
    });
    expect(planToday(base({ fetchedAt: DAY.Tue }))).toEqual({ kind: "drop", hasDrop: false });
  });
  it("Wednesday is the board, due pools only", () => {
    const progress = [
      { name: "Crew", slug: "crew", made: 2, target: 5 },
      { name: "Done", slug: "done", made: 5, target: 5 },
      { name: "NoMin", slug: "nomin", made: 0, target: null },
    ];
    const block = planToday(base({ fetchedAt: DAY.Wed, progress }));
    expect(block.kind).toBe("board");
    if (block.kind === "board") {
      expect(block.due.map((p) => p.slug)).toEqual(["crew"]);
    }
  });
  it("game days lead with the next kickoff", () => {
    expect(planToday(base({ fetchedAt: DAY.Sat, nextKick: "2026-08-22T23:30:00Z" }))).toEqual({
      kind: "kickoff",
      at: "2026-08-22T23:30:00Z",
    });
  });
});

describe("planToday — priorities", () => {
  it("live football beats the calendar, Monday included (MNF)", () => {
    expect(planToday(base({ fetchedAt: DAY.Mon, liveCount: 1 }))).toEqual({
      kind: "live",
      liveCount: 1,
    });
  });
  it("on a game day, picks still owed outrank the kickoff — lock beats watch", () => {
    const progress = [{ name: "Crew", slug: "crew", made: 1, target: 5 }];
    const block = planToday(
      base({ fetchedAt: DAY.Sat, nextKick: "2026-08-22T23:30:00Z", progress }),
    );
    expect(block.kind).toBe("board");
  });
  it("but not for a signed-out visitor, who has no picks to owe", () => {
    const progress = [{ name: "Crew", slug: "crew", made: 1, target: 5 }];
    const block = planToday(
      base({
        fetchedAt: DAY.Sat,
        nextKick: "2026-08-22T23:30:00Z",
        progress,
        signedIn: false,
      }),
    );
    expect(block.kind).toBe("kickoff");
  });
  it("a game day with everything already kicked falls back to results", () => {
    expect(planToday(base({ fetchedAt: DAY.Sun, nextKick: null }))).toEqual({
      kind: "results",
    });
  });
  it("a week with nothing at all is quiet — the hub renders no filler", () => {
    expect(
      planToday(base({ fetchedAt: DAY.Fri, nextKick: null, weekGameCount: 0 })),
    ).toEqual({ kind: "quiet" });
  });
});
