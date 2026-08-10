-- Query diet, round two (audit 09/P-3, P-4).
--
-- Two more whole-history tables were being shipped on every slate fetch and
-- reduced in JS to "the latest row":
--   * system_ratings: every synced week × 3 systems × the slate's teams —
--     ~5,000 rows per poll tick by week 14, reduced to ~120.
--   * poll_rankings: every week of every poll, reduced to the newest week.
-- Same medicine as line_consensus/latest_ratings in 0015: push the
-- reduction into Postgres, ship only what renders.

create or replace view public.latest_systems
with (security_invoker = true) as
select distinct on (season_id, system, team_id)
  season_id, system, team_id, week, value
from public.system_ratings
order by season_id, system, team_id, week desc;

-- Latest week per (season, season_type, poll): pickPollRanks still gets every
-- poll (it prefers CFP > AP > Coaches) but only one week of each.
create or replace view public.latest_poll_rankings
with (security_invoker = true) as
select p.season_id, p.season_type, p.week, p.poll, p.team_id, p.rank
from public.poll_rankings p
join (
  select season_id, season_type, poll, max(week) as week
  from public.poll_rankings
  group by season_id, season_type, poll
) latest using (season_id, season_type, poll, week);

grant select on public.latest_systems to anon, authenticated;
grant select on public.latest_poll_rankings to anon, authenticated;
