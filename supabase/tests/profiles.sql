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
-- This is where the assertion "a signed-in member can still read is_admin"
-- used to sit. It was correct and deliberate: 0040 closed the signed-out half
-- only, and the row above it said the rest was "a separate, larger change
-- (an is_current_user_admin() RPC and six call sites), left queued".
--
-- 0050 is that change, so the assertion is now false and its inverse is
-- asserted below. Recorded rather than silently deleted, because a test that
-- pinned the old behaviour failing is exactly how this migration proved it did
-- something — it was the first thing to go red.
-- (It was nine call sites, not six. See SEC-08b in docs/STATUS.md.)

-- ── SEC-08b: is_admin is not readable, and the gate still works ────────────
--
-- 0040 closed the signed-out half of P2-2; `authenticated` kept the whole row,
-- so any member could list the admins. 0050 takes the column away and puts the
-- question behind a SECURITY DEFINER function that answers about the caller
-- only.
--
-- The risk in this change is not that it fails open — it is that it fails
-- CLOSED and nobody notices until an admin cannot reach /admin. Both
-- directions are asserted, and the role switches use the same
-- begin/test_as/rollback shape as the escalation tests above, because
-- `set local role` is transaction-scoped and psql gives each statement its own
-- transaction.

\echo '# the admin flag is not readable, even signed in'
select pg_temp.chk('authenticated has no column-level SELECT on is_admin',
  not has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'SELECT'));
select pg_temp.chk('anon still has none either (0040 stands)',
  not has_column_privilege('anon', 'public.profiles', 'is_admin', 'SELECT'));

\echo '# but the columns the app reads are untouched'
select pg_temp.chk('display_name, or every name on the site vanishes',
  has_column_privilege('authenticated', 'public.profiles', 'display_name', 'SELECT'));
select pg_temp.chk('and the two /me edits',
  has_column_privilege('authenticated', 'public.profiles', 'timezone', 'SELECT')
  and has_column_privilege('authenticated', 'public.profiles', 'favorite_team_ids', 'SELECT'));

\echo '# a signed-in member can no longer read the column at all'
begin;
  select test_as(:bob::uuid);
  select pg_temp.raises('bob reading is_admin -> denied',
    'select is_admin from profiles where id = auth.uid()');
  select pg_temp.raises('bob listing the admins -> denied',
    'select id from profiles where is_admin');
rollback;

\echo '# is_current_user_admin() answers about the caller, and fails closed'
begin;
  select test_as(:ann::uuid);
  select pg_temp.chk('ann, an admin, is told yes', is_current_user_admin());
rollback;

begin;
  select test_as(:bob::uuid);
  select pg_temp.chk('bob, a member, is told no', not is_current_user_admin());
rollback;

begin;
  select test_as_anon();
  -- Denied outright, not answered "false" — EXECUTE is revoked from anon, so a
  -- signed-out caller cannot even ask. Two layers agree on the answer and this
  -- is the outer one: `lib/admin.ts` turns any RPC error into false, and the
  -- function's own coalesce() would return false if it ever were reachable.
  -- Every call site guards on a user first, so nothing in the app takes this
  -- path; it is asserted because "fails closed" should be a property of the
  -- database, not an emergent one.
  select pg_temp.raises('signed out cannot even call it -> denied',
    'select is_current_user_admin()');
rollback;

\echo '# and the function is reachable by exactly the role that needs it'
select pg_temp.chk('authenticated may execute it',
  has_function_privilege('authenticated', 'public.is_current_user_admin()', 'EXECUTE'));
select pg_temp.chk('anon may not — a signed-out caller has nothing to ask',
  not has_function_privilege('anon', 'public.is_current_user_admin()', 'EXECUTE'));
