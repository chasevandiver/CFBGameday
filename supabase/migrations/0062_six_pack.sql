-- R3-E2 — the Six-Pack: six questions on the week, free to play.
--
-- **0060 was deliberately never created.** The planned `group_game_splits`
-- definer function was rejected during the R2-D1 build (splits computable
-- under RLS are exactly the splits the design permits), and 0061 took the
-- next number. The gap is a recorded rejection, not a lost file.
--
-- ## The closure rule
--
-- Every question settles exclusively from the slate's own games. No
-- league-wide scans, so the grader's read set is the six games the slate
-- names and no question can wait forever on data that never arrives. The
-- kinds and their settlement live in `src/lib/six-pack.ts`; this schema only
-- has to store them and keep the writes honest.
--
-- ## What is NOT stored, and why
--
--   * **No `locks_at`.** The lock is `min(start_ts)` over the slate's own
--     games, computed live in the RPC below and on the page. A stored lock is
--     the thing a rescheduled kickoff contradicts — the same reason survivor
--     elimination and the streak are both derived.
--   * **No `group_id`.** The roster is the scope (R3-E1): one entry per
--     person, ranked inside every pool they're in. `betting-groups.ts`
--     settled this argument for `bets`.
--   * **No rollover counter.** "Nobody has cleared it in four weeks" is a
--     fold over graded slates, so a re-grade moves it.
--
-- ## Writes
--
-- Slates and questions are written by the `six-pack` job (service role).
-- Members write only through `submit_six_pack`, which takes all six answers
-- at once — a partial entry is not an entry, and six separate inserts would
-- let one fail and leave a half-answered week.
--
-- Apply-vs-deploy order: apply this FIRST. The R3-E2 page selects
-- `six_pack_questions`, so deploying it against a database without this
-- migration fails the read loudly.

create table public.six_pack_slates (
  id          bigint generated always as identity primary key,
  season_id   integer not null references public.seasons(id),
  season_type text    not null default 'regular',
  week        integer not null,
  created_at  timestamptz not null default now(),
  -- One slate a week, which is what makes generation idempotent: a re-run
  -- finds the row rather than minting a second set of questions.
  unique (season_id, season_type, week)
);

create table public.six_pack_questions (
  slate_id  bigint   not null references public.six_pack_slates(id) on delete cascade,
  idx       smallint not null check (idx between 1 and 6),
  kind      text     not null
            check (kind in ('winner', 'cover', 'total', 'margin', 'high_game')),
  -- Null only for slate-wide kinds (high_game), whose candidates are its
  -- own `choices`. Every other kind names exactly one game.
  game_id   integer  references public.games(id),
  -- The number the question was ASKED at, frozen at generation. A spread that
  -- moves on Thursday must not re-word a question answered on Tuesday.
  line      numeric(5,1),
  choices   text[]   not null check (array_length(choices, 1) between 2 and 6),
  -- Written by the grading job. 'void' means it can never settle.
  answer     text,
  graded_at  timestamptz,
  primary key (slate_id, idx)
);

create table public.six_pack_entries (
  user_id    uuid     not null references auth.users(id) on delete cascade,
  slate_id   bigint   not null,
  idx        smallint not null,
  choice     text     not null,
  created_at timestamptz not null default now(),
  result     text check (result in ('correct', 'wrong', 'void')),
  primary key (user_id, slate_id, idx),
  foreign key (slate_id, idx) references public.six_pack_questions(slate_id, idx)
    on delete cascade
);

create index six_pack_entries_slate on public.six_pack_entries (slate_id);
create index six_pack_questions_game on public.six_pack_questions (game_id);

alter table public.six_pack_slates    enable row level security;
alter table public.six_pack_questions enable row level security;
alter table public.six_pack_entries   enable row level security;

-- The questions are public knowledge, like guess_line_slates (0057).
create policy "read six pack slates" on public.six_pack_slates
  for select to authenticated, anon using (true);
create policy "read six pack questions" on public.six_pack_questions
  for select to authenticated, anon using (true);

-- Entries reveal at the slate's first kickoff — line_guesses_revealed's shape.
create or replace function public.six_pack_revealed(p_slate bigint)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.six_pack_questions q
    join public.games g on g.id = q.game_id
    where q.slate_id = p_slate and g.start_ts <= now()
  );
$$;
grant execute on function public.six_pack_revealed(bigint) to authenticated, anon;

create policy "read own six pack entries" on public.six_pack_entries
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "read others six pack entries when revealed" on public.six_pack_entries
  for select to authenticated
  using (user_id <> (select auth.uid()) and public.six_pack_revealed(slate_id));

create policy "anon read revealed six pack entries" on public.six_pack_entries
  for select to anon
  using (public.six_pack_revealed(slate_id));

revoke insert, update, delete, truncate on public.six_pack_slates    from public, anon, authenticated;
revoke insert, update, delete, truncate on public.six_pack_questions from public, anon, authenticated;
revoke insert, update, delete, truncate on public.six_pack_entries   from public, anon, authenticated;

-- The only write path a member has. All six or none.
create or replace function public.submit_six_pack(p_slate bigint, p_choices text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  v_questions integer;
  v_games     integer;
  v_locked    boolean;
  v_graded    integer;
  i           integer;
  v_choices   text[];
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select count(*) into v_questions
    from public.six_pack_questions q where q.slate_id = p_slate;
  if v_questions = 0 then
    raise exception 'no six-pack for that week';
  end if;

  if p_choices is null or array_length(p_choices, 1) is distinct from v_questions then
    raise exception 'answer all six — a partial entry is not an entry';
  end if;

  -- Fail closed: a slate with no game-bearing question has nothing to lock
  -- against, and an unlockable market must not accept answers. The generator
  -- guarantees this cannot happen; this is the belt.
  select count(*) into v_games
    from public.six_pack_questions q
    where q.slate_id = p_slate and q.game_id is not null;
  if v_games = 0 then
    raise exception 'this six-pack has nothing to lock against';
  end if;

  -- A TBD kickoff counts as locked, the fail-closed convention picks and
  -- guesses already use.
  select bool_or(g.start_ts is null or g.start_ts <= now()) into v_locked
    from public.six_pack_questions q
    join public.games g on g.id = q.game_id
    where q.slate_id = p_slate;
  if coalesce(v_locked, true) then
    raise exception 'kickoff — the six-pack is locked';
  end if;

  select count(*) into v_graded
    from public.six_pack_questions q
    where q.slate_id = p_slate and q.graded_at is not null;
  if v_graded > 0 then
    raise exception 'this six-pack has already started grading';
  end if;

  -- Every answer must be one the question offered.
  for i in 1 .. v_questions loop
    select q.choices into v_choices
      from public.six_pack_questions q
      where q.slate_id = p_slate and q.idx = i;
    if v_choices is null then
      raise exception 'this six-pack is incomplete — question % is missing', i;
    end if;
    if not (p_choices[i] = any (v_choices)) then
      raise exception 'that is not one of the answers for question %', i;
    end if;
  end loop;

  -- One statement, so all six land or none do.
  insert into public.six_pack_entries (user_id, slate_id, idx, choice)
  select uid, p_slate, gs.i, p_choices[gs.i]
    from generate_series(1, v_questions) as gs(i)
  on conflict (user_id, slate_id, idx) do update set choice = excluded.choice;
end;
$$;

revoke execute on function public.submit_six_pack(bigint, text[]) from public, anon;
grant  execute on function public.submit_six_pack(bigint, text[]) to authenticated;
