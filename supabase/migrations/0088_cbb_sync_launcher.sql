-- The basketball import, launched by the database (CBB-20).
--
-- 2026-11-13: no college basketball lines on the slate at 1:30pm Eastern.
-- The cbbmodel feed had published the day's picks at 6:41am. `cbb-sync` is
-- what imports them, and it ran on GitHub's schedule: nine cron slots a day
-- (jobs.yml). The last one to fire before the owner noticed had run at
-- 5:06am — itself the 8:20pm slot, nine hours late — and the 7:25am, 9:25am,
-- 11:20am and 1:20pm slots had not fired at all. Nothing failed. Nothing was
-- red. The scheduler was simply hours behind, which is the same fault LIVE-10
-- (0084) was written for on the live football loop.
--
-- So the same answer: pg_cron asks, on the hour, whether basketball is in
-- season, and dispatches `cbb-sync` through the workflow-dispatch API with
-- the Vault token the loop launcher already uses. A dispatched run starts in
-- seconds; a scheduled one starts when GitHub gets to it.
--
-- GitHub's cron slots stay in jobs.yml as the second path. The import is
-- idempotent and appends only what changed, so the two overlapping costs
-- nothing, and the throttle below keeps a database dispatch from stacking on
-- one that just ran.
--
-- In season means a basketball game inside the last day or the next three.
-- The sync keeps the schedule a week ahead, so from November to April that is
-- always true, and from April to November it never is — no calendar to
-- maintain, and an idle summer costs one indexed read an hour. (The first
-- sync of a season is by hand, with `cbb-sync-reference`; this cannot launch
-- into an empty table and should not.)
--
-- Hourly at :12 from 11:00 to 04:00 UTC — 6am to 11pm Eastern, which covers
-- the feed's morning run and every one of its line snapshots through the
-- last West Coast tip. Dispatches are logged to `loop_launches` with reason
-- 'cbb-sync'. Inert without the `github_actions_dispatch` Vault secret.

create or replace function public.launch_cbb_sync_if_needed()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last        timestamptz;
  v_token       text;
  v_request_id  bigint;
begin
  if not exists (
    select 1 from games
    where sport = 'cbb'
      and start_ts > now() - interval '1 day'
      and start_ts < now() + interval '3 days'
  ) then
    return 'idle';
  end if;

  -- One an hour is the design; 45 minutes is the floor, so a manual dispatch
  -- or a second scheduler tick cannot double it.
  select max(requested_at) into v_last from loop_launches where reason = 'cbb-sync';
  if v_last is not null and v_last > now() - interval '45 minutes' then
    return 'pending';
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
      'User-Agent', 'the-cfb-slate cbb-sync-launcher'
    ),
    body := '{"ref":"main","inputs":{"task":"cbb-sync"}}'::jsonb,
    timeout_milliseconds := 10000
  ) into v_request_id;
  insert into loop_launches (reason, request_id) values ('cbb-sync', v_request_id);
  return 'dispatched';
end;
$$;

comment on function public.launch_cbb_sync_if_needed() is
  'CBB-20. While basketball is in season, dispatch jobs.yml with task=cbb-sync via pg_net, at most once per 45 minutes. Exists because GitHub''s own cron ran the import hours late. Inert without the github_actions_dispatch Vault secret.';

revoke execute on function public.launch_cbb_sync_if_needed() from public, anon, authenticated;

do $unschedule$
begin
  perform cron.unschedule('cbb-sync-launcher-hourly');
exception when others then
  null; -- first run
end
$unschedule$;

select cron.schedule(
  'cbb-sync-launcher-hourly',
  '12 0-4,11-23 * * *',
  $cmd$ select public.launch_cbb_sync_if_needed(); $cmd$
);
