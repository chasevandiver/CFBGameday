-- The append-only ledger, enforced (0013 §2).
--
-- "Unhideable by design" is Honest Note #5 and it is schema, not policy: the
-- only user-driven edit on a bet is ungraded → voided, inserts are sanitized
-- so grading fields can't be pre-set, and a settled bet is immutable — a
-- forged win or an erased loss must be impossible, because the Sunday grader
-- skips rows whose result is already set. This suite is the regression net
-- the audit (06/SEC-03) found missing for the enforce_bet_void_only /
-- bets_insert_clean triggers.

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
  (1, 'Georgia', 'UGA',  'SEC', 'fbs'),
  (2, 'Alabama', 'BAMA', 'SEC', 'fbs');
insert into games (id, season_id, week, season_type, start_ts, home_team_id, away_team_id)
values (301, 2026, 2, 'regular', now() + interval '3 days', 1, 2);
insert into invite_allowlist (email, make_admin) values
  ('ann@example.com', true), ('bob@example.com', false);
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ann@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');
\o

\set ann '''11111111-1111-1111-1111-111111111111'''
\set bob '''22222222-2222-2222-2222-222222222222'''

\echo '# inserts arrive clean'
begin;
  select test_as(:bob::uuid);
  -- bob tries to log a bet born graded: a win, paid out, with CLV
  insert into bets (season_id, user_id, game_id, bet_type, description, side,
                    line_taken, odds, units, reason_tag,
                    result, payout_units, clv, closing_line)
  values (2026, :bob::uuid, 301, 'spread', 'UGA -3.5', 'home',
          -3.5, -110, 1, 'feel',
          'win', 9.09, 5, -9.5);
  select pg_temp.chk('the sanitizer stripped every grading field',
    (select result is null and payout_units is null and clv is null
        and closing_line is null and voided_at is null
     from bets where user_id = :bob::uuid));
commit;

select id as bobbet from bets where user_id = :bob::uuid \gset

\echo '# the only user edit is voiding'
begin;
  select test_as(:bob::uuid);
  select pg_temp.raises('rewriting the line you took -> refused',
    'update bets set line_taken = -1.5 where id = ' || :bobbet);
  select pg_temp.raises('granting yourself a win -> refused',
    'update bets set result = ''win'', payout_units = 9 where id = ' || :bobbet);
rollback;

begin;
  select test_as(:bob::uuid);
  -- a void that also tries to sneak the units up: the trigger rebuilds the
  -- row from OLD, keeping only the void itself
  update bets set result = 'void', voided_at = now(), units = 50
  where id = :bobbet;
  select pg_temp.chk('void lands, but the units edit is discarded',
    (select result = 'void' and voided_at is not null and units = 1
     from bets where id = :bobbet));
  select pg_temp.raises('un-voiding -> refused',
    'update bets set result = null, voided_at = null where id = ' || :bobbet);
rollback;

\echo '# a graded bet is history'
begin;
  -- the Sunday grader connects as service_role and is exempt from the trigger
  set local role service_role;
  update bets set result = 'loss', payout_units = -1, closing_line = -6.5
  where id = :bobbet;
commit;

begin;
  select test_as(:bob::uuid);
  select pg_temp.raises('voiding away a graded loss -> refused',
    'update bets set result = ''void'', voided_at = now() where id = ' || :bobbet);
  select pg_temp.raises('flipping a loss to a win -> refused',
    'update bets set result = ''win'' where id = ' || :bobbet);
  -- deletes were never granted at all — append-only means no eraser exists
  select pg_temp.raises('deleting the loss -> refused',
    'delete from bets where id = ' || :bobbet);
  select pg_temp.chk('the loss is still on the ledger',
    (select count(*) = 1 from bets where id = :bobbet));
rollback;

\echo '# other people''s ledgers'
begin;
  select test_as(:ann::uuid);
  do $$ begin
    execute 'update bets set units = 0.01 where user_id = ''22222222-2222-2222-2222-222222222222''';
  exception when others then null; end $$;
  select pg_temp.chk('ann cannot shrink bob''s losing stake',
    (select units = 1 from bets where id = :bobbet));
rollback;

begin;
  select test_as_anon();
  do $$ begin
    execute 'insert into bets (season_id, user_id, bet_type, description, units, reason_tag) '
         || 'values (2026, ''22222222-2222-2222-2222-222222222222'', ''future'', ''forged'', 1, ''feel'')';
  exception when others then null; end $$;
  select pg_temp.chk('anon cannot plant a bet on someone''s ledger',
    (select count(*) = 1 from bets));
rollback;
