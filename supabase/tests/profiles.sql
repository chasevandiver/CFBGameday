-- The is_admin column grant (0013 §1).
--
-- The original audit's #1 exploit: "update own profile" is a row policy, and
-- RLS restricts rows, not columns — so any member could set is_admin on their
-- own row and walk into the service-role paths the admin pages gate on it.
-- 0013 revoked table-level UPDATE and re-granted only display_name /
-- favorite_team_ids / timezone. This suite is the regression net the audit
-- (06/SEC-03) found missing: a future migration re-granting UPDATE would
-- reopen the escalation with a green db:test.

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
insert into invite_allowlist (email, make_admin) values
  ('ann@example.com', true), ('bob@example.com', false);
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ann@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');
\o

\set ann '''11111111-1111-1111-1111-111111111111'''
\set bob '''22222222-2222-2222-2222-222222222222'''

\echo '# the signup trigger seeded what the attacks below need'
select pg_temp.chk('ann is admin via the allowlist',
  (select is_admin from profiles where id = :ann::uuid));
select pg_temp.chk('bob is not',
  not (select is_admin from profiles where id = :bob::uuid));

\echo '# self-service privilege escalation'
begin;
  select test_as(:bob::uuid);
  select pg_temp.raises('bob setting his own is_admin -> denied',
    'update profiles set is_admin = true where id = auth.uid()');
rollback;

begin;
  select test_as(:bob::uuid);
  -- a mixed update must not smuggle the forbidden column through
  select pg_temp.raises('is_admin hidden inside an allowed update -> denied',
    'update profiles set display_name = ''bob!'', is_admin = true where id = auth.uid()');
rollback;

\echo '# the allowed columns still work'
begin;
  select test_as(:bob::uuid);
  update profiles set display_name = 'Robert', timezone = 'America/New_York'
  where id = :bob::uuid;
  select pg_temp.chk('bob renamed himself',
    (select display_name = 'Robert' from profiles where id = :bob::uuid));
rollback;

\echo '# other rows and anon'
begin;
  select test_as(:bob::uuid);
  -- row policy: the update silently matches nothing
  update profiles set display_name = 'gotcha' where id = :ann::uuid;
  select pg_temp.chk('bob cannot rename ann',
    (select display_name <> 'gotcha' from profiles where id = :ann::uuid));
rollback;

begin;
  select test_as_anon();
  -- denied by grant or matched-nothing by policy — either way, no effect
  do $$ begin
    execute 'update profiles set display_name = ''x'' where id = ''11111111-1111-1111-1111-111111111111''';
  exception when others then null; end $$;
  select pg_temp.chk('anon cannot rename anyone',
    (select display_name <> 'x' from profiles where id = :ann::uuid));
rollback;

select pg_temp.chk('nobody became admin along the way',
  (select count(*) = 1 from profiles where is_admin));

\echo '# is_admin is not readable signed out (0040, P2-2 / SEC-08)'
-- Both SELECT policies on this table are `using (true)`, so before 0040 a
-- signed-out PostgREST call could read every column of every profile and learn
-- who the admins were. RLS restricts rows, not columns — the fix is a column
-- grant, the read-side twin of 0013's UPDATE narrowing above.
begin;
  select test_as_anon();
  select pg_temp.raises('anon reading is_admin',
    $$select is_admin from profiles$$);
  select pg_temp.raises('anon reading the whole row',
    $$select * from profiles$$);
  select pg_temp.raises('anon reading a timezone',
    $$select timezone from profiles$$);
  -- Names stay public: /recap and /game render display_name for signed-out
  -- visitors, and fetchProfiles (queries.ts) asks for exactly these two.
  select pg_temp.chk('but names are still readable',
                     (select count(*) from (select id, display_name from profiles) q) = 2);
rollback;
-- A signed-in member is unaffected — narrowing that is a separate, larger
-- change (an is_current_user_admin() RPC and six call sites), left queued.
begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('a signed-in member can still read is_admin',
                     (select count(*) from (select is_admin from profiles) q) = 2);
rollback;
