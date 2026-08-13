/**
 * Continuous live-score poller. GitHub Actions cron can't fire sub-5-minute
 * reliably, so instead of one poll per workflow run, an hourly run executes
 * this loop for ~an hour and the workflow's concurrency group hands off to
 * the next run. Supabase realtime pushes every write to browsers instantly,
 * so the poll interval below IS the score-freshness ceiling.
 *
 * Adaptive cadence, checked against OUR database (free) before every CFBD call:
 *   - a game is live               → poll every 30s   (~120 calls/hour)
 *   - kickoff within 15 min, or a
 *     scheduled game that should
 *     have started (status lag)    → poll every 120s  (~30 calls/hour)
 *   - nothing happening            → no CFBD calls, re-check the DB every 60s
 *
 * Worst-case month (~14 live hours every Saturday + weeknight windows) is
 * ~9–10k CFBD calls — a third of a 30k budget. Every call is metered into
 * api_call_log, and the loop slows itself down (then stops) as the monthly
 * budget runs out rather than blowing through it.
 *
 * Usage: npx tsx scripts/scoreboard-loop.ts [--minutes 63] [--interval 30]
 */

import { cfbdCallCount } from "../src/lib/cfbd";
import { espnCallCount } from "../src/lib/espn";
import { createServiceClient } from "../src/lib/supabase/service";
import { envNum } from "./lib/env-num";
import { idleSkip, envDays } from "./lib/idle";
import {
  SEASON,
  logCfbdCalls,
  logEspnCalls,
  nflScoreboardJob,
  recordJobRun,
  scoreboardJob,
} from "./lib/jobs-core";
import { NFL_SEASON } from "./lib/nfl";

// `??` only catches undefined, so this used to read `CFBD_MONTHLY_BUDGET=""` as
// a budget of zero — which throttles at 80% of nothing and refuses to poll at
// 95% of nothing, i.e. a Saturday with no live scores. envNum treats blank as
// unset (P2-1).
const MONTHLY_BUDGET = envNum("CFBD_MONTHLY_BUDGET", 30_000, { min: 1 });

function argNum(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  const v = i > -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Activity = "live" | "imminent" | "idle";

async function activity(
  db: ReturnType<typeof createServiceClient>,
  season: number,
): Promise<Activity> {
  const now = Date.now();
  const { data: live } = await db
    .from("games")
    .select("id")
    .eq("season_id", season)
    .eq("status", "in_progress")
    .limit(1);
  if ((live ?? []).length > 0) return "live";

  // scheduled games that kick soon — or already kicked but our status hasn't
  // flipped yet (that transition is exactly what we're polling to catch)
  const { data: soon } = await db
    .from("games")
    .select("id")
    .eq("season_id", season)
    .eq("status", "scheduled")
    .gte("start_ts", new Date(now - 4 * 3600_000).toISOString())
    .lte("start_ts", new Date(now + 15 * 60_000).toISOString())
    .limit(1);
  return (soon ?? []).length > 0 ? "imminent" : "idle";
}

async function callsThisMonth(db: ReturnType<typeof createServiceClient>): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { count } = await db
    .from("api_call_log")
    .select("id", { count: "exact", head: true })
    .gte("called_at", monthStart.toISOString());
  return count ?? 0;
}

async function main() {
  const minutes = argNum("--minutes", 63);
  // argNum validates the FLAG but not the fallback it is handed, so a blank
  // SCOREBOARD_INTERVAL_SECONDS used to arrive as 0 and spin the poll loop.
  const liveInterval = argNum("--interval", envNum("SCOREBOARD_INTERVAL_SECONDS", 30, { min: 1 }));
  const db = createServiceClient();

  // Nothing within two days IN EITHER LEAGUE: don't hold a runner for an hour
  // to re-ask our own database every 60s. (This loop already makes zero feed
  // calls when idle — what it burns offseason is Actions minutes.)
  const horizonDays = envDays("SCOREBOARD_IDLE_DAYS", 2);
  const cfbIdle = await idleSkip(db, { job: "scoreboard-loop", season: SEASON, horizonDays });
  const nflIdle = await idleSkip(db, {
    job: "scoreboard-loop-nfl",
    season: NFL_SEASON,
    horizonDays,
  });
  if (cfbIdle && nflIdle) {
    return;
  }

  const deadline = Date.now() + minutes * 60_000;

  // Budget posture for this run: past 95% stop entirely, past 80% run at
  // half speed. Checked once per run — an hourly loop can't overshoot much.
  // CFBD only: the NFL board is a free unauthenticated feed, so the budget
  // never silences it — a blown CFBD month still shows live NFL scores.
  const spent = await callsThisMonth(db);
  const cfbdExhausted = spent >= MONTHLY_BUDGET * 0.95;
  if (cfbdExhausted) {
    console.log(
      `CFBD budget nearly exhausted (${spent}/${MONTHLY_BUDGET}) — CFB polling off. ` +
        "Raise CFBD_MONTHLY_BUDGET if the cap has changed.",
    );
    if (nflIdle) return;
  }
  const throttled = spent >= MONTHLY_BUDGET * 0.8;
  const liveMs = (throttled ? liveInterval * 2 : liveInterval) * 1000;
  console.log(
    `scoreboard loop: ${minutes} min, live every ${liveMs / 1000}s` +
      `${throttled ? " (throttled: >80% of monthly budget spent)" : ""}, ` +
      `${spent}/${MONTHLY_BUDGET} calls used this month`,
  );

  // One job_runs row per launch (not per tick — a Saturday would write
  // thousands); the freshness card reads the latest launch.
  await recordJobRun(db, "scoreboard-loop", async () => {
    let ticks = 0;
    while (Date.now() < deadline) {
      let waitMs = 60_000;
      try {
        // Each league gates its own feed: an idle NFL Tuesday costs zero ESPN
        // calls while CFB polls, and vice versa on a Sunday.
        const cfbState = cfbdExhausted ? "idle" : await activity(db, SEASON);
        const nflState = await activity(db, NFL_SEASON);
        if (cfbState !== "idle") {
          const before = cfbdCallCount();
          const result = await scoreboardJob(db);
          await logCfbdCalls(db, "scoreboard", cfbdCallCount() - before);
          ticks++;
          if (ticks % 10 === 1) console.log(`[cfb ${cfbState}]`, JSON.stringify(result));
        }
        if (nflState !== "idle") {
          const before = espnCallCount();
          const result = await nflScoreboardJob(db);
          await logEspnCalls(db, "scoreboard-nfl", espnCallCount() - before);
          ticks++;
          if (ticks % 10 === 1) console.log(`[nfl ${nflState}]`, JSON.stringify(result));
        }
        const state =
          cfbState === "live" || nflState === "live"
            ? "live"
            : cfbState === "imminent" || nflState === "imminent"
              ? "imminent"
              : "idle";
        if (state !== "idle") waitMs = state === "live" ? liveMs : 120_000;
      } catch (err) {
        // one bad tick never kills the hour
        console.error("tick failed:", err instanceof Error ? err.message : err);
        waitMs = 60_000;
      }
      if (Date.now() + waitMs > deadline) break;
      await sleep(waitMs);
    }
    console.log(
      `done: ${ticks} scoreboard polls, ${cfbdCallCount()} CFBD + ${espnCallCount()} ESPN calls this run`,
    );
    return { ticks, cfbd_calls: cfbdCallCount(), espn_calls: espnCallCount() };
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
