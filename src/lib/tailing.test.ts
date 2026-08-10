import { describe, expect, it } from "vitest";
import {
  classifyBets,
  pairStatsFor,
  recentForm,
  statsByMember,
  type SheetBet,
} from "./tailing";

const T = (min: number) => new Date(Date.UTC(2026, 8, 12, 12, min)).toISOString();

let nextId = 1;
const bet = (over: Partial<SheetBet> = {}): SheetBet => ({
  id: nextId++,
  userId: "jeff",
  gameId: 1,
  betType: "spread",
  side: "home",
  line: -6.5,
  odds: -110,
  units: 1,
  placedAt: T(0),
  result: null,
  payoutUnits: null,
  clv: null,
  voidedAt: null,
  ...over,
});

const rel = (rows: ReturnType<typeof classifyBets>, id: number) =>
  rows.find((r) => r.id === id)!;

describe("classifyBets", () => {
  it("credits the first bet on a market and calls the rest tails or fades", () => {
    const first = bet({ userId: "jeff", placedAt: T(0), side: "home" });
    const second = bet({ userId: "mo", placedAt: T(5), side: "home" });
    const third = bet({ userId: "sam", placedAt: T(9), side: "away" });
    const rows = classifyBets([third, second, first]);

    expect(rel(rows, first.id).relation).toBe("origin");
    expect(rel(rows, second.id).relation).toBe("tail");
    expect(rel(rows, third.id).relation).toBe("fade");
    // Every follower's counterparty is the source, not the person just before.
    expect(rel(rows, second.id).sourceUserId).toBe("jeff");
    expect(rel(rows, third.id).sourceUserId).toBe("jeff");
    expect(rel(rows, third.id).sourceBetId).toBe(first.id);
    expect(rel(rows, first.id).tailedBy).toBe(1);
    expect(rel(rows, first.id).fadedBy).toBe(1);
    expect(rel(rows, second.id).lagMs).toBe(5 * 60_000);
  });

  it("keeps markets separate — the total is a different thing to be first in", () => {
    const spread = bet({ userId: "jeff", betType: "spread", placedAt: T(0) });
    const total = bet({ userId: "mo", betType: "total", side: "over", placedAt: T(3) });
    const rows = classifyBets([spread, total]);
    expect(rel(rows, total.id).relation).toBe("origin");
    expect(rel(rows, total.id).sourceUserId).toBeNull();
    expect(rel(rows, spread.id).tailedBy).toBe(0);
  });

  it("keeps games separate", () => {
    const a = bet({ userId: "jeff", gameId: 1, placedAt: T(0) });
    const b = bet({ userId: "mo", gameId: 2, placedAt: T(4) });
    const rows = classifyBets([a, b]);
    expect(rel(rows, b.id).relation).toBe("origin");
  });

  it("does not let anyone tail themselves", () => {
    const one = bet({ userId: "jeff", placedAt: T(0) });
    const two = bet({ userId: "jeff", placedAt: T(6) });
    const rows = classifyBets([one, two]);
    expect(rel(rows, two.id).relation).toBe("origin");
    expect(rel(rows, two.id).sourceUserId).toBeNull();
    expect(rel(rows, one.id).tailedBy).toBe(0);
  });

  it("a voided bet never happened, so it cannot hold origination", () => {
    // The person who actually put the number up must keep the credit.
    const voided = bet({ userId: "jeff", placedAt: T(0), voidedAt: T(1) });
    const real = bet({ userId: "mo", placedAt: T(5) });
    const later = bet({ userId: "sam", placedAt: T(8) });
    const rows = classifyBets([voided, real, later]);
    expect(rows.find((r) => r.id === voided.id)).toBeUndefined();
    expect(rel(rows, real.id).relation).toBe("origin");
    expect(rel(rows, later.id).sourceUserId).toBe("mo");
  });

  it("breaks a placed_at tie on the row id so 'first' is stable", () => {
    // A slip logs its whole batch inside one transaction, where now() is fixed.
    const a: SheetBet = bet({ id: 100, userId: "jeff", placedAt: T(2) });
    const b: SheetBet = bet({ id: 101, userId: "mo", placedAt: T(2) });
    for (const order of [[a, b], [b, a]]) {
      const rows = classifyBets(order);
      expect(rel(rows, 100).relation).toBe("origin");
      expect(rel(rows, 101).relation).toBe("tail");
    }
  });

  it("leaves a bet with no game or no side unclassified rather than guessing", () => {
    const future = bet({ userId: "jeff", gameId: null, side: null, betType: "future" });
    const rows = classifyBets([future]);
    expect(rel(rows, future.id).relation).toBe("unclassified");
  });

  it("reads over/under as opposite sides of one market", () => {
    const over = bet({ userId: "jeff", betType: "total", side: "over", placedAt: T(0) });
    const under = bet({ userId: "mo", betType: "total", side: "under", placedAt: T(2) });
    const rows = classifyBets([over, under]);
    expect(rel(rows, under.id).relation).toBe("fade");
  });
});

describe("statsByMember", () => {
  it("separates what you opened from what you rode and what you opposed", () => {
    const rows = classifyBets([
      bet({ userId: "jeff", gameId: 1, placedAt: T(0), result: "win", payoutUnits: 0.9 }),
      bet({ userId: "mo", gameId: 1, placedAt: T(2), result: "win", payoutUnits: 0.9 }),
      bet({ userId: "sam", gameId: 1, side: "away", placedAt: T(3), result: "loss", payoutUnits: -1 }),
      bet({ userId: "mo", gameId: 2, placedAt: T(0), result: "loss", payoutUnits: -1 }),
    ]);
    const stats = statsByMember(rows, ["jeff", "mo", "sam"]);

    const jeff = stats.get("jeff")!;
    expect(jeff.originated.wins).toBe(1);
    expect(jeff.tailing.decided).toBe(0);
    // What people who rode Jeff got for it — his value as a source.
    expect(jeff.tailedByOthers.wins).toBe(1);
    expect(jeff.fadedByOthers.losses).toBe(1);
    expect(jeff.timesFollowed).toBe(2);

    const mo = stats.get("mo")!;
    expect(mo.overall.decided).toBe(2);
    expect(mo.tailing.wins).toBe(1);
    expect(mo.originated.losses).toBe(1);
  });
});

describe("pairStatsFor", () => {
  it("answers 'am I better off just copying Jeff'", () => {
    const rows = classifyBets([
      bet({ userId: "jeff", gameId: 1, placedAt: T(0) }),
      bet({ userId: "mo", gameId: 1, placedAt: T(1), result: "win", payoutUnits: 0.9 }),
      bet({ userId: "jeff", gameId: 2, placedAt: T(0) }),
      bet({ userId: "mo", gameId: 2, placedAt: T(1), result: "win", payoutUnits: 0.9 }),
      bet({ userId: "sam", gameId: 3, placedAt: T(0) }),
      bet({ userId: "mo", gameId: 3, side: "away", placedAt: T(1), result: "loss", payoutUnits: -1 }),
    ]);
    const pairs = pairStatsFor(rows, "mo");
    const vsJeff = pairs.find((p) => p.otherId === "jeff")!;
    expect(vsJeff.tailing.wins).toBe(2);
    expect(vsJeff.fading.decided).toBe(0);
    const vsSam = pairs.find((p) => p.otherId === "sam")!;
    expect(vsSam.fading.losses).toBe(1);
  });

  it("is empty for someone who has only ever been first", () => {
    const rows = classifyBets([bet({ userId: "jeff", placedAt: T(0) })]);
    expect(pairStatsFor(rows, "jeff")).toEqual([]);
  });
});

describe("recentForm", () => {
  const graded = (n: number, result: "win" | "loss") =>
    Array.from({ length: n }, (_, i) =>
      bet({ placedAt: T(i), result, payoutUnits: result === "win" ? 0.9 : -1 }),
    );

  it("calls +3 on the window hot and −3 cold", () => {
    expect(recentForm([...graded(6, "win"), ...graded(3, "loss")]).label).toBe("hot");
    expect(recentForm([...graded(3, "win"), ...graded(6, "loss")]).label).toBe("cold");
    expect(recentForm([...graded(5, "win"), ...graded(4, "loss")]).label).toBe("level");
  });

  it("takes the most recent n, newest first", () => {
    const old = bet({ placedAt: T(0), result: "loss", payoutUnits: -1 });
    const recent = bet({ placedAt: T(50), result: "win", payoutUnits: 0.9 });
    const form = recentForm([old, recent], 1);
    expect(form.results).toEqual(["win"]);
    expect(form.wins).toBe(1);
  });

  it("ignores pending and voided bets — a week that hasn't happened is not form", () => {
    const form = recentForm([
      bet({ placedAt: T(1), result: null }),
      bet({ placedAt: T(2), result: "win", payoutUnits: 0.9, voidedAt: T(3) }),
      bet({ placedAt: T(4), result: "win", payoutUnits: 0.9 }),
    ]);
    expect(form.results).toEqual(["win"]);
    expect(form.label).toBe("level");
  });

  it("reports units alongside the record, since 6-4 can still be a losing week", () => {
    // 7-3 over the window is comfortably "hot", and still down 0.7u because
    // one of the three losses was five times the size of any of the wins.
    const form = recentForm([
      ...graded(7, "win"),
      bet({ placedAt: T(20), result: "loss", units: 5, payoutUnits: -5 }),
      ...graded(2, "loss"),
    ]);
    expect(form.wins).toBe(7);
    expect(form.losses).toBe(3);
    expect(form.label).toBe("hot");
    expect(form.units).toBeLessThan(0);
  });
});
