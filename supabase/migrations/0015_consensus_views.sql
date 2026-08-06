-- Query diet for the slate hot path (audit §8, performance).
--
-- fetchSlateView used to pull every line_snapshots row for every game of the
-- week — with the pre-kickoff burst poller writing every 10 minutes across
-- multiple books, a 60-game Saturday accumulates tens of thousands of rows,
-- all shipped out of Postgres on every page load and every 30-second client
-- poll, only to be reduced to one consensus number per game.
--
-- These views push the reduction into the database:
--   * line_consensus: one row per game — latest snapshot per provider,
--     averaged and snapped to the half point (mirrors consensusFromSnapshots
--     in src/lib/queries.ts; keep the two in sync).
--   * latest_ratings: newest ratings row per (season, team) — replaces
--     fetching every week of every team to find the latest.
--
-- security_invoker so RLS on the underlying tables applies to the querier
-- (both tables are public-read since 0011).

create or replace view public.line_consensus
with (security_invoker = true) as
select
  t.game_id,
  round(avg(t.spread) * 2) / 2                            as spread,
  round(avg(coalesce(t.spread_open, t.spread)) * 2) / 2   as spread_open,
  round(avg(t.total) * 2) / 2                             as total,
  round(avg(coalesce(t.total_open, t.total)) * 2) / 2     as total_open,
  round(avg(t.ml_home))                                   as ml_home,
  round(avg(t.ml_away))                                   as ml_away
from (
  select distinct on (game_id, provider)
    game_id, provider, spread, spread_open, total, total_open, ml_home, ml_away
  from public.line_snapshots
  order by game_id, provider, captured_at desc
) t
group by t.game_id;

create or replace view public.latest_ratings
with (security_invoker = true) as
select distinct on (season_id, team_id)
  season_id, team_id, week, overall, offense, defense, model_version
from public.ratings
order by season_id, team_id, week desc;

grant select on public.line_consensus to anon, authenticated;
grant select on public.latest_ratings to anon, authenticated;

-- History reads filter by recency; support the (game_id, captured_at) path.
create index if not exists line_snapshots_game_captured
  on public.line_snapshots (game_id, captured_at desc);
