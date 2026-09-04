import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DAY_MS,
  envDays,
  idleExhausted,
  IDLE_EXIT_MS,
  idleOverridden,
  idleSkip,
  KICKOFF_HOLD_MS,
  kickoffHold,
  msUntilNextGame,
  nextScheduledKickoff,
  scheduledState,
} from "./idle";

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
    for (const m of ["select", "gte", "gt", "order", "not", "or"]) chain[m] = self;
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

describe("kickoffHold — an idle run that knows a kickoff is coming (LIVE-9)", () => {
  /**
   * 2026-09-04, run 33923110435. The 21:00 launch arrived at 21:53, found the
   * earliest kickoff 37 minutes out — past the 15-minute imminent window — and
   * `idleExhausted` ended it at 22:13:57. Eastern Michigan kicked at 22:30.
   * The 22:00 launch never fired and the 23:00 one had not arrived by 23:12,
   * so three games kicked into a board nobody was polling. The timestamps
   * below are that night's.
   */
  const launched = Date.parse("2026-09-04T21:53:43Z");
  const exitTick = Date.parse("2026-09-04T22:13:57Z");
  const deadline = launched + 240 * 60_000;
  const emu = "2026-09-04T22:30:00Z";

  it("holds for the Friday opener that the exit fired a minute ahead of", () => {
    expect(idleExhausted(launched, exitTick)).toBe(true); // the old rule would have left
    expect(kickoffHold([emu, null], exitTick, deadline)).toBe(Date.parse(emu));
  });

  it("lets the run end when neither league has a kickoff coming", () => {
    expect(kickoffHold([null, null], exitTick, deadline)).toBeNull();
    expect(kickoffHold([], exitTick, deadline)).toBeNull();
  });

  it("does not hold for a kickoff beyond the window — the launches in between will cover it", () => {
    const later = new Date(exitTick + KICKOFF_HOLD_MS + 60_000).toISOString();
    expect(kickoffHold([later], exitTick, deadline)).toBeNull();
    const edge = new Date(exitTick + KICKOFF_HOLD_MS).toISOString();
    expect(kickoffHold([edge], exitTick, deadline)).toBe(exitTick + KICKOFF_HOLD_MS);
  });

  it("does not hold for a kickoff the run's own deadline would cut off anyway", () => {
    const nearEnd = deadline - 10 * 60_000;
    const afterDeadline = new Date(deadline + 5 * 60_000).toISOString();
    expect(kickoffHold([afterDeadline], nearEnd, deadline)).toBeNull();
    expect(kickoffHold([new Date(deadline).toISOString()], nearEnd, deadline)).toBeNull();
    // Still inside the deadline is still worth staying for, however briefly.
    const beforeDeadline = new Date(deadline - 5 * 60_000).toISOString();
    expect(kickoffHold([beforeDeadline], nearEnd, deadline)).toBe(deadline - 5 * 60_000);
  });

  it("ignores a kickoff already in the past — that is scheduledState's call, and a stale row is not a reason to stay", () => {
    expect(kickoffHold(["2026-09-04T22:00:00Z"], exitTick, deadline)).toBeNull();
    expect(kickoffHold([new Date(exitTick).toISOString()], exitTick, deadline)).toBeNull();
  });

  it("skips garbage rather than trusting it", () => {
    expect(kickoffHold(["not a date"], exitTick, deadline)).toBeNull();
    expect(kickoffHold(["not a date", emu], exitTick, deadline)).toBe(Date.parse(emu));
  });

  it("returns the earliest of the two leagues", () => {
    const nfl = "2026-09-04T23:20:00Z";
    expect(kickoffHold([nfl, emu], exitTick, deadline)).toBe(Date.parse(emu));
    expect(kickoffHold([emu, nfl], exitTick, deadline)).toBe(Date.parse(emu));
  });

  it("covers a launch that runs an hour late on top of one that was dropped", () => {
    // Hourly launches; one dropped and the next 60 minutes late is a 2-hour
    // gap. Anything shorter would re-open the hole this exists to close.
    expect(KICKOFF_HOLD_MS).toBeGreaterThanOrEqual(2 * 3600_000);
    // And it is bounded by the run's own deadline, so it can never outlast it.
    expect(KICKOFF_HOLD_MS).toBeLessThanOrEqual(240 * 60_000);
  });

  it("reads the next scheduled kickoff and answers null for an empty slate", async () => {
    expect(await nextScheduledKickoff(stubDb({ next: { start_ts: emu } }), 2026, exitTick)).toBe(emu);
    expect(await nextScheduledKickoff(stubDb({ next: null }), 2026, exitTick)).toBeNull();
  });
});

/**
 * SCORE-4, launch day 2026-08-29. The loop polled a game that had ALREADY
 * KICKED every 120 seconds, because "kicked off but our status still says
 * scheduled" was classified `imminent` — the same bucket as a game an hour
 * out. Measured gaps: 122–127s from 15:59 until the status flipped at 16:09,
 * then 30–31s for the rest of the game. Owner, watching it happen: "it seems
 * to be a few minutes behind."
 */
describe("scheduledState", () => {
  const now = Date.parse("2026-08-29T16:05:00Z");
  const at = (iso: string) => scheduledState(iso, now);

  it("calls a kickoff that has passed `kicked`, not `imminent`", () => {
    // The regression. Pre-fix this whole case answered "imminent" → 120s.
    expect(at("2026-08-29T16:00:00Z")).toBe("kicked");
    expect(at("2026-08-29T13:00:00Z")).toBe("kicked");
  });

  it("still calls a kickoff in the future `imminent`", () => {
    expect(at("2026-08-29T16:10:00Z")).toBe("imminent");
    expect(at("2026-08-29T16:19:00Z")).toBe("imminent");
  });

  it("treats the exact kickoff instant as kicked", () => {
    // At t=kick the ball is in the air; a boundary that rounds the other way
    // spends one more 120s window on the tick that matters most.
    expect(scheduledState("2026-08-29T16:05:00Z", now)).toBe("kicked");
  });

  it("is idle when the window held no scheduled game", () => {
    expect(scheduledState(null, now)).toBe("idle");
  });

  it("does not promote an unparseable timestamp to kicked", () => {
    // Garbage is not evidence a game started — stay on the slow cadence.
    expect(scheduledState("not a date", now)).toBe("imminent");
  });
});

/**
 * The wiring, not just the helper: a pure function returning "kicked" buys
 * nothing if the loop still maps it to the slow branch. Source-scanned
 * because the mapping lives in a script the unit tests do not execute.
 */
describe("the loop spends the fast cadence on a kicked game", () => {
  const LOOP = readFileSync(join(__dirname, "..", "scoreboard-loop.ts"), "utf8");

  it("treats kicked and live as one cadence class", () => {
    // Checked failing against the pre-fix loop, which had neither line.
    expect(LOOP).toMatch(/const fastCadence = \(s: Activity\): boolean =>\s*s === "live" \|\| s === "kicked"/);
    expect(LOOP).toMatch(/if \(fast\) waitMs = liveMs;/);
  });

  it("keeps the 120s branch for genuinely upcoming games only", () => {
    expect(LOOP).toMatch(/else if \(imminent\) waitMs = 120_000;/);
  });

  it("still asks the DB for the earliest kickoff, which is what makes the split possible", () => {
    // Without the ordering the single row is arbitrary and `kicked` would be
    // a coin flip on a mixed window.
    expect(LOOP).toMatch(/\.order\("start_ts"\)/);
  });

  it("leaves the NFL edge pager keyed to a CONFIRMED live game", () => {
    // Widening this to `kicked` would page on a game we only believe started.
    expect(LOOP).toMatch(/nflState === "live"/);
  });
});
