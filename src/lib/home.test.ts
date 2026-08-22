import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPositions,
  GRADED_HOLD_MS,
  heldFinals,
  heldVsNow,
  outsideWeekIds,
  recordTone,
  settledRecord,
  splitSettled,
  homeRefreshTier,
  placeOf,
  splitPositions,
  type HomeBet,
  type HomeData,
  type HomePick,
  type Position,
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

const homeData = (over: Partial<HomeData> = {}): HomeData =>
  ({
    seasonId: 2026,
    week: 0,
    seasonType: "regular",
    fetchedAt: "2026-08-14T02:45:00Z",
    firstKick: null,
    liveCount: 0,
    weekGameCount: 8,
    positions: [],
    openBetCount: 0,
    openBetUnits: 0,
    weekPickCount: 0,
    groups: [],
    progress: [],
    bets: EMPTY_TALLY,
    picks: EMPTY_TALLY,
    pickGroupCount: 0,
    curve: [],
    ...over,
  }) as HomeData;

const position = (g: GameView): Position => ({ game: g, picks: [], bets: [] });

describe("homeRefreshTier", () => {
  /* The bug this exists for, reported 2026-08-14. liveCount and firstKick
     describe the CFB week on purpose, and the hub shows both leagues — so a
     live NFL game the viewer had money on read as "nothing happening" and put
     the page on its five-minute idle tier. */
  it("is live when a position is live, even with the CFB week weeks away", () => {
    const data = homeData({
      liveCount: 0,                       // CFB week 0 — nothing playing
      firstKick: "2026-08-29T16:00:00Z",  // fifteen days out
      positions: [position(game(401874392, "in_progress", "2026-08-14T00:00:00Z"))],
    });
    expect(homeRefreshTier(data)).toEqual({ live: true, imminent: true });
  });

  it("is live on the CFB week alone, for a visitor with no positions", () => {
    expect(homeRefreshTier(homeData({ liveCount: 3 })).live).toBe(true);
  });

  it("is imminent when a position kicks off inside six hours", () => {
    const data = homeData({
      positions: [position(game(1, "scheduled", "2026-08-14T06:00:00Z"))], // +3h15
    });
    expect(homeRefreshTier(data)).toEqual({ live: false, imminent: true });
  });

  it("stays idle when the only kickoff is days away", () => {
    const data = homeData({
      firstKick: "2026-08-29T16:00:00Z",
      positions: [position(game(1, "scheduled", "2026-08-29T16:00:00Z"))],
    });
    expect(homeRefreshTier(data)).toEqual({ live: false, imminent: false });
  });

  /* Bounded on both sides: a late kickoff still counts, but a game stuck at
     scheduled long past its start must not hold the fast tier forever. */
  it("counts a kickoff just past due, but not one stuck for hours", () => {
    const justLate = homeData({
      positions: [position(game(1, "scheduled", "2026-08-14T01:00:00Z"))], // -1h45
    });
    expect(homeRefreshTier(justLate).imminent).toBe(true);

    const stuck = homeData({
      positions: [position(game(1, "scheduled", "2026-08-13T12:00:00Z"))], // -14h45
    });
    expect(homeRefreshTier(stuck).imminent).toBe(false);
  });

  it("ignores a position with no kickoff time", () => {
    const data = homeData({ positions: [position(game(1, "scheduled", null))] });
    expect(homeRefreshTier(data)).toEqual({ live: false, imminent: false });
  });
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

/**
 * HUB-2. The hub's positions are scoped to the current week, and the week
 * pointer rolls the instant nothing in it is live or still scheduled. Week 0's
 * last game finals around midnight Saturday, so every graded card from that
 * Saturday used to disappear hours before anyone opened the app on Sunday —
 * the roadmap's Monday question ("How did I do?") failing outright.
 */
describe("held finals (HUB-2)", () => {
  const week = new Set([100, 101]);

  describe("outsideWeekIds", () => {
    it("asks about nothing when every position is inside the week", () => {
      // The common case by a wide margin: the pointer covers a position from
      // the moment it is made until its own slate ends, so this saves a query
      // on almost every hub render.
      expect(
        outsideWeekIds([{ game_id: 100 }], [{ game_id: 101 }], week),
      ).toEqual([]);
    });

    it("collects picks and bets alike, deduped", () => {
      const out = outsideWeekIds(
        [{ game_id: 900 }, { game_id: 900 }, { game_id: 100 }],
        [{ game_id: 900 }, { game_id: 901 }],
        week,
      );
      expect(out.sort()).toEqual([900, 901]);
    });

    it("drops the null game_id a future or parlay bet carries", () => {
      expect(outsideWeekIds([], [{ game_id: null }, { game_id: 902 }], week)).toEqual([902]);
    });
  });

  describe("heldFinals", () => {
    it("indexes per season, because the two slates are loaded separately", () => {
      // Handing the CFB loader an NFL id would filter it out on season_id and
      // quietly lose the position it was fetched for.
      const { ids, bySeason } = heldFinals([
        { id: 900, season_id: 2026 },
        { id: 901, season_id: 2026 },
        { id: 800, season_id: 102026 },
      ]);
      expect([...ids].sort()).toEqual([800, 900, 901]);
      expect(bySeason.get(2026)).toEqual([900, 901]);
      expect(bySeason.get(102026)).toEqual([800]);
    });

    it("is empty for an empty answer, not undefined", () => {
      const { ids, bySeason } = heldFinals([]);
      expect(ids.size).toBe(0);
      expect(bySeason.get(2026) ?? []).toEqual([]);
    });

    it("does not list a game twice if the read returns it twice", () => {
      const { bySeason } = heldFinals([
        { id: 900, season_id: 2026 },
        { id: 900, season_id: 2026 },
      ]);
      expect(bySeason.get(2026)).toEqual([900]);
    });
  });

  it("holds a game from kickoff for two days, so a 9pm Saturday still shows Monday", () => {
    // Measured from KICKOFF because nothing stores a reliable end time for a
    // CFB game. A 9pm CT Saturday kick is ~44h past its finish at the cutoff.
    const kick = Date.parse("2026-08-30T02:00:00Z"); // 9pm CT Sat Aug 29
    const mondayEvening = Date.parse("2026-08-31T23:00:00Z"); // 6pm CT Mon
    expect(mondayEvening - kick).toBeLessThan(GRADED_HOLD_MS);
    // And gone before the next board matters.
    const wednesday = Date.parse("2026-09-02T15:00:00Z");
    expect(wednesday - kick).toBeGreaterThan(GRADED_HOLD_MS);
  });
});

/**
 * The held ids widen `fetchSlateView`'s week filter, and the trap is where
 * `season_type` sits. Left outside the `or` as another `.eq`, it silently drops
 * any held game whose type differs from the current pointer's — an NFL
 * preseason final while the pointer has rolled to the regular season, which is
 * exactly the handoff week HUB-2 exists to survive. A dropped row is not an
 * error: the position simply is not there, which is the bug HUB-2 fixed.
 */
describe("the widened slate query keeps season_type with the week", () => {
  const SRC = readFileSync(join(__dirname, "./queries.ts"), "utf8");

  it("puts season_type inside the or, not beside it", () => {
    const or = /\.or\(\s*`([^`]+)`/.exec(SRC)?.[1] ?? "";
    expect(or, "fetchSlateView no longer builds an or filter").toContain("id.in.");
    expect(or).toMatch(/and\(week\.eq\.\$\{week\},season_type\.eq\.\$\{seasonType\}\)/);
  });

  it("still constrains the ids to integers before interpolating them", () => {
    // They reach a string that becomes a PostgREST filter, through a public
    // function signature anything can call.
    expect(SRC).toMatch(/Number\.isSafeInteger/);
  });
});

/**
 * Five settled games above the fold, ~1,000px of scroll, and the one pick still
 * in doubt pushed out of sight — from a real screenshot on 2026-08-22. HUB-1
 * made each settled row short; it could not make five of them stop being the
 * page.
 */
describe("the settled half of a section", () => {
  const at = (id: number, status: GameView["status"]) =>
    ({ game: { id, status }, picks: [], bets: [] }) as unknown as Position;

  it("keeps anything still in doubt out of the fold", () => {
    // Scheduled AND live: a game that has not kicked is as much "what have I
    // got riding" as one in the fourth quarter, and neither is a result.
    const { live, settled } = splitSettled([
      at(1, "final"),
      at(2, "in_progress"),
      at(3, "scheduled"),
      at(4, "final"),
    ]);
    expect(live.map((p) => p.game.id)).toEqual([2, 3]);
    expect(settled.map((p) => p.game.id)).toEqual([1, 4]);
  });

  it("leaves a postponed game in the live half rather than calling it settled", () => {
    // It has no result and never had one. Folding it under a record would file
    // it as something that happened.
    const { live, settled } = splitSettled([at(1, "postponed"), at(2, "canceled")]);
    expect(live.length).toBe(2);
    expect(settled.length).toBe(0);
  });

  describe("settledRecord", () => {
    const pos = (results: Array<string | null>): Position =>
      ({
        game: { id: 1, status: "final" },
        picks: [],
        bets: results.map((result, i) => ({ id: i, result })),
      }) as unknown as Position;

    it("counts every position on a game, not one per card", () => {
      // Two bets on one game is two results, and a card that says 1-0 over a
      // row showing a win and a loss is the summary lying about its own list.
      expect(settledRecord([pos(["win", "loss"])])).toMatchObject({ wins: 1, losses: 1 });
    });

    it("does not count a void, which never happened", () => {
      expect(settledRecord([pos(["win", "void"])])).toMatchObject({
        wins: 1,
        losses: 0,
        pushes: 0,
        decided: 1,
      });
    });

    it("does not count an ungraded final, so the number stops moving as you read it", () => {
      // The grader settles within a tick of the whistle, but that tick exists.
      expect(settledRecord([pos(["win", null])]).decided).toBe(1);
    });

    it("reports nothing decided when nothing has graded, so the caller can say so", () => {
      expect(settledRecord([pos([null, null])]).decided).toBe(0);
    });

    it("counts pushes separately, since W-L-P and W-L are different sentences", () => {
      expect(settledRecord([pos(["win", "push", "push"])])).toMatchObject({
        wins: 1,
        losses: 0,
        pushes: 2,
        decided: 3,
      });
    });
  });
});

describe("recordTone", () => {
  it("colours a winning week green and a losing one red", () => {
    expect(recordTone({ wins: 6, losses: 2 })).toBe("win");
    expect(recordTone({ wins: 2, losses: 6 })).toBe("loss");
  });

  it("leaves an even week neutral rather than picking a side", () => {
    expect(recordTone({ wins: 4, losses: 4 })).toBe("even");
    expect(recordTone({ wins: 0, losses: 0 })).toBe("even");
  });

  it("does not let pushes decide it", () => {
    // A push is the absence of an outcome. 3-3-4 is even however it is spelled,
    // and tinting it either way would claim something the week did not do.
    expect(recordTone({ wins: 3, losses: 3 })).toBe("even");
  });

  it("turns on one game, since 1-0 is a good week and should look like one", () => {
    expect(recordTone({ wins: 1, losses: 0 })).toBe("win");
    expect(recordTone({ wins: 0, losses: 1 })).toBe("loss");
  });
});
