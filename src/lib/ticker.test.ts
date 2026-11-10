import { describe, expect, it } from "vitest";
import { demoTickerData } from "./demo-data";
import { tickerMine, tickerStake } from "./ticker";
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
