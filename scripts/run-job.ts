/**
 * CLI entry for scheduled jobs (GitHub Actions calls this).
 * Usage: npx tsx scripts/run-job.ts <scoreboard|weather|ratings-update|freeze|sync-rankings>
 * (refresh-lines and sync-games have their own scripts with extra flags.)
 */

import { createServiceClient } from "../src/lib/supabase/service";
import { freezeJob, ratingsUpdateJob, scoreboardJob, syncRankingsJob, weatherJob } from "./lib/jobs-core";

async function main() {
  const task = process.argv[2];
  const db = createServiceClient();
  const jobs = {
    scoreboard: scoreboardJob,
    weather: weatherJob,
    "ratings-update": ratingsUpdateJob,
    freeze: freezeJob,
    "sync-rankings": syncRankingsJob,
  } as const;
  const job = jobs[task as keyof typeof jobs];
  if (!job) throw new Error(`unknown task "${task}" (${Object.keys(jobs).join("|")})`);
  const result = await job(db);
  console.log(task, JSON.stringify(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
