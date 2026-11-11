import { describe, expect, it } from "vitest";
import { demoTickerData } from "./demo-data";
import { tickerMine, tickerStake, tickerSummary } from "./ticker";
import type { MyBetView, MyPickView } from "./slate";

const bet = (overrides: Partial<MyBetView> = {}): MyBetView => ({
  id: 1,
  betType: "spread",
  side: "home",
  line: -3.5,
  ...overrides,
});

const pick = (overrides: Partial<MyPickView> = {}): MyPickView => ({
  market: "spread",
  side: "home",
  line: -3.5,
  ...overrides,
});

describe("tickerMine", () => {
  it("stays null with nothing riding — the chip must not claim a stake", () => {
    expect(tickerMine("in_progress", 21, 14, [], [])).toBeNull();
  });

  it("marks pregame action as 'on' — you're on it, nothing to grade yet", () => {
    expect(tickerMine("scheduled", null, null, [], [pick()])).toBe("on");
    expect(tickerMine("scheduled", null, null, [bet()], [])).toBe("on");
  });

  it("speaks the aura's vocabulary once a verdict exists", () => {
    expect(tickerMine("in_progress", 28, 20, [bet()], [])).toBe("covering");
    expect(tickerMine("in_progress", 21, 20, [bet()], [])).toBe("losing");
    expect(tickerMine("in_progress", 24, 21, [bet({ line: -3 })], [])).toBe("push");
  });

  it("falls back to 'on' when the only bet is a type a score can't grade", () => {
    expect(tickerMine("in_progress", 21, 14, [bet({ betType: "first_half" })], [])).toBe("on");
  });
});

describe("demoTickerData", () => {
  const NOW = Date.parse("2026-08-11T15:00:00Z");

  it("carries the pose regardless of when the link is opened: live, finals, and everything up next except the late window", () => {
    const { games } = demoTickerData(NOW);
    const byStatus = (s: string) => games.filter((g) => g.status === s).length;
    expect(byStatus("in_progress")).toBe(3);
    expect(byStatus("final")).toBe(3);
    // 4 primetime kickoffs make the strip; the two late games don't.
    expect(byStatus("scheduled")).toBe(4);
  });

  it("lands the three live games one on each verdict", () => {
    const mine = new Map(demoTickerData(NOW).games.map((g) => [g.id, g.mine]));
    expect(mine.get(9104)).toBe("losing");
    expect(mine.get(9105)).toBe("push");
    expect(mine.get(9106)).toBe("covering");
  });

  it("marks pregame picks as 'on' and leaves untouched games plain", () => {
    const mine = new Map(demoTickerData(NOW).games.map((g) => [g.id, g.mine]));
    expect(mine.get(9107)).toBe("on"); // picked in two pools, not kicked yet
    expect(mine.get(9103)).toBeNull(); // a final the viewer had nothing on
  });
});

/* TV-3: the label the TV overlay prints, and which side it colours. Lines are
   stored home-perspective, so an away ticket must print with its sign flipped. */
describe("tickerStake", () => {
  it("labels an away spread bet from the bettor's side", () => {
    expect(
      tickerStake([{ id: 1, betType: "spread", side: "away", line: 3.5 }], [], "UGA", "ALA"),
    ).toEqual({ label: "ALA -3.5", side: "away" });
  });

  it("labels a home spread bet as stored", () => {
    expect(
      tickerStake([{ id: 1, betType: "spread", side: "home", line: -7 }], [], "TEX", "OU"),
    ).toEqual({ label: "TEX -7", side: "home" });
  });

  it("labels a total with no team side", () => {
    expect(
      tickerStake([{ id: 1, betType: "total", side: "over", line: 54.5 }], [], "TEX", "OU"),
    ).toEqual({ label: "O 54.5", side: "over" });
  });

  it("prefers a gradable bet over an ungradable one, and any bet over a pick", () => {
    expect(
      tickerStake(
        [
          { id: 1, betType: "team_total", side: "home", line: 30 },
          { id: 2, betType: "moneyline", side: "home", line: null },
        ],
        [{ market: "spread", side: "away", line: 3 }],
        "TCU",
        "BAY",
      ),
    ).toEqual({ label: "TCU ML", side: "home" });
  });

  it("falls back to the headline pick", () => {
    expect(tickerStake([], [{ market: "spread", side: "away", line: 3 }], "TCU", "BAY")).toEqual({
      label: "BAY -3",
      side: "away",
    });
  });

  it("is null with nothing on the game", () => {
    expect(tickerStake([], [], "TCU", "BAY")).toBeNull();
  });
});

/* TV-9: the summary card's record and units. */
describe("tickerSummary", () => {
  const bet = (over: Partial<Parameters<typeof tickerSummary>[0][number]>) => ({
    game_id: 1,
    bet_type: "spread",
    side: "away",
    line_taken: 1.5,
    odds: -110,
    units: 1,
    result: null,
    payout_units: null,
    ...over,
  });
  const games = [
    { id: 1, status: "final", home_points: 34, away_points: 17 },
    { id: 2, status: "final", home_points: 10, away_points: 24 },
    { id: 3, status: "in_progress", home_points: 7, away_points: 7 },
    { id: 4, status: "scheduled", home_points: null, away_points: null },
  ];

  it("grades finals from the score at the bet's own line and odds", () => {
    const s = tickerSummary(
      [
        bet({ game_id: 1 }), // away +1.5, lost by 17: loss, -1u
        bet({ game_id: 2, odds: 150, units: 2 }), // away +1.5, won by 14: win, +3u
        bet({ game_id: 3 }),
        bet({ game_id: 4 }),
      ],
      games,
    );
    expect(s).toEqual({ record: "1-1", units: 2, live: 1, upcoming: 1 });
  });

  it("prefers the grader's result and payout when it has run", () => {
    const s = tickerSummary([bet({ game_id: 1, result: "win", payout_units: 0.91 })], games);
    expect(s).toEqual({ record: "1-0", units: 0.91, live: 0, upcoming: 0 });
  });

  it("skips voids, and is null with no bets", () => {
    expect(tickerSummary([bet({ game_id: 1, result: "void" })], games)?.record).toBe("0-0");
    expect(tickerSummary([], games)).toBeNull();
  });
});
