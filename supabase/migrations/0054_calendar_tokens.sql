-- R2-A3 — calendar feeds: a capability token for a client that cannot sign in.
--
-- Calendar apps subscribe to a URL and poll it forever; they cannot carry a
-- Supabase session. So the feed URL itself is the credential: an unguessable
-- uuid, one per user, resolved server-side by the route handler (service
-- client, same posture as api/push/resubscribe). The token grants exactly one
-- thing — reading a schedule assembled for that user — and nothing else.
--
-- A separate table, not a `profiles` column, on purpose: profiles' column
-- grants are curated (0013, 0040, 0052) and every leaderboard join reads it —
-- a capability token must never ride along in a `select("*")` someone forgets
-- to narrow.
--
-- Apply-vs-deploy order is free: nothing in the running app reads or writes
-- this table until the R2-A3 route and /me card ship.

create table public.calendar_tokens (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  token      uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table public.calendar_tokens enable row level security;

-- You may see your own token (the /me card renders it). Nobody else's.
create policy calendar_tokens_select_own on public.calendar_tokens
  for select to authenticated
  using (user_id = (select auth.uid()));

-- All writes through the RPCs below.
revoke insert, update, delete, truncate on public.calendar_tokens
  from public, anon, authenticated;

-- First visit to the /me card mints the token; later visits return it.
-- `on conflict do nothing` + re-select tolerates two concurrent first calls.
create or replace function public.ensure_calendar_token()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  tok uuid;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  insert into public.calendar_tokens (user_id) values (uid)
  on conflict (user_id) do nothing;
  select token into tok from public.calendar_tokens where user_id = uid;
  return tok;
end;
$$;

-- Rotation is the revocation story: a leaked feed URL dies the moment the
-- owner rotates, and the old token resolves to nothing.
create or replace function public.rotate_calendar_token()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  tok uuid;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  insert into public.calendar_tokens (user_id) values (uid)
  on conflict (user_id) do update set token = gen_random_uuid(), created_at = now();
  select token into tok from public.calendar_tokens where user_id = uid;
  return tok;
end;
$$;

revoke execute on function public.ensure_calendar_token() from public, anon;
grant  execute on function public.ensure_calendar_token() to authenticated;
revoke execute on function public.rotate_calendar_token() from public, anon;
grant  execute on function public.rotate_calendar_token() to authenticated;
