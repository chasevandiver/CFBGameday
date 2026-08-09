import { describe, expect, it } from "vitest";
import {
  byLeagueRules,
  EMPTY_TALLY,
  formatRecord,
  isDecided,
  PICKEM_WIN_PAYOUT,
  tally,
  tallyBy,
  type Tally,
  type Wager,
} from "./records";

/** A pick: flat stake, no payout column — the −110 convention applies. */
const pick = (result: Wager["result"], clv: number | null = null): Wager => ({
  result,
  units: 1,
  payoutUnits: null,
  clv,
});

/** A bet: the grader wrote a payout at the bet's real odds. */
const bet = (result: Wager["result"], units: number, payoutUnits: number | null): Wager => ({
  result,
  units,
  payoutUnits,
  clv: null,
});

describe("tally", () => {
  it("is empty for no wagers", () => {
    expect(tally([])).toEqual(EMPTY_TALLY);
  });

  it("counts wins, losses and pushes", () => {
    const t = tally([pick("win"), pick("win"), pick("loss"), pick("push")]);
    expect([t.wins, t.losses, t.pushes]).toEqual([2, 1, 1]);
    expect(t.decided).toBe(4);
  });

  it("skips ungraded and voided wagers entirely", () => {
    // League Rule #4: a void never happened, and an ungraded pick is not a loss.
    const t = tally([pick("win"), pick(null), pick("void")]);
    expect(t.decided).toBe(1);
    expect(t.wins).toBe(1);
    expect(t.units).toBeCloseTo(PICKEM_WIN_PAYOUT, 10);
  });

  it("pays a pick'em win at −110 and a loss at the full stake", () => {
    // One unit risked to win 0.909. Win one, lose one, and you are down.
    const t = tally([pick("win"), pick("loss")]);
    expect(t.units).toBeCloseTo(PICKEM_WIN_PAYOUT - 1, 10);
    expect(t.units).toBeLessThan(0);
  });

  it("uses a bet's real payout instead of the −110 convention", () => {
    // +200 underdog, 1 unit: the grader wrote +2.0, not +0.909.
    const t = tally([bet("win", 1, 2)]);
    expect(t.units).toBe(2);
  });

  it("treats a zero payout as a real payout, not as a missing one", () => {
    // The distinction the module exists for: null means "derive it", 0 means 0.
    expect(tally([bet("win", 1, 0)]).units).toBe(0);
    expect(tally([pick("win")]).units).toBeCloseTo(PICKEM_WIN_PAYOUT, 10);
  });

  it("keeps pushes out of the ROI denominator", () => {
    // Stake is returned on a push, so it was never at risk.
    const t = tally([pick("win"), pick("push")]);
    expect(t.staked).toBe(1);
    expect(t.roi).toBeCloseTo(PICKEM_WIN_PAYOUT, 10);
  });

  it("has no ROI when nothing was at risk", () => {
    expect(tally([pick("push")]).roi).toBeNull();
    expect(tally([]).roi).toBeNull();
  });

  it("averages CLV over only the wagers that carry one", () => {
    // An ungraded-for-CLV wager must not be banked as a zero — that would read
    // as "dead even" and drag a real average toward it.
    const t = tally([pick("win", 2), pick("loss", 4), pick("win", null)]);
    expect(t.avgClv).toBe(3);
    expect(t.clvCount).toBe(2);
  });

  it("has no CLV average when nothing is priced", () => {
    const t = tally([pick("win"), pick("loss")]);
    expect(t.avgClv).toBeNull();
    expect(t.clvCount).toBe(0);
  });

  it("coerces numerics that PostgREST returned as strings", () => {
    // `numeric` columns arrive as strings; every call site used to Number() them
    // by hand, and forgetting turned units into concatenation.
    const t = tally([
      { result: "win", units: "2" as unknown as number, payoutUnits: null, clv: "1.5" as unknown as number },
    ]);
    expect(t.units).toBeCloseTo(2 * PICKEM_WIN_PAYOUT, 10);
    expect(t.avgClv).toBe(1.5);
  });
});

describe("isDecided", () => {
  it("accepts the three graded outcomes and rejects the other two", () => {
    expect(["win", "loss", "push"].map((r) => isDecided(pick(r as Wager["result"])))).toEqual([
      true,
      true,
      true,
    ]);
    expect([isDecided(pick(null)), isDecided(pick("void"))]).toEqual([false, false]);
  });
});

describe("tallyBy", () => {
  it("tallies each key independently", () => {
    const rows = [
      { ...pick("win"), user: "a" },
      { ...pick("loss"), user: "a" },
      { ...pick("win"), user: "b" },
    ];
    const by = tallyBy(rows, (r) => r.user);
    expect(by.get("a")!.decided).toBe(2);
    expect(by.get("b")!.wins).toBe(1);
  });

  it("omits keys whose wagers all skipped, but keeps keys that appeared", () => {
    // A user with only ungraded picks still gets a bucket — an empty tally is a
    // meaningful answer ("0-0"), whereas a missing user reads as "not playing".
    const rows = [{ ...pick(null), user: "a" }];
    const by = tallyBy(rows, (r) => r.user);
    expect(by.get("a")).toEqual(EMPTY_TALLY);
  });
});

describe("byLeagueRules", () => {
  const t = (units: number, roi: number | null, avgClv: number | null): Tally => ({
    ...EMPTY_TALLY,
    units,
    roi,
    avgClv,
  });

  it("sorts by units first", () => {
    const rows = [t(1, 0.9, 5), t(3, 0.1, 0)];
    expect(rows.sort(byLeagueRules).map((r) => r.units)).toEqual([3, 1]);
  });

  it("breaks a units tie on ROI, then on CLV", () => {
    expect([t(2, 0.1, 9), t(2, 0.5, 0)].sort(byLeagueRules)[0].roi).toBe(0.5);
    expect([t(2, 0.5, 0), t(2, 0.5, 9)].sort(byLeagueRules)[0].avgClv).toBe(9);
  });

  it("sorts a null tiebreak last rather than first", () => {
    // Otherwise someone with no priced wagers outranks a measured edge.
    expect([t(2, null, null), t(2, 0.5, 1)].sort(byLeagueRules)[0].roi).toBe(0.5);
  });
});

describe("formatRecord", () => {
  it("shows the push only when there is one", () => {
    expect(formatRecord({ ...EMPTY_TALLY, wins: 12, losses: 7 })).toBe("12-7");
    expect(formatRecord({ ...EMPTY_TALLY, wins: 12, losses: 7, pushes: 1 })).toBe("12-7-1");
  });
});
