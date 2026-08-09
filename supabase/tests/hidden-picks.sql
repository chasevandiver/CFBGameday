-- Picks hidden until kickoff (0023).
--
-- The blind is an RLS rule, so the only honest test is three roles reading the
-- same rows: the owner of a pick, a teammate, and a signed-out visitor looking
-- at a public group. Off by default is asserted first, because a setting that
-- changes behaviour for groups that never touched it is the failure mode.

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
  (2, 'Alabama', 'BAMA', 'SEC', 'fbs');

-- One game upcoming, one already kicked off.
insert into games (id, season_id, week, season_type, start_ts, home_team_id, away_team_id) values
  (301, 2026, 2, 'regular', now() + interval '3 days', 1, 2),
  (302, 2026, 2, 'regular', now() - interval '2 hours', 2, 1);

insert into line_snapshots (game_id, provider, source, spread, total) values
  (301, 'bookA', 'cfbd', -6.5, 51.5),
  (302, 'bookA', 'cfbd', -3.0, 44.0);

insert into invite_allowlist (email, make_admin) values
  ('ann@example.com', true), ('bob@example.com', false), ('cal@example.com', false);
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ann@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'cal@example.com');
\o

\set ann '''11111111-1111-1111-1111-111111111111'''
\set bob '''22222222-2222-2222-2222-222222222222'''
\set cal '''33333333-3333-3333-3333-333333333333'''

\o /dev/null
begin;
  select test_as(:ann::uuid);
  select create_group('Blind Pool', 'public') as grp \gset
  select set_group_week_config(:'grp'::uuid, 2026, 2, 'regular', 'full_slate', null,
                               array['spread']);
commit;
select join_code as code from groups where id = :'grp'::uuid \gset
begin;
  select test_as(:bob::uuid);
  select join_group(:'code');
commit;
-- Both members pick both games. 302 has kicked off, so it goes in as data
-- rather than through make_pick, which locks at kickoff.
begin;
  select test_as(:ann::uuid);
  select make_pick(:'grp'::uuid, 301, 'spread', 'home');
commit;
begin;
  select test_as(:bob::uuid);
  select make_pick(:'grp'::uuid, 301, 'spread', 'away');
commit;
insert into picks (season_id, group_id, user_id, game_id, market, side, line_at_pick) values
  (2026, :'grp'::uuid, :ann::uuid, 302, 'spread', 'home', -3.0),
  (2026, :'grp'::uuid, :bob::uuid, 302, 'spread', 'away', -3.0);
\o

\echo '# off by default: nothing changes'
select pg_temp.chk('a new group does not hide picks',
                   (select not picks_hidden_until_kickoff from groups where id = :'grp'::uuid));
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('a teammate sees both sides of the upcoming game',
                     (select count(*) from picks where game_id = 301) = 2);
rollback;
begin;
  select test_as_anon();
  select pg_temp.chk('anon sees them too, on a public group',
                     (select count(*) from picks where game_id = 301) = 2);
rollback;

\echo '# blind on'
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select update_group(:'grp'::uuid, 'Blind Pool', 'public', true);
commit;
\o
select pg_temp.chk('the admin turned it on',
                   (select picks_hidden_until_kickoff from groups where id = :'grp'::uuid));

begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('you still see your own pick on an upcoming game',
                     (select count(*) from picks
                      where game_id = 301 and user_id = :bob::uuid) = 1);
  select pg_temp.chk('but not your teammate''s',
                     (select count(*) from picks
                      where game_id = 301 and user_id = :ann::uuid) = 0);
  select pg_temp.chk('a game that has kicked off is fully readable',
                     (select count(*) from picks where game_id = 302) = 2);
rollback;

begin;
  select test_as_anon();
  select pg_temp.chk('anon sees nothing on the upcoming game',
                     (select count(*) from picks where game_id = 301) = 0);
  select pg_temp.chk('and everything on the kicked-off one',
                     (select count(*) from picks where game_id = 302) = 2);
rollback;

\echo '# the count survives the blind'
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('a member can still count the hidden picks',
                     group_game_pick_count(:'grp'::uuid, 301) = 2);
rollback;
begin;
  -- Cal is not in the group. The board is public, so without the membership
  -- guard he could poll it for who has committed.
  select test_as(:cal::uuid);
  select pg_temp.chk('a non-member cannot, even on a public group',
                     group_game_pick_count(:'grp'::uuid, 301) = 0);
rollback;
select pg_temp.chk('anon is not granted the counter at all',
                   not has_function_privilege('anon',
                     'public.group_game_pick_count(uuid,integer)', 'execute'));

\echo '# a TBD kickoff stays hidden rather than defaulting to open'
\o /dev/null
update games set start_ts = null where id = 301;
\o
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('null start_ts is treated as not yet kicked off',
                     (select count(*) from picks
                      where game_id = 301 and user_id = :ann::uuid) = 0);
rollback;
\o /dev/null
update games set start_ts = now() + interval '3 days' where id = 301;
\o

\echo '# turning it back off reveals again'
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select update_group(:'grp'::uuid, 'Blind Pool', 'public', false);
commit;
\o
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('picks are readable again',
                     (select count(*) from picks where game_id = 301) = 2);
rollback;
