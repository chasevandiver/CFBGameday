import { describe, expect, it } from "vitest";
import { badgeLabel, openPickCount } from "./picks-due";

describe("openPickCount — what the Groups badge counts", () => {
  it("counts the games with no pick on them", () => {
    expect(
      openPickCount({ boardGameIds: [1, 2, 3], pickedGameIds: [2], lockedGameIds: [] }),
    ).toBe(2);
  });

  it("is silent when the week is done", () => {
    expect(
      openPickCount({ boardGameIds: [1, 2], pickedGameIds: [1, 2], lockedGameIds: [] }),
    ).toBe(0);
  });

  it("does not count a game that has already kicked", () => {
    // make_pick refuses these at the database. Badging them would show a debt
    // the app will not let anyone pay, and a badge that cannot clear is one
    // people stop seeing.
    expect(
      openPickCount({ boardGameIds: [1, 2, 3], pickedGameIds: [], lockedGameIds: [1, 2] }),
    ).toBe(1);
  });

  it("treats one pick on a game as that game handled", () => {
    // A board can ask for a spread AND a total on the same game; requiring
    // both would badge someone who has done everything it asked. Same rule
    // notifyPicksDueJob uses, deliberately.
    expect(
      openPickCount({ boardGameIds: [7], pickedGameIds: [7, 7], lockedGameIds: [] }),
    ).toBe(0);
  });

  it("says nothing when there is no board", () => {
    expect(openPickCount({ boardGameIds: [], pickedGameIds: [], lockedGameIds: [] })).toBe(0);
  });
});

describe("badgeLabel", () => {
  it("renders nothing at zero, which is the common case", () => {
    expect(badgeLabel(0)).toBeNull();
    expect(badgeLabel(-1)).toBeNull();
  });

  it("counts up to nine", () => {
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(9)).toBe("9");
  });

  it("stops counting past nine, where digits stop being information", () => {
    expect(badgeLabel(10)).toBe("9+");
    expect(badgeLabel(40)).toBe("9+");
  });
});
