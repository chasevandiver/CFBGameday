-- TRUNCATE is not reachable by the API roles (0049).
--
-- The append-only guarantee on `bets` and `picks` is enforced by RLS policies
-- (0013), and RLS does not apply to TRUNCATE — it is a table privilege that
-- removes every row at once, policies unconsulted. Supabase's default
-- privileges granted it to `anon` and `authenticated` on every public table,
-- so the guarantee rested entirely on PostgREST exposing no TRUNCATE verb.
--
-- These assertions are the regression net. The interesting one is the last:
-- a future `create table` must not re-inherit the privilege, because a
-- migration that fixed the 47 existing tables and left the default in place
-- would read as done while the hole reopened on the next table anyone added.

\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on
\pset format unaligned

create function pg_temp.chk(label text, ok boolean) returns text
language sql as $$ select case when ok then 'PASS  ' else 'FAIL  ' end || label; $$;

\o /dev/null
insert into seasons (id, label, week0_start, is_current)
values (2026, '2026', date '2026-08-29', true);
\o

select '# the API roles cannot TRUNCATE the append-only tables';

select pg_temp.chk(
  'anon has no TRUNCATE on bets',
  not has_table_privilege('anon', 'public.bets', 'TRUNCATE'));

select pg_temp.chk(
  'authenticated has no TRUNCATE on bets',
  not has_table_privilege('authenticated', 'public.bets', 'TRUNCATE'));

select pg_temp.chk(
  'anon has no TRUNCATE on picks',
  not has_table_privilege('anon', 'public.picks', 'TRUNCATE'));

select pg_temp.chk(
  'authenticated has no TRUNCATE on picks',
  not has_table_privilege('authenticated', 'public.picks', 'TRUNCATE'));

select '# nor on anything else in public';

-- Keyed on the oid, not on a formatted name. `pg_tables` lists every schema and
-- the planner is free to evaluate has_table_privilege() before the schemaname
-- filter, so `format('public.%I', tablename)` blows up on auth.users with
-- "relation public.users does not exist" — a test that fails for a reason
-- having nothing to do with what it is testing. The oid cannot be misresolved.
--
-- Stated as a list so a failure names the tables rather than just saying no.
select pg_temp.chk(
  'no public table grants TRUNCATE to anon or authenticated: ' ||
    coalesce(string_agg(c.relname, ', '), 'none'),
  count(*) = 0)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and (has_table_privilege('anon', c.oid, 'TRUNCATE')
    or has_table_privilege('authenticated', c.oid, 'TRUNCATE'));

select '# the reads and writes the app actually needs still work';

-- The revoke must be surgical. If it took SELECT with it, every signed-out
-- page would break and this suite should say so before a deploy does.
select pg_temp.chk(
  'anon can still SELECT games',
  has_table_privilege('anon', 'public.games', 'SELECT'));

select pg_temp.chk(
  'authenticated can still INSERT bets',
  has_table_privilege('authenticated', 'public.bets', 'INSERT'));

select pg_temp.chk(
  'service_role keeps TRUNCATE — the jobs role is not the API surface',
  has_table_privilege('service_role', 'public.games', 'TRUNCATE'));

select '# and a NEW table does not re-inherit it';

\o /dev/null
create table public.truncate_probe (id int primary key);
\o

select pg_temp.chk(
  'a table created after 0049 grants anon no TRUNCATE',
  not has_table_privilege('anon', 'public.truncate_probe', 'TRUNCATE'));

select pg_temp.chk(
  'a table created after 0049 grants authenticated no TRUNCATE',
  not has_table_privilege('authenticated', 'public.truncate_probe', 'TRUNCATE'));

\o /dev/null
drop table public.truncate_probe;
\o
