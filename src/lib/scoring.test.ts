import { describe, expect, it } from "vitest";
import { parseScoringPlays, pointsCovered } from "./espn";
import { byPeriod, cfbdScoringOffense, cfbdScoringPlays, formatClock, type ScoringPlayRow } from "./scoring";
import type { CfbdPlay } from "./cfbd";

/**
 * SCORE-1 — the two feeds, reduced to one row shape.
 *
 * The risk here is not the arithmetic, it is the parsing: two providers, two
 * naming conventions, and a set of absences that each have to degrade a
 * specific way rather than throwing or dropping a score.
 */

describe("parseScoringPlays (ESPN)", () => {
  const summary = {
    scoringPlays: [
      {
        id: "1",
        type: { text: "Passing Touchdown" },
        text: "J.Burrow 17 yd pass to J.Chase (E.McPherson kick)",
        period: { number: 1 },
        clock: { displayValue: "9:12" },
        team: { id: "4" },
        awayScore: 0,
        homeScore: 7,
      },
      {
        id: "2",
        type: { text: "Field Goal Good" },
        text: "J.Slye 55 yard field goal is GOOD, Center-M.Cox.",
        period: { number: 2 },
        clock: { displayValue: "0:03" },
        team: { id: "23" },
        awayScore: 3,
        homeScore: 7,
      },
    ],
  };

  it("reads the play, the clock, the quarter and the running score", () => {
    const plays = parseScoringPlays(summary);
    expect(plays).toHaveLength(2);
    expect(plays[0].text).toBe("J.Burrow 17 yd pass to J.Chase (E.McPherson kick)");
    expect(plays[0].period).toBe(1);
    expect(plays[0].clock).toBe("9:12");
    expect(plays[0].homePoints).toBe(7);
    expect(plays[0].awayPoints).toBe(0);
    expect(plays[0].espnTeamId).toBe(4);
    expect(plays[0].playType).toBe("Passing Touchdown");
  });

  /* Order comes from the array, not the clock and not the id. A clock counts
     down, resets every quarter and stops, and a touchdown and its extra point
     are routinely stamped at the same second. */
  it("numbers the plays by feed order", () => {
    const plays = parseScoringPlays(summary);
    expect(plays.map((p) => p.sequence)).toEqual([0, 1]);
  });

  it("survives an empty or absent scoringPlays", () => {
    expect(parseScoringPlays({})).toEqual([]);
    expect(parseScoringPlays({ scoringPlays: [] })).toEqual([]);
    expect(parseScoringPlays({ scoringPlays: [null] })).toEqual([]);
  });

  /* The text IS the feature. A row that renders as a blank line beside a score
     is worse than a gap where a play should be. */
  it("drops a play with no text", () => {
    expect(parseScoringPlays({ scoringPlays: [{ text: "   ", homeScore: 7 }] })).toEqual([]);
  });

  /* 0 is a real score at the start of a game, so defaulting to it must not be
     confused with "missing" — otherwise the opening touchdown of every shutout
     is lost. */
  it("keeps a play whose opponent has not scored", () => {
    const plays = parseScoringPlays({
      scoringPlays: [{ text: "Opening TD", homeScore: 7, awayScore: 0 }],
    });
    expect(plays).toHaveLength(1);
    expect(plays[0].awayPoints).toBe(0);
  });

  /* Some feeds omit the team on a safety. Losing the crest is acceptable;
     losing the score is not. */
  it("keeps a play with no team", () => {
    const plays = parseScoringPlays({
      scoringPlays: [{ text: "Safety", homeScore: 2, awayScore: 0, team: null }],
    });
    expect(plays[0].espnTeamId).toBeNull();
  });
});

describe("pointsCovered — the gate that makes /summary affordable", () => {
  /* NFL-12 left this call as a decision owed because one per live game per tick
     is ~16x the scoreboard call on a Sunday. Reading the last row's running
     score turns it into ~1 call per SCORE. */
  it("reads the last row's running total, not a sum", () => {
    expect(
      pointsCovered([
        { homePoints: 7, awayPoints: 0 },
        { homePoints: 7, awayPoints: 3 },
        { homePoints: 14, awayPoints: 3 },
      ]),
    ).toBe(17);
  });

  it("is zero before anything is stored", () => {
    expect(pointsCovered([])).toBe(0);
  });
});

describe("cfbdScoringPlays", () => {
  const plays: CfbdPlay[] = [
    { id: 1, game_id: 401, scoring: false, period: 1, play_text: "Rush for 3 yards", home_score: 0, away_score: 0 },
    {
      id: 2,
      game_id: 401,
      scoring: true,
      period: 1,
      clock: { minutes: 9, seconds: 4 },
      offense: "Texas",
      play_type: "Passing Touchdown",
      play_text: "Quinn Ewers pass complete to Xavier Worthy for 17 yds for a TD",
      home_score: 7,
      away_score: 0,
    },
    // camelCase, mixed into the same response — CFBD does this in the wild.
    {
      id: 3,
      gameId: 401,
      scoring: true,
      period: 3,
      clock: { minutes: 0, seconds: 32 },
      offense: "Ohio State",
      playText: "Field Goal Good",
      homeScore: 7,
      awayScore: 3,
    },
    { id: 4, game_id: 999, scoring: true, period: 1, play_text: "Another game's TD", home_score: 7, away_score: 0 },
  ];

  it("keeps only this game's scoring plays", () => {
    const out = cfbdScoringPlays(plays, 401);
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.sequence)).toEqual([0, 1]);
  });

  /* The reason each field is read through two names: CFBD's keys have appeared
     in both conventions across versions, and the two are mixed within one
     response. Reading only snake_case silently drops half the scores. */
  it("reads camelCase and snake_case alike", () => {
    const out = cfbdScoringPlays(plays, 401);
    expect(out[1].text).toBe("Field Goal Good");
    expect(out[1].homePoints).toBe(7);
    expect(out[1].awayPoints).toBe(3);
  });

  it("formats the clock object as a broadcast clock", () => {
    const out = cfbdScoringPlays(plays, 401);
    expect(out[0].clock).toBe("9:04");
    expect(out[1].clock).toBe("0:32");
  });

  /* CFBD publishes no play type at all, which is why the column is nullable —
     `live-play.ts` had to solve the same absence for `last_play`. */
  it("leaves the type null when the feed has none", () => {
    expect(cfbdScoringPlays(plays, 401)[1].playType).toBeNull();
  });

  it("reports the offense per play, in the same order, for team matching", () => {
    expect(cfbdScoringOffense(plays, 401)).toEqual(["Texas", "Ohio State"]);
  });
});

describe("formatClock", () => {
  it("pads the seconds", () => {
    expect(formatClock({ minutes: 12, seconds: 5 })).toBe("12:05");
    expect(formatClock({ minutes: 0, seconds: 0 })).toBe("0:00");
  });

  /* Null rather than a fabricated 0:00: "the feed did not say" and "no time
     left" are different facts and the card should not conflate them. */
  it("is null when the feed omits it", () => {
    expect(formatClock(null)).toBeNull();
    expect(formatClock({ minutes: 3 })).toBeNull();
    expect(formatClock({ seconds: 12 })).toBeNull();
  });
});

describe("byPeriod", () => {
  const row = (seq: number, period: number | null): ScoringPlayRow => ({
    game_id: 1,
    sequence: seq,
    period,
    clock: null,
    scoring_team_id: null,
    play_type: null,
    play_text: `play ${seq}`,
    home_points: 0,
    away_points: 0,
    source: "espn",
  });

  it("groups consecutive plays into their quarter", () => {
    const out = byPeriod([row(0, 1), row(1, 1), row(2, 2)]);
    expect(out.map((p) => p.period)).toEqual([1, 2]);
    expect(out[0].plays).toHaveLength(2);
  });

  it("orders by sequence, whatever order the rows arrive in", () => {
    const out = byPeriod([row(2, 2), row(0, 1), row(1, 1)]);
    expect(out.map((p) => p.period)).toEqual([1, 2]);
    expect(out[0].plays.map((p) => p.sequence)).toEqual([0, 1]);
  });

  /* A quarter that is scored in, left, and returned to (overtime after a tied
     regulation, say) reads as two blocks rather than being merged — the
     timeline is chronological first and grouped second. */
  it("opens a new block when the period comes back round", () => {
    const out = byPeriod([row(0, 4), row(1, 5), row(2, 4)]);
    expect(out.map((p) => p.period)).toEqual([4, 5, 4]);
  });

  it("keeps a play whose period the feed omitted", () => {
    const out = byPeriod([row(0, null)]);
    expect(out).toHaveLength(1);
    expect(out[0].period).toBeNull();
  });
});
