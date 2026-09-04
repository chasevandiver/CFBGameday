import { describe, expect, it } from "vitest";
import { lineRecoveredMarker, recoverFreezeLine } from "./freeze-recovery";
import { DEFAULT_PARAMS, normalCdf, paramsForWeek } from "../model/ratings";

const FROZEN_AT = "2026-09-03T13:07:13.072296+00:00";
const before = "2026-09-02T23:41:24.401+00:00";
const after = "2026-09-04T00:31:19.993+00:00";

describe("recoverFreezeLine", () => {
  it("rebuilds the freeze-time consensus and everything derived from it", () => {
    // Georgia Tech −10.7 vs a market of −6.5 (both books), close −6.5. The
    // real Week 1 row 369, checked against the freeze's own functions.
    const r = recoverFreezeLine({
      modelSpread: -10.7,
      week: 1,
      frozenAt: FROZEN_AT,
      closeSpread: -6.5,
      snapshots: [
        { provider: "Bovada", captured_at: before, spread: -6.5, spread_open: -7 },
        { provider: "DraftKings", captured_at: before, spread: -6.5, spread_open: -7 },
      ],
    });
    expect(r).not.toBeNull();
    expect(r!.vegas_spread).toBe(-6.5);
    expect(r!.open_spread).toBe(-7);
    expect(r!.edge).toBe(-4.2);
    expect(r!.edge_flag).toBe("BIG_EDGE");
    const sigma = paramsForWeek(1, DEFAULT_PARAMS).marginSigma;
    expect(r!.cover_prob).toBeCloseTo(1 - normalCdf(6.5, 10.7, sigma), 4);
    // The line never moved, so the model's side was worth nothing at the close.
    expect(r!.clv).toBe(0);
  });

  it("ignores snapshots captured after the freeze", () => {
    const r = recoverFreezeLine({
      modelSpread: -7,
      week: 1,
      frozenAt: FROZEN_AT,
      closeSpread: null,
      snapshots: [
        { provider: "DraftKings", captured_at: before, spread: -3, spread_open: -2.5 },
        { provider: "DraftKings", captured_at: after, spread: -9, spread_open: -2.5 },
      ],
    });
    expect(r!.vegas_spread).toBe(-3);
    expect(r!.edge).toBe(-4);
    expect(r!.clv).toBeNull();
  });

  it("snaps a split market to the half point the way the freeze does", () => {
    // Bovada −21, DraftKings −20.5 → mean −20.75 → −21: `snapToHalf` rounds
    // the half away from zero, and the live backfill wrote exactly this.
    const r = recoverFreezeLine({
      modelSpread: -32.3,
      week: 1,
      frozenAt: FROZEN_AT,
      closeSpread: null,
      snapshots: [
        { provider: "Bovada", captured_at: before, spread: -21, spread_open: -18.5 },
        { provider: "DraftKings", captured_at: before, spread: -20.5, spread_open: -18.5 },
      ],
    });
    expect(r!.vegas_spread).toBe(-21);
    expect(r!.edge).toBe(-11.3);
  });

  it("flags EDGE between 2 and 4 and nothing under 2, and writes CLV with a stored close", () => {
    const at = (modelSpread: number, closeSpread: number | null = null) =>
      recoverFreezeLine({
        modelSpread,
        week: 1,
        frozenAt: FROZEN_AT,
        closeSpread,
        snapshots: [{ provider: "DraftKings", captured_at: before, spread: -3, spread_open: -3 }],
      })!;
    expect(at(-5.5).edge_flag).toBe("EDGE");
    expect(at(-4).edge_flag).toBeNull();
    // Model −1 (likes the away side) against −3, closing −3.5: the away
    // backer took +3 and the close gave +3.5 — the market moved AWAY from the
    // model by half a point, so the lean's CLV is negative.
    expect(at(-1, -3.5).clv).toBe(-0.5);
    expect(at(-1, -3.5).edge).toBe(2);
  });

  it("returns null when the log has no pre-freeze spread either", () => {
    expect(
      recoverFreezeLine({
        modelSpread: -7,
        week: 1,
        frozenAt: FROZEN_AT,
        closeSpread: null,
        snapshots: [{ provider: "DraftKings", captured_at: after, spread: -3 }],
      }),
    ).toBeNull();
    expect(
      recoverFreezeLine({ modelSpread: -7, week: 1, frozenAt: FROZEN_AT, closeSpread: null, snapshots: [] }),
    ).toBeNull();
  });
});

describe("lineRecoveredMarker", () => {
  it("reads the marker and tolerates every other shape", () => {
    const marker = { at: "2026-09-04T06:00:00Z", reason: "FREEZE-3", from: "line_snapshots" };
    expect(lineRecoveredMarker({ situational: 0, line_recovered: marker })).toEqual(marker);
    expect(lineRecoveredMarker({ situational: 0 })).toBeNull();
    expect(lineRecoveredMarker({ line_recovered: "yes" })).toBeNull();
    expect(lineRecoveredMarker(null)).toBeNull();
    expect(lineRecoveredMarker("{}")).toBeNull();
  });
});
