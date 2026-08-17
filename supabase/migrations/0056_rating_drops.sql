-- R2-B2 — The Tuesday Drop: the weekly ratings update as a named event.
--
-- The SP+-vs-Sagarin lesson (docs/ROADMAP.md §13): same-quality math, but the
-- one that lands on a fixed day with a voice that argues back is the one that
-- gets checked. The numbers already exist (`ratings`, `poll_rankings`); this
-- table stores the one LLM-written paragraph that defends the week's most
-- controversial model position, produced by scripts/generate-drop.ts on the
-- Monday after the Sunday ratings-update.
--
-- Same posture as 0005's LLM tables: written only by the service-role
-- producer, the app reads. One row per (season, week) — regenerating
-- overwrites, which is what --force is for.
--
-- Apply-vs-deploy order is free: additive table; the hub and /ratings treat
-- a missing table exactly like a week with no drop yet.

create table public.rating_drops (
  season_id     integer not null references public.seasons(id),
  week          integer not null,
  -- { headline, defense } — the shape zod enforces in the producer.
  content       jsonb not null,
  model         text not null,
  generated_at  timestamptz not null default now(),
  primary key (season_id, week)
);

alter table public.rating_drops enable row level security;

create policy "read drops" on public.rating_drops
  for select to authenticated using (true);
-- The signed-out hub renders the Tuesday block too (0011's posture: the site
-- reads public).
create policy "anon read drops" on public.rating_drops
  for select to anon using (true);

revoke insert, update, delete, truncate on public.rating_drops
  from public, anon, authenticated;
