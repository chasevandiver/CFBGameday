-- The database's own 30-second live-score refresh (owner request 2026-08-14:
-- "the site should be pulling from espn on a 30 second refresh").
--
-- pg_cron invokes the nfl-scoreboard edge function every 30 seconds via
-- pg_net; the function (supabase/functions/nfl-scoreboard/index.ts, deployed
-- 2026-08-14) fetches ESPN's public scoreboard and patches stored NFL games'
-- live columns, no-op-diffed like the Actions loop. Its idle gate means an
-- off-night tick is one cheap indexed query and no ESPN call. The function
-- authenticates nothing (verify_jwt off) because it takes no input and can
-- only refresh public data through its own server-side credentials.
--
-- This exists because GitHub Actions — the scheduler for everything else —
-- stalled outright on 2026-08-13 while preseason games were live. The
-- Actions loop keeps running as a second writer; both diff before writing,
-- so they coexist.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $unschedule$
begin
  perform cron.unschedule('nfl-scoreboard-30s');
exception when others then
  null; -- not scheduled yet
end
$unschedule$;

select cron.schedule(
  'nfl-scoreboard-30s',
  '30 seconds',
  $cmd$
  select net.http_post(
    url := 'https://mjijyutmbtnwcjspozsx.supabase.co/functions/v1/nfl-scoreboard',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  $cmd$
);
