-- CHAIN-1 — Chains: a daily run of higher-or-lower over the archive.
--
-- The third answer to the same complaint (owner, 2026-08-18: Guess the Game is
-- "way too random… just trying to randomly guess a team"). A comparison cannot
-- be a guessing game in that sense — there is no space to guess into, it is one
-- in two every time, and the only thing that moves you off the coin flip is
-- knowing something.
--
-- ## Same generation discipline as The Tape, and the same reason
--
-- Generated ahead into a queue by `daily-puzzles`, not computed on read.
-- GTG-1: a puzzle with no job has no cadence, so nothing can be late, so an
-- empty deck went unnoticed for weeks. Queue depth is the health metric.
--
-- ## The deck is the answer key, so it is not readable
--
-- `chains_cards` holds both compared values AND which side wins. Shipping the
-- deck would not merely spoil one answer, it would end the game: a player who
-- can read card nine before answering card one has a list, not a run. RLS is on
-- with NO select policy, and /api/chains serves exactly one face-up card,
-- reveals the ones already played, and hands over the rest of the deck only
-- once the run is over — which is the payoff, not a leak.
--
-- ## Ties cannot exist here
--
-- `six_pack_questions` grades a push as `void`; a run has nowhere to put a
-- void, since there is no slot between "kept going" and "stopped". The check
-- constraint below refuses an equal pair at the database, backing up the
-- generator's own refusal — the belt-and-braces shape `submit_six_pack` uses
-- for a condition its generator already guarantees.
--
-- ## Apply-vs-deploy order: APPLY FIRST — the page selects `chains_puzzles`.

create table public.chains_puzzles (
  day        date primary key,
  deck_size  smallint not null check (deck_size between 1 and 50),
  created_at timestamptz not null default now()
);

alter table public.chains_puzzles enable row level security;

-- The same America/Chicago conversion as 0068, and for the same reason: the
-- queue holds future rows, `current_date` is the SESSION timezone (UTC on
-- Supabase), and `productDate` is Chicago. Between 00:00 and 06:00 UTC they
-- disagree, so the naive version hands out tomorrow's run every night.
create policy "read chains puzzles once the day has arrived" on public.chains_puzzles
  for select to authenticated, anon
  using (day <= (now() at time zone 'America/Chicago')::date);

revoke insert, update, delete, truncate on public.chains_puzzles
  from public, anon, authenticated;

create table public.chains_cards (
  day         date     not null references public.chains_puzzles(day) on delete cascade,
  idx         smallint not null check (idx >= 0),
  kind        text     not null,
  prompt      text     not null,
  left_label  text     not null,
  left_sub    text     not null default '',
  left_team   integer  references public.teams(id),
  right_label text     not null,
  right_sub   text     not null default '',
  right_team  integer  references public.teams(id),
  left_value  numeric(6,1) not null,
  right_value numeric(6,1) not null,
  answer      text     not null check (answer in ('left', 'right')),
  -- A card with two equal values has no answer. The generator refuses one; this
  -- is the belt.
  constraint chains_card_has_an_answer check (left_value <> right_value),
  primary key (day, idx)
);

alter table public.chains_cards enable row level security;
revoke insert, update, delete, truncate on public.chains_cards
  from public, anon, authenticated;

-- One run per player per day. `length` is both the score and the index of the
-- card in play, which is what makes "answer the next one" a single comparison
-- on the server rather than a client-supplied cursor.
create table public.chains_runs (
  user_id  uuid     not null references auth.users(id) on delete cascade,
  day      date     not null references public.chains_puzzles(day) on delete cascade,
  length   smallint not null default 0 check (length >= 0),
  busted   boolean  not null default false,
  answers  jsonb    not null default '[]',
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.chains_runs enable row level security;

create policy "read own chains runs" on public.chains_runs
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete, truncate on public.chains_runs
  from public, anon, authenticated;

-- The board. Ranked on TOTAL length rather than best, because a cumulative
-- total is monotone — `arcade.ts`'s header is explicit that a total which can
-- go down is one nobody trusts, and best-run alone would let one lucky
-- Tuesday outrank a season of playing. `best` rides along because it is the
-- number people actually argue about.
--
-- Only ENDED runs count. A run still in progress is not a result, the same
-- rule GTG-10 had to state for days still being played: counting it would
-- score somebody for walking away mid-drive.
create or replace function public.chains_leaderboard()
returns table (user_id uuid, played integer, best integer, total integer, cleared integer)
language sql
security definer
stable
set search_path = ''
as $$
  select r.user_id,
         count(*) filter (where r.ended_at is not null)::integer,
         coalesce(max(r.length) filter (where r.ended_at is not null), 0)::integer,
         coalesce(sum(r.length) filter (where r.ended_at is not null), 0)::integer,
         count(*) filter (
           where r.ended_at is not null and not r.busted
         )::integer
  from public.chains_runs r
  group by r.user_id;
$$;

revoke execute on function public.chains_leaderboard() from public, anon;
grant  execute on function public.chains_leaderboard() to authenticated;
