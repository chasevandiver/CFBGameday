-- Managed seats: members who don't have a login yet.
--
-- Owner request 2026-08-28: "I want to be able to add people to a group that
-- don't have logins at the moment and pick for them as an admin and then have
-- me assign the alias of the name. I do a pickem with my dad and uncles, Jeff,
-- John, Greg and may take them a week to get on board."
--
-- ## Why a seat is a real profile
--
-- Everything a member does hangs off `profiles.id`: `group_members`, `picks`,
-- `survivor_picks`, every roster join and every standings computation. A
-- parallel "ghost member" table would need a shadow of each of those — or a
-- second user_id column on all of them — and every read in the product would
-- have to learn the union. So a seat IS a profile: a real `profiles` row whose
-- display_name is the alias the admin typed, backed by an `auth.users` row
-- that can never sign in (no password, an unroutable @managed.invalid address,
-- and this site's own invite allowlist in front of every real signup path).
-- The tests already seed accounts by inserting into auth.users directly; this
-- is the same move with a bookkeeping row on top.
--
-- `managed_members` is that bookkeeping: which profile is a seat, whose group
-- it belongs to, and — once the person finally signs up — which real account
-- claimed it. A seat belongs to exactly one group; it is not a person, and it
-- must never leak into another group's add-member search.
--
-- ## The claim
--
-- When Jeff gets his login, the admin hands him the seat
-- (`claim_managed_member`): the membership row and every pick the admin made
-- on his behalf move to his account, history intact, and the seat is marked
-- claimed. The seat's profile stays behind as an inert, claimed husk — deleting
-- auth rows from a migration-defined RPC is how a cascade eats history.
-- Claiming refuses an account that already has picks in the group (only
-- possible for a previously removed member); that collision has no right
-- answer a function should invent.
--
-- ## Picking for a seat
--
-- `make_pick` / `remove_pick` (and, from 0082, the survivor pair) gain a
-- `p_for` argument: null means "for myself" and is the everyday path; non-null
-- is admin-only and must name an unclaimed seat of that group, checked in
-- `acting_user` below. Every other rule — kickoff locks, market checks, the
-- no-repeat rule — applies to the seat exactly as it would to anyone.

-- ---------------------------------------------------------------------------
-- The bookkeeping
-- ---------------------------------------------------------------------------

create table public.managed_members (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  group_id   uuid not null references public.groups(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  claimed_by uuid references public.profiles(id),
  claimed_at timestamptz,
  -- Claimed-ness is one fact, not two half-facts that can disagree.
  check ((claimed_by is null) = (claimed_at is null))
);

create index managed_members_group on public.managed_members (group_id);

comment on table public.managed_members is
  'Profiles that are group-owned seats: added by an admin for someone with no '
  'login yet, picked for by admins, and handed over (claimed) once the person '
  'signs up. The profile row is real; the auth row behind it can never sign in.';

alter table public.managed_members enable row level security;

-- Members can see which of their roster are seats; so can anyone who can see a
-- public group. Same visibility rule as the roster itself.
create policy "read seats in visible groups" on public.managed_members
  for select to authenticated using (public.is_group_visible(group_id));
create policy "anon read seats in public groups" on public.managed_members
  for select to anon using (public.is_group_visible(group_id));

revoke insert, update, delete, truncate on public.managed_members from anon, authenticated;
grant select on public.managed_members to anon, authenticated;

-- ---------------------------------------------------------------------------
-- "Is this an unclaimed seat of this group?" — asked by policies and RPCs,
-- so it is security definer and stated once.
-- ---------------------------------------------------------------------------

create or replace function public.is_managed_seat(p_group uuid, p_profile uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from managed_members mm
    where mm.profile_id = p_profile
      and mm.group_id = p_group
      and mm.claimed_at is null
  );
$$;

grant execute on function public.is_managed_seat(uuid, uuid) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Creating a seat
--
-- The auth row is inserted with the allowlist door held open for exactly one
-- statement: `handle_new_user` (0002) refuses any email it does not know, so
-- the function allowlists the synthetic address, inserts, and takes the entry
-- back out. That keeps invite-only enforcement in one place instead of
-- growing a bypass flag an attacker-supplied signup could set.
-- ---------------------------------------------------------------------------

create or replace function public.create_managed_member(p_group uuid, p_alias text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_alias text := btrim(coalesce(p_alias, ''));
  v_id    uuid := gen_random_uuid();
  v_email text;
begin
  if not public.is_group_admin(p_group) then
    raise exception 'Only a group admin can add a seat';
  end if;
  if not exists (select 1 from groups where id = p_group and archived_at is null) then
    raise exception 'That group is archived';
  end if;
  if v_alias = '' then
    raise exception 'Give the seat a name';
  end if;
  if length(v_alias) > 40 then
    raise exception 'Names are 40 characters or fewer';
  end if;
  -- One "Jeff" per roster. Checked against active members (seats included, via
  -- their profiles) so the group's board never shows two identical names the
  -- admin has to tell apart by memory.
  if exists (
    select 1 from group_members gm
    join profiles p on p.id = gm.user_id
    where gm.group_id = p_group and gm.removed_at is null
      and lower(p.display_name) = lower(v_alias)
  ) then
    raise exception 'Somebody in this group is already named %', v_alias;
  end if;

  v_email := 'seat-' || v_id || '@managed.invalid';

  -- The one-statement door. The address is unroutable and the row carries no
  -- password, so nothing can ever authenticate as it.
  insert into invite_allowlist (email) values (v_email);
  insert into auth.users (id, email) values (v_id, v_email);
  delete from invite_allowlist where email = v_email;

  -- handle_new_user named the profile after the email's local part; the alias
  -- is what the admin actually said.
  update profiles set display_name = v_alias where id = v_id;

  insert into managed_members (profile_id, group_id, created_by)
  values (v_id, p_group, v_uid);
  insert into group_members (group_id, user_id, role)
  values (p_group, v_id, 'member');

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Renaming a seat — "have me assign the alias of the name". A seat's name is
-- the admin's to set for as long as it is a seat; a claimed one belongs to the
-- person who claimed it.
-- ---------------------------------------------------------------------------

create or replace function public.rename_managed_member(
  p_group uuid, p_seat uuid, p_alias text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alias text := btrim(coalesce(p_alias, ''));
begin
  if not public.is_group_admin(p_group) then
    raise exception 'Only a group admin can rename a seat';
  end if;
  if not public.is_managed_seat(p_group, p_seat) then
    raise exception 'That is not one of this group''s seats';
  end if;
  if v_alias = '' then
    raise exception 'Give the seat a name';
  end if;
  if length(v_alias) > 40 then
    raise exception 'Names are 40 characters or fewer';
  end if;
  if exists (
    select 1 from group_members gm
    join profiles p on p.id = gm.user_id
    where gm.group_id = p_group and gm.removed_at is null
      and gm.user_id <> p_seat
      and lower(p.display_name) = lower(v_alias)
  ) then
    raise exception 'Somebody in this group is already named %', v_alias;
  end if;

  update profiles set display_name = v_alias where id = p_seat;
end;
$$;

-- ---------------------------------------------------------------------------
-- Handing the seat over
-- ---------------------------------------------------------------------------

create or replace function public.claim_managed_member(
  p_group uuid, p_seat uuid, p_user uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_group_admin(p_group) then
    raise exception 'Only a group admin can hand a seat over';
  end if;
  if not public.is_managed_seat(p_group, p_seat) then
    raise exception 'That is not one of this group''s seats';
  end if;
  if not exists (
    select 1 from group_members
    where group_id = p_group and user_id = p_seat and removed_at is null
  ) then
    raise exception 'That seat is no longer in the group';
  end if;
  if not exists (select 1 from profiles where id = p_user) then
    raise exception 'No account for that person';
  end if;
  if exists (
    select 1 from managed_members where profile_id = p_user and claimed_at is null
  ) then
    raise exception 'That is a seat, not a signed-up account';
  end if;
  if exists (
    select 1 from group_members
    where group_id = p_group and user_id = p_user and removed_at is null
  ) then
    raise exception 'They are already in this group under their own name';
  end if;
  -- A previously removed member can hold old picks in this group, and merging
  -- two pick histories has no right answer a function should invent. Rare by
  -- construction, refused rather than guessed at.
  if exists (select 1 from picks where group_id = p_group and user_id = p_user)
     or exists (select 1 from survivor_picks where group_id = p_group and user_id = p_user)
  then
    raise exception 'That account already has picks in this group from an earlier membership';
  end if;

  -- The dead row from an earlier membership, if any, yields its key to the
  -- seat's row — which keeps the seat's joined_at and role.
  delete from group_members
  where group_id = p_group and user_id = p_user and removed_at is not null;

  update group_members set user_id = p_user
  where group_id = p_group and user_id = p_seat;

  update picks set user_id = p_user
  where group_id = p_group and user_id = p_seat;

  update survivor_picks set user_id = p_user
  where group_id = p_group and user_id = p_seat;

  update managed_members
  set claimed_by = p_user, claimed_at = now()
  where profile_id = p_seat;
end;
$$;

-- ---------------------------------------------------------------------------
-- Seats stay out of the directory
--
-- `search_group_candidates` (0064) answers "who could I add to this group" —
-- a seat is not a person and must not be offered to any group, its own
-- included (it is already there). `add_group_member` gets the same guard so
-- the typed-name path cannot reach one either.
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
    and not exists (
      select 1 from managed_members mm
      where mm.profile_id = p.id and mm.claimed_at is null
    )
  order by (lower(p.display_name) = lower(v_q)) desc,
           (p.display_name ilike v_like || '%') desc,
           p.display_name
  limit 8;
end;
$$;

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
  if exists (
    select 1 from managed_members where profile_id = p_user and claimed_at is null
  ) then
    raise exception 'That is a seat, not a signed-up account';
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

-- ---------------------------------------------------------------------------
-- Who a pick is for
--
-- Null: yourself, the everyday path, no admin needed. Non-null: an admin of
-- the group naming one of its unclaimed seats — still on the roster, since a
-- removed seat has no picks to make. Raises rather than returning null so the
-- RPCs that call it cannot forget to check.
-- ---------------------------------------------------------------------------

create or replace function public.acting_user(p_group uuid, p_for uuid)
returns uuid
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if p_for is null or p_for = v_uid then
    return v_uid;
  end if;
  if not public.is_group_admin(p_group) then
    raise exception 'Only a group admin can pick for someone else';
  end if;
  if not public.is_managed_seat(p_group, p_for)
     or not exists (
       select 1 from group_members
       where group_id = p_group and user_id = p_for and removed_at is null
     )
  then
    raise exception 'You can only pick for one of this group''s seats';
  end if;
  return p_for;
end;
$$;

revoke execute on function public.acting_user(uuid, uuid) from public, anon;
grant execute on function public.acting_user(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- make_pick / remove_pick learn who the pick is for
--
-- Bodies are 0074's / 0038's verbatim apart from: the caller resolves through
-- acting_user, and the row is written for that identity. Dropped and recreated
-- because adding a defaulted argument creates an overload, and two overloads a
-- named-argument PostgREST call both matches is an ambiguity error.
-- ---------------------------------------------------------------------------

drop function if exists public.make_pick(uuid, integer, text, text);

create or replace function public.make_pick(
  p_group_id uuid, p_game_id integer, p_market text, p_side text,
  p_for uuid default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  g       record;
  cfg     record;
  v_line  numeric;
  v_user  uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to save your picks';
  end if;
  if not public.is_group_member(p_group_id) then
    raise exception 'You are not in this group';
  end if;
  v_user := public.acting_user(p_group_id, p_for);
  if p_market not in ('spread', 'total', 'straight_up') then
    raise exception 'Bad market';
  end if;
  if p_market = 'total' and p_side not in ('over', 'under') then
    raise exception 'Bad side';
  end if;
  if p_market in ('spread', 'straight_up') and p_side not in ('home', 'away') then
    raise exception 'Bad side';
  end if;

  select id, season_id, week, season_type, start_ts into g
  from games where id = p_game_id;
  if not found then
    raise exception 'Game not found';
  end if;

  select selection_mode, markets into cfg
  from group_week_config
  where group_id = p_group_id and season_id = g.season_id
    and week = g.week and season_type = g.season_type;
  if not found then
    raise exception 'This group has not set up week % yet.', g.week;
  end if;
  if not (p_market = any (cfg.markets)) then
    raise exception 'This group is not playing that bet type in week %.', g.week;
  end if;
  if not exists (
    select 1 from public.group_week_game_ids(p_group_id, g.season_id, g.week, g.season_type) gid
    where gid = p_game_id
  ) then
    raise exception 'That game is not in play for this group in week %.', g.week;
  end if;

  -- Unchanged from 0013: picks lock at their own game's kickoff, and a TBD
  -- kickoff counts as locked rather than as open forever.
  if g.start_ts is null or g.start_ts <= now() then
    raise exception 'Kickoff — picks are locked for this game.';
  end if;

  if p_market <> 'straight_up' then
    -- Consensus: latest non-null value per provider, averaged, snapped to the
    -- half point (mirrors consensusFromSnapshots in src/lib/consensus.ts).
    -- DQ-15: books when there are books, the aggregate alone when there are not.
    with latest as (
      select distinct on (provider)
        provider,
        case when p_market = 'spread' then spread else total end as v
      from line_snapshots
      where game_id = p_game_id
        and (case when p_market = 'spread' then spread else total end) is not null
      order by provider, captured_at desc
    )
    select round(avg(l.v) * 2) / 2 into v_line
    from latest l
    where l.provider <> all (array['consensus'])
       or not exists (
            select 1 from latest b where b.provider <> all (array['consensus'])
          );
    if v_line is null then
      raise exception 'No line posted yet for this game';
    end if;
  end if;

  insert into picks (season_id, group_id, user_id, game_id, market, side, line_at_pick, units, locked_at)
  values (g.season_id, p_group_id, v_user, p_game_id, p_market, p_side, v_line, 1, now())
  on conflict (group_id, user_id, game_id, market) do update
    set side = excluded.side,
        line_at_pick = excluded.line_at_pick,
        locked_at = now(),
        -- A replaced pick is a NEW pick: it must not inherit the grade of the
        -- one it replaced. Without this a re-pick on a revived game keeps
        -- result='void' and the grader's `.is("result", null)` filter skips it
        -- forever. (0034, preserved verbatim.)
        result = null,
        clv = null;
end;
$function$;

drop function if exists public.remove_pick(uuid, integer, text);

create function public.remove_pick(
  p_group_id uuid, p_game_id integer, p_market text,
  p_for uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start   timestamptz;
  v_deleted integer;
  v_user    uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to change your picks';
  end if;

  if not public.is_group_member(p_group_id) then
    raise exception 'You are not in this group';
  end if;
  v_user := public.acting_user(p_group_id, p_for);

  select start_ts into v_start from games where id = p_game_id;
  if not found then
    raise exception 'Game not found';
  end if;
  if v_start is null or v_start <= now() then
    raise exception 'Kickoff — picks are locked for this game.';
  end if;

  delete from picks
  where group_id = p_group_id
    and user_id = v_user
    and game_id = p_game_id
    and market = p_market;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admins can read a seat's picks
--
-- Under the pre-kickoff blind (0023/0053), only the owner sees a pick — but a
-- seat's picks are the admin's own work, and a board that cannot show the
-- admin what they just entered for Jeff is a board that says the tap failed.
-- Admin only: ordinary members still see a seat's picks when everyone else's
-- reveal.
-- ---------------------------------------------------------------------------

create policy "admins read seat picks" on public.picks
  for select to authenticated
  using (public.is_group_admin(group_id) and public.is_managed_seat(group_id, user_id));

create policy "admins read seat survivor picks" on public.survivor_picks
  for select to authenticated
  using (public.is_group_admin(group_id) and public.is_managed_seat(group_id, user_id));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.create_managed_member(uuid, text)       from public, anon;
revoke execute on function public.rename_managed_member(uuid, uuid, text) from public, anon;
revoke execute on function public.claim_managed_member(uuid, uuid, uuid)  from public, anon;
revoke execute on function public.make_pick(uuid, integer, text, text, uuid)   from public, anon;
revoke execute on function public.remove_pick(uuid, integer, text, uuid)       from public, anon;

grant execute on function public.create_managed_member(uuid, text)        to authenticated;
grant execute on function public.rename_managed_member(uuid, uuid, text)  to authenticated;
grant execute on function public.claim_managed_member(uuid, uuid, uuid)   to authenticated;
grant execute on function public.make_pick(uuid, integer, text, text, uuid)    to authenticated;
grant execute on function public.remove_pick(uuid, integer, text, uuid)        to authenticated;
