/**
 * CLI entry for scheduled jobs (GitHub Actions calls this).
 * Usage: npx tsx scripts/run-job.ts <scoreboard|weather|ratings-update|freeze|sync-rankings>
 * (refresh-lines and sync-games have their own scripts with extra flags.)
 */

import { cfbdCallCount } from "../src/lib/cfbd";
import { createServiceClient } from "../src/lib/supabase/service";
import {
  cfbScoringJob,
  freezeGroupWeeksJob,
  freezeJob,
  gradeSeasonFinals,
  nflScoringJob,
  logCfbdCalls,
  ratingsUpdateJob,
  recordJobRun,
  scoreboardJob,
  SEASON,
  syncRankingsJob,
  syncSystemsJob,
  watchdogJob,
  weatherJob,
} from "./lib/jobs-core";
import { backfillGamesJob, backfillLinesJob, backfillRankingsJob } from "./lib/backfill";
import { guessLinesJob, streakJob } from "./lib/daily-games";
import { dailyPuzzlesJob } from "./lib/daily-puzzles";
import { sixPackJob } from "./lib/six-pack";
import { NFL_SEASON } from "./lib/nfl";
import { notifyLogBetsJob, notifyPicksDueJob } from "./lib/notify-jobs";

async function main() {
  const task = process.argv[2];
  const db = createServiceClient();
  const jobs = {
    scoreboard: scoreboardJob,
    weather: weatherJob,
    "ratings-update": ratingsUpdateJob,
    freeze: freezeJob,
    "freeze-groups": freezeGroupWeeksJob,
    "sync-rankings": syncRankingsJob,
    "sync-systems": syncSystemsJob,
    // Absence check: throws (→ exit 1, red run, failure email) when a job it
    // depends on has gone silent past its cadence. The external dead-man ping
    // catches the whole scheduler dying; this catches one job dying.
    watchdog: watchdogJob,
    // Push. Sends live inside `scoreboard`; this is the scheduled half.
    "notify-picks-due": notifyPicksDueJob,
    "notify-log-bets": notifyLogBetsJob,
    // NFL settlement: the ratings replay stays CFB-only, but an NFL final
    // grades picks/bets and CLV with the identical shared machinery.
    "nfl-grade": (db: Parameters<typeof gradeSeasonFinals>[0]) => gradeSeasonFinals(db, NFL_SEASON),
    // SCORE-1: the scoring timeline, one job per league because the two feeds
    // are shaped differently — ESPN publishes a ready-made summary per game,
    // CFBD publishes a whole week of plays and expects you to filter. Both are
    // gated on the score having moved, so an idle run costs no external call.
    "nfl-scoring": (db: Parameters<typeof nflScoringJob>[0]) => nflScoringJob(db, NFL_SEASON),
    "cfb-scoring": (db: Parameters<typeof cfbScoringJob>[0]) => cfbScoringJob(db, SEASON),
    // The daily game layer (R2-C1/C2). Selection is idempotent per week/day;
    // grading sweeps anything the last run left pending.
    "guess-lines": guessLinesJob,
    streak: streakJob,
    // The weekly one (R3-E2): Tuesday generates, Sun/Mon grade. Both halves
    // are idempotent, so a missed run costs latency and never correctness.
    "six-pack": sixPackJob,
    // The three trial games' generator (TAPE/DC/CHAIN). Banks a fortnight
    // ahead so queue depth is the health metric — the lane Guess the Game
    // could never have, because a puzzle computed on read has no job to be
    // late (GTG-1).
    "daily-puzzles": dailyPuzzlesJob,
    // Dispatch-only (no cron): finished seasons do not change, so this is
    // run by hand when the puzzle deck needs widening. See scripts/lib/backfill.ts.
    "backfill-games": backfillGamesJob,
    // The other two halves of the archive (BF-3), same dispatch-only rule:
    // the market and the polls for seasons that are already over.
    "backfill-lines": backfillLinesJob,
    "backfill-rankings": backfillRankingsJob,
  } as const;
  const job = jobs[task as keyof typeof jobs];
  if (!job) throw new Error(`unknown task "${task}" (${Object.keys(jobs).join("|")})`);
  const result = await recordJobRun(db, task, () => job(db));
  await logCfbdCalls(db, task, cfbdCallCount());
  console.log(task, JSON.stringify(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
