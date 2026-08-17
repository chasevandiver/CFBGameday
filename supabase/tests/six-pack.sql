-- The Six-Pack (R3-E2, migration 0062).
--
-- Entries are RPC-only and all-or-nothing, so the assertions that matter are
-- the refusals: a partial entry, a choice the question never offered, an
-- entry after kickoff (with TBD counting as locked), and an entry once
-- grading has begun. Plus the blind — nobody reads anybody else's answers
-- until the slate's first game kicks.

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
  (2, 'Alabama', 'BAMA', 'SEC', 'fbs'),
  (3, 'Auburn',  'AUB',  'SEC', 'fbs'),
  (4, 'Texas',   'TEX',  'SEC', 'fbs');

-- The open slate's games (all future) and a second week that has kicked off.
insert into games (id, season_id, week, season_type, start_ts, home_team_id, away_team_id) values
  (501, 2026, 3, 'regular', now() + interval '4 days', 1, 2),
  (502, 2026, 3, 'regular', now() + interval '4 days', 3, 4),
  (601, 2026, 4, 'regular', now() - interval '2 hours', 1, 3),
  (602, 2026, 4, 'regular', now() + interval '2 days',  2, 4);

insert into six_pack_slates (id, season_id, season_type, week)
  overriding system value values (900, 2026, 'regular', 3), (901, 2026, 'regular', 4);

insert into six_pack_questions (slate_id, idx, kind, game_id, line, choices) values
  (900, 1, 'winner',    501, null,  array['home','away']),
  (900, 2, 'winner',    502, null,  array['home','away']),
  (900, 3, 'cover',     501, -6.5,  array['home','away']),
  (900, 4, 'total',     502, 51.5,  array['over','under']),
  (900, 5, 'margin',    501, null,  array['1-7','8-14','15+']),
  (900, 6, 'high_game', null, null, array['501','502']),
  -- Week 4: its first game has already kicked, so this slate is locked.
  (901, 1, 'winner',    601, null,  array['home','away']),
  (901, 2, 'winner',    602, null,  array['home','away']),
  (901, 3, 'cover',     601, -3.5,  array['home','away']),
  (901, 4, 'total',     602, 44.5,  array['over','under']),
  (901, 5, 'margin',    601, null,  array['1-7','8-14','15+']),
  (901, 6, 'high_game', null, null, array['601','602']);

insert into invite_allowlist (email, make_admin) values
  ('ann@example.com', false), ('bob@example.com', false);
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ann@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');
\o

\set ann '''11111111-1111-1111-1111-111111111111'''
\set bob '''22222222-2222-2222-2222-222222222222'''
\set six '''{home,away,home,over,1-7,501}'''

\echo '# the entry lands, all six at once'
begin;
  select test_as(:ann::uuid);
  select submit_six_pack(900, :six::text[]);
  select pg_temp.chk('all six answers land',
    (select count(*) = 6 from six_pack_entries
      where user_id = :ann::uuid and slate_id = 900));
  select pg_temp.chk('the answers are the ones submitted',
    (select choice = 'over' from six_pack_entries
      where user_id = :ann::uuid and slate_id = 900 and idx = 4));
  -- Changing your mind before kickoff is part of the game.
  select submit_six_pack(900, '{away,away,home,under,15+,502}'::text[]);
  select pg_temp.chk('re-entering before kickoff replaces, never duplicates',
    (select count(*) = 6 from six_pack_entries
      where user_id = :ann::uuid and slate_id = 900));
  select pg_temp.chk('and the new answers stuck',
    (select choice = 'under' from six_pack_entries
      where user_id = :ann::uuid and slate_id = 900 and idx = 4));
rollback;

\echo '# the refusals'
select public.expect_denied('a partial entry -> refused', :ann::uuid,
  $q$select submit_six_pack(900, '{home,away,home}'::text[])$q$,
  'answer all six');
select public.expect_denied('an answer the question never offered -> refused', :ann::uuid,
  $q$select submit_six_pack(900, '{home,away,home,sideways,1-7,501}'::text[])$q$,
  'not one of the answers');
select public.expect_denied('an entry on a slate whose first game kicked -> refused', :ann::uuid,
  $q$select submit_six_pack(901, '{home,away,home,over,1-7,601}'::text[])$q$,
  'the six-pack is locked');
select public.expect_denied('a slate that does not exist -> refused', :ann::uuid,
  $q$select submit_six_pack(99999, '{home,away,home,over,1-7,501}'::text[])$q$,
  'no six-pack for that week');
select public.expect_denied('anon cannot execute the RPC', null,
  $q$select submit_six_pack(900, '{home,away,home,over,1-7,501}'::text[])$q$,
  'permission denied');

\echo '# direct writes are denied everywhere'
select public.expect_denied('direct entry insert -> denied', :bob::uuid,
  $q$insert into six_pack_entries (user_id, slate_id, idx, choice)
     values ('22222222-2222-2222-2222-222222222222', 900, 1, 'home')$q$,
  'permission denied');
select public.expect_denied('writing a question -> denied', :bob::uuid,
  $q$insert into six_pack_questions (slate_id, idx, kind, game_id, choices)
     values (900, 6, 'winner', 501, array['home','away'])$q$,
  'permission denied');
select public.expect_denied('grading your own answer -> denied', :bob::uuid,
  $q$update six_pack_questions set answer = 'home' where slate_id = 900 and idx = 1$q$,
  'permission denied');
select public.expect_denied('minting a slate -> denied', :bob::uuid,
  $q$insert into six_pack_slates (season_id, season_type, week) values (2026, 'regular', 9)$q$,
  'permission denied');

\echo '# TBD kickoff counts as locked (fail closed)'
\o /dev/null
insert into six_pack_slates (id, season_id, season_type, week)
  overriding system value values (902, 2026, 'regular', 5);
-- 701 has no announced kickoff; 702 is safely in the future. One TBD is
-- enough to lock the slate, which is the fail-closed rule under test.
insert into games (id, season_id, week, season_type, start_ts, home_team_id, away_team_id)
  values (701, 2026, 5, 'regular', null, 1, 4),
         (702, 2026, 5, 'regular', now() + interval '6 days', 2, 3);
insert into six_pack_questions (slate_id, idx, kind, game_id, line, choices) values
  (902, 1, 'winner', 701, null, array['home','away']),
  (902, 2, 'winner', 702, null, array['home','away']),
  (902, 3, 'cover',  701, -3.5, array['home','away']),
  (902, 4, 'total',  702, 44.5, array['over','under']),
  (902, 5, 'margin', 701, null, array['1-7','8-14','15+']),
  (902, 6, 'high_game', null, null, array['701','702']);
\o
select public.expect_denied('a slate whose kickoff is TBD -> refused', :ann::uuid,
  $q$select submit_six_pack(902, '{home,away,home,over,1-7,701}'::text[])$q$,
  'the six-pack is locked');

\echo '# grading closes entry'
\o /dev/null
update six_pack_questions set answer = 'home', graded_at = now()
  where slate_id = 900 and idx = 1;
\o
select public.expect_denied('an entry once grading has begun -> refused', :bob::uuid,
  $q$select submit_six_pack(900, '{home,away,home,over,1-7,501}'::text[])$q$,
  'already started grading');
\o /dev/null
update six_pack_questions set answer = null, graded_at = null
  where slate_id = 900 and idx = 1;
\o

\echo '# the blind'
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select submit_six_pack(900, :six::text[]);
commit;
\o
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('bob cannot read ann''s open-slate entry',
    not exists (select 1 from six_pack_entries
                 where user_id = :ann::uuid and slate_id = 900));
  select pg_temp.chk('an all-future slate is not revealed',
    not (select six_pack_revealed(900)));
  select pg_temp.chk('a slate whose first game kicked IS revealed',
    (select six_pack_revealed(901)));
rollback;

-- And once it reveals, the crew can read it: the same row, both answers.
\o /dev/null
insert into six_pack_entries (user_id, slate_id, idx, choice)
values (:ann::uuid, 901, 1, 'home');
\o
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('after the first kickoff the entry is readable by the crew',
    exists (select 1 from six_pack_entries
             where user_id = :ann::uuid and slate_id = 901));
rollback;

\echo '# everyone can read the questions themselves'
begin;
  select test_as_anon();
  select pg_temp.chk('the questions are public knowledge',
    (select count(*) = 6 from six_pack_questions where slate_id = 900));
  select pg_temp.chk('but a signed-out visitor sees no entries on an open slate',
    not exists (select 1 from six_pack_entries where slate_id = 900));
rollback;
