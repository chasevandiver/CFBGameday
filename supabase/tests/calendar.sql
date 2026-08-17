-- R2-A3 — the calendar token is a capability; this suite is its containment.
--
-- The token grants a schedule read to a client that cannot sign in, so the
-- table's whole security story is: you can see your own row, you can write
-- nothing directly, and the RPCs mint/rotate only for the caller. A future
-- migration widening the grant would hand every member a way to read every
-- feed URL — this suite is the regression net.

\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on
\pset format unaligned

create function pg_temp.chk(label text, ok boolean) returns text
language sql as $$ select case when ok then 'PASS  ' else 'FAIL  ' end || label; $$;

\o /dev/null
insert into seasons (id, label, week0_start, is_current)
values (2026, '2026', date '2026-08-29', true);
insert into invite_allowlist (email, make_admin) values
  ('ann@example.com', false), ('bob@example.com', false);
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ann@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');
\o

\set ann '''11111111-1111-1111-1111-111111111111'''
\set bob '''22222222-2222-2222-2222-222222222222'''

\echo '# minting and rotation'
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('ensure mints a token',
    (select ensure_calendar_token() is not null));
  select pg_temp.chk('ensure is idempotent — same token back',
    (select ensure_calendar_token() = ensure_calendar_token()));
  select ensure_calendar_token() as tok_before \gset
  select rotate_calendar_token() as tok_after \gset
  select pg_temp.chk('rotate returns a different token',
    (:'tok_before'::uuid <> :'tok_after'::uuid));
  select pg_temp.chk('rotate persisted the new token',
    (select token = :'tok_after'::uuid from calendar_tokens
      where user_id = :ann::uuid));
rollback;

\echo '# rotate with no prior row mints one'
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('rotate as a fresh user returns a token',
    (select rotate_calendar_token() is not null));
rollback;

\echo '# containment: other users'
begin;
  select test_as(:ann::uuid);
  select ensure_calendar_token() as ann_tok \gset
  select test_as(:bob::uuid);
  select pg_temp.chk('bob cannot see ann''s token row',
    not exists (select 1 from calendar_tokens where user_id = :ann::uuid));
rollback;

select public.expect_denied('direct insert -> denied', :bob::uuid,
  $q$insert into calendar_tokens (user_id) values ('22222222-2222-2222-2222-222222222222')$q$,
  'permission denied');
select public.expect_denied('direct update -> denied', :bob::uuid,
  $q$update calendar_tokens set token = gen_random_uuid()$q$,
  'permission denied');
select public.expect_denied('direct delete -> denied', :bob::uuid,
  $q$delete from calendar_tokens$q$,
  'permission denied');

\echo '# signed out'
select public.expect_denied('anon cannot execute ensure', null,
  $q$select ensure_calendar_token()$q$,
  'permission denied');
select public.expect_denied('anon cannot execute rotate', null,
  $q$select rotate_calendar_token()$q$,
  'permission denied');
begin;
  select test_as_anon();
  select pg_temp.chk('anon sees no rows',
    not exists (select 1 from calendar_tokens));
rollback;
