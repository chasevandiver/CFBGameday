import { describe, expect, it } from "vitest";
import { isRealPlay, keepLastPlay } from "./live-play";

/**
 * Every string below was captured from ESPN's live NFL scoreboard on
 * 2026-08-14 rather than invented, so the deny-list is held to the vocabulary
 * the feed actually emits.
 */

describe("isRealPlay", () => {
  it("keeps football, by ESPN's own type", () => {
    expect(isRealPlay("N.Singleton up the middle to SF 22 for 3 yards (Q.Bell).", "Rush")).toBe(true);
    expect(
      isRealPlay("(Shotgun) F.Mendoza pass incomplete deep right.", "Pass Incompletion"),
    ).toBe(true);
    expect(
      isRealPlay("R.Leonard FUMBLES (Aborted) at NE 29, and recovers at NE 29.", "Fumble Recovery (Own)"),
    ).toBe(true);
    // a missed kick is news, and so is a made one
    expect(
      isRealPlay("K.Matsuzawa 38 yard field goal is No Good, Hit Crossbar.", "Field Goal Missed"),
    ).toBe(true);
    expect(isRealPlay("J.Tucker 41 yard field goal is GOOD.", "Field Goal Good")).toBe(true);
    expect(isRealPlay("J.Tucker extra point is GOOD.", "Extra Point Good")).toBe(true);
    // a penalty explains a flag, which is exactly what a glance wants explained
    expect(
      isRealPlay("PENALTY on LAC, Delay of Game, 5 yards - No Play.", "Penalty"),
    ).toBe(true);
  });

  it("rejects the things that are not football", () => {
    expect(isRealPlay("Official Timeout at 11:36.", "Official Timeout")).toBe(false);
    expect(isRealPlay("Timeout #2 by DET at 01:21.", "Timeout")).toBe(false);
    expect(isRealPlay("Two-Minute Warning", "Two-minute warning")).toBe(false);
    expect(isRealPlay("End of quarter", "End Period")).toBe(false);
  });

  /* The deny-list must fail OPEN: a play type nobody has seen yet should show
     up on the card, not vanish from it. */
  it("treats an unrecognised type as a play", () => {
    expect(isRealPlay("R.Bullock 55 yard field goal is BLOCKED.", "Field Goal Blocked")).toBe(true);
    expect(isRealPlay("Something entirely new happened.", "Brand New Type")).toBe(true);
  });

  it("falls back to the text when the feed carries no type — CFBD has none", () => {
    expect(isRealPlay("Henderson rush up the middle for 12 yds to the MICH 14")).toBe(true);
    expect(isRealPlay("Official Timeout at 11:36.")).toBe(false);
    expect(isRealPlay("Timeout #1 by SF at 04:02.")).toBe(false);
    expect(isRealPlay("Two-Minute Warning")).toBe(false);
    expect(isRealPlay("End of the 3rd Quarter")).toBe(false);
  });

  /* Anchored at the start: a play that merely mentions a timeout afterwards is
     still a play, and this is the case a naive `includes("Timeout")` breaks. */
  it("does not reject a play that mentions a timeout", () => {
    expect(isRealPlay("D.Ross to LAC 38 for 11 yards. Timeout #1 by LAC at 02:00.")).toBe(true);
  });

  it("has nothing to keep when the text is missing", () => {
    expect(isRealPlay(null)).toBe(false);
    expect(isRealPlay("")).toBe(false);
    expect(isRealPlay("   ")).toBe(false);
  });
});

describe("keepLastPlay", () => {
  /* The reported bug: a TV timeout follows almost every score, so the plays it
     used to overwrite were the field goal, the extra point and the touchdown —
     the only ones anybody was reading. */
  it("holds the scoring play through the timeout that follows it", () => {
    const scored = "J.Tucker 41 yard field goal is GOOD, Center-N.Moore, Holder-J.Koch.";
    expect(keepLastPlay("Official Timeout at 11:36.", scored, "Official Timeout")).toBe(scored);
    expect(keepLastPlay("Two-Minute Warning", scored, "Two-minute warning")).toBe(scored);
  });

  it("takes the new play as soon as one happens", () => {
    const next = "(Shotgun) D.Uiagalelei pass short right to D.Ross for 11 yards.";
    expect(keepLastPlay(next, "Official Timeout at 11:36.", "Pass Reception")).toBe(next);
  });

  it("returns the stored value unchanged, so the diff sees no write", () => {
    const stored = "N.Singleton up the middle to SF 22 for 3 yards.";
    // identity matters: applyScoreboard compares patch to stored and skips the
    // UPDATE when they match, which is what keeps realtime quiet during a timeout
    expect(keepLastPlay("Official Timeout at 04:02.", stored, "Official Timeout")).toBe(stored);
  });

  it("holds nothing when there is nothing stored yet", () => {
    expect(keepLastPlay("Official Timeout at 11:36.", null, "Official Timeout")).toBeNull();
    expect(keepLastPlay(null, null)).toBeNull();
  });
});
