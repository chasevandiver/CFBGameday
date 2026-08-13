-- Groups: membership, visibility, week configuration and the freeze (0020).
--
-- Every assertion runs as a real API role. `test_as` sets the JWT claim and
-- switches to `authenticated`, so RLS and the security-definer RPCs are
-- exercised the way PostgREST would exercise them — reading the policy and
-- agreeing with it is not a test.

\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on
\pset format unaligned

create function pg_temp.chk(label text, ok boolean) returns text
language sql as $$ select case when ok then 'PASS  ' else 'FAIL  ' end || label; $$;

-- Records the message of an expected failure, or a FAIL line if none came.
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
  (5, 'Iowa',       'IOWA', 'Big Ten', 'fbs');

-- Week 2 is upcoming; week 1 has already kicked off.
insert into games (id, season_id, week, season_type, start_ts, home_team_id, away_team_id) values
  (201, 2026, 2, 'regular', now() + interval '3 days', 1, 2),   -- SEC only
  (202, 2026, 2, 'regular', now() + interval '3 days', 3, 4),   -- Big Ten only
  (203, 2026, 2, 'regular', now() + interval '4 days', 5, 1),   -- Iowa (B1G) vs Georgia
  (101, 2026, 1, 'regular', now() - interval '2 days', 3, 5);

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

\echo '# creating a group'
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select create_group('Saturday Boys', 'private') as grp \gset
commit;
select join_code as code from groups where id = :'grp'::uuid \gset
\o
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('creator is the admin', is_group_admin(:'grp'::uuid));
  select pg_temp.chk('creator is a member',  is_group_member(:'grp'::uuid));
  select pg_temp.chk('name slugified to saturday-boys',
                     (select slug from groups where id = :'grp'::uuid) = 'saturday-boys');
rollback;

\echo '# joining, and who can see a private group'
\o /dev/null
begin;
  select test_as(:bob::uuid);
  select join_group(:'code');
commit;
\o
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('joiner is a member, not an admin',
                     is_group_member(:'grp'::uuid) and not is_group_admin(:'grp'::uuid));
rollback;
begin;
  select test_as(:cal::uuid);
  select pg_temp.chk('non-member sees no private group', (select count(*) from groups) = 0);
  select pg_temp.chk('non-member sees no roster', (select count(*) from group_members) = 0);
rollback;
begin;
  select test_as_anon();
  select pg_temp.chk('anon sees no private group', (select count(*) from groups) = 0);
rollback;

\echo '# a public group is readable signed out'
\o /dev/null
update groups set visibility = 'public' where id = :'grp'::uuid;
\o
begin;
  select test_as_anon();
  select pg_temp.chk('anon sees a public group', (select count(*) from groups) = 1);
  select pg_temp.chk('anon sees its roster', (select count(*) from group_members) = 2);
rollback;
\o /dev/null
update groups set visibility = 'private' where id = :'grp'::uuid;
\o

\echo '# every write goes through an RPC'
begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('direct update on groups',
                        $$update groups set name = 'Hijacked'$$);
  select pg_temp.raises('direct insert into group_members',
                        $$insert into group_members (group_id, user_id, role)
                          select id, '33333333-3333-3333-3333-333333333333', 'admin'
                          from groups limit 1$$);
  select pg_temp.raises('direct insert into group_week_config',
                        $$insert into group_week_config
                            (group_id, season_id, week, selection_mode, markets)
                          select id, 2026, 3, 'full_slate', array['spread'] from groups limit 1$$);
rollback;

\echo '# selection modes'
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select set_group_week_config(:'grp'::uuid, 2026, 2, 'regular',
                               'full_slate', null, array['spread','total']);
commit;
\o
select pg_temp.chk('full_slate takes the whole week',
                   (select array_agg(g order by g) from group_week_game_ids(:'grp'::uuid, 2026, 2) g)
                   = array[201,202,203]);
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select set_group_week_config(:'grp'::uuid, 2026, 2, 'regular',
                               'conference', 'Big Ten', array['spread']);
commit;
\o
select pg_temp.chk('conference takes games with a Big Ten team on either side',
                   (select array_agg(g order by g) from group_week_game_ids(:'grp'::uuid, 2026, 2) g)
                   = array[202,203]);
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select set_group_week_config(:'grp'::uuid, 2026, 2, 'regular',
                               'handpicked', null, array['spread','straight_up'], array[201,203]);
commit;
\o
select pg_temp.chk('handpicked takes exactly the listed games',
                   (select array_agg(g order by g) from group_week_game_ids(:'grp'::uuid, 2026, 2) g)
                   = array[201,203]);

\echo '# configuration is validated'
begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('a game from another week',
    format($$select set_group_week_config(%L, 2026, 2, 'regular', 'handpicked', null,
                                          array['spread'], array[101])$$, :'grp'));
  select pg_temp.raises('conference mode with no conference',
    format($$select set_group_week_config(%L, 2026, 2, 'regular', 'conference', null,
                                          array['spread'])$$, :'grp'));
  select pg_temp.raises('an unknown market',
    format($$select set_group_week_config(%L, 2026, 2, 'regular', 'full_slate', null,
                                          array['parlay'])$$, :'grp'));
  select pg_temp.raises('zero markets',
    format($$select set_group_week_config(%L, 2026, 2, 'regular', 'full_slate', null,
                                          array[]::text[])$$, :'grp'));
rollback;
begin;
  select test_as(:bob::uuid);
  select pg_temp.raises('a plain member configuring the week',
    format($$select set_group_week_config(%L, 2026, 2, 'regular', 'full_slate', null,
                                          array['spread'])$$, :'grp'));
rollback;

\echo '# renaming a group, and the weekly minimum'
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select set_group_week_config(:'grp'::uuid, 2026, 3, 'regular', 'full_slate', null,
                               array['spread'], null, 3);
commit;
\o
select pg_temp.chk('a weekly minimum is stored',
                   (select min_picks_per_week from group_week_config
                    where group_id = :'grp'::uuid and week = 3) = 3);
select pg_temp.chk('and defaults to none when not given',
                   (select min_picks_per_week from group_week_config
                    where group_id = :'grp'::uuid and week = 2) = 0);
begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('an absurd weekly minimum',
    format($$select set_group_week_config(%L, 2026, 3, 'regular', 'full_slate', null,
                                          array['spread'], null, 500)$$, :'grp'));
rollback;

\o /dev/null
begin;
  select test_as(:ann::uuid);
  select update_group(:'grp'::uuid, 'Sunday Boys', 'public');
commit;
\o
select pg_temp.chk('renaming moves the slug with the name',
                   (select name || '/' || slug || '/' || visibility from groups
                    where id = :'grp'::uuid) = 'Sunday Boys/sunday-boys/public');
begin;
  select test_as(:bob::uuid);
  select pg_temp.raises('a member renaming the group',
    format($$select update_group(%L, 'Hijacked', 'public')$$, :'grp'));
rollback;
begin;
  -- As the admin, so this reaches the name check instead of stopping at the
  -- admin gate and reporting a pass for the wrong reason.
  select test_as(:ann::uuid);
  select pg_temp.raises('an empty group name',
    format($$select update_group(%L, '   ', 'private')$$, :'grp'));
  select pg_temp.raises('a bad visibility',
    format($$select update_group(%L, 'Fine', 'secret')$$, :'grp'));
rollback;
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select update_group(:'grp'::uuid, 'Saturday Boys', 'private');
commit;
\o
select pg_temp.chk('renaming back restores the original slug, not saturday-boys-1',
                   (select slug from groups where id = :'grp'::uuid) = 'saturday-boys');

\echo '# the freeze'
select pg_temp.chk('an upcoming week is unlocked',
                   not group_week_is_locked(:'grp'::uuid, 2026, 2));
\o /dev/null
-- Config is handpicked {201,203}; age 201 so the week has started.
update games set start_ts = now() - interval '1 hour' where id = 201;
\o
select pg_temp.chk('the clock locks the week, with no locked_at stamped',
                   group_week_is_locked(:'grp'::uuid, 2026, 2)
                   and (select locked_at is null from group_week_config
                        where group_id = :'grp'::uuid and week = 2));
begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('editing a locked week',
    format($$select set_group_week_config(%L, 2026, 2, 'regular', 'full_slate', null,
                                          array['spread'])$$, :'grp'));
rollback;

\echo '# freezing materialises a live-resolved list'
\o /dev/null
-- Back to conference mode with nothing materialised, and age a Big Ten game.
update group_week_config set selection_mode = 'conference', conference = 'Big Ten'
  where group_id = :'grp'::uuid and week = 2;
delete from group_week_games where group_id = :'grp'::uuid and week = 2;
update games set start_ts = now() - interval '1 hour' where id = 202;
\o
select pg_temp.chk('resolves live before the freeze',
                   (select array_agg(g order by g) from group_week_game_ids(:'grp'::uuid, 2026, 2) g)
                   = array[202,203]);
select pg_temp.chk('freeze reports that it fired', freeze_group_week(:'grp'::uuid, 2026, 2));
select pg_temp.chk('the list is now rows in group_week_games',
                   (select array_agg(game_id order by game_id) from group_week_games
                    where group_id = :'grp'::uuid and week = 2) = array[202,203]);
select pg_temp.chk('locked_at is stamped',
                   (select locked_at is not null from group_week_config
                    where group_id = :'grp'::uuid and week = 2));
select pg_temp.chk('resolution now reads the frozen table',
                   (select array_agg(g order by g) from group_week_game_ids(:'grp'::uuid, 2026, 2) g)
                   = array[202,203]);
select pg_temp.chk('freezing twice is a no-op',
                   not freeze_group_week(:'grp'::uuid, 2026, 2));
-- A postponement that moves a game out of the week cannot pull it off the board.
\o /dev/null
update games set week = 3 where id = 203;
\o
select pg_temp.chk('a frozen board survives a game being rescheduled',
                   (select array_agg(g order by g) from group_week_game_ids(:'grp'::uuid, 2026, 2) g)
                   = array[202,203]);
\o /dev/null
update games set week = 2 where id = 203;
\o

\echo '# who may run the freeze'
-- The job connects as service_role. Supabase's default privileges grant it
-- EXECUTE on new functions, and 0020 only revokes from public/anon/
-- authenticated — so the revoke does not lock the job out of its own function.
select pg_temp.chk('service_role can run the freeze job',
                   has_function_privilege('service_role',
                     'public.freeze_group_week(uuid,integer,integer,text)', 'execute'));
select pg_temp.chk('a signed-in member cannot force a freeze',
                   not has_function_privilege('authenticated',
                     'public.freeze_group_week(uuid,integer,integer,text)', 'execute'));
select pg_temp.chk('but can make a pick',
                   has_function_privilege('authenticated',
                     'public.make_pick(uuid,integer,text,text)', 'execute'));

\echo '# admin transfer and the last-admin invariant'
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select set_group_role(:'grp'::uuid, :bob::uuid, 'admin');
  select set_group_role(:'grp'::uuid, :ann::uuid, 'member');
commit;
\o
select pg_temp.chk('transfer promoted bob and demoted ann',
                   (select string_agg(p.display_name || '=' || m.role, ',' order by p.display_name)
                    from group_members m join profiles p on p.id = m.user_id
                    where m.group_id = :'grp'::uuid and m.removed_at is null)
                   = 'ann=member,bob=admin');
begin;
  select test_as(:bob::uuid);
  select pg_temp.raises('demoting the last admin',
    format($$select set_group_role(%L, %L, 'member')$$, :'grp', :bob));
  select pg_temp.raises('the last admin leaving',
    format($$select leave_group(%L)$$, :'grp'));
rollback;
begin;
  set constraints all immediate;
  select pg_temp.raises('the trigger backstop, bypassing the RPC guard',
    format($$update group_members set role = 'member'
             where group_id = %L and role = 'admin'$$, :'grp'));
rollback;

\echo '# removal is soft, and rejoining restores the role'
begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('a plain member removing someone',
    format($$select remove_group_member(%L, %L)$$, :'grp', :bob));
rollback;
\o /dev/null
begin;
  select test_as(:bob::uuid);
  select remove_group_member(:'grp'::uuid, :ann::uuid);
commit;
\o
select pg_temp.chk('the row is kept with removed_at set',
                   (select removed_at is not null from group_members
                    where group_id = :'grp'::uuid and user_id = :ann::uuid));
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('a removed member loses sight of a private group',
                     (select count(*) from groups) = 0);
rollback;
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select join_group(:'code');
commit;
\o
select pg_temp.chk('rejoining reactivates the same row',
                   (select count(*) from group_members
                    where group_id = :'grp'::uuid and user_id = :ann::uuid) = 1
                   and (select removed_at is null from group_members
                        where group_id = :'grp'::uuid and user_id = :ann::uuid));

\echo '# removal is durable, leaving is not (0038, SEC-02)'
-- Before 0038, join_group's `on conflict … do update set removed_at = null`
-- discarded the 'member' in its VALUES list, so an admin removed by another
-- admin walked back in through the join code still holding admin. The two
-- exits are now distinguished by `removed_by`: an admin removed you (role does
-- not survive) or you left on your own (it does). Leaving has to keep the role,
-- or a sole owner who leaves their own group could not rejoin it — the
-- deferred group_members_keep_admin trigger would refuse a members-but-no-admin
-- state.
--
-- Standing state here: bob is admin, ann is a member who was removed and
-- rejoined above. Promote her so there is an admin to remove.
\o /dev/null
begin;
  select test_as(:bob::uuid);
  select set_group_role(:'grp'::uuid, :ann::uuid, 'admin');
commit;
begin;
  select test_as(:bob::uuid);
  select remove_group_member(:'grp'::uuid, :ann::uuid);
commit;
\o
select pg_temp.chk('the removal recorded who did it',
                   (select removed_by from group_members
                    where group_id = :'grp'::uuid and user_id = :ann::uuid) = :bob::uuid);
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select join_group(:'code');
commit;
\o
select pg_temp.chk('a removed admin comes back a member',
                   (select role from group_members
                    where group_id = :'grp'::uuid and user_id = :ann::uuid) = 'member');
select pg_temp.chk('and the removal is cleared, not carried forward',
                   (select removed_by is null and removed_at is null from group_members
                    where group_id = :'grp'::uuid and user_id = :ann::uuid));

-- Leaving voluntarily is the other branch: cal creates his own group, leaves
-- it as its only member, and rejoins. He has to come back an admin — nobody
-- outranked him, and an empty group has no one to promote him.
\o /dev/null
begin;
  select test_as(:cal::uuid);
  select create_group('Cal''s Den', 'private', 'pickem') as g \gset
commit;
select join_code as calcode from groups where id = :'g'::uuid \gset
begin;
  select test_as(:cal::uuid);
  select leave_group(:'g'::uuid);
commit;
begin;
  select test_as(:cal::uuid);
  select join_group(:'calcode');
commit;
\o
select pg_temp.chk('someone who left on their own keeps their role',
                   (select role from group_members
                    where group_id = :'g'::uuid and user_id = :cal::uuid) = 'admin');

\echo '# join codes are a boundary now (0039, SEC-01)'
-- Old codes were six hex characters — a 16-symbol alphabet, 16^6 ≈ 16.7M — and
-- join_group had no throttle at all, so the space was walkable. New codes are
-- ten Crockford base32 characters and failures cost.
select pg_temp.chk('a fresh code is ten characters',
                   (select length(join_code) = 10 from groups where id = :'grp'::uuid));
select pg_temp.chk('drawn only from the Crockford alphabet',
                   (select join_code ~ '^[0-9A-HJKMNP-TV-Z]{10}$'
                    from groups where id = :'grp'::uuid));
-- bob is the admin here; ann was demoted by the SEC-02 block above.
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('an admin mints another valid one',
                     (select regenerate_join_code(:'grp'::uuid)) ~ '^[0-9A-HJKMNP-TV-Z]{10}$');
commit;
begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('a plain member cannot',
    format($$select regenerate_join_code(%L)$$, :'grp'));
rollback;

-- Crockford folds the letters it dropped onto the digits they look like, so a
-- code read off a phone survives the obvious transcription slips.
select pg_temp.chk('I and L read as 1, O reads as 0',
                   normalize_join_code('il o-1') = '1101');
select pg_temp.chk('case, spaces and hyphens are noise',
                   normalize_join_code('  ab-cd ef ') = 'ABCDEF');

\o /dev/null
select join_code as freshcode from groups where id = :'grp'::uuid \gset
\o
begin;
  select test_as(:cal::uuid);
  select pg_temp.chk('a wrong code returns null rather than raising',
                     (select join_group('ZZZZZZZZZZ')) is null);
  select pg_temp.chk('a right code still returns the group',
                     (select join_group(:'freshcode')) = :'grp'::uuid);
rollback;

-- The throttle counts failures, which is why the miss above returns instead of
-- raising: a raise would roll back the very row being counted.
\o /dev/null
begin;
  select test_as(:cal::uuid);
  select join_group('ZZZZZZZZZ' || i) from generate_series(0, 9) as i;
commit;
\o
select pg_temp.chk('ten misses were recorded',
                   (select count(*) from group_join_attempts where user_id = :cal::uuid) = 10);
begin;
  select test_as(:cal::uuid);
  select pg_temp.raises('the eleventh attempt is refused',
    $$select join_group('ZZZZZZZZZZ')$$);
  select pg_temp.raises('and a correct code is refused too, while throttled',
    format($$select join_group(%L)$$, :'freshcode'));
rollback;

begin;
  select test_as_anon();
  select pg_temp.chk('anon cannot read a join code',
                     (select count(*) from information_schema.column_privileges
                      where table_name = 'groups' and column_name = 'join_code'
                        and grantee = 'anon' and privilege_type = 'SELECT') = 0);
  select pg_temp.raises('and cannot select the column',
    $$select join_code from groups$$);
  -- The revoke had to drop the whole table grant to bite, so the columns a
  -- signed-out visitor legitimately reads are re-granted. This is the exact
  -- set src/lib/groups.ts:98 asks for on the public-group-by-slug path; if it
  -- ever needs another column, this fails before the page 500s.
  select pg_temp.chk('but still reads a public group the app way',
                     (select count(*) from (
                        select id, name, slug, visibility, kind,
                               picks_hidden_until_kickoff, archived_at
                        from groups) q) >= 0);
rollback;

\echo '# league scope (0042)'
-- NFL season + one NFL game, seeded as postgres. Offset ids per league.ts.
\o /dev/null
insert into seasons (id, label, week0_start, is_current, sport)
values (102026, '2026 NFL', date '2026-09-10', true, 'nfl');
insert into teams (id, school, abbreviation, conference, classification, sport) values
  (100012, 'Kansas City Chiefs', 'KC',  'AFC West', 'nfl', 'nfl'),
  (100024, 'Los Angeles Chargers', 'LAC', 'AFC West', 'nfl', 'nfl');
insert into games (id, season_id, week, season_type, start_ts, home_team_id, away_team_id, sport)
values (900001, 102026, 1, 'regular', now() + interval '5 days', 100012, 100024, 'nfl');
\o

select pg_temp.chk('a group plays CFB by default',
                   (select leagues = '{cfb}' from groups where id = :'grp'::uuid));

-- bob is the admin (ann was demoted above)
begin;
  select test_as(:bob::uuid);
  select pg_temp.raises('an NFL week is refused while the group is CFB-only',
    format($$select set_group_week_config(%L, 102026, 1, 'regular', 'full_slate', null,
             array['spread'])$$, :'grp'));
  select set_group_leagues(:'grp'::uuid, array['nfl','cfb']);
  select pg_temp.chk('the admin opened the group to both leagues — stored deduped and ordered',
                     (select leagues = '{cfb,nfl}' from groups where id = :'grp'::uuid));
  select set_group_week_config(:'grp'::uuid, 102026, 1, 'regular', 'full_slate', null,
                               array['spread']);
  select pg_temp.chk('an NFL week config lands once the league is on',
                     exists (select 1 from group_week_config
                             where group_id = :'grp'::uuid and season_id = 102026 and week = 1));
  select pg_temp.raises('but at least one league must stay on',
    format($$select set_group_leagues(%L, array[]::text[])$$, :'grp'));
  select pg_temp.raises('and an invented league is refused',
    format($$select set_group_leagues(%L, array['xfl'])$$, :'grp'));
rollback;

begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('a plain member cannot change the leagues',
    format($$select set_group_leagues(%L, array['nfl'])$$, :'grp'));
rollback;

-- A betting group has no league scope: the sheet follows the bets.
\o /dev/null
begin;
  select test_as(:bob::uuid);
  select create_group('Degens', 'private', 'betting') as bgrp \gset
commit;
\o
begin;
  select test_as(:bob::uuid);
  select pg_temp.raises('a betting group refuses a league scope',
    format($$select set_group_leagues(%L, array['nfl'])$$, :'bgrp'));
rollback;
