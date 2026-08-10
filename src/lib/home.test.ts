import { describe, expect, it } from "vitest";
import { buildPositions, placeOf, type HomeBet, type HomePick } from "./home";
import { EMPTY_TALLY, tally, type Tally } from "./records";
import type { GameView } from "./slate";

const t = (wins: number, losses: number): Tally =>
  tally(
    Array.from({ length: wins + losses }, (_, i) => ({
      result: i < wins ? ("win" as const) : ("loss" as const),
      units: 1,
      payoutUnits: null,
    })),
  );

const game = (id: number, status: string, startTs: string | null): GameView =>
  ({ id, status, startTs }) as GameView;

const pick = (gameId: number, groupId = "g1"): HomePick => ({
  gameId,
  market: "spread",
  side: "home",
  line: -3.5,
  result: null,
  groupId,
  groupName: "Sunday Crew",
  groupSlug: "sunday-crew",
});

const bet = (gameId: number, id = 1): HomeBet => ({
  id,
  gameId,
  betType: "spread",
  side: "away",
  line: -3.5,
  result: null,
});

describe("placeOf", () => {
  it("reports a 1-based place in an already-sorted field", () => {
    const sorted = [
      { userId: "a", tally: t(9, 2) },
      { userId: "me", tally: t(6, 5) },
      { userId: "c", tally: t(3, 8) },
    ];
    expect(placeOf(sorted, "me")).toBe(2);
    expect(placeOf(sorted, "a")).toBe(1);
  });

  /**
   * Every group is in this state until the first Saturday settles, and "1st of
   * 8" off a board where every row is 0-0 is a claim the data can't support.
   */
  it("is null when nothing in the group has graded", () => {
    const sorted = [
      { userId: "a", tally: EMPTY_TALLY },
      { userId: "me", tally: EMPTY_TALLY },
    ];
    expect(placeOf(sorted, "me")).toBeNull();
  });

  it("is null for someone not in the field", () => {
    expect(placeOf([{ userId: "a", tally: t(1, 0) }], "me")).toBeNull();
  });
});

describe("buildPositions", () => {
  const games = [
    game(1, "scheduled", "2026-09-05T16:00:00Z"),
    game(2, "in_progress", "2026-09-05T20:00:00Z"),
    game(3, "final", "2026-09-05T12:00:00Z"),
    game(4, "scheduled", "2026-09-05T23:00:00Z"),
  ];

  it("keeps only games with a pick or a bet", () => {
    const out = buildPositions(games, [pick(1)], [bet(3)]);
    expect(out.map((p) => p.game.id)).toEqual([1, 3]);
  });

  it("reads a Saturday in order: live, then upcoming, then settled", () => {
    const out = buildPositions(games, [pick(1), pick(2), pick(3), pick(4)], []);
    expect(out.map((p) => p.game.id)).toEqual([2, 1, 4, 3]);
  });

  /** One row per game however many boards it spans — that is one question. */
  it("collapses picks from several pools onto one game", () => {
    const out = buildPositions(games, [pick(1, "g1"), pick(1, "g2")], [bet(1)]);
    expect(out).toHaveLength(1);
    expect(out[0].picks.map((p) => p.groupId)).toEqual(["g1", "g2"]);
    expect(out[0].bets).toHaveLength(1);
  });

  it("sinks a game with no kickoff below the ones that have one", () => {
    const out = buildPositions(
      [game(5, "scheduled", null), game(1, "scheduled", "2026-09-05T16:00:00Z")],
      [pick(5), pick(1)],
      [],
    );
    expect(out.map((p) => p.game.id)).toEqual([1, 5]);
  });

  it("returns nothing when there is no action", () => {
    expect(buildPositions(games, [], [])).toEqual([]);
  });
});
