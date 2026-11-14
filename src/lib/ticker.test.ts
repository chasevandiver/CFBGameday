import { describe, expect, it } from "vitest";
import { demoTickerData } from "./demo-data";
import {
  newDeploy,
  tickerMine,
  tickerStake,
  tickerSummary,
  tickerTickets,
  ticketsOf,
  type TicketBet,
} from "./ticker";
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

describe("newDeploy (TV-16)", () => {
  it("reloads only when a seen deploy is replaced by another", () => {
    expect(newDeploy("abc", "def")).toBe(true);
    expect(newDeploy("abc", "abc")).toBe(false);
    expect(newDeploy(null, "abc")).toBe(false);
    expect(newDeploy("abc", null)).toBe(false);
    expect(newDeploy("abc", undefined)).toBe(false);
  });
});

/**
 * TV-22, owner pick 2026-11-14: every ticket on a game, each graded on its
 * own. `tickerStake` returns one, so a side and a total on the same game
 * showed as the side alone.
 */
describe("tickerTickets (TV-22)", () => {
  const total = (o: Partial<TicketBet> = {}): TicketBet => ({
    id: 2,
    betType: "total",
    side: "over",
    line: 54.5,
    odds: -110,
    units: 1,
    ...o,
  });
  const side = (o: Partial<TicketBet> = {}): TicketBet => ({
    ...bet(),
    odds: -110,
    units: 1,
    ...o,
  });

  it("lists a side and a total, each with its own verdict", () => {
    const t = tickerTickets("in_progress", 28, 20, [side(), total()], [], "UGA", "ALA");
    expect(t.map((x) => [x.label, x.state])).toEqual([
      ["UGA -3.5", "covering"],
      ["O 54.5", "losing"],
    ]);
  });

  it("leads with the ticket tickerStake names, so the first is the one the tile grades", () => {
    const bets = [side({ betType: "first_half" }), total()];
    const t = tickerTickets("in_progress", 28, 20, bets, [], "UGA", "ALA");
    expect(t[0].label).toBe(tickerStake(bets, [], "UGA", "ALA")?.label);
    expect(t.map((x) => x.state)).toEqual(["losing", "on"]);
  });

  it("is ungraded before kickoff and carries no units until the game is final", () => {
    expect(tickerTickets("scheduled", null, null, [side()], [], "UGA", "ALA")).toEqual([
      { label: "UGA -3.5", side: "home", state: "on", units: null },
    ]);
    expect(tickerTickets("in_progress", 28, 20, [side()], [], "UGA", "ALA")[0].units).toBeNull();
  });

  it("prices a final at the bet's own odds, and takes the grader's word when it has run", () => {
    const fromScore = tickerTickets("final", 28, 20, [side({ units: 2 })], [], "UGA", "ALA");
    expect(fromScore[0]).toMatchObject({ state: "covering", units: 1.82 });
    // The grader settles what a score can't: a first-half bet reads WON here.
    const graded = tickerTickets(
      "final",
      28,
      20,
      [side({ betType: "first_half", result: "win", payoutUnits: 0.91 })],
      [],
      "UGA",
      "ALA",
    );
    expect(graded[0]).toMatchObject({ state: "covering", units: 0.91 });
  });

  it("never grades a voided bet from the score", () => {
    const t = tickerTickets("final", 28, 20, [side({ result: "void" })], [], "UGA", "ALA");
    expect(t[0]).toMatchObject({ state: "on", units: null });
  });

  it("shows picks only when there is no bet, headline first, with no units", () => {
    const picks = [pick({ market: "total", side: "under", line: 54.5 }), pick()];
    expect(
      tickerTickets("in_progress", 28, 20, [], picks, "UGA", "ALA").map((x) => [x.label, x.state]),
    ).toEqual([
      ["UGA -3.5", "covering"],
      ["U 54.5", "covering"],
    ]);
    expect(tickerTickets("in_progress", 28, 20, [side()], picks, "UGA", "ALA")).toHaveLength(1);
  });

  it("falls back to the single stake for a payload that predates tickets", () => {
    const g = {
      id: 1,
      status: "in_progress",
      startTs: null,
      period: 2,
      clock: "5:00",
      homeAbbr: "UGA",
      awayAbbr: "ALA",
      homePoints: 7,
      awayPoints: 3,
    };
    expect(ticketsOf(g)).toEqual([]);
    expect(
      ticketsOf({ ...g, mine: "covering", stake: { label: "UGA -3.5", side: "home" } }),
    ).toEqual([{ label: "UGA -3.5", side: "home", state: "covering" }]);
  });
});
