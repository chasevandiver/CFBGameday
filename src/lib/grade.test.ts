import { describe, expect, it } from "vitest";
import { firstHalfScore, gradePick, gradeTeamTotal } from "./grade";
import type { ScoringPlayRow } from "./scoring";

// Spreads are home-perspective everywhere in this codebase: negative means the
// home team is favoured. Each case states the bet in plain terms first, the way
// clv.test.ts does, so the claim can be checked without re-deriving the algebra.
describe("gradePick — spread", () => {
  it("settles a home favourite that covers", () => {
    // Took home -3. Home won by 10.
    expect(gradePick("spread", "home", -3, 31, 21)).toBe("win");
  });

  it("settles a home favourite that wins but does not cover", () => {
    // Took home -7. Home won by 3.
    expect(gradePick("spread", "home", -7, 24, 21)).toBe("loss");
  });

  it("settles an away dog that loses by less than the number", () => {
    // Took away +7 (home -7). Away lost by 3.
    expect(gradePick("spread", "away", -7, 24, 21)).toBe("win");
  });

  it("pushes on the number", () => {
    // Took home -3. Home won by exactly 3.
    expect(gradePick("spread", "home", -3, 24, 21)).toBe("push");
    expect(gradePick("spread", "away", -3, 24, 21)).toBe("push");
  });

  it("gives opposite results to the two sides of the same game", () => {
    expect(gradePick("spread", "home", -6.5, 30, 21)).toBe("win");
    expect(gradePick("spread", "away", -6.5, 30, 21)).toBe("loss");
  });
});

describe("gradePick — total", () => {
  it("settles an over that hits and an under that does not", () => {
    expect(gradePick("total", "over", 52.5, 31, 24)).toBe("win");
    expect(gradePick("total", "under", 52.5, 31, 24)).toBe("loss");
  });

  it("settles an under that holds", () => {
    expect(gradePick("total", "under", 52.5, 17, 14)).toBe("win");
  });

  it("pushes when the total lands exactly on the number", () => {
    expect(gradePick("total", "over", 55, 31, 24)).toBe("push");
    expect(gradePick("total", "under", 55, 31, 24)).toBe("push");
  });
});

describe("gradePick — straight up", () => {
  it("is decided by the winner, not by any number", () => {
    expect(gradePick("straight_up", "home", null, 24, 21)).toBe("win");
    expect(gradePick("straight_up", "away", null, 24, 21)).toBe("loss");
    expect(gradePick("straight_up", "away", null, 21, 24)).toBe("win");
  });

  it("ignores a line if one is somehow present", () => {
    // The whole point of branching on market: a 3-point home win is a
    // straight-up win even though it would not cover -7.
    expect(gradePick("straight_up", "home", -7, 24, 21)).toBe("win");
    expect(gradePick("spread", "home", -7, 24, 21)).toBe("loss");
  });

  it("pushes a 0-0 rather than settling it against the picker", () => {
    // Impossible in CFB, reachable through a bad feed.
    expect(gradePick("straight_up", "home", null, 0, 0)).toBe("push");
  });
});

describe("gradePick — refusals", () => {
  it("will not settle a priced market with no line", () => {
    // A check constraint forbids this row; inventing a zero would be worse
    // than declining, because a 0 spread settles as a pick'em and looks fine.
    expect(gradePick("spread", "home", null, 24, 21)).toBeNull();
    expect(gradePick("total", "over", null, 24, 21)).toBeNull();
  });

  it("will not settle a side that does not belong to the market", () => {
    expect(gradePick("spread", "over", -3, 24, 21)).toBeNull();
    expect(gradePick("total", "home", 52, 24, 21)).toBeNull();
    expect(gradePick("straight_up", "under", null, 24, 21)).toBeNull();
  });
});

describe("gradeTeamTotal (R2-A4)", () => {
  it("settles on one team's points only", () => {
    // Home team over 27.5 in a 31–24 game: home scored 31.
    expect(gradeTeamTotal("over", 27.5, 31)).toBe("win");
    expect(gradeTeamTotal("under", 27.5, 31)).toBe("loss");
    // Away under 27.5: away scored 24.
    expect(gradeTeamTotal("under", 27.5, 24)).toBe("win");
  });
  it("pushes on the number", () => {
    expect(gradeTeamTotal("over", 24, 24)).toBe("push");
    expect(gradeTeamTotal("under", 24, 24)).toBe("push");
  });
});

describe("firstHalfScore (R2-A4)", () => {
  const play = (over: Partial<ScoringPlayRow>): ScoringPlayRow => ({
    game_id: 1,
    sequence: 1,
    period: 1,
    clock: null,
    scoring_team_id: null,
    play_type: "TD",
    play_text: "touchdown",
    home_points: 7,
    away_points: 0,
    source: "test",
    ...over,
  });

  it("proves the half when every point is placed", () => {
    const plays = [
      play({ sequence: 1, period: 1, home_points: 7, away_points: 0 }),
      play({ sequence: 2, period: 2, home_points: 7, away_points: 3 }),
      play({ sequence: 3, period: 3, home_points: 14, away_points: 3 }),
      play({ sequence: 4, period: 4, home_points: 14, away_points: 10 }),
    ];
    expect(firstHalfScore(plays, 14, 10)).toEqual({ home: 7, away: 3 });
  });

  it("refuses when the plays under-explain the scoreboard (a missed play)", () => {
    const plays = [play({ sequence: 1, period: 1, home_points: 7, away_points: 0 })];
    // Final says 14–10; stored plays only account for 7–0.
    expect(firstHalfScore(plays, 14, 10)).toBeNull();
  });

  it("refuses when a play's period is unknown — its points fit no half", () => {
    const plays = [
      play({ sequence: 1, period: null, home_points: 7, away_points: 0 }),
      play({ sequence: 2, period: 3, home_points: 14, away_points: 0 }),
    ];
    expect(firstHalfScore(plays, 14, 0)).toBeNull();
  });

  it("refuses when the plays OVER-explain the scoreboard (a reversed score never taken back)", () => {
    // Feed logged 21 home points across the quarters; the final says 14.
    // `unaccounted` clamps at zero, so this is the case the exact-equality
    // check exists for.
    const plays = [
      play({ sequence: 1, period: 1, home_points: 7, away_points: 0 }),
      play({ sequence: 2, period: 1, home_points: 14, away_points: 0 }),
      play({ sequence: 3, period: 2, home_points: 21, away_points: 0 }),
    ];
    expect(firstHalfScore(plays, 14, 0)).toBeNull();
  });

  it("an overtime score lands outside the half but still must be placed", () => {
    const plays = [
      play({ sequence: 1, period: 1, home_points: 7, away_points: 0 }),
      play({ sequence: 2, period: 2, home_points: 7, away_points: 7 }),
      play({ sequence: 3, period: 5, home_points: 13, away_points: 7 }),
    ];
    expect(firstHalfScore(plays, 13, 7)).toEqual({ home: 7, away: 7 });
  });
});
