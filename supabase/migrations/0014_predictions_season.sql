-- predictions.season_id (audit bug #7): the Receipts page fetched every frozen
-- prediction ever made, across seasons, and grouped by week — season 2026's
-- Week 1 and season 2027's Week 1 would merge. Predictions now carry season_id
-- directly (spec §8: "season_id on every table from day one"); the freeze job
-- writes it and Receipts filters on it.

alter table public.predictions
  add column if not exists season_id integer references public.seasons(id);

update public.predictions p
  set season_id = g.season_id
  from public.games g
  where g.id = p.game_id and p.season_id is null;

create index if not exists predictions_season
  on public.predictions (season_id, frozen, created_at desc);
