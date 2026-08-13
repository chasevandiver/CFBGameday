-- Two membership defects that both let a stale role or a stale group stand in
-- for a checked one (P2-5, SEC-02).
--
-- Neither is exploitable today. Both are the same shape as the defects this
-- repo keeps finding: a path that reports success without having verified the
-- thing its caller believes it verified.

-- ---------------------------------------------------------------------------
-- P2-5 — remove_pick never checked membership, and could not say it did nothing
--
-- `make_pick` (0021:162) opens with is_group_member and refuses a stranger.
-- `remove_pick` never did. It is not a hole — the DELETE is scoped to
-- `user_id = auth.uid()`, so a non-member's call matches no rows — but the
-- function reports the same `void` whether it removed a pick, hit a group the
-- caller was thrown out of, or matched nothing at all. That is exactly the
-- complaint audit bug #9 made about the *previous* implementation, which
-- reported the kickoff lock by deleting zero rows; 0021 fixed the lock and
-- left the rest.
--
-- Two changes. The membership check joins make_pick's, so being removed from a
-- group stops your writes in both directions rather than one. And the function
-- returns the number of rows it deleted instead of `void`.
--
-- Deliberately NOT raising on a zero-row delete, though the tracked item
-- offered it: removal is idempotent by nature and a double-tap on a phone is
-- the common case, so raising would turn the second tap into an error toast
-- for a pick that is already gone — the state the user asked for. The audit's
-- lesson was that the caller could not *tell*, and a count answers that
-- without inventing a failure. `src/app/actions/picks.ts` keeps returning
-- ok:true for 0, now knowingly rather than by accident.
--
-- Return type changes, so this is a drop rather than a replace.
drop function if exists public.remove_pick(uuid, integer, text);

create function public.remove_pick(
  p_group_id uuid,
  p_game_id  integer,
  p_market   text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start   timestamptz;
  v_deleted integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to change your picks';
  end if;

  if not public.is_group_member(p_group_id) then
    raise exception 'You are not in this group';
  end if;

  select start_ts into v_start from games where id = p_game_id;
  if not found then
    raise exception 'Game not found';
  end if;
  if v_start is null or v_start <= now() then
    raise exception 'Kickoff — picks are locked for this game.';
  end if;

  delete from picks
  where group_id = p_group_id
    and user_id = (select auth.uid())
    and game_id = p_game_id
    and market = p_market;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.remove_pick(uuid, integer, text) from public, anon;
grant  execute on function public.remove_pick(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- SEC-02 — removal was not durable
--
-- `join_group` (0020:406) ends with:
--
--     insert into group_members (group_id, user_id, role)
--     values (v_id, v_uid, 'member')
--     on conflict (group_id, user_id) do update set removed_at = null;
--
-- The `'member'` in the VALUES list is discarded on conflict, so the DO UPDATE
-- clears `removed_at` and leaves `role` exactly as it was. An admin removed by
-- another admin walks back in through the join code holding admin again. The
-- migration's own comment says so ("Rejoining restores the old row, and with
-- it the role you left holding") — it was written as a property, and it is the
-- defect.
--
-- The obvious fix — always rejoin as 'member' — breaks a legitimate case.
-- `leave_group` (0020:413) deliberately lets the last member out of a group
-- without a successor ("An empty group needs no admin"), so a sole owner who
-- leaves their own group and rejoins would come back a member of a group with
-- no admin, and the deferred `group_members_keep_admin` trigger would refuse
-- the insert. The creator could not re-enter their own group.
--
-- So the two exits stop being interchangeable. `removed_by` records *who* did
-- it: null means you left on your own and keep your role, non-null means an
-- admin removed you and the role does not survive. That is the distinction
-- SEC-02 is actually about — "removal isn't durable" is about being removed,
-- not about leaving.
alter table public.group_members
  add column if not exists removed_by uuid references public.profiles(id) on delete set null;

comment on column public.group_members.removed_by is
  'Admin who removed this member, null if they left on their own. Non-null '
  'demotes them to member on rejoin (SEC-02).';

create or replace function public.remove_group_member(p_group uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_group_admin(p_group) then
    raise exception 'Only a group admin can remove members';
  end if;
  if p_user = (select auth.uid()) then
    raise exception 'Use leave_group to remove yourself';
  end if;
  if not exists (select 1 from group_members
                 where group_id = p_group and user_id = p_user and removed_at is null) then
    raise exception 'They are not in this group';
  end if;

  update group_members
     set removed_at = now(),
         removed_by = (select auth.uid())
   where group_id = p_group and user_id = p_user;
end;
$$;

-- leave_group is unchanged in behaviour and restated only to clear removed_by:
-- someone previously removed, then readmitted, then leaving voluntarily should
-- not carry the old removal forward into their next rejoin.
create or replace function public.leave_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_role text;
begin
  select role into v_role
  from group_members
  where group_id = p_group and user_id = v_uid and removed_at is null;
  if not found then
    raise exception 'You are not in this group';
  end if;

  -- The deferred trigger would also catch this at commit; saying it here gives
  -- the admin an instruction instead of a constraint violation.
  if v_role = 'admin'
     and (select count(*) from group_members
          where group_id = p_group and removed_at is null and role = 'admin') = 1
     and exists (select 1 from group_members
                 where group_id = p_group and removed_at is null and user_id <> v_uid)
  then
    raise exception 'Make someone else an admin before you leave';
  end if;

  update group_members set removed_at = now(), removed_by = null
  where group_id = p_group and user_id = v_uid;
end;
$$;

create or replace function public.join_group(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Sign in to join a group';
  end if;

  select id into v_id
  from groups
  where join_code = upper(btrim(p_code)) and archived_at is null;
  if not found then
    raise exception 'No group with that code';
  end if;

  -- Rejoining restores the old row. It restores the old *role* only if you
  -- left on your own; an admin who removed you outranks the code you still
  -- have (SEC-02).
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
