-- Join codes become a boundary rather than a routing token (SEC-01), plus the
-- two adjacent holes found while reading the surface.
--
-- `groups.join_code` is commented "routing, not a security boundary" (0020:35)
-- and that was true when a group was reached by invitation and the code was a
-- convenience. It is now the only thing standing between a stranger and a
-- crew's picks, so it gets the properties a boundary needs: enough entropy to
-- be worth guessing at, and a cost per guess.

-- ---------------------------------------------------------------------------
-- One generator, three callers
--
-- The same six-character loop was copy-pasted into create_group (0027:112),
-- regenerate_join_code (0020:536) and, historically, the 0020 create_group.
-- Three copies of a security parameter is three places to forget.
--
-- Old: upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)) — hex, so a
-- 16-character alphabet, 16^6 ≈ 16.7 million. Not 36^6; the alphabet was never
-- alphanumeric.
--
-- New: ten characters of Crockford base32 — 32^10 ≈ 1.1e15, about 67 million
-- times the old space. Crockford's alphabet drops I, L, O and U, so there is no
-- 1/I, 0/O or B/8 confusion when someone reads a code off a phone screen, and
-- no accidental profanity from the missing U.
--
-- Randomness comes from gen_random_uuid()'s v4 payload rather than random():
-- random() is a deterministic PRNG seeded per session and is not fit for this,
-- and pgcrypto's gen_random_bytes lives in the `extensions` schema on Supabase
-- but is absent from a bare Postgres, which would make `npm run db:test` fail
-- on something production has. A v4 UUID is 16 CSPRNG bytes; 256 is an exact
-- multiple of 32, so taking each byte mod 32 is unbiased.
create or replace function public.new_join_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  -- Crockford base32: no I, L, O or U.
  k_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes    bytea;
  v_code     text;
  i          integer;
begin
  loop
    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_code  := '';
    for i in 0..9 loop
      v_code := v_code || substr(k_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from groups where join_code = v_code);
  end loop;
  return v_code;
end;
$$;

-- Codes are typed by hand off a screen, so accept what a person would write:
-- case, spaces and hyphens are noise, and Crockford's own rule folds the
-- letters it excluded onto the digits they look like. Safe for the existing
-- six-character hex codes too — hex is 0-9A-F and contains none of I, L or O.
create or replace function public.normalize_join_code(p_code text)
returns text
language sql
immutable
as $$
  select translate(upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g')),
                   'ILO', '110');
$$;

-- ---------------------------------------------------------------------------
-- A cost per guess
--
-- Entropy alone is not the whole answer: without a throttle an attacker gets
-- unlimited tries at whatever the space is, and join_group is reachable by any
-- signed-in user. Ten failures in fifteen minutes is far above what a person
-- mistyping a code from a text message will hit and far below what a search
-- needs.
--
-- Only failures are recorded. A successful join is not evidence of anything.
create table public.group_join_attempts (
  id           bigserial primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index group_join_attempts_user on public.group_join_attempts (user_id, attempted_at desc);

-- Deny-all, like api_call_log (0001:292). Nothing in the app reads this; it is
-- written by a security-definer function and read by the same.
alter table public.group_join_attempts enable row level security;
revoke all on table public.group_join_attempts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- join_group
--
-- The failure path returns null instead of raising, and that is load-bearing
-- rather than a style choice: `raise` aborts the transaction, which would roll
-- back the very attempt row the throttle counts. A function that raised on a
-- bad code could never accumulate evidence that codes were being guessed. The
-- caller turns null into the message (src/app/actions/groups.ts).
--
-- The throttle check itself still raises — by then there is nothing pending to
-- lose, and the earlier failures are already committed.
create or replace function public.join_group(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  k_window   constant interval := interval '15 minutes';
  k_max_fail constant integer  := 10;
  v_uid   uuid := (select auth.uid());
  v_id    uuid;
  v_fails integer;
begin
  if v_uid is null then
    raise exception 'Sign in to join a group';
  end if;

  -- Self-limiting: the window is fifteen minutes, so anything older than a day
  -- is dead weight. Cheaper here than a scheduled job for a table this small.
  delete from group_join_attempts
   where user_id = v_uid and attempted_at < now() - interval '1 day';

  select count(*) into v_fails
    from group_join_attempts
   where user_id = v_uid and attempted_at > now() - k_window;
  if v_fails >= k_max_fail then
    raise exception 'Too many join attempts. Wait a few minutes and try again.';
  end if;

  select id into v_id
  from groups
  where join_code = public.normalize_join_code(p_code) and archived_at is null;

  if not found then
    insert into group_join_attempts (user_id) values (v_uid);
    return null;
  end if;

  -- Rejoining restores the old row. It restores the old *role* only if you
  -- left on your own; an admin who removed you outranks the code you still
  -- have (SEC-02, 0038).
  insert into group_members (group_id, user_id, role)
  values (v_id, v_uid, 'member')
  on conflict (group_id, user_id) do update
    set removed_at = null,
        removed_by = null,
        role = case
                 when group_members.removed_by is not null then 'member'
                 else group_members.role
               end;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The two call sites that mint codes
-- ---------------------------------------------------------------------------

create or replace function public.regenerate_join_code(p_group uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not public.is_group_admin(p_group) then
    raise exception 'Only a group admin can change the join code';
  end if;
  v_code := public.new_join_code();
  update groups set join_code = v_code where id = p_group;
  return v_code;
end;
$$;

create or replace function public.create_group(
  p_name       text,
  p_visibility text default 'private',
  p_kind       text default 'pickem'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_id   uuid;
  v_base text;
  v_slug text;
  v_n    integer := 0;
begin
  if v_uid is null then
    raise exception 'Sign in to create a group';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Give the group a name';
  end if;
  if length(btrim(p_name)) > 60 then
    raise exception 'Group names are 60 characters or fewer';
  end if;
  if p_visibility not in ('private', 'public') then
    raise exception 'Bad visibility';
  end if;
  if p_kind not in ('pickem', 'betting') then
    raise exception 'Bad group kind';
  end if;

  v_base := btrim(regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'), '-');
  if v_base = '' then
    v_base := 'group';
  end if;
  v_slug := v_base;
  while exists (select 1 from groups where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  insert into groups (name, slug, visibility, join_code, created_by, kind)
  values (btrim(p_name), v_slug, p_visibility, public.new_join_code(), v_uid, p_kind)
  returning id into v_id;

  insert into group_members (group_id, user_id, role)
  values (v_id, v_uid, 'admin');

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Two holes adjacent to the code, found while reading this surface
-- ---------------------------------------------------------------------------

-- (1) anon could read the join code of any public group.
--
-- `create policy "anon read public groups" … using (visibility = 'public')`
-- (0020:302) grants every column, join_code included. The app is careful —
-- groups/[slug]/page.tsx:89 fetches it only for an admin — but a server action
-- is not a security boundary and neither is a page component; PostgREST would
-- have answered `select join_code from groups` for a signed-out caller. RLS
-- restricts rows, not columns, so the fix is a column grant, which composes
-- with the policy rather than replacing it.
--
-- Live exposure at the time of writing was zero: `visibility` defaults to
-- 'private' and the project has no public groups. Latent, not urgent, and
-- fixed because the next public group would not come with a reminder.
--
-- Deliberately NOT revoked from `authenticated`: a member needs to read the
-- code of a group they are in to pass it on, and narrowing that means deciding
-- whether a public group's code should be readable by any signed-in user —
-- a product question about what "public" means, not a leak. Left as it is.
-- Revoke the table grant first, then re-grant the columns that stay. A
-- column-level revoke against a table-level SELECT is a no-op — the broad
-- grant still answers — which is the same shape as 0013:26, where revoking
-- UPDATE on profiles had to precede granting the three allowed columns. Caught
-- by the assertion below failing while the migration "worked".
revoke select on public.groups from anon;
grant select (id, name, slug, visibility, created_by, created_at, archived_at,
              picks_hidden_until_kickoff, kind)
  on public.groups to anon;

-- (2) create_group lost its revoke in the 0027 rename.
--
-- 0020:685 revoked EXECUTE on create_group(text, text) from public and anon.
-- 0027 dropped that signature for the three-argument one and granted the new
-- one to `authenticated` (0027:127) without re-revoking, so Postgres's default
-- EXECUTE-to-PUBLIC stood. Not exploitable — the function raises 'Sign in to
-- create a group' on a null auth.uid() (0027:85) — but the grant was wider
-- than every sibling RPC's for no reason anyone chose.
revoke execute on function public.create_group(text, text, text) from public, anon;
grant  execute on function public.create_group(text, text, text) to authenticated;

revoke execute on function public.new_join_code()            from public, anon, authenticated;
revoke execute on function public.normalize_join_code(text)  from public, anon;
