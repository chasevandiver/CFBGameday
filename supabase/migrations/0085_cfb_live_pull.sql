-- LIVE-11 — a second live feed for college football: ESPN, from the database.
--
-- Week 1 Saturday, 2026-09-06 00:31 UTC, 25 games live: CFBD began answering
-- 401 on `/scoreboard` and on nothing else. The access probe read every other
-- endpoint `ok` and `/scoreboard` DENIED — the Tier 1+ entitlement on the key
-- had lapsed. The Actions loop kept running and kept failing every tick, and
-- the whole slate froze where it stood. Nothing on our side can renew a tier;
-- what can be done is to stop having exactly one feed for the one thing the
-- product is watched for.
--
-- This is 0044's lane opened to CFB. NFL-13 had recorded that it could not be:
-- "games.id for CFB rows is a CFBD id and there is no ESPN id column to join a
-- college board on". That was wrong — CFBD's game ids are ESPN's event ids
-- (401860878 is CSU/WYO on both boards, and every live id tonight matched) —
-- so the same key joins both, and supabase/functions/cfb-scoreboard/index.ts
-- is nfl-scoreboard with the sport, the URLs (FBS group 80 + FCS group 81) and
-- the heartbeat source (`edge-cfb`) changed.
--
-- 30 seconds rather than NFL's 10: the college slate is ~80 games across two
-- feeds, and 30s is the freshness the Actions loop already promised. Gated in
-- the cron command exactly as 0044 is, so an idle night costs no invocation:
-- ~120 invocations an hour while college football is on, roughly 8,000 a
-- month in season against a 500,000 quota.
--
-- Two writers coexist, as they already do for the NFL: both diff before
-- writing, and the function normalises ESPN's "8:00" to CFBD's "08:00" so
-- the row never flip-flops on the clock. A stored final is never reopened.
-- Grading stays where it is — the loop's sweeps and the Sunday backstop read
-- `status = 'final'` whoever wrote it.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $unschedule$
begin
  perform cron.unschedule('cfb-scoreboard-30s');
exception when others then
  null; -- first run
end
$unschedule$;

select cron.schedule(
  'cfb-scoreboard-30s',
  '30 seconds',
  $cmd$
  select net.http_post(
    url := 'https://mjijyutmbtnwcjspozsx.supabase.co/functions/v1/cfb-scoreboard',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  )
  where exists (
    select 1
    from public.games
    where sport = 'cfb'
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
