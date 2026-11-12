-- MIG-2 — filed after the fact. THIS IS ALREADY APPLIED.
--
-- Applied to the live project on 2026-09-05 as `20260905164720`
-- (`0084_loop_launcher`) and never committed. Found on 2026-11-12 while adding
-- college basketball: the directory ended at 0083, `schema_migrations` had two
-- more rows, and the live `cron.job` table listed `loop-launcher-2m` with no
-- file to explain it. Same defect as MIG-1 (0077), two migrations wide this
-- time — see also 0085.
--
-- Everything below the line of dashes is **verbatim** from
-- `schema_migrations.statements` for that version, so the repo cannot drift
-- from what production ran. That includes its own second comment line, which
-- points at "this file" for the full rationale: the file it was applied from
-- carried a longer header that was never committed and is not recoverable
-- from the database. What the code does is plain enough to stand without it,
-- and inventing the missing prose would be worse than admitting it is gone.
--
-- ## Do not re-apply
--
-- Every statement is idempotent (`if not exists`, `create or replace`, an
-- unschedule-then-schedule), so running it again is harmless rather than
-- destructive; it is simply already the live definition. 0086 replaces
-- `launch_live_loop_if_needed` to keep basketball out of the football loop.
--
-- ---------------------------------------------------------------------------

-- LIVE-10 — a second scheduler for the live loop, in the database.
-- Full rationale in supabase/migrations/0084_loop_launcher.sql (this file, verbatim).

create extension if not exists pg_cron;
create extension if not exists pg_net;

create index if not exists games_status_start
  on public.games (status, start_ts);

create table if not exists public.loop_launcher_state (
  id                  boolean primary key default true check (id),
  checked_at          timestamptz not null default now(),
  result              text not null,
  reason              text,
  last_dispatched_at  timestamptz
);

comment on table public.loop_launcher_state is
  'Single row: the live-loop launcher''s last decision (LIVE-10). result is idle | polling | pending | no_vault | no_token | dispatched.';

create table if not exists public.loop_launches (
  id            bigserial primary key,
  requested_at  timestamptz not null default now(),
  reason        text not null,
  request_id    bigint
);

comment on table public.loop_launches is
  'Every workflow dispatch the database issued for scoreboard-loop (LIVE-10), and why.';

alter table public.loop_launcher_state enable row level security;
alter table public.loop_launches enable row level security;
revoke all on public.loop_launcher_state from anon, authenticated;
revoke all on public.loop_launches from anon, authenticated;
revoke all on sequence public.loop_launches_id_seq from anon, authenticated;

create or replace function public.launch_live_loop_if_needed()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason      text;
  v_beat        timestamptz;
  v_last        timestamptz;
  v_token       text;
  v_request_id  bigint;
  v_result      text;
begin
  -- 1. Should a loop be running? Mirrors activity() in scoreboard-loop.ts.
  select case
    when exists (select 1 from games where status = 'in_progress') then 'live'
    when exists (
      select 1 from games
      where status = 'scheduled'
        and start_ts >= now() - interval '4 hours'
        and start_ts <= now()
    ) then 'kicked'
    when exists (
      select 1 from games
      where status = 'scheduled'
        and start_ts > now()
        and start_ts <= now() + interval '15 minutes'
    ) then 'imminent'
  end into v_reason;

  if v_reason is null then
    v_result := 'idle';

  else
    -- 2. Is one running? A beat is a completed poll (LIVE-3), never a launch.
    select beat_at into v_beat from live_heartbeat where source = 'actions-loop';
    select last_dispatched_at into v_last from loop_launcher_state where id;

    if v_beat is not null and v_beat > now() - interval '3 minutes' then
      v_result := 'polling';
    elsif v_last is not null and v_last > now() - interval '10 minutes' then
      -- Dispatched recently; a runner takes about a minute to reach its
      -- first beat and a queued one can take longer. Do not stack launches.
      v_result := 'pending';
    elsif to_regclass('vault.decrypted_secrets') is null then
      v_result := 'no_vault';
    else
      execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
        into v_token using 'github_actions_dispatch';
      if v_token is null or v_token = '' then
        v_result := 'no_token';
      else
        select net.http_post(
          url := 'https://api.github.com/repos/chasevandiver/CFBGameday/actions/workflows/jobs.yml/dispatches',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || v_token,
            'Accept', 'application/vnd.github+json',
            'X-GitHub-Api-Version', '2022-11-28',
            'Content-Type', 'application/json',
            'User-Agent', 'the-cfb-slate loop-launcher'
          ),
          body := '{"ref":"main","inputs":{"task":"scoreboard-loop"}}'::jsonb,
          timeout_milliseconds := 10000
        ) into v_request_id;
        insert into loop_launches (reason, request_id) values (v_reason, v_request_id);
        v_result := 'dispatched';
      end if;
    end if;
  end if;

  insert into loop_launcher_state as s (id, checked_at, result, reason, last_dispatched_at)
  values (true, now(), v_result, v_reason,
          case when v_result = 'dispatched' then now() end)
  on conflict (id) do update set
    checked_at         = excluded.checked_at,
    result             = excluded.result,
    reason             = excluded.reason,
    last_dispatched_at = coalesce(excluded.last_dispatched_at, s.last_dispatched_at);

  return v_result;
end;
$$;

comment on function public.launch_live_loop_if_needed() is
  'LIVE-10. If football is on (or 15 min out) and the Actions loop has not beaten in 3 min, dispatch jobs.yml with task=scoreboard-loop via pg_net. Inert without the github_actions_dispatch Vault secret.';

revoke execute on function public.launch_live_loop_if_needed() from public, anon, authenticated;

do $unschedule$
begin
  perform cron.unschedule('loop-launcher-2m');
exception when others then
  null; -- first run
end
$unschedule$;

select cron.schedule(
  'loop-launcher-2m',
  '*/2 * * * *',
  $cmd$ select public.launch_live_loop_if_needed(); $cmd$
);
