import { describe, expect, it } from "vitest";
import { clockToSeconds, coverMargin, spreadCoverSide, totalCoverSide } from "./cover";
import { gradePick } from "./grade";
import { liveSpreadStatus } from "./live-status";

/**
 * `coverMargin` replaced four character-identical copies (grade, live-status,
 * the bet grader, and slate's home-perspective variant). These tests pin both
 * the arithmetic and the agreement, so a future edit to one caller can't
 * quietly reintroduce the drift.
 */
describe("coverMargin", () => {
  it("a home backer on -3 covers by winning by 4", () => {
    expect(coverMargin("home", -3, 24, 20)).toBe(1);
  });

  it("the same game is a loss for the away backer, by the same amount", () => {
    expect(coverMargin("away", -3, 24, 20)).toBe(-1);
  });

  it("landing on the number is zero from both sides", () => {
    expect(coverMargin("home", -3, 24, 21)).toBe(0);
    expect(coverMargin("away", -3, 24, 21)).toBe(0);
  });

  it("an away dog on +6.5 covers a 3-point loss", () => {
    // stored home-perspective: home -6.5, so the away ticket reads +6.5
    expect(coverMargin("away", -6.5, 24, 21)).toBe(3.5);
  });

  it("agrees with the settlement path and the live chips, game by game", () => {
    const cases: Array<[number, number, number]> = [
      [-3, 24, 20],
      [-3, 24, 21],
      [-6.5, 24, 21],
      [7, 17, 28],
      [0, 21, 21],
      [-14, 42, 10],
    ];
    for (const [line, h, a] of cases) {
      for (const side of ["home", "away"] as const) {
        const cm = coverMargin(side, line, h, a);
        const graded = gradePick("spread", side, line, h, a);
        expect(graded).toBe(cm > 0 ? "win" : cm < 0 ? "loss" : "push");
        const live = liveSpreadStatus(side, line, h, a);
        expect(live.state).toBe(cm > 0 ? "winning" : cm < 0 ? "losing" : "push");
      }
    }
  });
});

describe("spreadCoverSide / totalCoverSide", () => {
  it("names who is covering", () => {
    expect(spreadCoverSide(-3, 24, 20)).toBe("home");
    expect(spreadCoverSide(-3, 24, 22)).toBe("away");
    expect(spreadCoverSide(-3, 24, 21)).toBe("push");
  });

  it("names which way a total is going", () => {
    expect(totalCoverSide(51.5, 28, 24)).toBe("over");
    expect(totalCoverSide(51.5, 24, 20)).toBe("under");
    expect(totalCoverSide(52, 28, 24)).toBe("push");
  });
});

describe("clockToSeconds", () => {
  it("parses a game clock", () => {
    expect(clockToSeconds("12:34")).toBe(754);
    expect(clockToSeconds("0:38")).toBe(38);
    expect(clockToSeconds("15:00")).toBe(900);
  });

  it("is null for anything it can't trust, never zero", () => {
    // zero would read as "no time left", which is a different claim entirely
    expect(clockToSeconds(null)).toBeNull();
    expect(clockToSeconds("")).toBeNull();
    expect(clockToSeconds("halftime")).toBeNull();
    expect(clockToSeconds("1:75")).toBeNull();
  });
});
