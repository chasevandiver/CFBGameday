-- R2-C2 — The Streak: one curated matchup a day, pick a side, protect the
-- run. Free-to-play; the streak is the whole currency (BRAND §16 — no units,
-- no stakes, no "lock" language).
--
-- `streak_days` is written by the daily job (service role): one row per
-- calendar day (the product's day — DEFAULT_TZ — computed by the job, stored
-- as a plain date). No row = no matchup that day, and the page says so;
-- dormancy is a state, not an error.
--
-- The streak itself is DERIVED, never stored: a counter column would be a
-- second source of truth that a re-grade or corrected final contradicts —
-- the same reason survivor elimination is computed (0053). `src/lib/streak.ts`
-- recounts from graded picks on every read.
--
-- Picks lock at the game's kickoff (0038's rule, same clock). A tie,
-- postponement or cancellation grades `void` and passes through the streak
-- unbroken — League Rule #4's spirit: a dead game breaks no run.
--
-- Visibility mirrors hidden picks (0023): your own always, others' after
-- kickoff. Apply-vs-deploy order is free: new tables, RPC-only writes.

create table public.streak_days (
  day         date primary key,
  game_id     integer not null references public.games(id),
  created_at  timestamptz not null default now()
);

alter table public.streak_days enable row level security;
create policy "read streak days" on public.streak_days
  for select to authenticated, anon using (true);
revoke insert, update, delete, truncate on public.streak_days
  from public, anon, authenticated;

create table public.streak_picks (
  user_id     uuid not null references auth.users(id) on delete cascade,
  day         date not null references public.streak_days(day),
  side        text not null check (side in ('home', 'away')),
  created_at  timestamptz not null default now(),
  -- Written by the grading job (service role).
  result      text check (result in ('win', 'loss', 'void')),
  primary key (user_id, day)
);

alter table public.streak_picks enable row level security;

create or replace function public.streak_revealed(p_day date)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  -- A TBD kickoff stays hidden — null <= now() is not true, the safe answer.
  select exists (
    select 1 from streak_days sd
    join games g on g.id = sd.game_id
    where sd.day = p_day and g.start_ts <= now()
  );
$$;
grant execute on function public.streak_revealed(date) to authenticated, anon;

create policy "read own streak picks" on public.streak_picks
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "read others streak picks after kickoff" on public.streak_picks
  for select to authenticated
  using (user_id <> (select auth.uid()) and public.streak_revealed(day));

create policy "anon read revealed streak picks" on public.streak_picks
  for select to anon
  using (public.streak_revealed(day));

revoke insert, update, delete, truncate on public.streak_picks
  from public, anon, authenticated;

create or replace function public.make_streak_pick(p_day date, p_side text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
  v_kick timestamptz;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if p_side not in ('home', 'away') then
    raise exception 'side must be home or away';
  end if;
  select g.start_ts into v_kick
    from streak_days sd join games g on g.id = sd.game_id
    where sd.day = p_day;
  if not found then
    raise exception 'no streak matchup for that day';
  end if;
  -- A selected game should always carry a kickoff; if it somehow doesn't,
  -- refuse rather than run an unlockable market on it.
  if v_kick is null then
    raise exception 'kickoff not set — picking is closed for this matchup';
  end if;
  if v_kick <= now() then
    raise exception 'kickoff — the streak pick is locked';
  end if;
  insert into streak_picks (user_id, day, side)
  values (uid, p_day, p_side)
  on conflict (user_id, day) do update
    set side = excluded.side
    where streak_picks.result is null;
end;
$$;

revoke execute on function public.make_streak_pick(date, text) from public, anon;
grant  execute on function public.make_streak_pick(date, text) to authenticated;
