-- Admin cancellation of wagers (0046 / ADM-1, ADM-2).
--
-- Three things only the database can answer:
--
--   * `deleted_wagers` is genuinely unreachable. It holds whole rows of other
--     people's betting history, so "deny-all" has to mean deny-all to both API
--     roles, not just to anon.
--
--   * `admin_remove_pick` refuses everyone except an admin OF THAT GROUP. A
--     member, a stranger and a signed-out caller must all be turned away, and
--     an admin of a *different* group is the case a group-blind admin check
--     would wave straight through.
--
--   * It works after kickoff, which is the whole point — `remove_pick`
--     (0038:62-64) raises there, and correcting a pick on a game that has
--     already started is exactly what an admin is for.
--
-- The attempts go through parameterised helpers rather than the `raises(text)`
-- idiom the other suites use: the statements here need a group UUID that only
-- exists at runtime, and building them as strings means nesting dollar quotes
-- three deep for no benefit.

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

-- Attempt admin_remove_pick as `p_as` (null = signed out) and expect a refusal.
-- `set local role` is transaction-scoped and each of these runs in its own
-- implicit transaction, so the role never leaks into the next assertion.
--
-- `p_expect` is not decoration. A bare "any error is a pass" helper reports
-- PASS when the function does not exist at all — verified: with 0046 removed,
-- all four refusal assertions passed on "function admin_remove_pick does not
-- exist" while proving nothing whatever about authorization. So the message
-- has to be the one the security check produces, and a missing-object error
-- (42883 / 42P01) is called out by name rather than absorbed.
create function pg_temp.denied(
  label text, p_as uuid, p_group uuid, p_target uuid, p_game integer, p_market text,
  p_expect text
) returns text
language plpgsql as $$
begin
  if p_as is null then perform test_as_anon(); else perform test_as(p_as); end if;
  perform admin_remove_pick(p_group, p_target, p_game, p_market);
  return 'FAIL  ' || label || ' (no error raised)';
exception
  when undefined_function or undefined_table or undefined_column then
    return 'FAIL  ' || label || ' (vacuous — the object is missing: ' || sqlerrm || ')';
  when others then
    if position(p_expect in sqlerrm) = 0 then
      return 'FAIL  ' || label || ' (wrong error: ' || sqlerrm || ')';
    end if;
    return 'PASS  ' || label || ' -> ' || sqlerrm;
end; $$;

-- The same, for a statement that should be refused to a given role.
create function pg_temp.denied_sql(label text, p_as uuid, stmt text, p_expect text)
returns text
language plpgsql as $$
begin
  if p_as is null then perform test_as_anon(); else perform test_as(p_as); end if;
  execute stmt;
  return 'FAIL  ' || label || ' (no error raised)';
exception
  when undefined_function or undefined_table or undefined_column then
    return 'FAIL  ' || label || ' (vacuous — the object is missing: ' || sqlerrm || ')';
  when others then
    if position(p_expect in sqlerrm) = 0 then
      return 'FAIL  ' || label || ' (wrong error: ' || sqlerrm || ')';
    end if;
    return 'PASS  ' || label || ' -> ' || sqlerrm;
end; $$;

\o /dev/null
insert into seasons (id, label, week0_start, is_current)
values (2026, '2026', date '2026-08-29', true);

insert into teams (id, school, abbreviation, conference, classification) values
  (1, 'Georgia', 'UGA',  'SEC', 'fbs'),
  (2, 'Alabama', 'BAMA', 'SEC', 'fbs');

-- 401 is upcoming; 402 has already kicked off and is the one that matters.
insert into games (id, season_id, week, season_type, start_ts, home_team_id, away_team_id) values
  (401, 2026, 2, 'regular', now() + interval '3 days', 1, 2),
  (402, 2026, 1, 'regular', now() - interval '2 hours', 2, 1);

insert into line_snapshots (game_id, provider, source, spread, total) values
  (401, 'bookA', 'cfbd', -3.0, 52.0),
  (402, 'bookA', 'cfbd', -6.5, 47.5);

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

-- Ann runs a pool with Bob in it. Cal runs his own, and is a stranger to Ann's.
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select create_group('Saturday Boys', 'private') as grp \gset
  select set_group_week_config(:'grp'::uuid, 2026, 2, 'regular', 'full_slate', null,
                               array['spread'], null);
commit;
select join_code as code from groups where id = :'grp'::uuid \gset

begin;
  select test_as(:bob::uuid);
  select join_group(:'code');
commit;

begin;
  select test_as(:cal::uuid);
  select create_group('Other Pool', 'private') as other \gset
commit;
\o

-- ---------------------------------------------------------------------------
\echo '# deleted_wagers is deny-all to both API roles'
-- ---------------------------------------------------------------------------
select pg_temp.denied_sql('anon cannot read the archive', null,
  'select 1 from deleted_wagers', 'permission denied');
select pg_temp.denied_sql('a signed-in user cannot read the archive', :ann::uuid,
  'select 1 from deleted_wagers', 'permission denied');
select pg_temp.denied_sql('and cannot write one either', :ann::uuid,
  $q$insert into deleted_wagers (kind, payload) values ('bet', '{}'::jsonb)$q$,
  'permission denied');

-- ---------------------------------------------------------------------------
\echo '# admin_remove_pick refuses everyone but an admin of that group'
-- ---------------------------------------------------------------------------
\o /dev/null
begin;
  select test_as(:bob::uuid);
  select make_pick(:'grp'::uuid, 401, 'spread', 'home');
commit;
\o
select pg_temp.chk('Bob has a pick to cancel',
                   (select count(*) from picks where game_id = 401 and user_id = :bob::uuid) = 1);

select pg_temp.denied('a plain member cannot cancel a teammate''s pick',
                      :bob::uuid, :'grp'::uuid, :ann::uuid, 401, 'spread',
                      'Only a group admin');
select pg_temp.denied('a stranger cannot',
                      :cal::uuid, :'grp'::uuid, :bob::uuid, 401, 'spread',
                      'Only a group admin');
-- Cal IS an admin — of his own group. A check that asked "is this caller an
-- admin anywhere" instead of "an admin here" would let this through.
select pg_temp.chk('...and the stranger really is an admin of his own group',
                   (select role from group_members
                     where group_id = :'other'::uuid and user_id = :cal::uuid) = 'admin');
-- anon never got EXECUTE (0046 revoke), so this one is stopped a step earlier
-- than the others — by the grant rather than by the function body.
select pg_temp.denied('a signed-out caller cannot',
                      null, :'grp'::uuid, :bob::uuid, 401, 'spread',
                      'permission denied for function');

select pg_temp.chk('Bob''s pick survived all of that',
                   (select count(*) from picks where game_id = 401 and user_id = :bob::uuid) = 1);

-- ---------------------------------------------------------------------------
\echo '# the group admin can, and it is archived rather than lost'
-- ---------------------------------------------------------------------------
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('the admin cancels exactly one row',
                     admin_remove_pick(:'grp'::uuid, :bob::uuid, 401, 'spread') = 1);
commit;
select pg_temp.chk('the pick is gone',
                   (select count(*) from picks where game_id = 401) = 0);
select pg_temp.chk('the archive kept it, whole',
                   (select count(*) from deleted_wagers
                     where kind = 'pick' and (payload->>'game_id')::int = 401) = 1);
select pg_temp.chk('and recorded who did it',
                   (select deleted_by from deleted_wagers where kind = 'pick') = :ann::uuid);
select pg_temp.chk('the archived row carries the side that was picked',
                   (select payload->>'side' from deleted_wagers where kind = 'pick') = 'home');

-- Idempotent, for the reason 0038:24-30 gives: the second tap of a double-tap
-- asks for a state the pick is already in.
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('cancelling again succeeds and reports zero',
                     admin_remove_pick(:'grp'::uuid, :bob::uuid, 401, 'spread') = 0);
commit;
select pg_temp.chk('and did not archive a second, empty row',
                   (select count(*) from deleted_wagers where kind = 'pick') = 1);

-- ---------------------------------------------------------------------------
\echo '# after kickoff — the case remove_pick refuses and this exists for'
-- ---------------------------------------------------------------------------
-- Game 402 started two hours ago. Bob's pick is planted directly: make_pick
-- has its own kickoff lock, which is correct and is not what is under test.
\o /dev/null
insert into picks (group_id, user_id, game_id, market, side, line_at_pick, season_id, locked_at)
values (:'grp'::uuid, :bob::uuid, 402, 'spread', 'away', -6.5, 2026, now());
\o

select pg_temp.denied_sql('the member himself is locked out after kickoff', :bob::uuid,
  'select remove_pick(' || quote_literal(:'grp') || '::uuid, 402, ''spread'')',
  'picks are locked');

begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('the admin is not — this is the whole point',
                     admin_remove_pick(:'grp'::uuid, :bob::uuid, 402, 'spread') = 1);
commit;
select pg_temp.chk('the post-kickoff pick is gone',
                   (select count(*) from picks where game_id = 402) = 0);

-- ---------------------------------------------------------------------------
\echo '# a graded pick can be cancelled too — that is how a test row is cleared'
-- ---------------------------------------------------------------------------
\o /dev/null
insert into picks (group_id, user_id, game_id, market, side, line_at_pick, season_id, locked_at, result)
values (:'grp'::uuid, :bob::uuid, 402, 'spread', 'home', -6.5, 2026, now(), 'win');
\o
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('a settled pick is cancellable',
                     admin_remove_pick(:'grp'::uuid, :bob::uuid, 402, 'spread') = 1);
commit;
select pg_temp.chk('and its grade went into the archive with it',
                   (select payload->>'result' from deleted_wagers
                     order by id desc limit 1) = 'win');

-- ---------------------------------------------------------------------------
\echo '# bets: still no delete for anyone but the service role (ADM-1)'
-- ---------------------------------------------------------------------------
-- ADM-1 deletes through the service role, which is RLS- and grant-exempt. What
-- must stay true is that nothing else gained a delete: 0001:360 revoked it and
-- 0046 does not hand it back.
\o /dev/null
insert into bets (season_id, user_id, game_id, bet_type, description, side,
                  line_taken, odds, units, reason_tag)
values (2026, :bob::uuid, 401, 'spread', 'Georgia -3', 'home', -3, -110, 2, 'model_edge');
\o
select pg_temp.denied_sql('a bettor cannot delete their own bet', :bob::uuid,
  'delete from bets where user_id = ' || quote_literal(:bob) || '::uuid',
  'permission denied');
select pg_temp.denied_sql('and anon certainly cannot', null, 'delete from bets',
  'permission denied');
select pg_temp.chk('the bet is still there',
                   (select count(*) from bets where game_id = 401) = 1);
