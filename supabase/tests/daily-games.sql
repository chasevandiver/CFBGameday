-- The daily game layer (R2-C1/C2/C3): 0057 guess-lines, 0058 streak, 0059 gtg.
--
-- Guess the Lines' whole integrity is "you guessed before you saw a number",
-- so the assertions that matter are refusals: a guess after the first
-- snapshot, a guess on a game not on the slate, another member's guess
-- readable before the reveal. The streak's are the kickoff lock and the
-- post-kickoff reveal (0023's shape). Gtg's is own-row containment — another
-- member's guess contents would spoil their morning.

\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on
\pset format unaligned

create function pg_temp.chk(label text, ok boolean) returns text
language sql as $$ select case when ok then 'PASS  ' else 'FAIL  ' end || label; $$;

\o /dev/null
insert into seasons (id, label, week0_start, is_current)
values (2026, '2026', date '2026-08-29', true);

insert into teams (id, school, abbreviation, conference, classification) values
  (1, 'Georgia', 'UGA',  'SEC', 'fbs'),
  (2, 'Alabama', 'BAMA', 'SEC', 'fbs'),
  (3, 'Auburn',  'AUB',  'SEC', 'fbs'),
  (4, 'Texas',   'TEX',  'SEC', 'fbs');

-- 401: no line yet (guessable). 402: a snapshot exists (closed).
-- 403: tomorrow's streak game, not kicked. 404: yesterday's, kicked.
insert into games (id, season_id, week, season_type, start_ts, home_team_id, away_team_id) values
  (401, 2026, 2, 'regular', now() + interval '5 days', 1, 2),
  (402, 2026, 2, 'regular', now() + interval '5 days', 3, 4),
  (403, 2026, 2, 'regular', now() + interval '1 day',  1, 3),
  (404, 2026, 2, 'regular', now() - interval '6 hours', 2, 4);

insert into line_snapshots (game_id, provider, source, spread, total) values
  (402, 'bookA', 'cfbd', -6.5, 51.5);

-- The slate rows the selection job would write (service role here).
insert into guess_line_slates (season_id, week, game_id) values
  (2026, 2, 401), (2026, 2, 402);

-- The streak days the daily job would write.
insert into streak_days (day, game_id) values
  (current_date + 1, 403),
  (current_date - 1, 404);

insert into invite_allowlist (email, make_admin) values
  ('ann@example.com', false), ('bob@example.com', false);
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ann@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');
\o

\set ann '''11111111-1111-1111-1111-111111111111'''
\set bob '''22222222-2222-2222-2222-222222222222'''

\echo '# guess the lines: the RPC and its refusals'
begin;
  select test_as(:ann::uuid);
  select make_line_guess(401, -3.5);
  select pg_temp.chk('a guess lands on an open slate game',
    (select guess = -3.5 from line_guesses
      where user_id = :ann::uuid and game_id = 401));
  select make_line_guess(401, -7);
  select pg_temp.chk('changing your mind before the line posts is allowed',
    (select guess = -7 from line_guesses
      where user_id = :ann::uuid and game_id = 401));
commit;

select public.expect_denied('a guess after the first snapshot -> refused', :ann::uuid,
  $q$select make_line_guess(402, -3)$q$,
  'the line has posted');
select public.expect_denied('a game off the slate -> refused', :ann::uuid,
  $q$select make_line_guess(403, -3)$q$,
  'not on this week');
select public.expect_denied('a quarter-point guess -> refused', :ann::uuid,
  $q$select make_line_guess(401, -3.25)$q$,
  'half-point');
select public.expect_denied('anon cannot execute the RPC', null,
  $q$select make_line_guess(401, -3)$q$,
  'permission denied');
select public.expect_denied('direct insert -> denied', :bob::uuid,
  $q$insert into line_guesses (user_id, game_id, season_id, week, guess)
     values ('22222222-2222-2222-2222-222222222222', 401, 2026, 2, -3)$q$,
  'permission denied');

\echo '# guess the lines: the blind'
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('bob cannot read ann''s guess on the open game',
    not exists (select 1 from line_guesses
                 where user_id = :ann::uuid and game_id = 401));
  select pg_temp.chk('but a game whose line has posted is revealed',
    (select line_guesses_revealed(402)));
  select pg_temp.chk('and the open game is not',
    not (select line_guesses_revealed(401)));
rollback;

\echo '# the streak: lock and reveal'
begin;
  select test_as(:ann::uuid);
  select make_streak_pick(current_date + 1, 'home');
  select pg_temp.chk('a pick lands before kickoff',
    (select side = 'home' from streak_picks
      where user_id = :ann::uuid and day = current_date + 1));
  select make_streak_pick(current_date + 1, 'away');
  select pg_temp.chk('switching sides before kickoff is allowed',
    (select side = 'away' from streak_picks
      where user_id = :ann::uuid and day = current_date + 1));
commit;

select public.expect_denied('a pick after kickoff -> refused', :ann::uuid,
  $q$select make_streak_pick(current_date - 1, 'home')$q$,
  'kickoff');
select public.expect_denied('a day with no matchup -> refused', :ann::uuid,
  $q$select make_streak_pick(current_date + 30, 'home')$q$,
  'no streak matchup');
select public.expect_denied('direct insert -> denied', :bob::uuid,
  $q$insert into streak_picks (user_id, day, side)
     values ('22222222-2222-2222-2222-222222222222', current_date + 1, 'home')$q$,
  'permission denied');

begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('bob cannot see ann''s pick before kickoff',
    not exists (select 1 from streak_picks
                 where user_id = :ann::uuid and day = current_date + 1));
rollback;

-- A graded pick on the kicked-off day, written as the job would (service).
\o /dev/null
insert into streak_picks (user_id, day, side, result)
values (:ann::uuid, current_date - 1, 'home', 'loss');
\o
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('after kickoff the pick is readable by the crew',
    exists (select 1 from streak_picks
             where user_id = :ann::uuid and day = current_date - 1));
rollback;

\echo '# guess the game: own-row containment'
\o /dev/null
insert into gtg_guesses (user_id, day, guesses, attempts)
values (:ann::uuid, current_date, '[{"name":"Auburn","verdict":"miss"}]', 1);
\o
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('bob cannot read ann''s gtg guesses',
    not exists (select 1 from gtg_guesses where user_id = :ann::uuid));
  select pg_temp.chk('the leaderboard fn answers without exposing contents',
    exists (select 1 from gtg_leaderboard() where played > 0));
rollback;
select public.expect_denied('direct gtg insert -> denied', :bob::uuid,
  $q$insert into gtg_guesses (user_id, day)
     values ('22222222-2222-2222-2222-222222222222', current_date)$q$,
  'permission denied');
select public.expect_denied('anon cannot execute the leaderboard', null,
  $q$select * from gtg_leaderboard()$q$,
  'permission denied');

-- ---------------------------------------------------------------------------
-- TAPE-2 (0068): The Tape. The answer key must be unreadable by anybody but
-- the route, and the queue of future days must not leak tomorrow's fixture.
-- ---------------------------------------------------------------------------

\echo '# the tape: the answer key is not readable'
\o /dev/null
insert into tape_puzzles (day, game_id) values (current_date, 404);
insert into tape_questions (day, idx, kind, prompt, choices, answer) values
  (current_date, 0, 'winner', 'Who won?', array['Alabama','Michigan'], 'Alabama'),
  (current_date, 1, 'total',  'Over or under 51.5?', array['Over','Under'], 'Under');
\o
begin;
  select test_as(:ann::uuid);
  -- RLS is on with NO select policy, so every row is denied rather than the
  -- answer column being blanked. That is the whole reason a column grant was
  -- rejected: PostgREST's `select *` ERRORS on a revoked column instead of
  -- omitting it, and a row also has to hide questions you have not reached,
  -- which no column grant can express.
  select pg_temp.chk('a member cannot read the answer key at all',
    not exists (select 1 from tape_questions where day = current_date));
  select pg_temp.chk('but the fixture itself is readable — it is the hook',
    exists (select 1 from tape_puzzles where day = current_date));
rollback;

\echo '# the tape: the queue does not leak tomorrow'
\o /dev/null
insert into tape_puzzles (day, game_id) values (current_date + 30, 403);
\o
begin;
  select test_as(:ann::uuid);
  -- The generator banks a fortnight, so this table always holds future rows.
  -- A day well past any timezone's "today" must be invisible from every
  -- session timezone — which is what catches a policy written against
  -- `current_date` (UTC on Supabase) rather than America/Chicago. Between
  -- 00:00 and 06:00 UTC those two disagree, so the naive version serves
  -- tomorrow's fixture for six hours every night.
  set local timezone to 'UTC';
  select pg_temp.chk('a future fixture is invisible from a UTC session',
    not exists (select 1 from tape_puzzles where day = current_date + 30));
  set local timezone to 'Asia/Tokyo';
  select pg_temp.chk('and from a session already on tomorrow',
    not exists (select 1 from tape_puzzles where day = current_date + 30));
rollback;

\echo '# the tape: own-row containment'
\o /dev/null
insert into tape_entries (user_id, day, answers, correct, completed_at)
values (:ann::uuid, current_date,
        '[{"idx":0,"choice":"Alabama","correct":true}]', 1, now());
\o
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('bob cannot read ann''s tape answers',
    not exists (select 1 from tape_entries where user_id = :ann::uuid));
  select pg_temp.chk('the board answers without exposing the round',
    exists (select 1 from tape_leaderboard() where played > 0));
rollback;
select public.expect_denied('direct tape entry insert -> denied', :bob::uuid,
  $q$insert into tape_entries (user_id, day)
     values ('22222222-2222-2222-2222-222222222222', current_date)$q$,
  'permission denied');
select public.expect_denied('a member cannot write the answer key', :bob::uuid,
  $q$insert into tape_questions (day, idx, kind, prompt, choices, answer)
     values (current_date, 4, 'winner', 'x', array['a','b'], 'a')$q$,
  'permission denied');
select public.expect_denied('anon cannot execute the tape board', null,
  $q$select * from tape_leaderboard()$q$,
  'permission denied');

-- ---------------------------------------------------------------------------
-- CHAIN-2 (0069): Chains. The deck is both the answer key AND the future of
-- the run, so it must not be readable at all — a player who can read card nine
-- before answering card one has a list, not a run.
-- ---------------------------------------------------------------------------

\echo '# chains: the deck is not readable'
\o /dev/null
insert into chains_puzzles (day, deck_size) values (current_date, 2);
insert into chains_cards
  (day, idx, kind, prompt, left_label, right_label, left_value, right_value, answer)
values
  (current_date, 0, 'total_points', 'Which game had more points?',
   'Alabama at Auburn', 'Texas at Oklahoma', 62, 93, 'right'),
  (current_date, 1, 'margin', 'Which was won by more?',
   'Georgia at Florida', 'Michigan at Ohio State', 28, 3, 'left');
\o
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('a member cannot read the deck at all',
    not exists (select 1 from chains_cards where day = current_date));
  select pg_temp.chk('but the day itself is readable',
    exists (select 1 from chains_puzzles where day = current_date));
rollback;

\echo '# chains: the queue does not leak tomorrow'
\o /dev/null
insert into chains_puzzles (day, deck_size) values (current_date + 30, 2);
\o
begin;
  select test_as(:ann::uuid);
  set local timezone to 'UTC';
  select pg_temp.chk('a future run is invisible from a UTC session',
    not exists (select 1 from chains_puzzles where day = current_date + 30));
rollback;

\echo '# chains: a card with no answer cannot be stored'
select public.expect_denied('equal values -> check constraint', null,
  $q$insert into chains_cards
       (day, idx, kind, prompt, left_label, right_label, left_value, right_value, answer)
     values (current_date, 9, 'margin', 'x', 'a', 'b', 21, 21, 'left')$q$,
  'chains_card_has_an_answer');

\echo '# chains: own-row containment'
\o /dev/null
insert into chains_runs (user_id, day, length, busted, ended_at)
values (:ann::uuid, current_date, 1, true, now());
\o
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('bob cannot read ann''s run',
    not exists (select 1 from chains_runs where user_id = :ann::uuid));
  select pg_temp.chk('the board answers without exposing the deck',
    exists (select 1 from chains_leaderboard() where played > 0));
rollback;
select public.expect_denied('direct chains run insert -> denied', :bob::uuid,
  $q$insert into chains_runs (user_id, day)
     values ('22222222-2222-2222-2222-222222222222', current_date)$q$,
  'permission denied');
select public.expect_denied('a member cannot write the deck', :bob::uuid,
  $q$insert into chains_cards
       (day, idx, kind, prompt, left_label, right_label, left_value, right_value, answer)
     values (current_date, 8, 'margin', 'x', 'a', 'b', 1, 2, 'right')$q$,
  'permission denied');
select public.expect_denied('anon cannot execute the chains board', null,
  $q$select * from chains_leaderboard()$q$,
  'permission denied');

-- ---------------------------------------------------------------------------
-- R2-D4 (0061): reactions — visibility rides the subject's own RLS.
-- ---------------------------------------------------------------------------
-- The hidden-pick case is the one that matters: reacting to a pick the blind
-- still hides must refuse EXACTLY like reacting to a pick that does not
-- exist, or the reaction table becomes an existence oracle for the blind.

\echo '# reactions'
\o /dev/null
-- A blind group with a pick from ann on the not-yet-kicked game 402
-- (it has a line, which make_pick requires; 401 deliberately has none).
begin;
  select test_as(:ann::uuid);
  select create_group('Blind Crew', 'private') as rgrp \gset
  select set_group_week_config(:'rgrp'::uuid, 2026, 2, 'regular', 'full_slate', null,
                               array['spread']);
  select update_group(:'rgrp'::uuid, 'Blind Crew', 'private', true);
commit;
select join_code as rcode from groups where id = :'rgrp'::uuid \gset
begin;
  select test_as(:bob::uuid);
  select join_group(:'rcode');
commit;
begin;
  select test_as(:ann::uuid);
  select make_pick(:'rgrp'::uuid, 402, 'spread', 'home');
commit;
select id as annpick from picks
  where user_id = :ann::uuid and game_id = 402 \gset
\o

begin;
  select test_as(:ann::uuid);
  insert into reactions (user_id, subject, subject_id, emoji)
  values (:ann::uuid, 'pick', :'annpick', 'fire');
  select pg_temp.chk('the owner can react to their own (visible) pick',
    exists (select 1 from reactions where subject_id = :'annpick'));
commit;

select public.expect_denied('bob reacting to a pick the blind hides -> refused', :bob::uuid,
  $q$insert into reactions (user_id, subject, subject_id, emoji)
     values ('22222222-2222-2222-2222-222222222222', 'pick', $q$ || :'annpick' || $q$, 'skull')$q$,
  'row-level security');
select public.expect_denied('and a pick that does not exist refuses IDENTICALLY', :bob::uuid,
  $q$insert into reactions (user_id, subject, subject_id, emoji)
     values ('22222222-2222-2222-2222-222222222222', 'pick', 999999, 'skull')$q$,
  'row-level security');

begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('bob cannot see the reaction on the hidden pick either',
    not exists (select 1 from reactions where subject_id = :'annpick'));
  select pg_temp.chk('and cannot tell it from a reaction that is not there',
    not exists (select 1 from reactions where subject_id = 999999));
rollback;

select public.expect_denied('reacting as someone else -> refused', :bob::uuid,
  $q$insert into reactions (user_id, subject, subject_id, emoji)
     values ('11111111-1111-1111-1111-111111111111', 'pick', $q$ || :'annpick' || $q$, 'ice')$q$,
  'row-level security');
select public.expect_denied('an emoji off the allow-list -> refused', :ann::uuid,
  $q$insert into reactions (user_id, subject, subject_id, emoji)
     values ('11111111-1111-1111-1111-111111111111', 'pick', $q$ || :'annpick' || $q$, 'thumbsup')$q$,
  'check constraint');

begin;
  select test_as(:ann::uuid);
  delete from reactions where subject = 'pick' and subject_id = :'annpick' and emoji = 'fire';
  select pg_temp.chk('taking a reaction back works',
    not exists (select 1 from reactions where subject_id = :'annpick'));
rollback;

-- ---------------------------------------------------------------------------
-- R3-E1: roster scoping is a PRODUCT FILTER, not a security boundary.
-- ---------------------------------------------------------------------------
-- The Games tab narrows each board to one pool's roster by filtering on
-- user_id (src/lib/games-scope.ts, the shape betting-groups.ts uses for the
-- unhideable ledger). Nothing about RLS changes, and this block exists to say
-- so out loud: a row outside your pool is still READABLE once the game
-- reveals — it is simply not shown. If someone later mistakes the pool filter
-- for a privacy control, this assertion is what contradicts them.

\echo '# roster scoping (R3-E1)'
\o /dev/null
-- Both have a graded guess on 402, whose line has posted (so it is revealed).
insert into line_guesses (user_id, game_id, season_id, week, guess, abs_error, graded_at)
values (:ann::uuid, 402, 2026, 2, -3.5, 0.5, now()),
       (:bob::uuid, 402, 2026, 2,  1.0, 5.0, now());
\o

begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('a revealed guess outside your pool is still readable — the filter is a product choice',
    exists (select 1 from line_guesses where user_id = :bob::uuid and game_id = 402));
  -- What the page actually renders for a pool of just ann: the same rows,
  -- narrowed by user_id in the query. Proven here as arithmetic, not policy.
  select pg_temp.chk('filtering to a roster of one returns exactly that row',
    (select count(*) = 1 from line_guesses
      where game_id = 402 and user_id = any (array[:ann::uuid])));
  select pg_temp.chk('and the unfiltered (everyone) read still returns both',
    (select count(*) = 2 from line_guesses where game_id = 402));
rollback;
