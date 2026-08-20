-- FUN-10 — crowd signs: one posterboard sign per member per week, rendered
-- above the Saturday slate for anyone running Fun Mode. The pit behind the
-- GameDay desk, crew-sized.
--
-- ## This is deliberately a free-text surface, and deliberately a small one
--
-- The social layer's standing rule is "reactions, not a chat room" (0061,
-- ROADMAP §14), and this does not reopen that: one row per (season, week,
-- member), 80 characters, upserted in place — an artifact you compose, not a
-- thread you answer. The conversation stays in the group chat; the wall gets
-- one line of posterboard each. The site is invite-only (allowlist + RLS),
-- so the audience of a sign is the same handful of friends who can already
-- read your picks.
--
-- ## Visibility
--
-- SELECT is `authenticated` only — no anon policy, unlike games/cover_flips.
-- Signs are people talking, not sports data; a signed-out visitor browsing
-- the public slate has no business on the wall. Writes are own-row only.
--
-- Apply-vs-deploy order is free: new table, nothing running reads it, and
-- the reading component renders nothing when the select comes back empty or
-- erroring (the rating_drops posture).

create table public.crowd_signs (
  id          bigint generated always as identity primary key,
  season_id   integer not null references public.seasons(id),
  week        integer not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 80),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (season_id, week, user_id)
);

create index crowd_signs_week_idx on public.crowd_signs (season_id, week);

alter table public.crowd_signs enable row level security;

create policy "signs are crew-visible" on public.crowd_signs
  for select to authenticated using (true);

create policy "write own sign" on public.crowd_signs
  for insert to authenticated with check (auth.uid() = user_id);

create policy "update own sign" on public.crowd_signs
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "delete own sign" on public.crowd_signs
  for delete to authenticated using (auth.uid() = user_id);
