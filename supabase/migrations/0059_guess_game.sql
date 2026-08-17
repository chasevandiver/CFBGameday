-- R2-C3 — Guess the Game: the daily puzzle.
--
-- One historical game per day (the 2023–25 backfill is the deck), same
-- puzzle for everyone by construction: selection is a deterministic
-- rendezvous hash over the candidate set, computed in code
-- (src/lib/guess-game.ts) — no job, no stored schedule, and stable when the
-- candidate set grows.
--
-- ## Why the play surface is a route, not a page prop
--
-- The answer must be server-authoritative: a page that ships the answer for
-- client-side checking is spoiled by view-source. /api/guess-game returns
-- ONLY the hints your attempt count has earned; the verdict happens
-- server-side on POST. This table therefore stores just each user's own
-- attempt state — the answer never lands in it.
--
-- Row shape: guesses is a jsonb array of {name, verdict} written only by the
-- route (service role); attempts and solved_at are its bookkeeping. Own-row
-- select only — another member's guess contents would spoil their morning,
-- and rarity scoring reads through the definer fn below instead.
--
-- Apply-vs-deploy order is free: new table, nothing in the running code
-- reads it.

create table public.gtg_guesses (
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  guesses    jsonb not null default '[]',
  attempts   integer not null default 0 check (attempts >= 0 and attempts <= 6),
  solved_at  timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.gtg_guesses enable row level security;

create policy "read own gtg" on public.gtg_guesses
  for select to authenticated
  using (user_id = (select auth.uid()));

-- All writes through the route handler (service role): verdict logic needs
-- game-data joins that don't belong in SQL.
revoke insert, update, delete, truncate on public.gtg_guesses
  from public, anon, authenticated;

-- The leaderboard without the spoilers: solved days and points (7 − attempts
-- on a solve; an unsolved day scores 0), never the guess contents.
create or replace function public.gtg_leaderboard()
returns table (user_id uuid, solved integer, points integer, played integer)
language sql
security definer
stable
set search_path = ''
as $$
  select g.user_id,
         count(*) filter (where g.solved_at is not null)::integer,
         coalesce(sum(7 - g.attempts) filter (where g.solved_at is not null), 0)::integer,
         count(*)::integer
  from public.gtg_guesses g
  group by g.user_id;
$$;

revoke execute on function public.gtg_leaderboard() from public, anon;
grant  execute on function public.gtg_leaderboard() to authenticated;
