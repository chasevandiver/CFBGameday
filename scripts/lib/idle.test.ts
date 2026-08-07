import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS, envDays, idleOverridden, idleSkip, msUntilNextGame } from "./idle";

/**
 * Minimal PostgREST-shaped stub. Filters chain; `.limit()` is both awaitable
 * (the live-game probe) and further chainable into `.maybeSingle()` (the
 * next-kickoff probe), which is how the real builder behaves.
 */
function stubDb(rows: { live?: unknown[]; next?: { start_ts: string } | null }): SupabaseClient {
  const builder = () => {
    const state = { status: "" };
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const m of ["select", "gte", "order", "not", "or"]) chain[m] = self;
    chain.eq = (col: string, val: unknown) => {
      if (col === "status") state.status = String(val);
      return chain;
    };
    chain.limit = () => {
      const result = { data: state.status === "in_progress" ? (rows.live ?? []) : [] };
      return {
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
        maybeSingle: () => Promise.resolve({ data: rows.next ?? null }),
      };
    };
    return chain;
  };
  return { from: () => builder() } as unknown as SupabaseClient;
}

const NOW = Date.parse("2026-08-06T12:00:00Z");
const inDays = (d: number) => new Date(NOW + d * DAY_MS).toISOString();

afterEach(() => {
  delete process.env.IDLE_OVERRIDE;
  delete process.env.LINES_IDLE_DAYS;
});

describe("msUntilNextGame", () => {
  it("returns 0 when a game is live", async () => {
    const db = stubDb({ live: [{ id: 1 }], next: { start_ts: inDays(3) } });
    expect(await msUntilNextGame(db, 2026, NOW)).toBe(0);
  });

  it("returns the gap to the next scheduled kickoff", async () => {
    const db = stubDb({ next: { start_ts: inDays(23) } });
    expect(await msUntilNextGame(db, 2026, NOW)).toBeCloseTo(23 * DAY_MS, -2);
  });

  it("returns null when nothing is scheduled", async () => {
    expect(await msUntilNextGame(stubDb({ next: null }), 2026, NOW)).toBeNull();
  });

  it("never goes negative for a game that should already have kicked", async () => {
    const db = stubDb({ next: { start_ts: inDays(-0.1) } });
    expect(await msUntilNextGame(db, 2026, NOW)).toBe(0);
  });
});

describe("idleSkip", () => {
  const opts = { job: "refresh-lines", season: 2026, horizonDays: 7 };

  it("skips in early August, when the opener is three weeks out", async () => {
    // the actual case this exists for: Aug 6, first game Aug 29
    const db = stubDb({ next: { start_ts: "2026-08-29T16:00:00Z" } });
    expect(await idleSkip(db, { ...opts, now: NOW })).toBe(true);
  });

  it("runs once the opener comes inside the horizon", async () => {
    const db = stubDb({ next: { start_ts: inDays(6) } });
    expect(await idleSkip(db, { ...opts, now: NOW })).toBe(false);
  });

  it("runs on the horizon boundary", async () => {
    const db = stubDb({ next: { start_ts: inDays(7) } });
    expect(await idleSkip(db, { ...opts, now: NOW })).toBe(false);
  });

  it("runs whenever a game is live", async () => {
    const db = stubDb({ live: [{ id: 1 }], next: null });
    expect(await idleSkip(db, { ...opts, now: NOW })).toBe(false);
  });

  it("skips an empty schedule by default but runs it for the bootstrap job", async () => {
    const db = stubDb({ next: null });
    expect(await idleSkip(db, { ...opts, now: NOW })).toBe(true);
    expect(await idleSkip(db, { ...opts, now: NOW, whenNoGames: "run" })).toBe(false);
  });

  it("honors IDLE_OVERRIDE without even querying", async () => {
    process.env.IDLE_OVERRIDE = "1";
    const db = stubDb({ next: { start_ts: inDays(90) } });
    expect(await idleSkip(db, { ...opts, now: NOW })).toBe(false);
  });
});

describe("overrides and thresholds", () => {
  it("detects --force on the command line", () => {
    expect(idleOverridden(["node", "x.ts", "--force"])).toBe(true);
    expect(idleOverridden(["node", "x.ts", "--burst"])).toBe(false);
  });

  it("reads env thresholds and falls back on garbage", () => {
    expect(envDays("LINES_IDLE_DAYS", 7)).toBe(7);
    process.env.LINES_IDLE_DAYS = "14";
    expect(envDays("LINES_IDLE_DAYS", 7)).toBe(14);
    process.env.LINES_IDLE_DAYS = "soon";
    expect(envDays("LINES_IDLE_DAYS", 7)).toBe(7);
    process.env.LINES_IDLE_DAYS = "0";
    expect(envDays("LINES_IDLE_DAYS", 7)).toBe(0);
  });
});
