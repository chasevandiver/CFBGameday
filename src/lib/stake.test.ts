import { describe, expect, it } from "vitest";
import { cardStake, liveStake, settledStake } from "./stake";
import type { GameView, MyBetView, MyPickView } from "./slate";

const team = (id: number, abbr: string) =>
  ({
    id,
    school: abbr,
    abbr,
    mascot: null,
    conference: null,
    color: null,
    altColor: null,
    logo: null,
    rank: null,
    pollRank: null,
    poll: null,
    record: null,
    confRecord: null,
  }) as GameView["home"];

const bet = (b: Partial<MyBetView>): MyBetView =>
  ({ id: 1, betType: "spread", side: "home", line: -3, result: null, ...b }) as MyBetView;

const pick = (p: Partial<MyPickView>): MyPickView =>
  ({ market: "spread", side: "home", line: -3, ...p }) as MyPickView;

/** OSU 21, MICH 10, in progress — the only fields these helpers read. */
const gameWith = (over: Partial<GameView>): GameView =>
  ({
    id: 1,
    home: team(1, "OSU"),
    away: team(2, "MICH"),
    status: "in_progress",
    homePoints: 21,
    awayPoints: 10,
    myBets: [],
    myPicks: [],
    ...over,
  }) as unknown as GameView;

describe("liveStake", () => {
  it("says nothing when the viewer has nothing on the game", () => {
    expect(liveStake(gameWith({}))).toBeNull();
  });

  it("reads a bet even with no pool pick — the reported gap", () => {
    // Before this, the live strip was gated on a pick'em pick, so a card you
    // had money and no pick on glowed green with no word on it.
    const s = liveStake(gameWith({ myBets: [bet({ line: -3 })] }));
    expect(s?.cover.word).toBe("Covering");
    expect(s?.cover.tier).toBe("covering");
    expect(s?.label).toBe("OSU -3");
  });

  it("ranks a bet above a pick, the way the aura does", () => {
    const s = liveStake(
      gameWith({
        // The bet is losing, the pick is covering: the money wins the strip.
        myBets: [bet({ side: "away", line: -3 })],
        myPicks: [pick({ side: "home", line: -3 })],
      }),
    );
    expect(s?.cover.tier).toBe("losing");
    expect(s?.label).toBe("MICH +3");
  });

  it("maps a moneyline bet onto the straight-up formula", () => {
    const s = liveStake(gameWith({ myBets: [bet({ betType: "moneyline", line: null })] }));
    expect(s?.cover.word).toBe("Winning");
    expect(s?.label).toBe("OSU ML");
  });

  it("falls through a wager a score cannot settle", () => {
    const s = liveStake(
      gameWith({
        myBets: [bet({ betType: "future", line: null })],
        myPicks: [pick({ side: "home", line: -3 })],
      }),
    );
    expect(s?.label).toBe("Pick OSU -3");
  });
});

describe("settledStake", () => {
  it("uses the grader's word over the score", () => {
    const s = settledStake(
      gameWith({ status: "final", myBets: [bet({ side: "home", line: -3, result: "loss" })] }),
    );
    expect(s?.cover.word).toBe("Lost");
  });

  it("computes from the final score when the grader has not run", () => {
    const s = settledStake(gameWith({ status: "final", myBets: [bet({ line: -3 })] }));
    expect(s?.cover.word).toBe("Won");
  });

  it("is silent on a voided wager with nothing else on the game", () => {
    expect(
      settledStake(gameWith({ status: "final", myBets: [bet({ result: "void" })] })),
    ).toBeNull();
  });
});

describe("cardStake", () => {
  it("has no verdict before kickoff", () => {
    expect(
      cardStake(gameWith({ status: "scheduled", homePoints: null, awayPoints: null, myBets: [bet({})] })),
    ).toBeNull();
  });

  it("routes live and final to the right tense", () => {
    expect(cardStake(gameWith({ myBets: [bet({})] }))?.cover.word).toBe("Covering");
    expect(cardStake(gameWith({ status: "final", myBets: [bet({})] }))?.cover.word).toBe("Won");
  });
});
