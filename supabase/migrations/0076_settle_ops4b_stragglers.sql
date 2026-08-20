-- OPS-4b — settle the two rows the 08-19 fix was supposed to prevent.
--
-- 0073 swept thirteen cancelled `scoreboard-loop` runs and shipped the code
-- half: `recordJobRun` traps SIGINT/SIGTERM and writes `canceled`. Two more
-- rows have appeared since, both after that code was live on `main`:
--
--   id 217, 2026-08-19 03:40   cancelled by the 04:30 launch
--   id 242, 2026-08-20 03:40   cancelled by the 04:30 launch, on d9fad2a
--
-- The handler never fires on GitHub. Actions run 32329026607's log has the
-- mechanism: cancelling kills the step's bash shell, and the runner then
-- prints `Terminate orphan process` for the whole `npm exec tsx → sh → node →
-- node` tree and completes the job 0.26 s later. The signal never reaches the
-- grandchild that installed the handler, and a Supabase round-trip would not
-- land inside a quarter second if it had. The fix is a workflow step guarded
-- by `if: cancelled()`, which runs after the process is gone — see
-- `scripts/settle-canceled-run.ts`.
--
-- Same rules as 0073, for the same reasons: the 3-hour cutoff, so a run that
-- may genuinely be in flight is left alone; `finished_at` stays null, because
-- nobody observed these two end and a fabricated timestamp is worse than a
-- missing one; and no DELETE, because the runs were real and only the ending
-- was missing. Rows the new step settles WILL carry a `finished_at` — that
-- one is observed, written by something that watched the cancellation happen.
--
-- Ordering is free: two rows in an observability table, no constraint change,
-- nothing in either build reads them.
--
-- This should be the last sweep of its kind. If a third one is ever needed,
-- the question to ask is not "which rows are stale" but "did the cancellation
-- step run", and the answer is in the cancelled job's log.

update job_runs
   set status = 'canceled',
       error = 'settled by 0076 — cancelled by the concurrency group; the SIGTERM handler could not reach the process in time (OPS-4b)'
 where status = 'running'
   and finished_at is null
   and started_at < now() - interval '3 hours';
