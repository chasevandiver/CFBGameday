-- Ops observability (audit 07): when a job dies at 2am on a Saturday, how do
-- we find out? Two pieces:
--
--   * job_runs — one row per scheduled-job run, written by the jobs
--     themselves through the service role. The admin page renders a
--     freshness card from it, which is the absence check no error email can
--     provide: an error alerts when a run fails, this alerts when a run
--     never happened.
--   * line_consensus.as_of — the newest snapshot feeding each game's
--     consensus, so every surface showing a line can say when that line was
--     captured. With the minimal line cadence (2x daily + close passes),
--     staleness is by design — so it has to be on screen, not implied.

create table public.job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  -- the job's own summary JSON, e.g. {"live_or_final": 12, "updated": 3}
  detail jsonb,
  error text
);

-- The freshness card asks "latest run per job"; this is that path.
create index job_runs_job_started_idx on public.job_runs (job, started_at desc);

-- Deny-all, like api_call_log: written by the service role, read by the
-- admin page through the service client behind the is_admin gate. No
-- policies on purpose — there is nothing here for authenticated or anon.
alter table public.job_runs enable row level security;
revoke all on public.job_runs from authenticated, anon;

-- Recreate with as_of appended (replace-view may only add columns at the
-- end). Same reduction as before; the inner select just carries captured_at
-- so the newest contributing snapshot's timestamp survives the group-by.
create or replace view public.line_consensus
with (security_invoker = true) as
select
  t.game_id,
  round(avg(t.spread) * 2) / 2                            as spread,
  round(avg(coalesce(t.spread_open, t.spread)) * 2) / 2   as spread_open,
  round(avg(t.total) * 2) / 2                             as total,
  round(avg(coalesce(t.total_open, t.total)) * 2) / 2     as total_open,
  round(avg(t.ml_home))                                   as ml_home,
  round(avg(t.ml_away))                                   as ml_away,
  max(t.captured_at)                                      as as_of
from (
  select distinct on (game_id, provider)
    game_id, provider, spread, spread_open, total, total_open, ml_home, ml_away, captured_at
  from public.line_snapshots
  order by game_id, provider, captured_at desc
) t
group by t.game_id;
