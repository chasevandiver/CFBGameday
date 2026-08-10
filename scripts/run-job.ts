/**
 * CLI entry for scheduled jobs (GitHub Actions calls this).
 * Usage: npx tsx scripts/run-job.ts <scoreboard|weather|ratings-update|freeze|sync-rankings>
 * (refresh-lines and sync-games have their own scripts with extra flags.)
 */

import { cfbdCallCount } from "../src/lib/cfbd";
import { createServiceClient } from "../src/lib/supabase/service";
import {
  freezeGroupWeeksJob,
  freezeJob,
  logCfbdCalls,
  ratingsUpdateJob,
  recordJobRun,
  scoreboardJob,
  syncRankingsJob,
  syncSystemsJob,
  weatherJob,
} from "./lib/jobs-core";

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
