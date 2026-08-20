import { describe, expect, it } from "vitest";
import { EMPTY_TRAIL, foldTrail } from "./drive-trail";

describe("foldTrail", () => {
  it("appends new spots for the same possession, oldest first", () => {
    let s = foldTrail(EMPTY_TRAIL, 25, "home");
    s = foldTrail(s, 32, "home");
    s = foldTrail(s, 41, "home");
    expect(s).toEqual({ poss: "home", xs: [25, 32, 41] });
  });

  it("drops a repeated spot — dead-ball re-renders are not movement", () => {
    const s = foldTrail(EMPTY_TRAIL, 25, "home");
    const same = foldTrail(s, 25, "home");
    expect(same).toBe(s);
  });

  it("caps the history to the newest N", () => {
    let s: typeof EMPTY_TRAIL = EMPTY_TRAIL;
    for (const x of [10, 20, 30, 40, 50, 60, 70]) s = foldTrail(s, x, "home", 5);
    expect(s.xs).toEqual([30, 40, 50, 60, 70]);
  });

  it("a possession change starts a fresh drive", () => {
    let s = foldTrail(EMPTY_TRAIL, 25, "home");
    s = foldTrail(s, 60, "home");
    s = foldTrail(s, 58, "away");
    expect(s).toEqual({ poss: "away", xs: [58] });
  });

  it("possession arriving from null also resets", () => {
    let s = foldTrail(EMPTY_TRAIL, 50, null);
    s = foldTrail(s, 45, "away");
    expect(s).toEqual({ poss: "away", xs: [45] });
  });
});
