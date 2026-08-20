/**
 * OPS-4b. Settle the `job_runs` row of a run the GitHub runner cancelled.
 *
 * Runs as the workflow's `if: cancelled()` step (jobs.yml), which is the only
 * place with a live process after a cancellation: the job's own SIGTERM
 * handler cannot land, because the signal goes to the step's shell and the
 * runner terminates the orphaned `npx tsx` tree a fraction of a second later.
 * See `publishRunId` in scripts/lib/jobs-core.ts for the run that proved it.
 *
 * Never fails the workflow. A cancelled job is already red-ish in the UI and a
 * bookkeeping write is not a reason to make the cancellation look like
 * something else — the same rule `recordJobRun` follows.
 */

import { readFileSync } from "node:fs";
import { createServiceClient } from "../src/lib/supabase/service";
import { settleCanceledRun } from "./lib/jobs-core";

async function main() {
  const path = process.env.JOB_RUN_ID_FILE;
  if (!path) {
    console.log("settle-canceled-run: no JOB_RUN_ID_FILE — nothing to settle");
    return;
  }

  let runId: number;
  try {
    runId = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
  } catch {
    // The job was cancelled before it recorded a run, or job_runs was
    // unavailable when it started. Either way there is no row to settle.
    console.log(`settle-canceled-run: no run id at ${path} — the job never recorded one`);
    return;
  }
  if (!Number.isInteger(runId)) {
    console.log("settle-canceled-run: run id file is not a number — leaving it alone");
    return;
  }

  const note = process.env.GITHUB_RUN_ID
    ? `canceled by the runner (Actions run ${process.env.GITHUB_RUN_ID})`
    : "canceled by the runner";
  const outcome = await settleCanceledRun(createServiceClient(), runId, note);
  console.log(`settle-canceled-run: job_runs ${runId} — ${outcome}`);
}

main().catch((err) => {
  console.log(`settle-canceled-run: ${err instanceof Error ? err.message : String(err)}`);
});
