import { describe, expect, it } from "vitest";
import { buildBoxScore } from "./boxscore";
import type { ScoringPlayRow } from "./scoring";

const play = (
  sequence: number,
  period: number | null,
  home: number,
  away: number,
): ScoringPlayRow => ({
  game_id: 1,
  sequence,
  period,
  clock: null,
  scoring_team_id: null,
  play_type: null,
  play_text: "score",
  home_points: home,
  away_points: away,
  source: "espn",
});

describe("buildBoxScore", () => {
  it("splits a final into quarters from the running score", () => {
    // away 7 in Q1; home 14 in Q2; home 7 and away 3 in Q4
    const box = buildBoxScore(
      [
        play(0, 1, 0, 7),
        play(1, 2, 7, 7),
        play(2, 2, 14, 7),
        play(3, 4, 21, 7),
        play(4, 4, 21, 10),
      ],
      21,
      10,
      "final",
      4,
    );
    expect(box.periods).toEqual([1, 2, 3, 4]);
    expect(box.away.cells).toEqual([7, 0, 0, 3]);
    expect(box.home.cells).toEqual([0, 14, 0, 7]);
    expect(box.home.total).toBe(21);
    expect(box.away.total).toBe(10);
    expect(box.home.unaccounted).toBe(0);
  });

  it("leaves unplayed quarters blank rather than zero while live", () => {
    const box = buildBoxScore([play(0, 1, 0, 3)], 0, 3, "in_progress", 2);
    expect(box.away.cells).toEqual([3, 0, null, null]);
    expect(box.home.cells).toEqual([0, 0, null, null]);
    expect(box.started).toBe(true);
  });

  it("is an empty four-column grid before kickoff", () => {
    const box = buildBoxScore([], null, null, "scheduled", null);
    expect(box.periods).toEqual([1, 2, 3, 4]);
    expect(box.home.cells).toEqual([null, null, null, null]);
    expect(box.started).toBe(false);
  });

  it("adds overtime columns as they are reached", () => {
    const box = buildBoxScore(
      [play(0, 4, 7, 7), play(1, 5, 14, 7)],
      14,
      7,
      "final",
      5,
    );
    expect(box.periods).toEqual([1, 2, 3, 4, 5]);
    expect(box.home.cells).toEqual([0, 0, 0, 7, 7]);
  });

  it("reports points the feed never published a play for", () => {
    // The scoreboard says 21; the timeline only accounts for 14.
    const box = buildBoxScore([play(0, 1, 7, 0), play(1, 2, 14, 0)], 21, 0, "final", 4);
    expect(box.home.cells).toEqual([7, 7, 0, 0]);
    expect(box.home.total).toBe(21);
    expect(box.home.unaccounted).toBe(7);
  });

  it("keeps a play with no period out of the columns", () => {
    const box = buildBoxScore([play(0, null, 7, 0)], 7, 0, "final", 4);
    expect(box.home.cells).toEqual([0, 0, 0, 0]);
    // It is still on the scoreboard, so it shows up as unaccounted rather than
    // vanishing.
    expect(box.home.unaccounted).toBe(7);
  });
});
