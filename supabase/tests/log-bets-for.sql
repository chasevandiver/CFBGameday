-- Logging a bet for a member (0083): the grant, the byline, and the void.
-- Same posture as bets.sql — every assertion runs as an API role through
-- `test_as`, so the policies and the definer function are exercised the way
-- PostgREST would exercise them.

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
-- One game already kicked off: the ledger has no kickoff lock and this suite
-- pins that a proxy row is no different.
insert into games (id, season_id, week, season_type, start_ts, home_team_id, away_team_id) values
  (301, 2026, 2, 'regular', now() + interval '3 days', 1, 2),
  (302, 2026, 2, 'regular', now() - interval '1 hour', 2, 1);
insert into invite_allowlist (email, make_admin) values
  ('ann@example.com', false), ('bob@example.com', false),
  ('cal@example.com', false), ('dee@example.com', false);
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ann@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'cal@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'dee@example.com');
\o

\set ann '''11111111-1111-1111-1111-111111111111'''
\set bob '''22222222-2222-2222-2222-222222222222'''
\set cal '''33333333-3333-3333-3333-333333333333'''
\set dee '''44444444-4444-4444-4444-444444444444'''

-- ann runs a betting group with bob in it; cal is in a pick'em group ann also
-- runs; dee is in nothing of ann's.
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select create_group('The Book', 'private', 'betting') as book \gset
  select add_group_member(:'book'::uuid, :bob::uuid);
  select create_group('Family Pickem', 'private', 'pickem') as pickem \gset
  select add_group_member(:'pickem'::uuid, :cal::uuid);
commit;
\o

\echo '# the grant'
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('an admin may log for a member of her betting group',
    can_log_bet_for(:bob::uuid));
  select pg_temp.chk('but not for herself — a self row is a self row',
    not can_log_bet_for(:ann::uuid));
  select pg_temp.chk('not for a pick''em member — no ledger there',
    not can_log_bet_for(:cal::uuid));
  select pg_temp.chk('not for a stranger',
    not can_log_bet_for(:dee::uuid));
  select pg_temp.chk('not for nobody',
    not can_log_bet_for(null));
rollback;
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('a plain member may not log for the admin',
    not can_log_bet_for(:ann::uuid));
rollback;
begin;
  select test_as_anon();
  select pg_temp.raises('signed out cannot even ask',
    format('select can_log_bet_for(%L)', :bob));
rollback;

\echo '# the proxy insert'
begin;
  select test_as(:ann::uuid);
  insert into bets (season_id, user_id, game_id, bet_type, description, side,
                    line_taken, odds, units, logged_by)
  values (2026, :bob::uuid, 301, 'spread', 'UGA -3.5', 'home', -3.5, -110, 1, :ann::uuid);
  select pg_temp.chk('ann logs a bet for bob, signed',
    exists (select 1 from bets where user_id = :bob::uuid and logged_by = :ann::uuid));
  select pg_temp.chk('the row is bob''s in every other respect',
    (select user_id = :bob::uuid and result is null and voided_at is null
     from bets where logged_by = :ann::uuid));
  -- After kickoff too: the ledger has never locked at kickoff and a proxy row
  -- follows the ledger's rule, not the pick'em board's.
  insert into bets (season_id, user_id, game_id, bet_type, description, side,
                    line_taken, odds, units, logged_by)
  values (2026, :bob::uuid, 302, 'total', 'Over 52', 'over', 52, -110, 1, :ann::uuid);
  select pg_temp.chk('a proxy row on a kicked-off game lands like any bet would',
    (select count(*) from bets where user_id = :bob::uuid) = 2);
  select pg_temp.chk('placed_at is the log time, not the caller''s to choose',
    (select bool_and(placed_at >= now() - interval '1 minute') from bets where user_id = :bob::uuid));
commit;

begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('a proxy row must carry the byline',
    format($$insert into bets (season_id, user_id, game_id, bet_type, description, side,
                               line_taken, odds, units)
             values (2026, %L, 301, 'spread', 'UGA -3.5', 'home', -3.5, -110, 1)$$, :bob));
  select pg_temp.raises('and the byline must be the caller, not somebody else',
    format($$insert into bets (season_id, user_id, game_id, bet_type, description, side,
                               line_taken, odds, units, logged_by)
             values (2026, %L, 301, 'spread', 'UGA -3.5', 'home', -3.5, -110, 1, %L)$$, :bob, :cal));
  select pg_temp.raises('a self row cannot name anyone else as its logger',
    format($$insert into bets (season_id, user_id, game_id, bet_type, description, side,
                               line_taken, odds, units, logged_by)
             values (2026, %L, 301, 'spread', 'UGA -3.5', 'home', -3.5, -110, 1, %L)$$, :ann, :bob));
  select pg_temp.raises('no logging for a pick''em member',
    format($$insert into bets (season_id, user_id, game_id, bet_type, description, side,
                               line_taken, odds, units, logged_by)
             values (2026, %L, 301, 'spread', 'UGA -3.5', 'home', -3.5, -110, 1, %L)$$, :cal, :ann));
  select pg_temp.raises('no logging for a stranger',
    format($$insert into bets (season_id, user_id, game_id, bet_type, description, side,
                               line_taken, odds, units, logged_by)
             values (2026, %L, 301, 'spread', 'UGA -3.5', 'home', -3.5, -110, 1, %L)$$, :dee, :ann));
rollback;
begin;
  select test_as(:bob::uuid);
  select pg_temp.raises('a plain member cannot log for the admin',
    format($$insert into bets (season_id, user_id, game_id, bet_type, description, side,
                               line_taken, odds, units, logged_by)
             values (2026, %L, 301, 'spread', 'UGA -3.5', 'home', -3.5, -110, 1, %L)$$, :ann, :bob));
  -- The everyday path is untouched: bob logs his own bet with no byline.
  insert into bets (season_id, user_id, game_id, bet_type, description, side,
                    line_taken, odds, units)
  values (2026, :bob::uuid, 301, 'moneyline', 'UGA ML', 'home', null, -160, 1);
  select pg_temp.chk('a self-logged row still lands, byline null',
    exists (select 1 from bets where user_id = :bob::uuid and bet_type = 'moneyline' and logged_by is null));
  -- and bob may also sign his own row, harmlessly
  insert into bets (season_id, user_id, game_id, bet_type, description, side,
                    line_taken, odds, units, logged_by)
  values (2026, :bob::uuid, 301, 'total', 'Under 52', 'under', 52, -110, 1, :bob::uuid);
  select pg_temp.chk('naming yourself as logger is allowed and means the same thing',
    exists (select 1 from bets where user_id = :bob::uuid and logged_by = :bob::uuid));
rollback;

select id as proxybet from bets where user_id = :bob::uuid and game_id = 301 \gset

\echo '# the void'
begin;
  select test_as(:cal::uuid);
  update bets set voided_at = now(), result = 'void' where id = :proxybet;
  select pg_temp.chk('a stranger''s void touches nothing (RLS hides the row)',
    (select voided_at is null from bets where id = :proxybet));
rollback;
begin;
  select test_as(:ann::uuid);
  update bets set voided_at = now(), result = 'void' where id = :proxybet;
  select pg_temp.chk('the admin voids the row she logged for bob',
    (select result = 'void' and voided_at is not null from bets where id = :proxybet));
rollback;
begin;
  select test_as(:bob::uuid);
  update bets set voided_at = now(), result = 'void' where id = :proxybet;
  select pg_temp.chk('and bob can void it himself — it is his bet',
    (select result = 'void' from bets where id = :proxybet));
rollback;
begin;
  select test_as(:ann::uuid);
  select pg_temp.raises('the widened policy changes who may ask, not what may change',
    'update bets set units = 50 where id = ' || :proxybet);
rollback;

\echo '# a seat counts as a member'
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select create_managed_member(:'book'::uuid, 'Jeff') as seat \gset
commit;
\o
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('an admin may log for a seat of her betting group',
    can_log_bet_for(:'seat'::uuid));
rollback;

\echo '# the grant follows the roster'
begin;
  select test_as(:ann::uuid);
  select remove_group_member(:'book'::uuid, :bob::uuid);
  select pg_temp.chk('a removed member is nobody''s to log for',
    not can_log_bet_for(:bob::uuid));
  select pg_temp.raises('and the insert says so',
    format($$insert into bets (season_id, user_id, game_id, bet_type, description, side,
                               line_taken, odds, units, logged_by)
             values (2026, %L, 301, 'spread', 'UGA -3.5', 'home', -3.5, -110, 1, %L)$$, :bob, :ann));
rollback;
begin;
  select test_as(:ann::uuid);
  select archive_group(:'book'::uuid);
  select pg_temp.chk('an archived group grants nothing',
    not can_log_bet_for(:bob::uuid));
rollback;
