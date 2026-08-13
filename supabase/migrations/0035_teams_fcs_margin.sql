-- Which FCS opponents are the good ones (SPEC §2.1, P1-2).
--
-- The two-bucket FCS rule is specced and has never been built; the code runs a
-- flat −30. The bucket is an FCS team's own average margin against FBS over
-- prior seasons (src/model/fcs.ts), and production cannot compute that at
-- runtime: `games` holds the current season only, so there is no prior-season
-- margin history in this database and loading three seasons of it would be a
-- far bigger change than the feature.
--
-- So the number is computed where the history already is — build-preseason.ts
-- has 2023–25 in memory — and materialised here. `jobs-core` reads it back and
-- splits at the median, using the same `fcsTopIds` the backtest uses, so the
-- fitted rule and the served rule cannot diverge.
--
-- Nullable with no default, and that is load-bearing: while it is null
-- everywhere, `fcsTopIds` returns an empty set and every FCS opponent prices at
-- `fcsOtherRating`, which is today's flat −30. If `preseason-refresh` never
-- goes green before Aug 29 the column simply stays empty and nothing changes.
--
-- Not written by sync-reference.ts: its upsert payload omits this column, and
-- PostgREST's generated ON CONFLICT DO UPDATE only sets columns present in the
-- body, so a reference sync cannot clobber it.
--
-- No RLS change. `teams` already has select for authenticated and anon (0001,
-- 0011) and no write policy at all — it is service-role-write like the rest of
-- the reference data.

alter table public.teams
  add column fcs_avg_margin numeric(5, 2);

comment on column public.teams.fcs_avg_margin is
  'Mean margin vs FBS opponents over the seasons before the current one, for '
  'non-FBS teams only. Written by scripts/build-preseason.ts via '
  'src/model/fcs.ts; read by freezeJob and ratingsUpdateJob to pick the FCS '
  'bucket. Null for every FBS team and for any FCS team with too few games.';
