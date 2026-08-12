-- 0029 — Split Week 0 out of the rows CFBD already merged into Week 1.
--
-- `scripts/lib/weeks.ts` owns this rule from now on: `sync-games` applies it at
-- ingest, every day, for every season. This migration is the one-time catch-up
-- for the 99 rows that were stored before the rule existed, so the site is
-- correct now rather than after the next 09:00 UTC sync.
--
-- Why Week 0 is not cosmetic: every surface keys on `week` — the slate selector,
-- group boards, the freeze, receipts, recap. Merged, CFBD's 2026 "week 1" is 99
-- games over ten days and two Saturdays, which puts the Sep 5 Georgia opener on
-- the same slate as games played the previous weekend, gives that slate seven
-- day-tabs, and asks a single Thursday freeze to price both weekends.
--
-- The rule, identical to the TypeScript, and derived rather than dated:
--   * regular-season week 1 only
--   * only when the kickoffs span more than 8 days (a normal week is ~6)
--   * split at the largest gap between consecutive kickoffs, and only if that
--     gap is at least 2 days — two Saturdays have a real hole between them
--   * everything before the seam becomes week 0
-- For 2026 the seam is a 4.83-day hole ending at the Sep 3 22:00 kickoff, so
-- eight games (seven on Aug 29, one on Aug 30) move to week 0 and 91 stay.
--
-- Idempotent: after this runs, week 1's span is ~4 days, rule 2 fails, and a
-- re-run moves nothing.
--
-- NOTE for the owner: the one existing `group_week_config` row is (2026, week 1,
-- regular). It keeps week 1 — now the Sep 3–7 slate — which is almost certainly
-- what was meant. A Week 0 board is a separate, deliberate act.

do $$
declare
  n_moved int;
  seam timestamptz;
  span_days numeric;
begin
  select extract(epoch from (max(start_ts) - min(start_ts))) / 86400 into span_days
  from public.games
  where season_id = 2026 and week = 1 and season_type = 'regular' and start_ts is not null;

  if span_days is null or span_days <= 8 then
    raise notice '0029: week 1 spans %s days — nothing to split (already applied, or never merged)', round(coalesce(span_days, 0), 2);
    return;
  end if;

  -- The start of the game that opens the later cluster: the kickoff preceded by
  -- the largest gap, provided that gap is a real hole.
  with wk1 as (
    select start_ts, lag(start_ts) over (order by start_ts) prev
    from public.games
    where season_id = 2026 and week = 1 and season_type = 'regular' and start_ts is not null
  )
  select start_ts into seam
  from wk1
  where prev is not null and extract(epoch from (start_ts - prev)) / 86400 >= 2
  order by (start_ts - prev) desc
  limit 1;

  if seam is null then
    raise notice '0029: week 1 is long but has no clean seam — leaving it alone rather than guessing';
    return;
  end if;

  update public.games
  set week = 0
  where season_id = 2026 and week = 1 and season_type = 'regular'
    and start_ts is not null and start_ts < seam;

  get diagnostics n_moved = row_count;
  raise notice '0029: seam at %; moved % games into week 0', seam, n_moved;
end $$;
