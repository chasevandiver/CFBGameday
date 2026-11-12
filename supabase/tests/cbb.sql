-- College basketball as the third league (0086).
--
-- What these assertions are for, in the order they would hurt:
--
--   1. Basketball rows can exist at all — the three `sport` checks admit
--      'cbb' — while a pick'em group still cannot be given the league.
--   2. A live BASKETBALL game does not launch the FOOTBALL scoreboard loop.
--      `launch_live_loop_if_needed` (0084) asked "is any game live?" with no
--      sport in the question; left alone it would have dispatched a runner
--      every ten minutes of every basketball evening from November to April.
--   3. The bet-settlement dispatcher fires when — and only when — a finished
--      basketball game is carrying an open bet the grader can settle, and is
--      throttled so a bet it cannot settle does not re-fire it forever.
--   4. Neither launcher is callable by an API role.
--
-- The cluster has no Vault, so a launcher that DECIDES to dispatch reports
-- 'no_vault'. That is the signal these tests read: 'idle' means it decided
-- there was nothing to do, anything else means it tried.

\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on
\pset format unaligned

create function pg_temp.chk(label text, ok boolean) returns text
language sql as $$ select case when ok then 'PASS  ' else 'FAIL  ' end || label; $$;

create function pg_temp.refused(label text, stmt text, expect text) returns text
language plpgsql as $$
begin
  execute stmt;
  return 'FAIL  ' || label || ' (no error raised)';
exception
  when undefined_table or undefined_column or undefined_function then
    return 'FAIL  ' || label || ' (vacuous — the object is missing: ' || sqlerrm || ')';
  when others then
    if position(expect in sqlerrm) = 0 then
      return 'FAIL  ' || label || ' (wrong error: ' || sqlerrm || ')';
    end if;
    return 'PASS  ' || label;
end; $$;

\o /dev/null
insert into seasons (id, label, week0_start, is_current, sport) values
  (2026,   '2026',        date '2026-08-29', true, 'cfb'),
  (102026, '2026 NFL',    date '2026-09-01', true, 'nfl');
insert into teams (id, school, abbreviation, conference, classification) values
  (2, 'Auburn',  'AUB',  'SEC', 'fbs'),
  (333, 'Alabama', 'BAMA', 'SEC', 'fbs');
insert into invite_allowlist (email, make_admin) values ('bob@example.com', false);
insert into auth.users (id, email) values
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');
\o
\set bob '''22222222-2222-2222-2222-222222222222'''

select '# basketball rows can exist';

\o /dev/null
insert into seasons (id, label, week0_start, is_current, sport)
values (202026, '2026-27 CBB', date '2026-11-01', true, 'cbb');
-- Auburn basketball is ESPN team 2, exactly as Auburn football is. The offset
-- is what keeps this insert from being an update of the row above.
insert into teams (id, sport, school, abbreviation, conference, classification, record, conf_record, poll_rank)
values (200002, 'cbb', 'Auburn',  'AUB',  'SEC', 'd1', '3-0', null, 5),
       (200333, 'cbb', 'Alabama', 'BAMA', 'SEC', 'd1', '2-1', null, null);
\o

select pg_temp.chk('three seasons are current at once, one per sport',
  (select count(*) = 3 from seasons where is_current));
select pg_temp.chk('a school keeps separate football and basketball rows',
  (select count(*) = 2 from teams where school = 'Auburn')
  and (select record is null from teams where id = 2)
  and (select record = '3-0' and poll_rank = 5 from teams where id = 200002));
select pg_temp.refused('a second current basketball season is refused',
  $$insert into seasons (id, label, week0_start, is_current, sport)
    values (202027, '2027-28 CBB', date '2027-11-01', true, 'cbb')$$,
  'seasons_one_current_per_sport');
select pg_temp.refused('an unknown sport is still refused on seasons',
  $$insert into seasons (id, label, week0_start, sport) values (302026, 'x', date '2026-11-01', 'nba')$$,
  'seasons_sport_check');
select pg_temp.refused('…and on teams',
  $$insert into teams (id, sport, school, classification) values (300001, 'nba', 'x', 'd1')$$,
  'teams_sport_check');
select pg_temp.refused('…and on games',
  $$insert into games (id, season_id, sport, week, home_team_id, away_team_id)
    values (9, 202026, 'nba', 1, 200002, 200333)$$,
  'games_sport_check');

select '# a pick''em group cannot be given basketball';

\o /dev/null
insert into groups (name, slug, visibility, join_code, created_by, kind)
values ('Pool', 'pool', 'private', 'ABCD12', :bob::uuid, 'pickem');
\o
select pg_temp.refused('groups.leagues does not admit cbb',
  $$update groups set leagues = '{cfb,cbb}' where slug = 'pool'$$,
  'groups_leagues_sane');

select '# the live block';

\o /dev/null
insert into games (id, season_id, sport, week, season_type, start_ts, home_team_id, away_team_id, status,
                   home_points, away_points, current_period, current_clock, hoops)
values (401, 202026, 'cbb', 11, 'regular', now() - interval '1 hour', 200002, 200333, 'in_progress',
        60, 53, 2, '10:00', '{"h":[33,27],"a":[34,19],"run":{"side":"home","pts":9},"wp":0.755}');
\o
select pg_temp.chk('hoops round-trips as jsonb',
  (select (hoops->'run'->>'pts')::int = 9 and (hoops->>'wp')::numeric = 0.755 from games where id = 401));
select pg_temp.chk('football rows carry no hoops',
  (select count(*) = 0 from games where sport <> 'cbb' and hoops is not null));

select '# the schedules';

select pg_temp.chk('the basketball pull is scheduled every 30 seconds, gated on its own sport',
  (select schedule = '30 seconds' and command like '%cbb-scoreboard%' and command like '%sport = ''cbb''%'
   from cron.job where jobname = 'cbb-scoreboard-30s'));
select pg_temp.chk('the grade dispatcher is scheduled',
  (select schedule = '*/5 * * * *' from cron.job where jobname = 'cbb-grade-launcher-5m'));
select pg_temp.chk('the football pulls and the loop launcher are still scheduled',
  (select count(*) = 3 from cron.job
   where jobname in ('nfl-scoreboard-10s', 'cfb-scoreboard-30s', 'loop-launcher-2m')));

select '# a live basketball game does not launch the football loop';

select pg_temp.chk('idle with only basketball live',
  launch_live_loop_if_needed() = 'idle');

\o /dev/null
insert into games (id, season_id, week, season_type, start_ts, home_team_id, away_team_id, status)
values (501, 2026, 11, 'regular', now() - interval '1 hour', 2, 333, 'in_progress');
\o
select pg_temp.chk('…and still launches for football (reaches the vault check)',
  launch_live_loop_if_needed() = 'no_vault');
\o /dev/null
update games set status = 'final', home_points = 24, away_points = 21 where id = 501;
\o
select pg_temp.chk('…and goes idle again when football ends, basketball still live',
  launch_live_loop_if_needed() = 'idle');

select '# the bet-settlement dispatcher';

select pg_temp.chk('idle with no bets anywhere',
  launch_cbb_grade_if_needed() = 'idle');

\o /dev/null
insert into bets (season_id, user_id, game_id, bet_type, description, side, line_taken, odds, units, reason_tag)
values (202026, :bob::uuid, 401, 'spread', 'AUB -4.5', 'home', -4.5, -110, 1, 'feel');
\o
select pg_temp.chk('idle while the game is still being played',
  launch_cbb_grade_if_needed() = 'idle');

\o /dev/null
update games set status = 'final', current_clock = null where id = 401;
\o
select pg_temp.chk('fires when a finished basketball game carries an open bet',
  launch_cbb_grade_if_needed() = 'no_vault');

\o /dev/null
update games set status = 'postponed' where id = 401;
\o
select pg_temp.chk('fires for a dead game too — a postponement voids the bet',
  launch_cbb_grade_if_needed() = 'no_vault');

\o /dev/null
update games set status = 'final', start_ts = now() - interval '11 hours' where id = 401;
\o
select pg_temp.chk('leaves a game older than ten hours to the morning backstop',
  launch_cbb_grade_if_needed() = 'idle');

\o /dev/null
update games set start_ts = now() - interval '3 hours' where id = 401;
update bets set bet_type = 'future' where game_id = 401;
\o
select pg_temp.chk('ignores a bet type the grader settles by hand',
  launch_cbb_grade_if_needed() = 'idle');

\o /dev/null
update bets set bet_type = 'spread', voided_at = now() where game_id = 401;
\o
select pg_temp.chk('ignores a voided bet',
  launch_cbb_grade_if_needed() = 'idle');

\o /dev/null
update bets set voided_at = null, result = 'win', payout_units = 0.91 where game_id = 401;
\o
select pg_temp.chk('goes idle once the bet is graded',
  launch_cbb_grade_if_needed() = 'idle');

\o /dev/null
-- an open bet on a finished FOOTBALL game is the loop's business, not this
insert into bets (season_id, user_id, game_id, bet_type, description, side, line_taken, odds, units, reason_tag)
values (2026, :bob::uuid, 501, 'spread', 'AUB -3', 'home', -3, -110, 1, 'feel');
\o
select pg_temp.chk('does not fire for football',
  launch_cbb_grade_if_needed() = 'idle');

select '# …and its throttle';

\o /dev/null
update bets set result = null, payout_units = null where game_id = 401;
insert into loop_launches (reason, requested_at) values ('cbb-grade', now() - interval '3 minutes');
\o
select pg_temp.chk('holds for ten minutes after a dispatch',
  launch_cbb_grade_if_needed() = 'pending');

\o /dev/null
update loop_launches set requested_at = now() - interval '20 minutes' where reason = 'cbb-grade';
\o
select pg_temp.chk('…then tries again',
  launch_cbb_grade_if_needed() = 'no_vault');

\o /dev/null
insert into loop_launches (reason, requested_at)
select 'cbb-grade', now() - (n || ' minutes')::interval from generate_series(30, 150, 30) n;
\o
select pg_temp.chk('stops at six dispatches in six hours — a stuck bet cannot re-fire it all night',
  launch_cbb_grade_if_needed() = 'capped');

\o /dev/null
-- the football loop's own launches must not count against basketball's cap
update loop_launches set reason = 'live' where requested_at < now() - interval '25 minutes';
\o
select pg_temp.chk('counts only its own dispatches',
  launch_cbb_grade_if_needed() = 'no_vault');

select '# neither launcher is an API surface';

select pg_temp.chk('anon cannot execute the loop launcher',
  not has_function_privilege('anon', 'public.launch_live_loop_if_needed()', 'EXECUTE'));
select pg_temp.chk('authenticated cannot execute the loop launcher',
  not has_function_privilege('authenticated', 'public.launch_live_loop_if_needed()', 'EXECUTE'));
select pg_temp.chk('anon cannot execute the grade dispatcher',
  not has_function_privilege('anon', 'public.launch_cbb_grade_if_needed()', 'EXECUTE'));
select pg_temp.chk('authenticated cannot execute the grade dispatcher',
  not has_function_privilege('authenticated', 'public.launch_cbb_grade_if_needed()', 'EXECUTE'));
select pg_temp.chk('the launcher tables are closed to the API roles',
  not has_table_privilege('anon', 'public.loop_launches', 'SELECT')
  and not has_table_privilege('authenticated', 'public.loop_launches', 'SELECT')
  and not has_table_privilege('authenticated', 'public.loop_launcher_state', 'SELECT'));
