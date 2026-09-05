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
import {
  idleSkip,
  envDays,
  idleExhausted,
  kickoffBeforeDeadline,
  msUntilNextGame,
  scheduledState,
  IDLE_EXIT_MS,
} from "./lib/idle";
import {
  SEASON,
  beat,
  beatAgeMin,
  cfbScoringJob,
  gradeSeasonFinals,
  HEARTBEAT_SOURCES,
  logCfbdCalls,
  logEspnCalls,
  nflScoreboardJob,
  nflScoringJob,
  recordJobRun,
  scoreboardJob,
} from "./lib/jobs-core";
import { NFL_SEASON } from "./lib/nfl";
import { notifyWatchdog } from "./lib/notify-jobs";

// `??` only catches undefined, so this used to read `CFBD_MONTHLY_BUDGET=""` as
// a budget of zero — which throttles at 80% of nothing and refuses to poll at
// 95% of nothing, i.e. a Saturday with no live scores. envNum treats blank as
// unset (P2-1).
const MONTHLY_BUDGET = envNum("CFBD_MONTHLY_BUDGET", 30_000, { min: 1 });

/* LIVE-3. How quiet the 10-second path has to go, during a live NFL game,
   before this loop pages about it. Three minutes is ~18 missed pulls — long
   enough to ride out a slow ESPN response or a pg_cron hiccup, short enough
   that the answer arrives during the game rather than after it. */
const EDGE_SILENT_MIN = envNum("EDGE_SILENT_MIN", 3, { min: 1 });

function argNum(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  const v = i > -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * `kicked` is separate from `live` on purpose. Both poll at the live cadence,
 * but `live` still means "our status says in_progress" — the NFL edge pager
 * below keys off that exact fact, and widening it would page for a game we
 * only *believe* has started.
 */
type Activity = "live" | "kicked" | "imminent" | "idle";

/** The two states that deserve the fast poll. */
const fastCadence = (s: Activity): boolean => s === "live" || s === "kicked";

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

  /* Scheduled games that kick soon — or already kicked but our status hasn't
     flipped yet (that transition is exactly what we're polling to catch).
     Ordered, so the one row we take is the EARLIEST: if it has already kicked
     something is underway, and if it has not then nothing in the window has.
     The ordering is what lets `scheduledState` tell those apart — before it,
     both answered "imminent" and a kicked-off game was polled every 120s. */
  const { data: soon } = await db
    .from("games")
    .select("start_ts")
    .eq("season_id", season)
    .eq("status", "scheduled")
    .gte("start_ts", new Date(now - 4 * 3600_000).toISOString())
    .lte("start_ts", new Date(now + 15 * 60_000).toISOString())
    .order("start_ts")
    .limit(1);
  const earliest = ((soon ?? []) as Array<{ start_ts: string | null }>)[0]?.start_ts ?? null;
  return scheduledState(earliest, now);
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
  /* LIVE-5, 2026-08-20. `source = "cfbd"`, which this had never filtered on.
     Every ESPN call lands in the same table by design (an unmetered feed is
     invisible in /admin), so the number this returned was CFBD + ESPN measured
     against CFBD's 30,000 — 1,719 ESPN against 714 CFBD in the month this was
     found, i.e. the count was more than three times the real usage.
     Harmless at 2,400 and not harmless later: the gates below halve the CFB
     poll rate at 80% and switch CFB polling OFF at 95%, so a Saturday's ESPN
     traffic could have taken college scores down with thousands of CFBD calls
     still unspent. */
  const { count } = await db
    .from("api_call_log")
    .select("id", { count: "exact", head: true })
    .eq("source", "cfbd")
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
    /** LIVE-9. Say once per run that the idle exit is being held off, not every minute. */
    let holdLogged = false;
    /** LIVE-3. One page per run about the other path, not one per tick. */
    let edgePaged = false;
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
        /* LIVE-3. One beat per tick that polled anything, so "did anything
           pull" is answerable without inferring it from data that may
           legitimately not have changed. After the writes, so a beat means a
           completed pull rather than an attempted one. */
        if (cfbState !== "idle" || nflState !== "idle") {
          await beat(db, HEARTBEAT_SOURCES.loop, { cfb: cfbState, nfl: nflState });
        }
        /* LIVE-3, the half that would have caught tonight. The 10-second path
           ran for a whole game returning `espn 403` and nothing said so; this
           loop is awake during exactly those minutes and can see its silence.
           Once per run — a page repeated every 30 seconds is a page nobody
           reads — and only while an NFL game is actually live, since that path
           is NFL-only and correctly quiet otherwise. */
        if (!edgePaged && nflState === "live") {
          const edgeAge = await beatAgeMin(db, HEARTBEAT_SOURCES.edge);
          if (edgeAge > EDGE_SILENT_MIN) {
            edgePaged = true;
            const how = Number.isFinite(edgeAge) ? `${Math.round(edgeAge)}m` : "ever";
            const problem =
              `10-second NFL refresh: an NFL game is LIVE and the edge pull has not ` +
              `succeeded in ${how} — this loop is covering it at ${liveMs / 1000}s`;
            console.error(problem);
            await notifyWatchdog(db, [problem]);
          }
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

        /* A kicked-off game polls as fast as a confirmed-live one: the status
           write we are waiting for is the whole point of the tick. */
        const fast = fastCadence(cfbState) || fastCadence(nflState);
        const imminent = cfbState === "imminent" || nflState === "imminent";
        if (fast) waitMs = liveMs;
        else if (imminent) waitMs = 120_000;
        idleSince = fast || imminent ? null : (idleSince ?? Date.now());
      } catch (err) {
        // one bad tick never kills the hour
        console.error("tick failed:", err instanceof Error ? err.message : err);
        waitMs = 60_000;
      }
      if (idleExhausted(idleSince, Date.now())) {
        /* LIVE-9. "The next launch picks it up" is only true if the next launch
           comes. Before giving up the runner, check whether a kickoff lands
           inside this run's own deadline — and if so, hold: the scheduler
           delivered Week 1 Saturday's launches 2.5 hours late, and a loop that
           had simply stayed would have been polling at kickoff. A CFB kickoff
           does not count once the CFBD budget has switched CFB polling off. */
        const now = Date.now();
        const [cfbMs, nflMs] = await Promise.all([
          cfbdExhausted ? Promise.resolve(null) : msUntilNextGame(db, SEASON, now),
          msUntilNextGame(db, NFL_SEASON, now),
        ]);
        const kick = kickoffBeforeDeadline([cfbMs, nflMs], now, deadline);
        if (kick === null) {
          console.log(
            `nothing live or imminent for ${IDLE_EXIT_MS / 60_000} min — ending this run early; ` +
              "the next launch picks it up",
          );
          break;
        }
        if (!holdLogged) {
          holdLogged = true;
          console.log(
            `nothing live or imminent for ${IDLE_EXIT_MS / 60_000} min, but a kickoff at ` +
              `${new Date(kick).toISOString()} lands before this run's deadline — holding the runner ` +
              "rather than trusting the next launch to arrive (LIVE-9)",
          );
        }
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
