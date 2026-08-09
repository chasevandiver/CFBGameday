-- Per-group picks and markets (0021).
--
-- The backfill is the risky half: it has to move every pre-existing pick into
-- a group before `group_id` goes NOT NULL, relabel over/unders as totals
-- rather than letting the 'spread' default stand, and leave the old crew's
-- history addressable. Those rows are seeded here *before* 0021 runs — see
-- scripts/db-test.sh, which applies migrations in order — so this file asserts
-- against what the migration actually did to them.

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
insert into seasons (id, label, week0_start, is_current)
values (2026, '2026', date '2026-08-29', true);

insert into teams (id, school, abbreviation, conference, classification) values
  (1, 'Georgia', 'UGA',  'SEC',     'fbs'),
  (2, 'Alabama', 'BAMA', 'SEC',     'fbs'),
  (3, 'Ohio State', 'OSU', 'Big Ten', 'fbs'),
  (4, 'Michigan', 'MICH', 'Big Ten', 'fbs');

insert into games (id, season_id, week, season_type, start_ts, home_team_id, away_team_id) values
  (201, 2026, 2, 'regular', now() + interval '3 days', 1, 2),
  (202, 2026, 2, 'regular', now() + interval '3 days', 3, 4),
  (203, 2026, 2, 'regular', now() + interval '4 days', 2, 3);

-- Two books on 201 and 202 so the consensus snap has something to average.
insert into line_snapshots (game_id, provider, source, spread, total, ml_home, ml_away) values
  (201, 'bookA', 'cfbd', -3.0, 52.0, -160, 140),
  (201, 'bookB', 'cfbd', -4.0, 53.0, -165, 145),
  (202, 'bookA', 'cfbd',  6.5, 44.5,  220, -270);
-- 203 has no line at all.

insert into invite_allowlist (email, make_admin) values
  ('ann@example.com', true), ('bob@example.com', false);
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ann@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');
\o

\set ann '''11111111-1111-1111-1111-111111111111'''
\set bob '''22222222-2222-2222-2222-222222222222'''

-- ---------------------------------------------------------------------------
-- The backfill, replayed
--
-- 0021 has already run by the time this file executes, so its DO block found
-- an empty profiles table and did nothing. Re-running it here against seeded
-- legacy rows exercises the same code on the shape it will meet in production.
-- ---------------------------------------------------------------------------
\echo '# backfill of pre-group picks'
\o /dev/null
-- Put the table back the way 0021 found it: group_id absent, and `market` at
-- its 'spread' default for every row regardless of side, so the backfill has
-- the same job to do that it will have in production.
alter table picks alter column group_id drop not null;
insert into picks (season_id, group_id, user_id, game_id, market, side, line_at_pick)
values (2026, null, :ann::uuid, 201, 'spread', 'home', -3.5),
       (2026, null, :bob::uuid, 201, 'spread', 'away', -3.5),
       (2026, null, :bob::uuid, 202, 'spread', 'over', 44.5);
\o

\o /dev/null
do $$
declare v_group uuid; v_admin uuid; v_code text;
begin
  if not exists (select 1 from public.picks) then return; end if;
  update public.picks set market = 'total' where side in ('over', 'under');

  select id into v_admin from public.profiles
  order by is_admin desc, created_at asc, id asc limit 1;
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from public.groups where join_code = v_code);
  end loop;
  insert into public.groups (name, slug, visibility, join_code, created_by)
  values ('The Crew', 'the-crew', 'private', v_code, v_admin) returning id into v_group;
  insert into public.group_members (group_id, user_id, role)
  select v_group, p.id, case when p.id = v_admin then 'admin' else 'member' end from public.profiles p;
  update public.picks set group_id = v_group where group_id is null;
  insert into public.group_week_config (group_id, season_id, week, season_type,
                                        selection_mode, markets, locked_at, updated_by)
  select v_group, g.season_id, g.week, g.season_type,
         'handpicked', array['spread','total'],
         case when min(g.start_ts) <= now() then now() end, v_admin
  from public.picks pk join public.games g on g.id = pk.game_id
  group by g.season_id, g.week, g.season_type;
  insert into public.group_week_games (group_id, season_id, week, season_type, game_id)
  select distinct v_group, g.season_id, g.week, g.season_type, g.id
  from public.picks pk join public.games g on g.id = pk.game_id;
end $$;
alter table picks alter column group_id set not null;
\o
select id as crew from groups where slug = 'the-crew' \gset

select pg_temp.chk('every legacy pick landed in a group',
                   (select count(*) from picks where group_id is null) = 0);
select pg_temp.chk('over/under was relabelled as a total, not left as a spread',
                   (select market from picks where user_id = :bob::uuid and game_id = 202) = 'total'
               and (select count(*) from picks where market = 'spread') = 2);
select pg_temp.chk('the commissioner is the crew admin',
                   (select role from group_members
                    where group_id = :'crew'::uuid and user_id = :ann::uuid) = 'admin');
select pg_temp.chk('everyone else came along as a member',
                   (select role from group_members
                    where group_id = :'crew'::uuid and user_id = :bob::uuid) = 'member');
select pg_temp.chk('picked weeks were reconstructed as handpicked lists',
                   (select selection_mode = 'handpicked'
                    from group_week_config where group_id = :'crew'::uuid and week = 2));
-- Week 2 kicks off in three days here. Freezing it would hand the owner a
-- board of exactly the games already picked that they could never change.
select pg_temp.chk('an upcoming week is left unfrozen and editable',
                   (select locked_at is null
                    from group_week_config where group_id = :'crew'::uuid and week = 2));
select pg_temp.chk('and only over the games that were actually picked',
                   (select array_agg(game_id order by game_id) from group_week_games
                    where group_id = :'crew'::uuid) = array[201,202]);

-- ---------------------------------------------------------------------------
\echo '# one pick per market, and per group'
-- ---------------------------------------------------------------------------
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select create_group('Second Pool', 'private') as pool \gset
  select set_group_week_config(:'pool'::uuid, 2026, 2, 'regular', 'full_slate', null,
                               array['spread','total','straight_up']);
commit;
-- Reopen the crew's week so picks can be made against it.
update group_week_config set locked_at = null, selection_mode = 'full_slate'
  where group_id = :'crew'::uuid and week = 2;
delete from group_week_games where group_id = :'crew'::uuid;
\o

begin;
  select test_as(:ann::uuid);
  select make_pick(:'pool'::uuid, 201, 'spread', 'home');
  select make_pick(:'pool'::uuid, 201, 'total',  'over');
  select make_pick(:'pool'::uuid, 201, 'straight_up', 'away');
commit;
select pg_temp.chk('three markets coexist on one game',
                   (select count(*) from picks
                    where group_id = :'pool'::uuid and game_id = 201) = 3);
select pg_temp.chk('the spread snapped to the two-book consensus (-3, -4 -> -3.5)',
                   (select line_at_pick from picks
                    where group_id = :'pool'::uuid and game_id = 201 and market = 'spread') = -3.5);
select pg_temp.chk('the total snapped too (52, 53 -> 52.5)',
                   (select line_at_pick from picks
                    where group_id = :'pool'::uuid and game_id = 201 and market = 'total') = 52.5);
select pg_temp.chk('straight-up carries no line',
                   (select line_at_pick is null from picks
                    where group_id = :'pool'::uuid and game_id = 201 and market = 'straight_up'));

\o /dev/null
begin;
  select test_as(:ann::uuid);
  select make_pick(:'crew'::uuid, 201, 'spread', 'away');
commit;
\o
select pg_temp.chk('opposite sides of one game in two groups both stand',
                   (select string_agg(g.slug || '=' || pk.side, ',' order by g.slug)
                    from picks pk join groups g on g.id = pk.group_id
                    where pk.user_id = :ann::uuid and pk.game_id = 201 and pk.market = 'spread')
                   = 'second-pool=home,the-crew=away');

-- ---------------------------------------------------------------------------
\echo '# re-picking re-snapshots rather than duplicating'
-- ---------------------------------------------------------------------------
\o /dev/null
insert into line_snapshots (game_id, provider, source, spread)
values (201, 'bookA', 'cfbd', -7.0), (201, 'bookB', 'cfbd', -8.0);
begin;
  select test_as(:ann::uuid);
  select make_pick(:'pool'::uuid, 201, 'spread', 'away');
commit;
\o
select pg_temp.chk('still one spread pick, re-sided and re-priced to -7.5',
                   (select count(*) from picks
                    where group_id = :'pool'::uuid and game_id = 201 and market = 'spread') = 1
               and (select side || ' ' || line_at_pick from picks
                    where group_id = :'pool'::uuid and game_id = 201 and market = 'spread')
                   = 'away -7.5');

-- ---------------------------------------------------------------------------
\echo '# what make_pick refuses'
-- ---------------------------------------------------------------------------
begin;
  select test_as(:bob::uuid);
  select pg_temp.raises('a non-member picking',
    format($$select make_pick(%L, 201, 'spread', 'home')$$, :'pool'));
rollback;
begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('a market the group turned off',
    format($$select make_pick(%L, 201, 'straight_up', 'home')$$, :'crew'));
  select pg_temp.raises('over/under on a spread',
    format($$select make_pick(%L, 201, 'spread', 'over')$$, :'pool'));
  select pg_temp.raises('a side on a game with no line',
    format($$select make_pick(%L, 203, 'spread', 'home')$$, :'pool'));
rollback;
\o /dev/null
update games set start_ts = now() - interval '1 hour' where id = 202;
\o
begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('a game that has kicked off',
    format($$select make_pick(%L, 202, 'spread', 'home')$$, :'pool'));
  select pg_temp.raises('removing a pick after kickoff',
    format($$select remove_pick(%L, 202, 'spread')$$, :'pool'));
rollback;
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select make_pick(:'pool'::uuid, 203, 'straight_up', 'home');
commit;
\o
select pg_temp.chk('straight-up works on 203, which has no line at all',
                   (select line_at_pick is null from picks
                    where group_id = :'pool'::uuid and game_id = 203));

-- ---------------------------------------------------------------------------
\echo '# a game outside the group is not pickable'
-- ---------------------------------------------------------------------------
\o /dev/null
-- Un-age 202: the kickoff test above locked week 2, which is the freeze doing
-- its job. Reopen it so this section can test the game list instead.
update games set start_ts = now() + interval '3 days' where id = 202;
begin;
  select test_as(:ann::uuid);
  select set_group_week_config(:'pool'::uuid, 2026, 2, 'regular', 'handpicked', null,
                               array['spread'], array[201]);
commit;
\o
begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('a game the admin left off the board',
    format($$select make_pick(%L, 203, 'spread', 'home')$$, :'pool'));
rollback;
select pg_temp.chk('picks already made on a dropped game are kept, not deleted',
                   (select count(*) from picks
                    where group_id = :'pool'::uuid and game_id = 203) = 1);

-- ---------------------------------------------------------------------------
\echo '# direct writes stay revoked, and visibility follows the group'
-- ---------------------------------------------------------------------------
begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('a hand-written line_at_pick',
    format($$insert into picks (season_id, group_id, user_id, game_id, market, side, line_at_pick)
             values (2026, %L, %L, 201, 'spread', 'home', -99)$$, :'pool', :ann));
  select pg_temp.raises('deleting a pick directly',
    $$delete from picks$$);
rollback;
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('a non-member sees none of the other pool''s picks',
                     (select count(*) from picks where group_id = :'pool'::uuid) = 0);
  select pg_temp.chk('but does see the crew picks they are in on',
                     (select count(*) from picks where group_id = :'crew'::uuid) > 0);
rollback;
begin;
  select test_as_anon();
  select pg_temp.chk('anon sees no picks from private groups',
                     (select count(*) from picks) = 0);
rollback;
