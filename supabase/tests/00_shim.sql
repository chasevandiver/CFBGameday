-- Minimal stand-in for what Supabase provisions before any project migration
-- runs: the three API roles, the auth schema, and auth.uid() reading the JWT
-- claim. Enough to exercise RLS and the security-definer RPCs for real.

-- Roles are cluster-wide, and the runner builds one database per suite, so
-- these have to survive being applied more than once. Dropping and recreating
-- fails the moment an earlier suite's database owns objects granted to them.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;
grant anon, authenticated, service_role to postgres;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique not null
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Test helpers: become a signed-in member, or a signed-out visitor.
create or replace function public.test_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
end; $$;

create or replace function public.test_as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
end; $$;

/*
 * Expect a statement to be REFUSED, as a given role, for a NAMED reason.
 *
 * Lives here rather than in one suite because two now need it, and because the
 * reason it takes `p_expect` is worth stating once: a helper that treats any
 * error as a pass reports PASS when the object under test does not exist.
 * Verified, not theorised — with migration 0046 removed, four "cannot cancel
 * someone else's pick" assertions all passed on "function admin_remove_pick
 * does not exist" while proving nothing whatever about authorization.
 *
 * So the message has to be the one the security check produces, and a
 * missing-object error is reported as VACUOUS rather than absorbed. That makes
 * the standard this repo already holds — every new DB assertion checked failing
 * against the pre-fix schema — actually mean something.
 *
 * `set local role` is transaction-scoped and psql runs each of these in its own
 * implicit transaction, so the role never leaks into the next assertion.
 */
create or replace function public.expect_denied(
  p_label text,
  p_as uuid,          -- null = signed out
  p_stmt text,
  p_expect text       -- substring the error message must contain
) returns text
language plpgsql as $$
begin
  if p_as is null then perform test_as_anon(); else perform test_as(p_as); end if;
  execute p_stmt;
  return 'FAIL  ' || p_label || ' (no error raised)';
exception
  when undefined_function or undefined_table or undefined_column then
    return 'FAIL  ' || p_label || ' (vacuous — the object is missing: ' || sqlerrm || ')';
  when others then
    if position(p_expect in sqlerrm) = 0 then
      return 'FAIL  ' || p_label || ' (wrong error: ' || sqlerrm || ')';
    end if;
    return 'PASS  ' || p_label || ' -> ' || sqlerrm;
end; $$;
