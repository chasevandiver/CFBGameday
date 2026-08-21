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
import { idleSkip, envDays, idleExhausted, IDLE_EXIT_MS } from "./lib/idle";
import {
  SEASON,
  cfbScoringJob,
  gradeSeasonFinals,
  logCfbdCalls,
  logEspnCalls,
  nflScoreboardJob,
  nflScoringJob,
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

/**
 * Settle everything final and ungraded in a season (GRADE-2).
 *
 * `applyScoreboard` grades the board it just polled, which covers every game
 * except the one that matters most: the LAST one of a slate. `activity()` turns
 * a league idle the instant nothing is `in_progress`, and the only caller of
 * `gradeGames` is the poll that `activity` has just switched off — so the tick
 * that would have offered the final game as "completed" never runs. Owner
 * report 2026-08-15: two bets on a three-game preseason slate graded within
 * minutes and the third, on the game that finished last, was still open four
 * hours later with the next backstop (`nfl-grade`, Mon/Tue/Fri) two days away.
 *
 * This is the same `gradeSeasonFinals` the scheduled backstop runs, called at
 * the three moments that close the hole:
 *   - when a league goes live → idle inside a run, which is the exact tick the
 *     last game finished on (~30s after the whistle);
 *   - at the end of a run, for a game that finals between the last tick and the
 *     deadline;
 *   - at the start of every run, before the idle guard returns, for a game that
 *     finals in the gap between runs.
 *
 * Cheap by construction: every query inside filters `result is null`, so a
 * sweep with nothing to do is one games read and three empty ones. Errors are
 * logged, never thrown — grading must not cost the loop its live scores, which
 * is the same posture `applyScoreboard` takes for its inline pass.
 */
async function sweepGrading(
  db: ReturnType<typeof createServiceClient>,
  season: number,
  label: string,
): Promise<void> {
  try {
    const r = (await gradeSeasonFinals(db, season)) as { betsGraded?: number; picksGraded?: number };
    if (r.betsGraded || r.picksGraded) console.log(`[sweep ${label}]`, JSON.stringify(r));
  } catch (err) {
    console.error(`sweep ${label} failed:`, err instanceof Error ? err.message : err);
  }
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
  /* Before the idle guard, not after it. A game that finals in the gap between
     two runs leaves the next run with nothing live to poll — which is exactly
     when it would be idle-skipped and the straggler would wait for the
     scheduled backstop. One sweep per launch, whether or not this run goes on
     to poll anything. */
  await sweepGrading(db, SEASON, "cfb start");
  await sweepGrading(db, NFL_SEASON, "nfl start");

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
  /* SCORE-1's cadence. The scoring timeline rides this loop rather than its own
     cron, because this is already the thing that runs during game windows —
     but it does NOT ride the 30-second tick.

     Both jobs are gated on the score having moved (`gamesNeedingScoring`), so
     an idle pass costs zero external calls either way. The interval is about
     the CFB side, which reads a whole week of FBS plays per call because CFBD
     publishes no per-game route: that is a multi-MB response, and asking for it
     twice a minute would be indefensible for a few dozen rows. Three minutes
     puts a score on the card well inside the time anyone takes to tap into a
     game, at ~20 calls an hour worst case against a 30,000/month budget. */
  const SCORING_INTERVAL_MS = 3 * 60_000;
  let lastScoring = 0;

  await recordJobRun(db, "scoreboard-loop", async () => {
    let ticks = 0;
    /* LIVE-2. When the leagues went quiet, so this run can stop holding a
       runner for the rest of a four-hour deadline. Null while anything is
       live or imminent; see idleExhausted for why leaving early is free. */
    let idleSince: number | null = null;
    // Per-league edge detection for the settle sweep, and whether this run ever
    // saw the league awake — the end-of-run sweep only pays for a league that
    // actually had games.
    let cfbWasActive = false;
    let nflWasActive = false;
    let cfbRanLive = false;
    let nflRanLive = false;
    while (Date.now() < deadline) {
      let waitMs = 60_000;
      try {
        // Each league gates its own feed: an idle NFL Tuesday costs zero ESPN
        // calls while CFB polls, and vice versa on a Sunday.
        const cfbState = cfbdExhausted ? "idle" : await activity(db, SEASON);
        const nflState = await activity(db, NFL_SEASON);
        if (cfbState !== "idle") {
          cfbRanLive = true;
          const before = cfbdCallCount();
          const result = await scoreboardJob(db);
          await logCfbdCalls(db, "scoreboard", cfbdCallCount() - before);
          ticks++;
          if (ticks % 10 === 1) console.log(`[cfb ${cfbState}]`, JSON.stringify(result));
        }
        if (nflState !== "idle") {
          nflRanLive = true;
          const before = espnCallCount();
          const result = await nflScoreboardJob(db);
          await logEspnCalls(db, "scoreboard-nfl", espnCallCount() - before);
          ticks++;
          if (ticks % 10 === 1) console.log(`[nfl ${nflState}]`, JSON.stringify(result));
        }
        // After the scores are written, so a play that just landed is matched
        // against the score it produced rather than the previous one.
        if (Date.now() - lastScoring >= SCORING_INTERVAL_MS) {
          lastScoring = Date.now();
          try {
            if (nflState !== "idle") {
              const before = espnCallCount();
              const r = await nflScoringJob(db, NFL_SEASON);
              await logEspnCalls(db, "nfl-scoring", espnCallCount() - before);
              if ((r as { plays?: number }).plays) console.log("[nfl scoring]", JSON.stringify(r));
            }
            if (cfbState !== "idle") {
              const before = cfbdCallCount();
              const r = await cfbScoringJob(db, SEASON);
              await logCfbdCalls(db, "cfb-scoring", cfbdCallCount() - before);
              if ((r as { plays?: number }).plays) console.log("[cfb scoring]", JSON.stringify(r));
            }
          } catch (err) {
            // The timeline is enrichment. A feed that will not answer must not
            // cost the slate its live scores, which is what this loop is for.
            console.error("scoring failed:", err instanceof Error ? err.message : err);
          }
        }

        /* The moment a league stops having anything live is the moment its
           last game went final — and the poll that would have graded it has
           just been switched off. Sweep on that edge, per league, so the last
           game of a slate settles on the same tick as every other one. */
        if (cfbWasActive && cfbState === "idle") await sweepGrading(db, SEASON, "cfb settled");
        if (nflWasActive && nflState === "idle") await sweepGrading(db, NFL_SEASON, "nfl settled");
        cfbWasActive = cfbState !== "idle";
        nflWasActive = nflState !== "idle";

        const state =
          cfbState === "live" || nflState === "live"
            ? "live"
            : cfbState === "imminent" || nflState === "imminent"
              ? "imminent"
              : "idle";
        if (state !== "idle") waitMs = state === "live" ? liveMs : 120_000;
        idleSince = state === "idle" ? (idleSince ?? Date.now()) : null;
      } catch (err) {
        // one bad tick never kills the hour
        console.error("tick failed:", err instanceof Error ? err.message : err);
        waitMs = 60_000;
      }
      if (idleExhausted(idleSince, Date.now())) {
        console.log(
          `nothing live or imminent for ${IDLE_EXIT_MS / 60_000} min — ending this run early; ` +
            "the next launch picks it up",
        );
        break;
      }
      if (Date.now() + waitMs > deadline) break;
      await sleep(waitMs);
    }
    /* The deadline can land between the last tick and a game going final, so
       the edge above never fires for it. One more sweep on the way out, only
       for a league this run actually polled. */
    if (cfbRanLive) await sweepGrading(db, SEASON, "cfb end");
    if (nflRanLive) await sweepGrading(db, NFL_SEASON, "nfl end");

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
