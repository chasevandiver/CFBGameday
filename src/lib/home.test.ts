import { describe, expect, it } from "vitest";
import {
  buildPositions,
  heldVsNow,
  placeOf,
  splitPositions,
  type HomeBet,
  type HomePick,
} from "./home";
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
  ({ id, status, startTs, myPicks: [], myBets: [] }) as unknown as GameView;

const lines = (spread: number | null, total: number | null): GameView["lines"] => ({
  spread,
  spreadOpen: null,
  total,
  totalOpen: null,
  mlHome: null,
  mlAway: null,
});

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

  /**
   * `tintFor` and the rest of live-status.ts read the viewer's layers off the
   * game, so the hub attaches them there rather than reimplementing the aura.
   */
  it("writes the picks and bets back onto the game", () => {
    const [pos] = buildPositions(games, [pick(1)], [bet(1)]);
    expect(pos.game.myPicks).toHaveLength(1);
    expect(pos.game.myBets).toHaveLength(1);
  });
});

describe("splitPositions", () => {
  const games = [game(1, "scheduled", "2026-09-05T16:00:00Z"), game(2, "final", "2026-09-05T12:00:00Z")];

  /** The real case: UNC held at +7 in a pool and +6.5 on a ticket. */
  it("puts a game with both layers in both lists, carrying only its own", () => {
    const out = splitPositions(buildPositions(games, [pick(1)], [bet(1)]));
    expect(out.bets.map((p) => p.game.id)).toEqual([1]);
    expect(out.picks.map((p) => p.game.id)).toEqual([1]);
    expect(out.bets[0].picks).toEqual([]);
    expect(out.picks[0].bets).toEqual([]);
  });

  /** Otherwise a pool pick could colour a money row's aura, and vice versa. */
  it("narrows the game's own layers so the tint follows the list", () => {
    const out = splitPositions(buildPositions(games, [pick(1)], [bet(1)]));
    expect(out.bets[0].game.myPicks).toEqual([]);
    expect(out.bets[0].game.myBets).toHaveLength(1);
    expect(out.picks[0].game.myBets).toEqual([]);
    expect(out.picks[0].game.myPicks).toHaveLength(1);
  });

  it("leaves a list empty when that layer has nothing", () => {
    const out = splitPositions(buildPositions(games, [pick(1)], []));
    expect(out.bets).toEqual([]);
    expect(out.picks).toHaveLength(1);
  });
});

describe("heldVsNow", () => {
  /**
   * Signs run through spreadClv/totalClv. These are the worked examples that
   * would catch an inversion — positive delta always means "your number is
   * better than what is on the board now".
   */
  it("credits a spread holder whose number got better", () => {
    // held MEM +4.5 (home −4.5), board now home −3.5 → you have the better side
    expect(heldVsNow("spread", "away", -4.5, lines(-3.5, null))).toEqual({
      held: 4.5,
      now: 3.5,
      delta: 1,
      isTotal: false,
    });
  });

  it("marks a spread holder whose number got worse", () => {
    // held UNC +6.5 (home −6.5), board now home −7 → +7 is available, yours isn't
    expect(heldVsNow("spread", "away", -6.5, lines(-7, null))).toEqual({
      held: 6.5,
      now: 7,
      delta: -0.5,
      isTotal: false,
    });
  });

  it("handles the home-side ticket without inverting it", () => {
    // laid FSU −30.5, board now −31.5 → yours is the cheaper lay
    expect(heldVsNow("spread", "home", -30.5, lines(-31.5, null))).toEqual({
      held: -30.5,
      now: -31.5,
      delta: 1,
      isTotal: false,
    });
  });

  it("credits an over bought below the current number", () => {
    expect(heldVsNow("total", "over", 57.5, lines(null, 60.5))).toEqual({
      held: 57.5,
      now: 60.5,
      delta: 3,
      isTotal: true,
    });
  });

  /** Over and under run in opposite directions — the easy one to get wrong. */
  it("marks an under that would now be available higher", () => {
    expect(heldVsNow("total", "under", 57.5, lines(null, 60.5))).toEqual({
      held: 57.5,
      now: 60.5,
      delta: -3,
      isTotal: true,
    });
  });

  /** A total is a bare number; only a spread carries a sign for its side. */
  it("flags totals so they render without a sign", () => {
    expect(heldVsNow("total", "over", 51.5, lines(null, 51.5))?.isTotal).toBe(true);
    expect(heldVsNow("spread", "away", -3, lines(-3, null))?.isTotal).toBe(false);
  });

  it("reports an unmoved line as zero, not minus zero", () => {
    const out = heldVsNow("spread", "away", -7, lines(-7, null));
    expect(out?.delta).toBe(0);
    expect(Object.is(out?.delta, -0)).toBe(false);
  });

  it("still shows your number when the board has none", () => {
    expect(heldVsNow("spread", "away", -7, lines(null, null))).toEqual({
      held: 7,
      now: null,
      delta: null,
      isTotal: false,
    });
  });

  it("has nothing to say about a market with no number", () => {
    expect(heldVsNow("straight_up", "home", null, lines(-7, null))).toBeNull();
    expect(heldVsNow("moneyline", "home", -7, lines(-7, null))).toBeNull();
  });
});
