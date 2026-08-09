import { describe, expect, it } from "vitest";
import {
  liveMoneylineStatus,
  liveSpreadStatus,
  liveTotalStatus,
  statusForBet,
  statusForPick,
  tintFor,
} from "./live-status";
import type { GameView, MyBetView } from "./slate";

describe("liveSpreadStatus", () => {
  it("home favorite covering", () => {
    // home -6.5, leading by 10
    const s = liveSpreadStatus("home", -6.5, 30, 20);
    expect(s.state).toBe("winning");
    expect(s.clinched).toBe(false);
    expect(s.label).toBe("Covering by 3.5");
  });

  it("home favorite leading but not covering", () => {
    const s = liveSpreadStatus("home", -6.5, 24, 20);
    expect(s.state).toBe("losing");
    expect(s.label).toBe("Down 2.5 ATS");
  });

  it("away dog covering while trailing", () => {
    // away +6.5, down 4
    const s = liveSpreadStatus("away", -6.5, 24, 20);
    expect(s.state).toBe("winning");
    expect(s.label).toBe("Covering by 2.5");
  });

  it("push on the number", () => {
    const s = liveSpreadStatus("home", -7, 27, 20);
    expect(s.state).toBe("push");
  });
});

describe("liveTotalStatus", () => {
  it("over clinches once points pass the line, whatever the clock", () => {
    const s = liveTotalStatus("over", 44.5, 28, 17);
    expect(s.state).toBe("winning");
    expect(s.clinched).toBe(true);
    expect(s.label).toBe("Over hit");
  });

  it("under is dead once points pass the line", () => {
    const s = liveTotalStatus("under", 44.5, 28, 17);
    expect(s.state).toBe("losing");
    expect(s.clinched).toBe(true);
    expect(s.label).toBe("Under dead");
  });

  it("exactly on an integer line is a live push", () => {
    const s = liveTotalStatus("over", 45, 28, 17);
    expect(s.state).toBe("push");
    expect(s.clinched).toBe(false);
  });

  it("over short of the line needs whole points to clear it", () => {
    // 50 on the board vs 54.5 → 5 more points wins the over
    expect(liveTotalStatus("over", 54.5, 30, 20).label).toBe("Needs 5 more");
    // integer 54: 55 wins, 54 pushes → still needs 5
    expect(liveTotalStatus("over", 54, 30, 20).label).toBe("Needs 5 more");
  });

  it("under short of the line is winning with room", () => {
    const s = liveTotalStatus("under", 54.5, 30, 20);
    expect(s.state).toBe("winning");
    expect(s.clinched).toBe(false);
    expect(s.label).toBe("4.5 pts of room");
  });
});

describe("liveMoneylineStatus", () => {
  it("leading / trailing / tied", () => {
    expect(liveMoneylineStatus("home", 21, 14).state).toBe("winning");
    expect(liveMoneylineStatus("away", 21, 14).state).toBe("losing");
    expect(liveMoneylineStatus("home", 14, 14).state).toBe("push");
    expect(liveMoneylineStatus("home", 14, 14).label).toBe("Tied");
  });
});

describe("statusForPick", () => {
  it("routes team sides to spread math and totals sides to total math", () => {
    expect(statusForPick("home", -6.5, 30, 20)?.state).toBe("winning");
    expect(statusForPick("over", 44.5, 28, 17)?.clinched).toBe(true);
    expect(statusForPick("weird", -3, 10, 7)).toBeNull();
  });
});

describe("statusForBet", () => {
  const bet = (overrides: Partial<MyBetView>): MyBetView => ({
    id: 1,
    betType: "spread",
    side: "home",
    line: -3.5,
    ...overrides,
  });

  it("grades spread, total, and moneyline bets", () => {
    expect(statusForBet(bet({}), 28, 20)?.state).toBe("winning");
    expect(statusForBet(bet({ betType: "total", side: "under", line: 50.5 }), 28, 20)?.state).toBe(
      "winning",
    );
    expect(statusForBet(bet({ betType: "moneyline", side: "away", line: null }), 28, 20)?.state).toBe(
      "losing",
    );
  });

  it("skips untrackable types and incomplete rows", () => {
    expect(statusForBet(bet({ betType: "first_half" }), 28, 20)).toBeNull();
    expect(statusForBet(bet({ betType: "future", side: null, line: null }), 28, 20)).toBeNull();
    expect(statusForBet(bet({ side: null }), 28, 20)).toBeNull();
    expect(statusForBet(bet({ line: null }), 28, 20)).toBeNull();
  });
});

describe("tintFor", () => {
  const g = (overrides: Partial<GameView> = {}): GameView =>
    ({
      status: "in_progress",
      homePoints: 28,
      awayPoints: 20,
      myPick: null,
      myBets: [],
      ...overrides,
    }) as GameView;

  it("is neutral with nothing riding on it, and before kickoff", () => {
    expect(tintFor(g())).toBe("teams");
    expect(tintFor(g({ status: "scheduled", homePoints: null, awayPoints: null }))).toBe("teams");
  });

  it("reads a pick as covering, losing, or on the bubble", () => {
    // home up 8: -3.5 covers by 4.5; -14.5 is down 6.5, out of reach of one
    // score; -10.5 is down only 2.5, so a field goal still flips it
    expect(tintFor(g({ myPick: { side: "home", line: -3.5 } }))).toBe("covering");
    expect(tintFor(g({ myPick: { side: "home", line: -14.5 } }))).toBe("losing");
    expect(tintFor(g({ myPick: { side: "home", line: -10.5 } }))).toBe("bubble");
  });

  it("drops the bubble once the game is final — nothing can flip it", () => {
    const settled = { status: "final", myPick: { side: "home", line: -6.5 } } as Partial<GameView>;
    expect(tintFor(g(settled))).toBe("covering");
  });

  it("a ledger bet outranks a pick'em pick", () => {
    const bets = [{ id: 1, betType: "spread", side: "away", line: 3.5 }];
    // the pick is covering, the bet is not — real units decide the colour
    expect(
      tintFor(g({ myPick: { side: "home", line: -3.5 }, myBets: bets as GameView["myBets"] })),
    ).toBe("losing");
  });

  it("stays neutral on a push rather than inventing a verdict", () => {
    expect(tintFor(g({ myPick: { side: "home", line: -8 }, status: "final" }))).toBe("teams");
  });
});
