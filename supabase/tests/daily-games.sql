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
