-- An admin can put someone in the group by name, without the join code.
--
-- Until now there was exactly one way in: the admin reads the code off the
-- settings page, sends it to a person, and that person signs in, finds the
-- Groups tab and types it. Every step is a place it stops — and the commonest
-- failure is not a mistyped code, it is a code that never gets typed at all,
-- because the group is a dozen people who already have accounts on an
-- invite-only site and the code is ceremony between them and the board.
--
-- So: a second door, next to the first rather than instead of it. The code
-- still exists and still works — it is the only path for someone the admin
-- cannot see yet — and this one covers the case where the person is already
-- here and the admin knows their name.
--
-- ## Why an admin adding someone is not the same as a stranger joining
--
-- `join_group` is a boundary (0039) because the caller is asserting a claim
-- about themselves: "I hold this group's code, let me in". It gets entropy and
-- a throttle because guessing is the attack.
--
-- These functions assert something different: an admin of a group, already
-- inside it, names an existing account. The privilege being exercised is one
-- the caller demonstrably has, so the gate is `is_group_admin` and there is
-- nothing to throttle — a wrong guess adds a person the admin did not mean to
-- add, to a group the admin already runs, and they can remove them again. The
-- worst case is a mistake, not an intrusion.
--
-- What it does mean is that being added is not consented to. That is the same
-- deal the product already offers — a member can leave at any time
-- (`leave_group`), removal is soft, and nothing about a group is written to a
-- person's account beyond a roster row. Deliberately NOT notified: there is a
-- push pipeline (0031–0033) but a new kind needs a `notification_settings`
-- row and a preference, and inventing one inside a membership migration is how
-- a notification nobody chose gets shipped. Recorded in docs/STATUS.md instead.
--
-- ## Names are not unique
--
-- `profiles.display_name` has no unique constraint (0001:181) and never has, so
-- resolving a typed name can land on two people. `add_group_member_by_name`
-- refuses that rather than picking one — the UI's search returns ids, so the
-- ambiguous path is the one where somebody typed a name by hand, and guessing
-- which Dave they meant is how the wrong Dave sees the board.

-- ---------------------------------------------------------------------------
-- Who could I add?
--
-- Security definer, admin-gated, and it answers with membership state rather
-- than filtering members out: an admin typing a name wants to be told "already
-- in" instead of watching the name they are certain about return nothing.
--
-- This is not a new exposure. `authenticated` can already read
-- (id, display_name) off `profiles` for every row (0052) — the useful thing
-- here is the join to `group_members`, not the names.
--
-- Two characters minimum, because a one-character query is a directory dump
-- with extra steps.
-- ---------------------------------------------------------------------------
create or replace function public.search_group_candidates(p_group uuid, p_q text)
returns table (id uuid, display_name text, membership text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q    text;
  v_like text;
begin
  if not public.is_group_admin(p_group) then
    raise exception 'Only a group admin can add members';
  end if;

  v_q := btrim(coalesce(p_q, ''));
  if length(v_q) < 2 then
    return;
  end if;

  -- The query is a person's name typed into a box, so % and _ in it are
  -- characters, not wildcards. Backslash is escaped first or it would escape
  -- the escapes.
  v_like := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');

  return query
  select p.id,
         p.display_name,
         case
           when m.user_id is null      then 'none'
           when m.removed_at is null   then 'member'
           else 'removed'
         end
  from profiles p
  left join group_members m on m.group_id = p_group and m.user_id = p.id
  where p.display_name ilike '%' || v_like || '%'
  -- Exact first, then names that start with what was typed, then the rest:
  -- typing "sam" should not bury Sam under Samantha and Rosamund.
  order by (lower(p.display_name) = lower(v_q)) desc,
           (p.display_name ilike v_like || '%') desc,
           p.display_name
  limit 8;
end;
$$;

-- ---------------------------------------------------------------------------
-- Add them
--
-- The insert is join_group's, minus the code and the throttle, and it keeps
-- join_group's role rule (SEC-02, 0038): rejoining restores the row, and
-- restores the *role* only if the person left on their own. An admin who was
-- removed by another admin comes back a member whether they walk in with the
-- code or are walked in by name — one rule, two doors.
-- ---------------------------------------------------------------------------
create or replace function public.add_group_member(p_group uuid, p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_group_admin(p_group) then
    raise exception 'Only a group admin can add members';
  end if;
  if not exists (select 1 from groups where id = p_group and archived_at is null) then
    raise exception 'That group is archived';
  end if;
  if not exists (select 1 from profiles where id = p_user) then
    raise exception 'No account for that person';
  end if;
  if exists (select 1 from group_members
             where group_id = p_group and user_id = p_user and removed_at is null) then
    raise exception 'They are already in this group';
  end if;

  insert into group_members (group_id, user_id, role)
  values (p_group, p_user, 'member')
  on conflict (group_id, user_id) do update
    set removed_at = null,
        removed_by = null,
        role = case
                 when group_members.removed_by is not null then 'member'
                 else group_members.role
               end;

  return p_user;
end;
$$;

create or replace function public.add_group_member_by_name(p_group uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text;
  v_user  uuid;
  v_count integer;
begin
  -- Checked here as well as in add_group_member, so a non-admin cannot use the
  -- "no account for that person" answer to test whether a name exists.
  if not public.is_group_admin(p_group) then
    raise exception 'Only a group admin can add members';
  end if;

  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception 'Type a name';
  end if;

  select count(*) into v_count
  from profiles p
  where lower(p.display_name) = lower(v_name);

  if v_count = 0 then
    raise exception 'Nobody on here is named %', v_name;
  end if;
  if v_count > 1 then
    raise exception 'More than one person is named % — pick them from the list', v_name;
  end if;

  -- Counted first, so this is the one row and `select into` cannot silently
  -- take the first of several. (No min(uuid) before Postgres 18, and the
  -- ambiguous case must not resolve to a person anyway.)
  select p.id into v_user
  from profiles p
  where lower(p.display_name) = lower(v_name);

  return public.add_group_member(p_group, v_user);
end;
$$;

revoke execute on function public.search_group_candidates(uuid, text)  from public, anon;
revoke execute on function public.add_group_member(uuid, uuid)         from public, anon;
revoke execute on function public.add_group_member_by_name(uuid, text) from public, anon;

grant execute on function public.search_group_candidates(uuid, text)   to authenticated;
grant execute on function public.add_group_member(uuid, uuid)          to authenticated;
grant execute on function public.add_group_member_by_name(uuid, text)  to authenticated;
