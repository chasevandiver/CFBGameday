-- DC-1 — Depth Chart: sixteen teams, four hidden groups of four.
--
-- The third replacement for Guess the Game, and the only one of the three with
-- a real hidden answer. The Tape and Chains both name what they are about, so
-- neither can promise secrecy — every fact in them is public, in this database
-- and on the open internet. Here the hidden thing is not a FACT but a
-- GROUPING, and no amount of looking up tells you which four categories
-- today's sixteen tiles were drawn from.
--
-- ## The fairness promise, stated exactly, because someone will test it
--
-- A grid works only if exactly one assignment of tiles to categories is
-- possible. `validateGrid` (src/lib/depth-chart.ts) proves that internally by
-- counting partitions. What it CANNOT prove is that no grouping exists outside
-- the fact index — a player may always notice that four of the sixteen are in
-- Ohio. NYT's Connections has the same hole.
--
-- So the promise is bounded and written down: **no fact stored in `dc_facts`
-- covers exactly four of the sixteen tiles**, beyond the four intended.
-- Anything outside the index is outside the promise. If that turns out to be
-- too weak in practice, the fix is to widen the index, not to weaken the
-- validator.
--
-- ## Facts are MATERIALISED, not evaluated
--
-- `dc_facts` + `dc_fact_teams` hold precomputed memberships rather than
-- predicates evaluated at generation. Two reasons: the validator's "does tile
-- t satisfy category c" becomes a set lookup instead of a re-query, and a
-- materialised fact is AUDITABLE — the owner can read the table and see
-- exactly what the game believes, which is not true of a predicate buried in
-- a job.
--
-- ## Generated ahead, like the other two (GTG-1's lesson)
--
-- Validation is TypeScript, so this one could not be computed on read even if
-- we wanted to. `daily-puzzles` banks a queue and the run fails below the
-- floor, so a generator that starves goes red days before a player sees it.
--
-- ## Apply-vs-deploy order: APPLY FIRST — the page selects `dc_puzzles`.

-- The fact index. Internal: RLS on, NO select policy. The labels ARE the
-- answers — "Lost to Georgia in 2022" next to a team list is the whole game —
-- and the index is also the map of every grouping the validator knows about.
create table public.dc_facts (
  id           bigint generated always as identity primary key,
  kind         text not null,
  label        text not null,
  -- Which season/team/state the fact is about, so a regenerated fact replaces
  -- rather than duplicates its predecessor.
  subject      text not null,
  member_count integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (kind, subject)
);

create table public.dc_fact_teams (
  fact_id bigint  not null references public.dc_facts(id) on delete cascade,
  team_id integer not null references public.teams(id) on delete cascade,
  primary key (fact_id, team_id)
);

alter table public.dc_facts      enable row level security;
alter table public.dc_fact_teams enable row level security;
revoke insert, update, delete, truncate on public.dc_facts      from public, anon, authenticated;
revoke insert, update, delete, truncate on public.dc_fact_teams from public, anon, authenticated;

-- The day's board. Readable once the day has arrived — the same explicit
-- America/Chicago conversion as 0068 and 0069, and for the same reason: the
-- queue holds future rows, `current_date` is the session timezone (UTC on
-- Supabase), and between 00:00 and 06:00 UTC that is already tomorrow in
-- Chicago's terms.
create table public.dc_puzzles (
  day        date primary key,
  traps      smallint not null default 0,
  created_at timestamptz not null default now()
);

alter table public.dc_puzzles enable row level security;
create policy "read dc puzzles once the day has arrived" on public.dc_puzzles
  for select to authenticated, anon
  using (day <= (now() at time zone 'America/Chicago')::date);
revoke insert, update, delete, truncate on public.dc_puzzles
  from public, anon, authenticated;

-- THE ANSWER. A group's label and its membership are the thing being hidden,
-- so this table has RLS on and no select policy — the route reveals a group
-- only once the player has solved it or run out of mistakes.
create table public.dc_puzzle_groups (
  day        date     not null references public.dc_puzzles(day) on delete cascade,
  gidx       smallint not null check (gidx between 0 and 3),
  group_id   text     not null,
  label      text     not null,
  team_ids   integer[] not null check (array_length(team_ids, 1) = 4),
  primary key (day, gidx)
);

alter table public.dc_puzzle_groups enable row level security;
revoke insert, update, delete, truncate on public.dc_puzzle_groups
  from public, anon, authenticated;

-- The sixteen tiles in presentation order. Readable: sixteen school names
-- narrow nothing, and the board has to render before the first guess. The
-- GROUPING is what `dc_puzzle_groups` is protecting, and none of it is here.
create table public.dc_puzzle_tiles (
  day     date     not null references public.dc_puzzles(day) on delete cascade,
  tidx    smallint not null check (tidx between 0 and 15),
  team_id integer  not null references public.teams(id),
  primary key (day, tidx)
);

alter table public.dc_puzzle_tiles enable row level security;
create policy "read dc tiles once the day has arrived" on public.dc_puzzle_tiles
  for select to authenticated, anon
  using (exists (
    select 1 from public.dc_puzzles p
    where p.day = dc_puzzle_tiles.day
      and p.day <= (now() at time zone 'America/Chicago')::date
  ));
revoke insert, update, delete, truncate on public.dc_puzzle_tiles
  from public, anon, authenticated;

create table public.dc_entries (
  user_id      uuid not null references auth.users(id) on delete cascade,
  day          date not null references public.dc_puzzles(day) on delete cascade,
  -- Group ids solved, in the order they fell.
  solved       jsonb not null default '[]',
  mistakes     smallint not null default 0 check (mistakes between 0 and 4),
  guesses      jsonb not null default '[]',
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.dc_entries enable row level security;

create policy "read own dc entries" on public.dc_entries
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete, truncate on public.dc_entries
  from public, anon, authenticated;

-- The board. Points reward finishing and penalise mistakes, so a clean board
-- beats a scrappy one — and, as everywhere else in the arcade, the arithmetic
-- lives in SQL so `arcade.ts` can consume it rather than keep a second copy
-- that drifts.
create or replace function public.dc_leaderboard()
returns table (user_id uuid, played integer, solved integer, clean integer, points integer)
language sql
security definer
stable
set search_path = ''
as $$
  select e.user_id,
         count(*) filter (where e.completed_at is not null)::integer,
         count(*) filter (
           where e.completed_at is not null and jsonb_array_length(e.solved) = 4
         )::integer,
         count(*) filter (
           where e.completed_at is not null
             and jsonb_array_length(e.solved) = 4
             and e.mistakes = 0
         )::integer,
         coalesce(sum(
           case when jsonb_array_length(e.solved) = 4 then 8 - e.mistakes
                else jsonb_array_length(e.solved) end
         ) filter (where e.completed_at is not null), 0)::integer
  from public.dc_entries e
  group by e.user_id;
$$;

revoke execute on function public.dc_leaderboard() from public, anon;
grant  execute on function public.dc_leaderboard() to authenticated;
