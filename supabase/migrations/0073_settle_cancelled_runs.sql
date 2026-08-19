-- OPS-4 — settle the job_runs rows that were cancelled and never said so.
--
-- The hourly scoreboard loops overlap by design: each runs ~63 minutes on an
-- hourly cron, and `jobs.yml`'s concurrency group has `cancel-in-progress:
-- true` so the new run replaces the old one for a seamless handoff. GitHub
-- signals the old process, `recordJobRun`'s ok and error branches never run,
-- and the row stays `status = 'running'` with a null `finished_at` forever.
--
-- Thirteen had accumulated by 2026-08-19 — roughly one per hour of live
-- football, so the rate grows with the season rather than shrinking. Every one
-- of them is a HEALTHY handoff written in the shape of a job that died.
--
-- ## What this is not
--
-- OPS-4 was tracked as "a hole in the thing that is supposed to notice holes",
-- on the reasoning that the watchdog reads `job_runs`. It does, but
-- `watchdogJob`'s `lastOkAgeH` filters `.eq("status", "ok")`, so a stuck
-- `running` row was never counted as a success and never blinded it. The
-- watchdog was fine the whole time.
--
-- What was actually wrong is `/admin`: its freshness card takes the LATEST run
-- per job and calls anything that is not `error` healthy — so the most recent
-- scoreboard-loop row, frequently a cancelled one, rendered green, and a loop
-- that had genuinely crashed would have rendered green too. Both halves are
-- fixed in code: `recordJobRun` now traps SIGINT/SIGTERM and writes
-- `canceled`, and the card shows a `running` row older than three hours as
-- "never finished" rather than as fine.
--
-- ## The cutoff
--
-- Three hours. The longest job is the ~63-minute loop, so anything still
-- reading `running` after three is finished one way or another. A run inside
-- that window is left alone: it may genuinely be in flight, and asserting it
-- is dead is the same class of mistake as calling a cancelled run healthy.
--
-- ## `finished_at` stays null, deliberately
--
-- Setting it to `started_at` would claim the run took zero seconds, and
-- `started_at + 63 minutes` would be a guess wearing a timestamp. Nobody
-- observed these runs finish, and that is what a null says. The same rule
-- `backfillSnapshotRows` applies to a line with no kickoff: a fabricated time
-- is worse than a missing one.
--
-- Status is what changes, so `running` recovers its meaning — still going, or
-- killed hard enough that even the SIGTERM handler did not land.
--
-- No DELETE. These rows record a real run; only the ending was missing.
--
-- ## THE ORDER IS LOAD-BEARING: apply this BEFORE the deploy
--
-- `job_runs_status_check` is `status IN ('running','ok','error')` — it has no
-- room for `canceled`, and the database refused the first attempt at this
-- migration, which is the only reason anyone found out. The code half would
-- have failed in the worst possible way: `recordJobRun`'s `finish` swallows
-- write errors on purpose ("observability must never break the thing it
-- observes"), so the constraint violation would have been caught and dropped,
-- the row would have stayed `running`, and the fix would have looked shipped
-- while doing nothing at all.
--
-- So the widened constraint has to be live before any process writes
-- `canceled`. It is inert against the running code — nothing writes that value
-- yet — which is what makes applying it first safe.

alter table job_runs drop constraint if exists job_runs_status_check;
alter table job_runs add constraint job_runs_status_check
  check (status in ('running', 'ok', 'error', 'canceled'));

update job_runs
   set status = 'canceled',
       error = 'settled by 0073 — cancelled by the concurrency group before recordJobRun could record it'
 where status = 'running'
   and finished_at is null
   and started_at < now() - interval '3 hours';
