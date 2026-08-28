-- Managed seats (0081): members without logins, admin proxy picks, and the
-- hand-over. Same posture as groups.sql — every assertion runs as a real API
-- role through `test_as`, so RLS and the security-definer RPCs are exercised
-- the way PostgREST would exercise them.

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
  (1, 'Georgia', 'UGA',  'SEC', 'fbs'),
  (2, 'Alabama', 'BAMA', 'SEC', 'fbs');

insert into games (id, season_id, week, season_type, start_ts, home_team_id, away_team_id) values
  (201, 2026, 2, 'regular', now() + interval '3 days', 1, 2),
  (301, 2026, 3, 'regular', now() + interval '10 days', 2, 1);

insert into line_snapshots (game_id, provider, source, spread, total, ml_home, ml_away) values
  (201, 'bookA', 'cfbd', -3.0, 52.0, -160, 140);

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

\echo '# creating a seat'
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select create_group('Family Pickem', 'private', 'pickem') as grp \gset
  select set_group_week_config(:'grp'::uuid, 2026, 2, 'regular', 'full_slate', null,
                               array['spread']);
  select add_group_member(:'grp'::uuid, :bob::uuid);
commit;
\o
begin;
  select test_as(:bob::uuid);
  select pg_temp.raises('only an admin can add a seat',
    format($$select create_managed_member(%L, 'Jeff')$$, :'grp'));
rollback;
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select create_managed_member(:'grp'::uuid, 'Jeff') as seat \gset
commit;
\o
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('the seat has a profile under its alias',
    (select display_name from profiles where id = :'seat'::uuid) = 'Jeff');
  select pg_temp.chk('the seat is on the roster',
    exists (select 1 from group_members
            where group_id = :'grp'::uuid and user_id = :'seat'::uuid and removed_at is null));
  select pg_temp.chk('and marked as an unclaimed seat',
    exists (select 1 from managed_members
            where profile_id = :'seat'::uuid and group_id = :'grp'::uuid and claimed_at is null));
  select pg_temp.raises('one Jeff per roster',
    format($$select create_managed_member(%L, 'jeff')$$, :'grp'));
rollback;
begin;
  -- The allowlist door was held open for exactly one statement; nothing may
  -- linger that a later signup could walk through.
  select pg_temp.chk('the allowlist keeps no seat residue',
    (select count(*) from invite_allowlist where email like '%managed.invalid') = 0);
rollback;

\echo '# a seat is not a person in the directory'
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('the candidate search does not offer the seat',
    not exists (select 1 from search_group_candidates(:'grp'::uuid, 'Jef')));
  select pg_temp.raises('the seat cannot be added to a group as an account',
    format($$select add_group_member(%L, %L)$$, :'grp', :'seat'));
rollback;

\echo '# the alias is the admin''s to assign'
begin;
  select test_as(:bob::uuid);
  select pg_temp.raises('only an admin renames a seat',
    format($$select rename_managed_member(%L, %L, 'Jeffrey')$$, :'grp', :'seat'));
rollback;
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select rename_managed_member(:'grp'::uuid, :'seat'::uuid, 'Jeffrey');
commit;
\o
begin;
  select pg_temp.chk('the rename landed on the profile',
    (select display_name from profiles where id = :'seat'::uuid) = 'Jeffrey');
rollback;

\echo '# picking for a seat'
begin;
  select test_as(:bob::uuid);
  select pg_temp.raises('a non-admin cannot pick for the seat',
    format($$select make_pick(%L, 201, 'spread', 'home', %L)$$, :'grp', :'seat'));
rollback;
begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('an admin cannot pick for a real member',
    format($$select make_pick(%L, 201, 'spread', 'home', %L)$$, :'grp', :bob));
rollback;
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select make_pick(:'grp'::uuid, 201, 'spread', 'home', :'seat'::uuid);
commit;
\o
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('the pick belongs to the seat, not the admin',
    (select user_id from picks where group_id = :'grp'::uuid and game_id = 201) = :'seat'::uuid);
rollback;

\echo '# the blind: the admin sees the seat''s pick, other members do not'
\o /dev/null
update groups set picks_hidden_until_kickoff = true where id = :'grp'::uuid;
\o
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('the admin reads the pregame pick they entered',
    (select count(*) from picks
     where group_id = :'grp'::uuid and user_id = :'seat'::uuid) = 1);
rollback;
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('an ordinary member still waits for kickoff',
    (select count(*) from picks
     where group_id = :'grp'::uuid and user_id = :'seat'::uuid) = 0);
rollback;

\echo '# clearing for a seat'
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select remove_pick(:'grp'::uuid, 201, 'spread', :'seat'::uuid);
commit;
\o
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('the seat''s pick is gone',
    (select count(*) from picks where group_id = :'grp'::uuid) = 0);
rollback;

\echo '# handing the seat over'
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select make_pick(:'grp'::uuid, 201, 'spread', 'away', :'seat'::uuid);
commit;
\o
begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('a seat cannot be handed to someone already in the group',
    format($$select claim_managed_member(%L, %L, %L)$$, :'grp', :'seat', :bob));
  select pg_temp.raises('or to another seat',
    format($$select claim_managed_member(%L, %L, %L)$$, :'grp', :'seat', :'seat'));
rollback;
begin;
  select test_as(:bob::uuid);
  select pg_temp.raises('only an admin hands a seat over',
    format($$select claim_managed_member(%L, %L, %L)$$, :'grp', :'seat', :cal));
rollback;
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select claim_managed_member(:'grp'::uuid, :'seat'::uuid, :cal::uuid);
commit;
\o
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('the membership is Cal''s now',
    exists (select 1 from group_members
            where group_id = :'grp'::uuid and user_id = :cal::uuid and removed_at is null));
  select pg_temp.chk('and the seat''s roster row is gone',
    not exists (select 1 from group_members
                where group_id = :'grp'::uuid and user_id = :'seat'::uuid));
  select pg_temp.chk('the seat is marked claimed',
    (select claimed_by from managed_members where profile_id = :'seat'::uuid) = :cal::uuid);
  select pg_temp.raises('nobody can pick for a claimed seat',
    format($$select make_pick(%L, 201, 'spread', 'home', %L)$$, :'grp', :'seat'));
  select pg_temp.raises('or rename it',
    format($$select rename_managed_member(%L, %L, 'Ghost')$$, :'grp', :'seat'));
rollback;
begin;
  -- Read as Cal: the blind is still on, so the moved pregame pick is exactly
  -- as private as any member's own — the admin's window closed with the claim.
  select test_as(:cal::uuid);
  select pg_temp.chk('the picks moved with the seat, history intact',
    (select user_id from picks where group_id = :'grp'::uuid and game_id = 201) = :cal::uuid);
rollback;
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('and the admin''s window closed with the claim',
    (select count(*) from picks
     where group_id = :'grp'::uuid and user_id = :cal::uuid) = 0);
rollback;

\echo '# every write to the bookkeeping goes through an RPC'
begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('direct insert into managed_members',
    format($$insert into managed_members (profile_id, group_id, created_by)
             values (%L, %L, %L)$$, :ann, :'grp', :ann));
  select pg_temp.raises('truncate managed_members', $$truncate managed_members$$);
rollback;
