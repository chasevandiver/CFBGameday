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

\echo '# the confidence tier: set at insert, editable until kickoff (0045)'
-- 0045 widened enforce_bet_void_only()'s whitelist by exactly one transition.
-- These are the boundaries of that transition. The tier has to be able to move
-- (a typo should not be permanent) without becoming a way to decide after the
-- fact what you were confident about — so kickoff, not grading, is the line.
\o /dev/null
insert into games (id, season_id, week, season_type, start_ts, home_team_id, away_team_id)
values (302, 2026, 2, 'regular', now() - interval '2 hours', 1, 2),   -- already kicked
       (303, 2026, 2, 'regular', null,                       1, 2);  -- kickoff TBD
\o

begin;
  select test_as(:bob::uuid);
  insert into bets (season_id, user_id, game_id, bet_type, description, side,
                    line_taken, odds, units, reason_tag) values
    (2026, :bob::uuid, 301, 'spread', 'live',   'home', -3.5, -110, 1, 'feel'),
    (2026, :bob::uuid, 302, 'spread', 'kicked', 'home', -3.5, -110, 1, 'feel'),
    (2026, :bob::uuid, 303, 'spread', 'tbd',    'home', -3.5, -110, 1, 'feel'),
    (2026, :bob::uuid, 301, 'spread', 'graded', 'home', -3.5, -110, 1, 'feel');
  insert into bets (season_id, user_id, bet_type, description, units, reason_tag, confidence)
  values (2026, :bob::uuid, 'future', 'futures', 1, 'feel', 'lean');
  select pg_temp.chk('an unspecified tier lands on the neutral rung',
    (select confidence = 'bet' from bets where description = 'live'));
  select pg_temp.chk('an explicit tier survives the insert sanitizer',
    (select confidence = 'lean' from bets where description = 'futures'));
commit;

begin;
  select test_as(:bob::uuid);
  select pg_temp.raises('a tier outside the ladder -> refused',
    'update bets set confidence = ''hammer'' where description = ''live''');
rollback;

begin;
  select test_as(:bob::uuid);
  update bets set confidence = 'century' where description = 'live';
  select pg_temp.chk('retagging before kickoff lands',
    (select confidence = 'century' from bets where description = 'live'));
rollback;

begin;
  select test_as(:bob::uuid);
  -- the retag branch rebuilds from OLD too, so a stake edit riding along on it
  -- is discarded exactly the way a void carrying one already is
  update bets set confidence = 'year', units = 50 where description = 'live';
  select pg_temp.chk('a retag carrying a stake edit keeps only the tier',
    (select confidence = 'year' and units = 1 from bets where description = 'live'));
rollback;

begin;
  select test_as(:bob::uuid);
  select pg_temp.raises('retagging after kickoff -> refused',
    'update bets set confidence = ''century'' where description = ''kicked''');
rollback;

begin;
  select test_as(:bob::uuid);
  update bets set confidence = 'day' where description = 'tbd';
  select pg_temp.chk('a game with no announced kickoff has not started',
    (select confidence = 'day' from bets where description = 'tbd'));
rollback;

begin;
  select test_as(:bob::uuid);
  update bets set confidence = 'century' where description = 'futures';
  select pg_temp.chk('a future has no kickoff, so it retags until it grades',
    (select confidence = 'century' from bets where description = 'futures'));
rollback;

begin;
  select test_as(:ann::uuid);
  do $$ begin
    execute 'update bets set confidence = ''lean'' where description = ''live''';
  exception when others then null; end $$;
  select pg_temp.chk('ann cannot retag bob''s bet',
    (select confidence = 'bet' from bets where description = 'live'));
rollback;

-- Grading runs in its own transaction: a session cannot go service_role ->
-- authenticated inside one, because service_role is not a member of it.
begin;
  set local role service_role;
  update bets set result = 'loss', payout_units = -1 where description = 'graded';
commit;

begin;
  select test_as(:bob::uuid);
  select pg_temp.raises('retagging a graded bet -> refused',
    'update bets set confidence = ''lean'' where description = ''graded''');
rollback;

begin;
  select test_as(:bob::uuid);
  -- and the transition 0013 actually cared about is untouched by all of this
  update bets set result = 'void', voided_at = now() where description = 'live';
  select pg_temp.chk('voiding still works alongside the new branch',
    (select result = 'void' and confidence = 'bet' from bets where description = 'live'));
rollback;

\echo '# the append-only tables stay append-only (grants, not policies)'
select pg_temp.chk('authenticated cannot UPDATE predictions',
  not has_table_privilege('authenticated', 'public.predictions', 'UPDATE'));
select pg_temp.chk('authenticated cannot DELETE predictions',
  not has_table_privilege('authenticated', 'public.predictions', 'DELETE'));
select pg_temp.chk('authenticated cannot UPDATE line_snapshots',
  not has_table_privilege('authenticated', 'public.line_snapshots', 'UPDATE'));
select pg_temp.chk('authenticated cannot DELETE line_snapshots',
  not has_table_privilege('authenticated', 'public.line_snapshots', 'DELETE'));
select pg_temp.chk('anon cannot UPDATE predictions',
  not has_table_privilege('anon', 'public.predictions', 'UPDATE'));
select pg_temp.chk('anon cannot UPDATE line_snapshots',
  not has_table_privilege('anon', 'public.line_snapshots', 'UPDATE'));

\echo '# cover_flips is a receipt too (0026)'
select pg_temp.chk('authenticated cannot UPDATE cover_flips',
  not has_table_privilege('authenticated', 'public.cover_flips', 'UPDATE'));
select pg_temp.chk('authenticated cannot DELETE cover_flips',
  not has_table_privilege('authenticated', 'public.cover_flips', 'DELETE'));
select pg_temp.chk('but everyone can read them',
  has_table_privilege('anon', 'public.cover_flips', 'SELECT'));

-- ---------------------------------------------------------------------------
\echo '# reason_tag is optional now, and still constrained when present (0047)'
-- ---------------------------------------------------------------------------
-- LEDGER-1 took the required "Why" picker out of the slip and the form. The
-- column stays for history and for the CSV export, so what has to hold is:
-- a bet inserts without one, and a garbage value is still refused. A CHECK
-- passes on NULL by definition, which is the whole reason it needed no change.
\o /dev/null
insert into games (id, season_id, week, season_type, start_ts, home_team_id, away_team_id)
values (777, 2026, 3, 'regular', now() + interval '5 days', 1, 2);
\o

\o /dev/null
insert into bets (season_id, user_id, game_id, bet_type, description, side,
                  line_taken, odds, units)
values (2026, :ann::uuid, 777, 'spread', 'Georgia -3', 'home', -3, -110, 2);
\o
select pg_temp.chk('a bet logs with no reason tag at all',
  (select reason_tag is null from bets where game_id = 777));

select pg_temp.raises('and an invented tag is still refused',
  $$insert into bets (season_id, user_id, game_id, bet_type, description, side,
                      line_taken, odds, units, reason_tag)
    values (2026, '11111111-1111-1111-1111-111111111111'::uuid, 777, 'spread',
            'Georgia -3', 'home', -3, -110, 2, 'vibes')$$);

-- ---------------------------------------------------------------------------
\echo '# scoring_plays: everyone reads it, only the writers write it (0048)'
-- ---------------------------------------------------------------------------
-- SCORE-1. A scoring summary is no more private than the score it adds up to,
-- so read matches `games`. Writes are the ingest jobs' alone: this is a record
-- of what happened and nothing a user does should be able to edit it. Same
-- posture as cover_flips (0026).
\o /dev/null
insert into scoring_plays (game_id, sequence, period, clock, scoring_team_id,
                           play_type, play_text, home_points, away_points, source)
values (777, 0, 1, '9:04', 1, 'Passing Touchdown',
        'Ewers pass complete to Worthy for 17 yds for a TD', 7, 0, 'cfbd');
\o

select pg_temp.chk('a signed-out visitor can read the timeline',
  (select count(*) = 1 from scoring_plays where game_id = 777));

select public.expect_denied('but anon cannot write one', null,
  $q$insert into scoring_plays (game_id, sequence, play_text, home_points, away_points, source)
     values (777, 99, 'invented', 99, 0, 'nope')$q$,
  'permission denied');

select public.expect_denied('and neither can a signed-in user', :ann::uuid,
  $q$insert into scoring_plays (game_id, sequence, play_text, home_points, away_points, source)
     values (777, 98, 'invented', 99, 0, 'nope')$q$,
  'permission denied');

select public.expect_denied('nor edit one that is there', :ann::uuid,
  $q$update scoring_plays set play_text = 'rewritten' where game_id = 777$q$,
  'permission denied');

-- The unique key is what makes the writer idempotent: a poll that re-reads the
-- same summary upserts the same rows rather than appending the game's history
-- a second time.
select pg_temp.raises('the same play cannot land twice',
  $$insert into scoring_plays (game_id, sequence, play_text, home_points, away_points, source)
    values (777, 0, 'duplicate', 7, 0, 'cfbd')$$);

-- ---------------------------------------------------------------------------
-- R2-A4 (0055): marking a future is the second permitted edit — and only that.
-- ---------------------------------------------------------------------------

\echo '# marking futures'
begin;
  select test_as(:bob::uuid);
  insert into bets (season_id, user_id, bet_type, description, units, odds, reason_tag)
  values (2026, :bob::uuid, 'future', 'UGA to win it all +900', 1, 900, 'feel');
  select id as futbet from bets
    where user_id = :bob::uuid and bet_type = 'future'
    order by id desc limit 1 \gset

  update bets set marked_odds = 450 where id = :futbet;
  select pg_temp.chk('an open future takes a mark, and the trigger stamps marked_at',
    (select marked_odds = 450 and marked_at is not null and result is null
     from bets where id = :futbet));

  update bets set marked_odds = null where id = :futbet;
  select pg_temp.chk('a null mark clears marked_at too',
    (select marked_odds is null and marked_at is null
     from bets where id = :futbet));

  -- A mark that tries to smuggle a grade: the trigger rebuilds NEW from OLD,
  -- so everything except the mark is discarded silently.
  update bets set marked_odds = 300, payout_units = 99, units = 50 where id = :futbet;
  select pg_temp.chk('a mark cannot carry a payout or a resize along',
    (select marked_odds = 300 and payout_units is null and units = 1
     from bets where id = :futbet));
rollback;

begin;
  select test_as(:bob::uuid);
  insert into bets (season_id, user_id, game_id, bet_type, description, side,
                    line_taken, odds, units, reason_tag)
  values (2026, :bob::uuid, 301, 'spread', 'UGA -3.5', 'home', -3.5, -110, 1, 'feel');
  select id as spreadbet from bets
    where user_id = :bob::uuid and bet_type = 'spread'
    order by id desc limit 1 \gset
  select pg_temp.raises('marking a non-future is still append-only',
    'update bets set marked_odds = 450 where id = ' || :spreadbet);
rollback;

\echo '# team_side arrives structured and constrained'
begin;
  select test_as(:bob::uuid);
  insert into bets (season_id, user_id, game_id, bet_type, description, side,
                    team_side, line_taken, odds, units, reason_tag)
  values (2026, :bob::uuid, 301, 'team_total', 'UGA team total o24.5', 'over',
          'home', 24.5, -110, 1, 'feel');
  select pg_temp.chk('a team_total stores its subject team',
    (select team_side = 'home' from bets
      where user_id = :bob::uuid and bet_type = 'team_total'));
  select pg_temp.raises('team_side rejects anything but home/away',
    $$insert into bets (season_id, user_id, game_id, bet_type, description, side,
                        team_side, line_taken, odds, units, reason_tag)
      values (2026, '22222222-2222-2222-2222-222222222222', 301, 'team_total',
              'bad', 'over', 'both', 24.5, -110, 1, 'feel')$$);
rollback;
