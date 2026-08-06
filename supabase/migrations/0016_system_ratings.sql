-- SP+ / FPI / Elo, stored weekly (audit #28): the consensus flag (spec §2.4)
-- compares the model against these systems, and the spec promises them
-- "side by side on every game card" — but they were fetched only during the
-- preseason build and never persisted or displayed. One row per system per
-- team per week; the weekly sync job appends, nothing overwrites history.

create table if not exists public.system_ratings (
  season_id   integer not null references public.seasons(id),
  team_id     integer not null references public.teams(id),
  system      text not null check (system in ('sp', 'fpi', 'elo')),
  week        integer not null,
  value       numeric(8, 2) not null,
  fetched_at  timestamptz not null default now(),
  primary key (season_id, system, week, team_id)
);

alter table public.system_ratings enable row level security;
create policy "read system ratings" on public.system_ratings
  for select to authenticated using (true);
create policy "anon read system ratings" on public.system_ratings
  for select to anon using (true);
