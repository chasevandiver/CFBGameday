import { describe, expect, it } from "vitest";
import { consensusFromSnapshots } from "../../src/lib/consensus";
import { SNAPSHOT_COLS } from "./jobs-core";

describe("SNAPSHOT_COLS", () => {
  it("selects spread_open, which the opener silently falls back without", () => {
    expect(SNAPSHOT_COLS).toContain("spread_open");
  });

  it("selects every field the consensus and grading paths read", () => {
    for (const col of ["game_id", "provider", "spread", "total", "captured_at"]) {
      expect(SNAPSHOT_COLS).toContain(col);
    }
  });
});

describe("the silent fallback SNAPSHOT_COLS exists to prevent", () => {
  const snaps = (withOpen: boolean) => [
    {
      game_id: 1,
      provider: "book",
      spread: -9,
      ...(withOpen ? { spread_open: -6 } : {}),
      total: 51,
      captured_at: "2026-09-01T12:00:00Z",
    },
  ];

  it("reports a real opener when spread_open is selected", () => {
    expect(consensusFromSnapshots(snaps(true)).open).toBe(-6);
  });

  it("reports the CURRENT line as the opener when it isn't — no error", () => {
    // This is the failure mode: open === spread, so every prediction's
    // open_spread would duplicate vegas_spread and the line movement on the
    // receipt would read as zero for every game.
    const c = consensusFromSnapshots(snaps(false));
    expect(c.open).toBe(-9);
    expect(c.open).toBe(c.spread);
  });
});
