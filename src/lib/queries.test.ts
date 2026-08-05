import { describe, expect, it } from "vitest";
import { consensusFromSnapshots, consensusHistory, snapToHalf } from "./queries";
import type { LineSnapshotRow } from "./db-types";

let nextId = 1;
const snap = (
  provider: string,
  spread: number | null,
  captured_at: string,
  rest: Partial<LineSnapshotRow> = {},
): LineSnapshotRow => ({
  id: nextId++,
  game_id: 1,
  provider,
  source: "cfbd",
  spread,
  spread_open: null,
  total: null,
  total_open: null,
  ml_home: null,
  ml_away: null,
  captured_at,
  ...rest,
});

describe("snapToHalf", () => {
  it("snaps to the nearest half point", () => {
    expect(snapToHalf(4.2)).toBe(4);
    expect(snapToHalf(6.7)).toBe(6.5);
    expect(snapToHalf(-3.3)).toBe(-3.5);
    expect(snapToHalf(7)).toBe(7);
    expect(snapToHalf(-2.5)).toBe(-2.5);
  });
});

describe("consensusFromSnapshots", () => {
  it("lands spread and total consensus on half-point increments", () => {
    const rows = [
      snap("a", -4, "2026-08-01T00:00:00Z", { total: 51.5 }),
      snap("b", -4.5, "2026-08-01T00:00:00Z", { total: 52 }),
      snap("c", -4, "2026-08-01T00:00:00Z", { total: 52 }),
    ];
    const c = consensusFromSnapshots(rows);
    // raw averages are -4.17 and 51.83 — not bookable lines
    expect(c.spread).toBe(-4);
    expect(c.total).toBe(52);
    expect(Math.abs((c.spread as number) * 2) % 1).toBe(0);
  });

  it("uses only the latest snapshot per provider", () => {
    const rows = [
      snap("a", -3, "2026-08-01T00:00:00Z"),
      snap("a", -7, "2026-08-02T00:00:00Z"),
      snap("b", -8, "2026-08-01T00:00:00Z"),
    ];
    expect(consensusFromSnapshots(rows).spread).toBe(-7.5);
  });

  it("keeps moneylines as whole numbers", () => {
    const rows = [
      snap("a", null, "2026-08-01T00:00:00Z", { ml_home: -150, ml_away: 130 }),
      snap("b", null, "2026-08-01T00:00:00Z", { ml_home: -155, ml_away: 135 }),
    ];
    const c = consensusFromSnapshots(rows);
    expect(c.mlHome).toBe(-152);
    expect(c.mlAway).toBe(133);
  });

  it("returns nulls when no snapshots exist", () => {
    const c = consensusFromSnapshots([]);
    expect(c.spread).toBeNull();
    expect(c.total).toBeNull();
  });
});

describe("consensusHistory", () => {
  it("emits half-point values only", () => {
    const rows = [
      snap("a", -4, "2026-08-01T00:00:00Z"),
      snap("b", -4.5, "2026-08-01T01:00:00Z"),
      snap("a", -5.5, "2026-08-01T02:00:00Z"),
    ];
    for (const p of consensusHistory(rows)) {
      expect(Math.abs(p.v * 2) % 1).toBe(0);
    }
  });
});
