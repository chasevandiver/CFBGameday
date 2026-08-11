import { describe, expect, it } from "vitest";
import { demoTickerData } from "./demo-data";
import { tickerMine } from "./ticker";
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
