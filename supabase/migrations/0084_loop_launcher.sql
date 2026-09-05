-- LIVE-10 — a second scheduler for the live loop, in the database.
--
-- Owner, Week 1 Saturday 2026-09-05, after ten games kicked with nothing
-- polling them (LIVE-9): "This has been happening a lot with the GitHub
-- actions. We need to fix this."
--
-- ## The fault
--
-- GitHub Actions cron is the only thing that launches `scoreboard-loop`, and
-- it is not a scheduler in the sense the loop needs: it drifted 13–15 minutes
-- on 2026-08-20 and dropped a fire (LIVE-2), stalled outright on 2026-08-13
-- with preseason games live (0043's reason for existing), and on 2026-09-05
-- delivered the 10:00 UTC crons at 13:11, coalesced an hourly range into one
-- run, and had the 14:00 slot arrive at 16:28. Every fix so far has been on
-- the loop's side of that boundary — longer runs (LIVE-2), holding the runner
-- for a reachable kickoff (LIVE-9) — and each one still needs GitHub to have
-- started *something* in the hours before kickoff. Nothing can be done about
-- when GitHub fires. What can be done is to stop depending on it.
--
-- ## The fix
--
-- pg_cron fires to the minute (0044's 10-second NFL pull has not missed a
-- tick since it was wired). So every two minutes the database asks two
-- questions the loop itself already answers from this same table:
--
--   1. Should a loop be running?  A game is `in_progress`, or a `scheduled`
--      one kicked in the last 4 hours (the status flip the loop exists to
--      catch), or one kicks in the next 15 minutes. The same window
--      `activity()` in scripts/scoreboard-loop.ts polls on, so the two agree.
--   2. Is one running?  `live_heartbeat.actions-loop` beats on every
--      successful poll (LIVE-3): 30s live, 120s imminent. Three minutes of
--      silence with football on is a dead or absent loop.
--
-- Yes to the first and no to the second, and the database dispatches the
-- workflow itself: `net.http_post` to GitHub's workflow-dispatch endpoint with
-- `task: scoreboard-loop`, which lands in the same concurrency group as a
-- scheduled launch and hands off the same way (LIVE-2). The GitHub crons stay
-- as they are — a launch that arrives is still a launch — this only fills the
-- hours when none does. A dispatched run takes about a minute to reach its
-- first beat, so a second dispatch is held for 10 minutes after the first.
--
-- ## The token
--
-- GitHub will not dispatch a workflow without credentials. A fine-grained
-- personal access token scoped to this one repository with Actions: write is
-- stored in Supabase Vault under the name `github_actions_dispatch`; the
-- function reads it through `vault.decrypted_secrets` at call time and never
-- copies it anywhere. Until the secret exists the launcher is inert: it
-- records `no_token` in `loop_launcher_state` and dispatches nothing, so this
-- migration is safe to apply ahead of the token. Storing it is one statement:
--
--   select vault.create_secret('<token>', 'github_actions_dispatch',
--     'Fine-grained PAT, Actions: write on chasevandiver/CFBGameday (LIVE-10)');
--
-- Fine-grained tokens expire (a year at most). When it does, the launcher
-- keeps dispatching and GitHub keeps answering 401 — pg_net is asynchronous,
-- so the function cannot see the reply. `loop_launches` records every
-- dispatch and its pg_net request id; `net._http_response` keeps the answer
-- for a few hours. Tracked in docs/STATUS.md.
--
-- ## Offline
--
-- scripts/db-test.sh stubs pg_cron and pg_net and has no Vault. The function
-- checks `to_regclass('vault.decrypted_secrets')` before reading it and
-- reports `no_vault`, so the suite can exercise both gates without a token or
-- a network. Everything here is `if not exists` / `or replace` / unschedule-
-- then-schedule, like 0044, so it re-applies cleanly.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The gate runs without a `sport` predicate (both leagues share one loop), and
-- 0044's index leads on sport. A (status, start_ts) index keeps a two-minute
-- tick at a handful of index probes.
create index if not exists games_status_start
  on public.games (status, start_ts);

-- One row, rewritten on every tick: what the launcher last decided and when.
-- The thing /admin reads to answer "is the launcher alive and what does it
-- think" without paging through cron.job_run_details.
create table if not exists public.loop_launcher_state (
  id                  boolean primary key default true check (id),
  checked_at          timestamptz not null default now(),
  result              text not null,
  reason              text,
  last_dispatched_at  timestamptz
);

comment on table public.loop_launcher_state is
  'Single row: the live-loop launcher''s last decision (LIVE-10). result is idle | polling | pending | no_vault | no_token | dispatched.';

-- One row per dispatch, with the pg_net request id so the reply can be found
-- in net._http_response while it is still retained.
create table if not exists public.loop_launches (
  id            bigserial primary key,
  requested_at  timestamptz not null default now(),
  reason        text not null,
  request_id    bigint
);

comment on table public.loop_launches is
  'Every workflow dispatch the database issued for scoreboard-loop (LIVE-10), and why.';

-- Deny-all, like live_heartbeat and api_call_log: RLS on, no policies, no
-- grants to the API roles. Only the service key and the jobs read these.
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

-- Only the scheduler and the service key may call this; it holds a token.
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
