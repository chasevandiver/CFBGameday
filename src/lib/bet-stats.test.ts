import { describe, expect, it } from "vitest";
import { extremes, lateFlips, marketSplit, streaks, type FlipRow } from "./bet-stats";
import type { ClassifiedBet } from "./tailing";

let nextId = 1;
const bet = (over: Partial<ClassifiedBet>): ClassifiedBet =>
  ({
    id: nextId++,
    userId: "u1",
    seasonId: 2026,
    gameId: 1,
    betType: "spread",
    side: "home",
    line: -3.5,
    odds: -110,
    units: 1,
    placedAt: `2026-08-${String(10 + (nextId % 20)).padStart(2, "0")}T12:00:00Z`,
    result: null,
    payoutUnits: null,
    clv: null,
    voidedAt: null,
    relation: "origin",
    sourceUserId: null,
    sourceBetId: null,
    lagMs: null,
    tailedBy: 0,
    fadedBy: 0,
    ...over,
  }) as ClassifiedBet;

describe("marketSplit", () => {
  it("splits the three real skills and pools the exotics", () => {
    // Spreads, totals and moneylines are three different games wearing one
    // record; a team_total is a footnote, not a fourth tile.
    const split = marketSplit([
      bet({ betType: "spread", result: "win" }),
      bet({ betType: "total", result: "loss" }),
      bet({ betType: "moneyline", result: "win" }),
      bet({ betType: "team_total", result: "loss" }),
    ]);
    expect(split.map((s) => s.key)).toEqual(["spread", "total", "moneyline", "other"]);
    expect(split[0].t.wins).toBe(1);
    expect(split[3].label).toBe("Other");
  });

  it("drops empty buckets rather than rendering 0-0 tiles", () => {
    const split = marketSplit([bet({ betType: "spread", result: "win" })]);
    expect(split.map((s) => s.key)).toEqual(["spread"]);
  });
});

describe("streaks", () => {
  const seq = (results: Array<"win" | "loss" | "push" | null>) =>
    results.map((result, i) =>
      bet({ result, placedAt: `2026-08-01T${String(i).padStart(2, "0")}:00:00Z` }),
    );

  it("finds the current run and the longest of each kind", () => {
    const s = streaks(seq(["win", "loss", "loss", "win", "win", "win"]));
    expect(s.current).toEqual({ kind: "win", length: 3 });
    expect(s.longestWin).toBe(3);
    expect(s.longestLoss).toBe(2);
  });

  it("lets a push interrupt nothing — a heater does not end on a tie", () => {
    const s = streaks(seq(["win", "push", "win"]));
    expect(s.current).toEqual({ kind: "win", length: 2 });
  });

  it("reports null with nothing graded, so the caller can say so", () => {
    expect(streaks(seq([null, "push"])).current).toBeNull();
  });
});

describe("extremes", () => {
  it("best win by what it paid, worst loss by what it risked", () => {
    // A loss pays nothing, so its size IS the stake.
    const big = bet({ result: "win", units: 1, payoutUnits: 3.4 });
    const small = bet({ result: "win", units: 2, payoutUnits: 1.8 });
    const ouch = bet({ result: "loss", units: 3 });
    const meh = bet({ result: "loss", units: 0.5 });
    const e = extremes([small, big, meh, ouch]);
    expect(e.bestWin?.id).toBe(big.id);
    expect(e.worstLoss?.id).toBe(ouch.id);
  });

  it("holds nulls before anything settles", () => {
    expect(extremes([bet({ result: null })])).toEqual({ bestWin: null, worstLoss: null });
  });
});

describe("lateFlips — the bad beat and the backdoor", () => {
  const flip = (over: Partial<FlipRow>): FlipRow => ({
    game_id: 1,
    market: "spread",
    from_side: "home",
    to_side: "away",
    period: 4,
    ...over,
  });

  it("a loss that was a win in the 4th is a bad beat", () => {
    // They held home, home was covering, the flip took it away, they lost.
    const out = lateFlips([bet({ side: "home", result: "loss" })], [flip({})]);
    expect(out).toEqual({ badBeats: 1, backdoors: 0 });
  });

  it("a win the flip moved TO them late is the backdoor they will not mention", () => {
    const out = lateFlips([bet({ side: "away", result: "win" })], [flip({})]);
    expect(out).toEqual({ badBeats: 0, backdoors: 1 });
  });

  it("ignores flips before the 4th — a halftime lead lost is just football", () => {
    const out = lateFlips([bet({ side: "home", result: "loss" })], [flip({ period: 3 })]);
    expect(out).toEqual({ badBeats: 0, backdoors: 0 });
  });

  it("matches market to market — a total flip is not a spread bad beat", () => {
    const out = lateFlips(
      [bet({ side: "home", betType: "spread", result: "loss" })],
      [flip({ market: "total", from_side: "over" })],
    );
    expect(out.badBeats).toBe(0);
  });

  it("never counts a moneyline, which cover_flips does not record", () => {
    const out = lateFlips([bet({ betType: "moneyline", side: "home", result: "loss" })], [flip({})]);
    expect(out.badBeats).toBe(0);
  });
});
