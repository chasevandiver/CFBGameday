import { describe, expect, it } from "vitest";
import { chooseWeek, copyTargets, neighbourWeeks } from "./week-bets";

/* Week keys are the Tuesday that opens each football week (footballWeekKey). */
const W4 = "2026-09-29";
const W5 = "2026-10-06";
const W6 = "2026-10-13";

describe("chooseWeek", () => {
  it("the current week when anybody bet in it", () => {
    expect(chooseWeek([W4, W5], W5, null)).toBe(W5);
  });

  it("on a quiet Tuesday, the week that just finished", () => {
    expect(chooseWeek([W4, W5], W6, undefined)).toBe(W5);
  });

  it("a date asked for opens the week it falls in", () => {
    // Sunday Oct 11 is in the week that opened Tuesday Oct 6
    expect(chooseWeek([W4, W5], W6, "2026-10-11")).toBe(W5);
    expect(chooseWeek([W4, W5], W6, W4)).toBe(W4);
  });

  it("junk in the URL falls back rather than erroring", () => {
    expect(chooseWeek([W4, W5], W5, "last-week")).toBe(W5);
    expect(chooseWeek([W4, W5], W5, "2026-13-45")).toBe(W5);
  });

  it("no bets at all is this week", () => {
    expect(chooseWeek([], W5, null)).toBe(W5);
  });
});

describe("neighbourWeeks", () => {
  it("steps between weeks with bets, and to now", () => {
    expect(neighbourWeeks([W4], W6, W4)).toEqual({ prev: null, next: W6 });
    expect(neighbourWeeks([W4, W5], W6, W5)).toEqual({ prev: W4, next: W6 });
    expect(neighbourWeeks([W4, W5], W5, W5)).toEqual({ prev: W4, next: null });
  });
});

describe("copyTargets", () => {
  const eric = { id: "eric", name: "Eric" };
  const hayden = { id: "hayden", name: "Hayden" };
  const chase = { id: "chase", name: "Me" };
  const colts = { userId: "eric", gameId: 401, betType: "spread", side: "away" };

  it("everyone but the owner, while nobody else holds it", () => {
    expect(copyTargets(colts, [colts], [chase, eric, hayden])).toEqual([chase, hayden]);
  });

  it("drops anyone already on the same side of the same market", () => {
    const tail = { ...colts, userId: "hayden" };
    expect(copyTargets(colts, [colts, tail], [chase, eric, hayden])).toEqual([chase]);
  });

  it("the other side, or another market on the game, does not count as holding it", () => {
    const fade = { ...colts, userId: "hayden", side: "home" };
    const total = { ...colts, userId: "chase", betType: "total", side: "over" };
    expect(copyTargets(colts, [colts, fade, total], [chase, eric, hayden])).toEqual([chase, hayden]);
  });

  it("a bet on no game cannot be copied", () => {
    expect(copyTargets({ ...colts, gameId: null }, [], [chase, hayden])).toEqual([]);
  });
});
