-- The live pull at 10 seconds, and cheaper than the 30-second one it replaces.
--
-- Owner request 2026-08-14, after being shown the arithmetic: narrow the cron
-- to game windows and take the interval to 10s.
--
-- 0043 fired every 30 seconds year-round and let the edge function decide
-- whether there was anything to do. That decision was correct but too late:
-- an "idle" tick still costs an Edge Function Invocation, and those are
-- metered (Free plan: 500,000/month). 30s year-round is ~87,700 invocations a
-- month, ~18% of the quota, essentially all of it spent on nights with no
-- football.
--
-- So the gate moves into the cron command itself. pg_cron still fires every
-- 10 seconds — a pg_cron tick is a local query and costs no invocation — but
-- `net.http_post` sits behind a `where exists (...)`, so the function is
-- invoked only while an NFL game is live or about to be. With no rows the
-- SELECT produces nothing and the target list is never evaluated.
--
-- The result is 3x fresher and roughly a third of the cost:
--
--     30s year-round (0043)   ~87,700/mo   ~18% of the free quota
--     10s, gated (this)       ~31,300/mo    ~6% of the free quota
--
-- assuming ~20 hours of live football a week. The gate predicate is a copy of
-- the function's own idle check, so the two agree; the function keeps its
-- check as defence in depth, since it stays publicly invokable.
--
-- CFB is deliberately NOT in this lane. `games.id` for CFB rows is a CFBD id
-- and there is no ESPN id column to join a college board on, so this path is
-- NFL-only exactly as 0043 was. CFB live scores still come from the Actions
-- loop via CFBD (`scoreboardJob`). Tracked as NFL-13.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The gate runs every 10 seconds forever, so it gets its own index rather
-- than a sequential scan of every game ever stored.
create index if not exists games_sport_status_start
  on public.games (sport, status, start_ts);

do $unschedule$
begin
  perform cron.unschedule('nfl-scoreboard-30s');
exception when others then
  null; -- 0043 not applied, or already replaced
end
$unschedule$;

do $unschedule$
begin
  perform cron.unschedule('nfl-scoreboard-10s');
exception when others then
  null; -- first run
end
$unschedule$;

select cron.schedule(
  'nfl-scoreboard-10s',
  '10 seconds',
  $cmd$
  select net.http_post(
    url := 'https://mjijyutmbtnwcjspozsx.supabase.co/functions/v1/nfl-scoreboard',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 8000
  )
  where exists (
    select 1
    from public.games
    where sport = 'nfl'
      and (
        status = 'in_progress'
        or (
          status = 'scheduled'
          and start_ts >= now() - interval '4 hours'
          and start_ts <= now() + interval '15 minutes'
        )
      )
  );
  $cmd$
);

-- pg_cron writes a `job_run_details` row for every tick whether or not the
-- gate opened: ~712 bytes each, 10s forever, which is ~187 MB a month against
-- a 500 MB Free-plan database. It would fill the disk in under three months
-- and nothing purges it by default. Two days is enough history to debug a bad
-- night (17,280 rows, ~12 MB) and bounded.
do $unschedule$
begin
  perform cron.unschedule('cron-log-purge');
exception when others then
  null; -- first run
end
$unschedule$;

select cron.schedule(
  'cron-log-purge',
  '17 9 * * *',
  $cmd$
  delete from cron.job_run_details where end_time < now() - interval '2 days';
  $cmd$
);
