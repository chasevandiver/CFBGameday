-- MIG-2 — filed after the fact. THIS IS ALREADY APPLIED.
--
-- Applied to the live project on 2026-09-06 as `20260906010814`
-- (`0085_cfb_live_pull`) and never committed, along with the edge function it
-- schedules. Found on 2026-11-12 with 0084 — see that file's header for how.
-- The function's source was recovered from the deployed version the same day
-- and is now `supabase/functions/cfb-scoreboard/index.ts`; its own header
-- carries the incident this was written in (CFBD answering 401 on
-- `/scoreboard` mid-slate on 2026-09-06).
--
-- Everything below the line of dashes is **verbatim** from
-- `schema_migrations.statements` for that version.
--
-- ## Do not re-apply
--
-- Idempotent (unschedule-then-schedule), so harmless; simply already live.
--
-- ---------------------------------------------------------------------------

-- LIVE-11 — a second live feed for college football: ESPN, from the database.
-- Full rationale in supabase/migrations/0085_cfb_live_pull.sql (this file, verbatim).

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
