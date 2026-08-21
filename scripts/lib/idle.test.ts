import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS, envDays, idleExhausted, IDLE_EXIT_MS, idleOverridden, idleSkip, msUntilNextGame } from "./idle";

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
    // Returns the REASON, not a bare true: job_runs.detail rendered every skip
    // as a flat "idle", which made a correct offseason no-op and a season with
    // nothing ingested the same green row. Still truthy, so call sites are
    // unchanged.
    expect(await idleSkip(db, { ...opts, now: NOW })).toBe("next_game_gt_7d");
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
    expect(await idleSkip(db, { ...opts, now: NOW })).toBe("no_scheduled_games");
    expect(await idleSkip(db, { ...opts, now: NOW, whenNoGames: "run" })).toBe(false);
  });

  it("distinguishes the two skip reasons, which used to look identical", async () => {
    // The whole point of returning a string. "the opener is in three weeks" is
    // a correct no-op; "this season has no games at all" during a bootstrap is
    // a fault. Both used to reach job_runs.detail as {"skipped": "idle"}.
    const far = stubDb({ next: { start_ts: "2026-08-29T16:00:00Z" } });
    const empty = stubDb({ next: null });
    const a = await idleSkip(far, { ...opts, now: NOW });
    const b = await idleSkip(empty, { ...opts, now: NOW });
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
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
    delete process.env.LINES_IDLE_DAYS;
  });

  it("treats a blank threshold as unset, not as zero (P2-1)", () => {
    // `Number("")` is 0, which is finite and >= 0, so the old guard returned
    // **0** here — collapsing the horizon so every run idle-skipped. An empty
    // GitHub secret and an absent one now mean the same thing.
    process.env.LINES_IDLE_DAYS = "";
    expect(envDays("LINES_IDLE_DAYS", 7)).toBe(7);
    process.env.LINES_IDLE_DAYS = "   ";
    expect(envDays("LINES_IDLE_DAYS", 7)).toBe(7);
    delete process.env.LINES_IDLE_DAYS;
  });

  it("still rejects a negative threshold", () => {
    process.env.LINES_IDLE_DAYS = "-1";
    expect(envDays("LINES_IDLE_DAYS", 7)).toBe(7);
    delete process.env.LINES_IDLE_DAYS;
  });
});


describe("idleExhausted — when a long run gives up (LIVE-2)", () => {
  /**
   * The loop now runs four hours so a dropped cron costs no coverage. The
   * price, unguarded, is a runner held for hours after the last whistle, so
   * the run ends once both leagues have been quiet for a while. Leaving is
   * free: the next launch re-enters within the hour and the end-of-run
   * grading sweep still runs on the way out.
   */
  const t0 = 1_700_000_000_000;

  it("never exits while something is live or imminent", () => {
    // null is the "not idle" signal, and no elapsed time makes it true.
    expect(idleExhausted(null, t0 + 10 * 3600_000)).toBe(false);
  });

  it("waits out a halftime rather than quitting on the first quiet tick", () => {
    expect(idleExhausted(t0, t0)).toBe(false);
    expect(idleExhausted(t0, t0 + 60_000)).toBe(false);
    expect(idleExhausted(t0, t0 + 15 * 60_000)).toBe(false);
  });

  it("exits once the quiet has run past the limit", () => {
    expect(idleExhausted(t0, t0 + IDLE_EXIT_MS)).toBe(true);
    expect(idleExhausted(t0, t0 + IDLE_EXIT_MS + 1)).toBe(true);
  });

  it("sits through a stoppage longer than the old whole run was", () => {
    // The limit has to clear halftime and a weather delay's pause; anything
    // near the old 63-minute run length would end a run mid-game.
    expect(IDLE_EXIT_MS).toBeGreaterThanOrEqual(15 * 60_000);
    expect(IDLE_EXIT_MS).toBeLessThan(63 * 60_000);
  });
});
