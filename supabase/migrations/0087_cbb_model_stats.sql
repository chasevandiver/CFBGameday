-- The college basketball model's own record, one row per season (CBB-16).
--
-- Owner request 2026-11-12: the CBB model's stats for the season and for
-- yesterday on the slate and on a page of their own, and on each card the hit
-- rate for whatever tier that game qualifies as.
--
-- The model is graded in the cbbmodel repo, by its own rule, against its own
-- pick-time line. This table stores what that repo's feed reports — the
-- season summary and the last fortnight by day — reduced by
-- `src/lib/cbb-model-stats.ts` and written by `cbb-sync-feed`. It is NOT
-- derived from `predictions` here: a second grading would disagree with the
-- model's own dashboard by a game or two for reasons nobody could explain.
--
-- One jsonb per season rather than columns: it is read and written whole, and
-- the breakdowns inside it (by confidence tier, by edge bucket, by day) are
-- the feed's to add to.
--
-- World-readable like `games` and `predictions` (0011): the site is public to
-- browse and this is the model's scoreboard. Writes are the service role's
-- alone — no insert/update/delete policy exists for the API roles.

create table if not exists public.cbb_model_stats (
  season_id   integer primary key references public.seasons(id),
  payload     jsonb not null,
  updated_at  timestamptz not null default now()
);

comment on table public.cbb_model_stats is
  'CBB-16. The cbbmodel feed''s own season record, per-tier hit rates and last 14 days, one row per season. Written by cbb-sync-feed; see src/lib/cbb-model-stats.ts CbbModelStats.';

alter table public.cbb_model_stats enable row level security;

drop policy if exists cbb_model_stats_read on public.cbb_model_stats;
create policy cbb_model_stats_read on public.cbb_model_stats
  for select to anon, authenticated using (true);

revoke all on public.cbb_model_stats from anon, authenticated;
grant select on public.cbb_model_stats to anon, authenticated;
