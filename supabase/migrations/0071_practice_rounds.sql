-- PRAC-1 — practice rounds for The Tape, Chains and Depth Chart.
--
-- Owner asked for one after playing the dailies: "is there a practice mode for
-- each so I can play today?" Guess the Game has had one since GTG-6 and the
-- three replacements shipped without, which was an omission rather than a
-- decision.
--
-- ## Why these are STORED rather than generated per request
--
-- Guess the Game's practice needs no storage: it re-derives its puzzle from a
-- client-supplied seed through the same rendezvous hash, and cutting a hint
-- ladder is free. None of the three replacements is that cheap.
--
--   * The Tape and Chains both draw from the salience deck, which is eleven
--     seasons of games joined to polls and closing lines. That is a heavy read
--     built for a once-a-day job, not for a request.
--   * Depth Chart is worse than heavy, it is UNBOUNDED: a fair board takes up
--     to `DC_ATTEMPTS` validated draws, measured at ~160ms a board, and an
--     unfair board is not an acceptable fallback.
--
-- So `daily-puzzles` tops these pools up alongside the queue, reusing the exact
-- same generators and — for Depth Chart — the exact same validator. A practice
-- board is therefore as fair as a real one, which is the property that would
-- have been quietly lost by generating practice on a cheaper path.
--
-- ## One row per round, answers in a jsonb payload
--
-- Deliberately not a mirror of the seven daily tables. Practice has no per-user
-- state to key on and no leaderboard to aggregate, so the shape that earned its
-- normalisation on the daily side buys nothing here — it would be seven more
-- tables to keep RLS and grants correct on. What matters is the same as there:
-- the payload is an ANSWER KEY, so RLS is on with **no select policy** and every
-- read goes through the practice route on the service client.
--
-- ## There is no write path, and that is the whole guarantee
--
-- Practice progress lives in the client and is passed back on each call. That
-- is safe for exactly one reason, the same one GTG-6 relied on: **nothing is
-- scored**, so there is nothing for a client to lie its way into. The practice
-- routes contain no INSERT, UPDATE or DELETE at all, which makes "practice
-- cannot touch your record" a property of the code rather than a promise in a
-- comment.
--
-- ## Apply-vs-deploy order is free
--
-- New tables nothing in the running code reads; the practice routes ship with
-- the deploy that follows.

create table public.tape_practice (
  id         bigint generated always as identity primary key,
  game_id    integer not null references public.games(id),
  -- {questions: [{kind, prompt, choices, answer}, ...]}
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  -- One round per game, so a top-up run finds the row rather than minting a
  -- second copy of the same fixture.
  unique (game_id)
);

create table public.chains_practice (
  id         bigint generated always as identity primary key,
  -- The generator's seed, so a top-up is idempotent without comparing decks.
  seed       text not null unique,
  -- {deck: [{kind, prompt, left, right, leftValue, rightValue, answer}, ...]}
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

create table public.dc_practice (
  id         bigint generated always as identity primary key,
  seed       text not null unique,
  -- {groups: [{id, label, teamIds}], tiles: [...], traps}
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.tape_practice   enable row level security;
alter table public.chains_practice enable row level security;
alter table public.dc_practice     enable row level security;

-- No select policy on any of the three: RLS on with no policy denies every row,
-- which is what makes the payload an answer key the route alone can read. Same
-- shape as tape_questions, chains_cards and dc_puzzle_groups.
revoke insert, update, delete, truncate on public.tape_practice
  from public, anon, authenticated;
revoke insert, update, delete, truncate on public.chains_practice
  from public, anon, authenticated;
revoke insert, update, delete, truncate on public.dc_practice
  from public, anon, authenticated;
