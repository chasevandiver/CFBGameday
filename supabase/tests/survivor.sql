-- Survivor pools (0053): scope, the no-repeat rule, the kickoff lock, and who
-- can read whose pick.
--
-- Same posture as groups.sql: every assertion runs as a real API role through
-- `test_as`, so RLS and the security-definer RPCs are exercised the way
-- PostgREST would exercise them. Reading the policy and agreeing with it is not
-- a test.

\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on
\pset format unaligned

create function pg_temp.chk(label text, ok boolean) returns text
language sql as $$ select case when ok then 'PASS  ' else 'FAIL  ' end || label; $$;

create function pg_temp.raises(label text, stmt text) returns text
language plpgsql as $$
begin
  execute stmt;
  return 'FAIL  ' || label || ' (no error raised)';
exception when others then
  return 'PASS  ' || label || ' -> ' || sqlerrm;
end; $$;

\o /dev/null
-- ---------------------------------------------------------------------------
-- Seed, as postgres (bypasses RLS)
-- ---------------------------------------------------------------------------
insert into seasons (id, label, week0_start, is_current)
values (2026, '2026', date '2026-08-29', true);

insert into teams (id, school, abbreviation, conference, classification) values
  (1, 'Georgia',    'UGA',  'SEC',     'fbs'),
  (2, 'Alabama',    'BAMA', 'SEC',     'fbs'),
  (3, 'Ohio State', 'OSU',  'Big Ten', 'fbs'),
  (4, 'Michigan',   'MICH', 'Big Ten', 'fbs'),
  (5, 'Auburn',     'AUB',  'SEC',     'fbs');

-- Week 1 has kicked off; weeks 2 and 3 have not.
insert into games (id, season_id, week, season_type, start_ts, home_team_id, away_team_id) values
  (101, 2026, 1, 'regular', now() - interval '2 days', 1, 3),   -- UGA vs OSU, started
  (201, 2026, 2, 'regular', now() + interval '3 days', 1, 4),   -- UGA vs MICH
  (202, 2026, 2, 'regular', now() + interval '4 days', 2, 5),   -- BAMA vs AUB
  (203, 2026, 2, 'regular', now() + interval '3 days', 3, 4),   -- OSU vs MICH, no SEC team
  (204, 2026, 2, 'regular', now() - interval '1 hour', 5, 2),   -- AUB vs BAMA, already kicked
  (301, 2026, 3, 'regular', now() + interval '10 days', 5, 1),  -- AUB vs UGA
  (302, 2026, 3, 'regular', now() + interval '11 days', 2, 1);  -- BAMA vs UGA

insert into invite_allowlist (email, make_admin) values
  ('ann@example.com', false), ('bob@example.com', false), ('cal@example.com', false);
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ann@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'cal@example.com');
\o

\set ann '''11111111-1111-1111-1111-111111111111'''
\set bob '''22222222-2222-2222-2222-222222222222'''
\set cal '''33333333-3333-3333-3333-333333333333'''

\echo '# creating a pool'
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select create_survivor_group('SEC Survivor', 'private', 'cfb', 'SEC', 1, false) as grp \gset
commit;
select join_code as code from groups where id = :'grp'::uuid \gset
\o
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('the group is a survivor pool',
                     (select kind from groups where id = :'grp'::uuid) = 'survivor');
  select pg_temp.chk('its league is stored on the group',
                     (select leagues from groups where id = :'grp'::uuid) = '{cfb}');
  select pg_temp.chk('the pool row carries the conference',
                     (select conference from survivor_pools where group_id = :'grp'::uuid) = 'SEC');
  select pg_temp.chk('creator is the admin', is_group_admin(:'grp'::uuid));
rollback;

begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('an NFL pool refuses a conference',
    $$select create_survivor_group('AFC only', 'private', 'nfl', 'AFC', 1, false)$$);
  select pg_temp.raises('strikes outside 1-3 are refused',
    $$select create_survivor_group('Nine lives', 'private', 'cfb', null, 9, false)$$);
rollback;

\echo '# a survivor pool has no board'
begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('no week config on a survivor pool',
    format($$select set_group_week_config(%L, 2026, 2, 'regular', 'full_slate', null,
                                          array['spread'])$$, :'grp'));
  -- `make_pick` never reaches the trigger here: with no week config possible,
  -- it refuses one step earlier. Both refusals are the same outcome, and the
  -- trigger stays as the backstop for a path that skips the RPC.
  select pg_temp.raises('no pick''em pick on a survivor pool',
    format($$select make_pick(%L, 201, 'spread', 'home')$$, :'grp'));
rollback;

\echo '# every write goes through an RPC'
begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('direct insert into survivor_picks',
    format($$insert into survivor_picks (group_id, season_id, week, user_id, game_id, team_id)
             values (%L, 2026, 2, %L, 201, 1)$$, :'grp', :ann));
  select pg_temp.raises('direct update on survivor_pools',
    $$update survivor_pools set strikes = 3$$);
rollback;

\echo '# the scope: this pool only takes SEC teams'
\o /dev/null
begin;
  select test_as(:bob::uuid);
  select join_group(:'code');
commit;
\o
begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('a Big Ten team is out of scope',
    format($$select make_survivor_pick(%L, 201, 4)$$, :'grp'));
  select pg_temp.raises('a team not in the game is refused',
    format($$select make_survivor_pick(%L, 201, 2)$$, :'grp'));
  -- 204 is in the pool's first week and has already started, so the only rule
  -- that can refuse it is the kickoff lock.
  select pg_temp.raises('a game that has kicked off is locked',
    format($$select make_survivor_pick(%L, 204, 5)$$, :'grp'));
  select pg_temp.raises('a week before the pool started is refused',
    format($$select make_survivor_pick(%L, 101, 1)$$, :'grp'));
rollback;
begin;
  select test_as(:cal::uuid);
  select pg_temp.raises('a non-member cannot pick',
    format($$select make_survivor_pick(%L, 201, 1)$$, :'grp'));
rollback;

\echo '# picking, changing, and the no-repeat rule'
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select make_survivor_pick(:'grp'::uuid, 201, 1);   -- Georgia, week 2
commit;
\o
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('the pick is stored against the week',
    (select team_id from survivor_picks
     where group_id = :'grp'::uuid and user_id = :ann::uuid and week = 2) = 1);
rollback;

\o /dev/null
begin;
  select test_as(:ann::uuid);
  select make_survivor_pick(:'grp'::uuid, 202, 2);   -- swap to Alabama, same week
commit;
\o
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('changing your mind replaces the pick, not adds one',
    (select count(*) from survivor_picks
     where group_id = :'grp'::uuid and user_id = :ann::uuid and week = 2) = 1);
  select pg_temp.chk('and it is the new team',
    (select team_id from survivor_picks
     where group_id = :'grp'::uuid and user_id = :ann::uuid and week = 2) = 2);
  -- 302 is Alabama again, in a later week, unstarted: the no-repeat rule is
  -- the only thing standing in the way.
  select pg_temp.raises('the same team cannot be used in another week',
    format($$select make_survivor_pick(%L, 302, 2)$$, :'grp'));
rollback;

\echo '# a pool that allows repeats does'
\o /dev/null
begin;
  select test_as(:bob::uuid);
  select create_survivor_group('Repeats OK', 'private', 'cfb', null, 2, true) as rgrp \gset
  select make_survivor_pick(:'rgrp'::uuid, 201, 1);
  select make_survivor_pick(:'rgrp'::uuid, 301, 1);
commit;
\o
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('the same team twice, when the pool says so',
    (select count(*) from survivor_picks
     where group_id = :'rgrp'::uuid and user_id = :bob::uuid and team_id = 1) = 2);
rollback;

\echo '# who can read whose pick'
-- The blind is off, so the pool reads like an open board.
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('a member sees another member''s pick with the blind off',
    (select count(*) from survivor_picks where group_id = :'grp'::uuid) = 1);
rollback;
begin;
  select test_as(:cal::uuid);
  select pg_temp.chk('a non-member sees nothing in a private pool',
    (select count(*) from survivor_picks where group_id = :'grp'::uuid) = 0);
rollback;

\o /dev/null
update groups set picks_hidden_until_kickoff = true where id = :'grp'::uuid;
\o
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('with the blind on, another member''s pregame pick is hidden',
    (select count(*) from survivor_picks where group_id = :'grp'::uuid) = 0);
rollback;
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('but your own pick is always yours to see',
    (select count(*) from survivor_picks where group_id = :'grp'::uuid) = 1);
rollback;

\echo '# clearing a pick'
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select remove_survivor_pick(:'grp'::uuid, 2, 'regular');
commit;
\o
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('the pick is gone',
    (select count(*) from survivor_picks
     where group_id = :'grp'::uuid and user_id = :ann::uuid) = 0);
rollback;

\echo '# no role may truncate the new tables (0049)'
begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('truncate survivor_picks', $$truncate survivor_picks$$);
  select pg_temp.raises('truncate survivor_pools', $$truncate survivor_pools$$);
rollback;
