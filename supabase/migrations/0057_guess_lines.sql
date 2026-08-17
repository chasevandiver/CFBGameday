-- R2-C1 — Guess the Lines: the Tuesday ritual.
--
-- Before the week's lines post, everyone submits their own spread for a
-- selected set of marquee games; once the books hang a number, the guesses
-- grade against the OPENING line and a season-long "sharpest eye" board
-- ranks mean absolute error. Free-to-play, scored in points of error — no
-- units, no stakes (BRAND §16).
--
-- ## The integrity rule, and where it is enforced
--
-- The entire game is "you guessed before you saw a number", so the RPC
-- refuses a guess THE MOMENT any line_snapshot exists for the game — not at
-- some scheduled lock time. The selection job enforces the same rule from
-- the other side: a game that already has a snapshot is never selected. The
-- race between the Monday selection and the 12:00 UTC lines refresh is
-- therefore harmless in one direction (a game selected minutes before its
-- first snapshot just closes early) and unrepresentable in the other (a
-- guess after the snapshot is refused by the RPC, whatever the job did).
--
-- ## Visibility
--
-- Mirrors hidden picks (0023): your own guesses always; others' only once
-- the game's line has posted (the snapshot IS the reveal — after it, a
-- copied guess can no longer beat the market it copied) or the guess is
-- graded. Same definer-fn shape as picks_revealed.
--
-- Apply-vs-deploy order is free: new tables, RPC-only writes, nothing in the
-- running code reads them.

create table public.guess_line_slates (
  season_id   integer not null references public.seasons(id),
  week        integer not null,
  game_id     integer not null references public.games(id),
  created_at  timestamptz not null default now(),
  primary key (season_id, week, game_id)
);

alter table public.guess_line_slates enable row level security;
-- The slate itself is public knowledge (which games are guessable).
create policy "read guess slates" on public.guess_line_slates
  for select to authenticated, anon using (true);
-- Written only by the selection job (service role).
revoke insert, update, delete, truncate on public.guess_line_slates
  from public, anon, authenticated;

create table public.line_guesses (
  user_id     uuid not null references auth.users(id) on delete cascade,
  game_id     integer not null references public.games(id),
  season_id   integer not null,
  week        integer not null,
  -- Home-perspective spread, half-point increments (enforced in the RPC —
  -- a check constraint on numeric % 0.5 is legal but the RPC gives a
  -- readable error).
  guess       numeric(4,1) not null,
  created_at  timestamptz not null default now(),
  -- Written by the grading job (service role) once the opening line exists.
  abs_error   numeric,
  graded_at   timestamptz,
  primary key (user_id, game_id)
);

alter table public.line_guesses enable row level security;

create or replace function public.line_guesses_revealed(p_game integer)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from line_snapshots ls where ls.game_id = p_game)
      or exists (select 1 from line_guesses lg
                  where lg.game_id = p_game and lg.graded_at is not null);
$$;
grant execute on function public.line_guesses_revealed(integer) to authenticated, anon;

create policy "read own line guesses" on public.line_guesses
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "read others line guesses when revealed" on public.line_guesses
  for select to authenticated
  using (user_id <> (select auth.uid()) and public.line_guesses_revealed(game_id));

create policy "anon read revealed line guesses" on public.line_guesses
  for select to anon
  using (public.line_guesses_revealed(game_id));

revoke insert, update, delete, truncate on public.line_guesses
  from public, anon, authenticated;

-- The only write path a member has. Upsert until the line posts — changing
-- your mind before there is a number is part of the game.
create or replace function public.make_line_guess(p_game integer, p_guess numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
  v_slate record;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  select season_id, week into v_slate
    from guess_line_slates where game_id = p_game;
  if v_slate is null then
    raise exception 'game is not on this week''s guess slate';
  end if;
  if p_guess is null or p_guess <> round(p_guess * 2) / 2 or abs(p_guess) > 60 then
    raise exception 'guess must be a half-point spread between -60 and 60';
  end if;
  if exists (select 1 from line_snapshots ls where ls.game_id = p_game) then
    raise exception 'the line has posted — guessing is closed for this game';
  end if;
  if exists (select 1 from line_guesses lg
              where lg.user_id = uid and lg.game_id = p_game
                and lg.graded_at is not null) then
    raise exception 'this guess is already graded';
  end if;
  insert into line_guesses (user_id, game_id, season_id, week, guess)
  values (uid, p_game, v_slate.season_id, v_slate.week, p_guess)
  on conflict (user_id, game_id) do update set guess = excluded.guess;
end;
$$;

revoke execute on function public.make_line_guess(integer, numeric) from public, anon;
grant  execute on function public.make_line_guess(integer, numeric) to authenticated;
