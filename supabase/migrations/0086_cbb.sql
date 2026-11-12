
-- ---------------------------------------------------------------------------
-- Keep basketball out of the football loop's launcher
--
-- `launch_live_loop_if_needed` (0084) asks "is any game live or about to be?"
-- with no sport in the question, because when it was written every game was
-- football. With basketball rows in the table it would answer yes on most
-- evenings from November to April and dispatch `scoreboard-loop` — which
-- polls CFB and the NFL, finds both idle, and exits without a heartbeat. So
-- the launcher would see no beat and dispatch again ten minutes later, all
-- night, every night: ~6 pointless Actions runs an hour for five months.
--
-- Basketball's live writer is the edge function above and needs no runner.
-- The body is 0084's, verbatim, with `sport <> 'cbb'` added to the three
-- existence checks and nothing else changed.
-- ---------------------------------------------------------------------------

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
  --    Football only: basketball has its own writer (0086).
  select case
    when exists (select 1 from games where status = 'in_progress' and sport <> 'cbb') then 'live'
    when exists (
      select 1 from games
      where status = 'scheduled'
        and sport <> 'cbb'
        and start_ts >= now() - interval '4 hours'
        and start_ts <= now()
    ) then 'kicked'
    when exists (
      select 1 from games
      where status = 'scheduled'
        and sport <> 'cbb'
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

-- ---------------------------------------------------------------------------
-- Settle a basketball bet when its game ends, without a standing runner
--
-- Football grades at the final because the Actions loop is already running
-- and sees the game finish (GRADE-1). Basketball has no loop. The scheduled
-- `cbb-grade` run each morning is the backstop, but "your bet settles
-- tomorrow" is the experience GRADE-1 was written to end.
--
-- So the database asks the one question that matters — is a FINISHED
-- basketball game carrying an OPEN bet? — every five minutes, and dispatches
-- the grader only when the answer is yes. Most nights nobody has a bet on
-- most games and this never fires; when someone does, it settles within
-- about six minutes of the horn at the cost of one short run.
--
-- Bounded three ways, because a bet the grader cannot settle (a first-half
-- bet on a game with no line score, a type it grades by hand) would otherwise
-- re-fire forever:
--   * only bet types the grader settles on its own;
--   * only games that tipped in the last 10 hours — after that it is the
--     morning backstop's;
--   * at most one dispatch per 10 minutes and six per 6 hours.
-- Dead games count too: a postponement voids the bets on it (League Rule #4).
--
-- Dispatches are logged to `loop_launches` with reason 'cbb-grade', which is
-- also where the throttle reads from, so there is no second state table.
-- Inert without the `github_actions_dispatch` Vault secret, as 0084 is.
-- ---------------------------------------------------------------------------

create or replace function public.launch_cbb_grade_if_needed()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due         boolean;
  v_last        timestamptz;
  v_recent      integer;
  v_token       text;
  v_request_id  bigint;
begin
  select exists (
    select 1
    from bets b
    join games g on g.id = b.game_id
    where g.sport = 'cbb'
      and g.status in ('final', 'postponed', 'canceled')
      and g.start_ts > now() - interval '10 hours'
      and b.result is null
      and b.voided_at is null
      and b.side is not null
      and b.bet_type in ('spread', 'total', 'moneyline', 'team_total', 'first_half')
  ) into v_due;
  if not v_due then
    return 'idle';
  end if;

  select max(requested_at), count(*) filter (where requested_at > now() - interval '6 hours')
    into v_last, v_recent
  from loop_launches
  where reason = 'cbb-grade';
  if v_last is not null and v_last > now() - interval '10 minutes' then
    return 'pending';
  end if;
  if v_recent >= 6 then
    return 'capped';
  end if;

  if to_regclass('vault.decrypted_secrets') is null then
    return 'no_vault';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
    into v_token using 'github_actions_dispatch';
  if v_token is null or v_token = '' then
    return 'no_token';
  end if;

  select net.http_post(
    url := 'https://api.github.com/repos/chasevandiver/CFBGameday/actions/workflows/jobs.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'Content-Type', 'application/json',
      'User-Agent', 'the-cfb-slate cbb-grade-launcher'
    ),
    body := '{"ref":"main","inputs":{"task":"cbb-grade"}}'::jsonb,
    timeout_milliseconds := 10000
  ) into v_request_id;
  insert into loop_launches (reason, request_id) values ('cbb-grade', v_request_id);
  return 'dispatched';
end;
$$;

comment on function public.launch_cbb_grade_if_needed() is
  'CBB-5. If a finished or dead basketball game carries an open, gradeable bet, dispatch jobs.yml with task=cbb-grade via pg_net. Throttled to one per 10 minutes and six per 6 hours. Inert without the github_actions_dispatch Vault secret.';

revoke execute on function public.launch_cbb_grade_if_needed() from public, anon, authenticated;

do $unschedule$
begin
  perform cron.unschedule('cbb-grade-launcher-5m');
exception when others then
  null; -- first run
end
$unschedule$;

select cron.schedule(
  'cbb-grade-launcher-5m',
  '*/5 * * * *',
  $cmd$ select public.launch_cbb_grade_if_needed(); $cmd$
);
