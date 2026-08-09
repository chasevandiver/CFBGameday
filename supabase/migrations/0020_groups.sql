-- Groups: many pools on one site.
--
-- Until now "the crew" meant every row in `profiles`, and the games in play
-- were inferred from whatever somebody happened to pick. That works for one
-- pool of friends and breaks the moment you belong to two. A group is created
-- by any user, who becomes its admin; the admin says which games are in play
-- each week and which markets members may pick.
--
-- Principles enforced here rather than in app code, following 0013:
--   * every write goes through a security-definer RPC — the tables themselves
--     are read-only to authenticated and anon, so an invariant cannot be
--     side-stepped by a direct PostgREST call
--   * a group always keeps at least one admin (deferred constraint trigger,
--     so a transfer can promote and demote in either order)
--   * a week's configuration freezes at that week's first kickoff, and the
--     freeze is decided from the clock, not from a flag a job has to set
--
-- Picks gain `group_id` and `market` in 0021, which is also where the existing
-- crew and its history are backfilled into a first group.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Deliberately no season_id: a group persists across seasons, which is what
-- makes a lifetime record answerable. Spec §8 asks for season_id on every
-- table; the season dimension lives on group_week_config and on picks instead,
-- so every *query* is still season-scoped.
create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,          -- /groups/[slug]
  visibility  text not null default 'private'
              check (visibility in ('private', 'public')),
  join_code   text not null unique,          -- routing, not a security boundary
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  archived_at timestamptz                    -- no hard delete; history survives
);

-- Removal is soft. A departed member's graded picks still have to resolve on
-- the weeks they played, so the row stays and `removed_at` hides them from the
-- current roster.
create table public.group_members (
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'member' check (role in ('admin', 'member')),
  joined_at  timestamptz not null default now(),
  removed_at timestamptz,
  primary key (group_id, user_id)
);
create index group_members_user on public.group_members (user_id);

create table public.group_week_config (
  group_id       uuid    not null references public.groups(id) on delete cascade,
  season_id      integer not null references public.seasons(id),
  week           integer not null,
  season_type    text    not null default 'regular',
  selection_mode text    not null
                 check (selection_mode in ('handpicked', 'full_slate', 'conference')),
  conference     text,
  markets        text[]  not null default '{spread}',
  -- Stamped by the freeze job when it materialises the game list. The *rule*
  -- does not depend on it — see group_week_is_locked.
  locked_at      timestamptz,
  updated_by     uuid references public.profiles(id),
  updated_at     timestamptz not null default now(),
  primary key (group_id, season_id, week, season_type),
  constraint group_week_conference_required
    check (selection_mode <> 'conference' or conference is not null),
  constraint group_week_markets_known
    check (markets <@ array['spread', 'total', 'straight_up']::text[]
           and array_length(markets, 1) >= 1)
);

-- The resolved game list. Always populated for handpicked; populated for the
-- other two modes only at the freeze, which is what stops a postponement from
-- pulling a game off a board people already picked.
create table public.group_week_games (
  group_id    uuid    not null,
  season_id   integer not null,
  week        integer not null,
  season_type text    not null default 'regular',
  game_id     integer not null references public.games(id),
  primary key (group_id, season_id, week, season_type, game_id),
  foreign key (group_id, season_id, week, season_type)
    references public.group_week_config (group_id, season_id, week, season_type)
    on delete cascade
);
create index group_week_games_game on public.group_week_games (game_id);

-- ---------------------------------------------------------------------------
-- Membership helpers
--
-- A policy on group_members that reads group_members recurses forever. These
-- are security definer so they bypass RLS and break the cycle; they are the
-- only thing the policies below need to consult.
-- ---------------------------------------------------------------------------

create or replace function public.is_group_member(p_group uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from group_members m
    where m.group_id = p_group
      and m.user_id = (select auth.uid())
      and m.removed_at is null
  );
$$;

create or replace function public.is_group_admin(p_group uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from group_members m
    where m.group_id = p_group
      and m.user_id = (select auth.uid())
      and m.removed_at is null
      and m.role = 'admin'
  );
$$;

-- One predicate for "may this caller see this group's board". Signed-out
-- callers have a null auth.uid(), so is_group_member is false and only the
-- public branch can pass.
create or replace function public.is_group_visible(p_group uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from groups g where g.id = p_group and g.visibility = 'public')
      or public.is_group_member(p_group);
$$;

grant execute on function public.is_group_member(uuid)  to authenticated, anon;
grant execute on function public.is_group_admin(uuid)   to authenticated, anon;
grant execute on function public.is_group_visible(uuid) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Resolving a week's game list
-- ---------------------------------------------------------------------------

-- security INVOKER on purpose. Called from the app it runs as the caller, so
-- RLS on group_week_config decides what a non-member can resolve; called from
-- the security-definer RPCs below it inherits their privileges.
create or replace function public.group_week_game_ids(
  p_group       uuid,
  p_season      integer,
  p_week        integer,
  p_season_type text default 'regular'
)
returns setof integer
language sql
stable
set search_path = public
as $$
  with cfg as (
    select selection_mode, conference, locked_at
    from group_week_config
    where group_id = p_group
      and season_id = p_season
      and week = p_week
      and season_type = p_season_type
  )
  -- materialised: handpicked always, every mode once the week has frozen
  select gwg.game_id
  from group_week_games gwg, cfg
  where gwg.group_id = p_group
    and gwg.season_id = p_season
    and gwg.week = p_week
    and gwg.season_type = p_season_type
    and (cfg.selection_mode = 'handpicked' or cfg.locked_at is not null)

  union

  -- resolved live, so a late schedule addition joins the board on its own
  select g.id
  from games g, cfg
  where cfg.locked_at is null
    and cfg.selection_mode <> 'handpicked'
    and g.season_id = p_season
    and g.week = p_week
    and g.season_type = p_season_type
    and (
      cfg.selection_mode = 'full_slate'
      or exists (
        select 1 from teams t
        where t.id in (g.home_team_id, g.away_team_id)
          and t.conference = cfg.conference
      )
    );
$$;

create or replace function public.group_week_first_kickoff(
  p_group       uuid,
  p_season      integer,
  p_week        integer,
  p_season_type text default 'regular'
)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select min(g.start_ts)
  from games g
  where g.id in (
    select public.group_week_game_ids(p_group, p_season, p_week, p_season_type)
  );
$$;

-- The freeze rule. Reads the clock rather than trusting `locked_at`, so
-- correctness never depends on the freeze job having run on time.
create or replace function public.group_week_is_locked(
  p_group       uuid,
  p_season      integer,
  p_week        integer,
  p_season_type text default 'regular'
)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select locked_at is not null
     from group_week_config
     where group_id = p_group and season_id = p_season
       and week = p_week and season_type = p_season_type),
    false
  )
  or coalesce(
    public.group_week_first_kickoff(p_group, p_season, p_week, p_season_type) <= now(),
    false
  );
$$;

grant execute on function public.group_week_game_ids(uuid, integer, integer, text)
  to authenticated, anon;
grant execute on function public.group_week_first_kickoff(uuid, integer, integer, text)
  to authenticated, anon;
grant execute on function public.group_week_is_locked(uuid, integer, integer, text)
  to authenticated, anon;

-- ---------------------------------------------------------------------------
-- A group always keeps an admin
--
-- Deferred so a transfer can demote the outgoing admin before promoting the
-- incoming one, or the other way round, inside one transaction.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_group_has_admin()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_group uuid;
begin
  v_group := coalesce(new.group_id, old.group_id);
  -- An empty group needs no admin; the last member out may leave.
  if exists (select 1 from group_members
             where group_id = v_group and removed_at is null)
     and not exists (select 1 from group_members
                     where group_id = v_group and removed_at is null and role = 'admin')
  then
    raise exception 'a group must keep at least one admin';
  end if;
  return null;
end;
$$;

create constraint trigger group_members_keep_admin
  after insert or update or delete on public.group_members
  deferrable initially deferred
  for each row execute function public.enforce_group_has_admin();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Reads are policy-driven and visibility-aware. Writes are revoked outright:
-- everything goes through the RPCs below.
-- ---------------------------------------------------------------------------

alter table public.groups            enable row level security;
alter table public.group_members     enable row level security;
alter table public.group_week_config enable row level security;
alter table public.group_week_games  enable row level security;

create policy "read visible groups" on public.groups for select to authenticated
  using (public.is_group_visible(id));
create policy "anon read public groups" on public.groups for select to anon
  using (visibility = 'public');

create policy "read visible group members" on public.group_members
  for select to authenticated using (public.is_group_visible(group_id));
create policy "anon read public group members" on public.group_members
  for select to anon using (public.is_group_visible(group_id));

create policy "read visible group config" on public.group_week_config
  for select to authenticated using (public.is_group_visible(group_id));
create policy "anon read public group config" on public.group_week_config
  for select to anon using (public.is_group_visible(group_id));

create policy "read visible group games" on public.group_week_games
  for select to authenticated using (public.is_group_visible(group_id));
create policy "anon read public group games" on public.group_week_games
  for select to anon using (public.is_group_visible(group_id));

revoke insert, update, delete on public.groups            from authenticated, anon;
revoke insert, update, delete on public.group_members     from authenticated, anon;
revoke insert, update, delete on public.group_week_config from authenticated, anon;
revoke insert, update, delete on public.group_week_games  from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Group lifecycle
-- ---------------------------------------------------------------------------

create or replace function public.create_group(
  p_name       text,
  p_visibility text default 'private'
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
  v_code text;
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

  v_base := btrim(regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'), '-');
  if v_base = '' then
    v_base := 'group';
  end if;
  v_slug := v_base;
  while exists (select 1 from groups where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from groups where join_code = v_code);
  end loop;

  insert into groups (name, slug, visibility, join_code, created_by)
  values (btrim(p_name), v_slug, p_visibility, v_code, v_uid)
  returning id into v_id;

  insert into group_members (group_id, user_id, role)
  values (v_id, v_uid, 'admin');

  return v_id;
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

  -- Rejoining restores the old row, and with it the role you left holding.
  insert into group_members (group_id, user_id, role)
  values (v_id, v_uid, 'member')
  on conflict (group_id, user_id) do update set removed_at = null;

  return v_id;
end;
$$;

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

  update group_members set removed_at = now()
  where group_id = p_group and user_id = v_uid;
end;
$$;

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

  update group_members set removed_at = now()
  where group_id = p_group and user_id = p_user;
end;
$$;

-- Admin transfer. A group may hold more than one admin; the trigger only
-- insists it never holds zero while anyone is still in it.
create or replace function public.set_group_role(p_group uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_group_admin(p_group) then
    raise exception 'Only a group admin can change roles';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'Bad role';
  end if;
  if not exists (select 1 from group_members
                 where group_id = p_group and user_id = p_user and removed_at is null) then
    raise exception 'They are not in this group';
  end if;

  -- The trigger below would catch this too, but only at commit and only to say
  -- "a group must keep at least one admin". Demoting is never the way out of
  -- the role — promote a replacement, or leave the group.
  if p_role = 'member'
     and exists (select 1 from group_members
                 where group_id = p_group and user_id = p_user
                   and removed_at is null and role = 'admin')
     and (select count(*) from group_members
          where group_id = p_group and removed_at is null and role = 'admin') = 1
  then
    raise exception 'Make someone else an admin first';
  end if;

  update group_members set role = p_role
  where group_id = p_group and user_id = p_user;
end;
$$;

create or replace function public.archive_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_group_admin(p_group) then
    raise exception 'Only a group admin can archive the group';
  end if;
  update groups set archived_at = now() where id = p_group and archived_at is null;
end;
$$;

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
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from groups where join_code = v_code);
  end loop;
  update groups set join_code = v_code where id = p_group;
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Weekly configuration
-- ---------------------------------------------------------------------------

-- Editable until the week's first kickoff, then locked. Picks already made on
-- a game that gets removed are NOT deleted: the board renders them greyed and
-- the record helper drops them, because a pick is a receipt of what someone
-- did and deleting it would rewrite history to suit a config change.
create or replace function public.set_group_week_config(
  p_group       uuid,
  p_season      integer,
  p_week        integer,
  p_season_type text,
  p_mode        text,
  p_conference  text,
  p_markets     text[],
  p_game_ids    integer[] default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not public.is_group_admin(p_group) then
    raise exception 'Only a group admin can set the week';
  end if;
  if p_season_type not in ('regular', 'postseason') then
    raise exception 'Bad season type';
  end if;
  if p_mode not in ('handpicked', 'full_slate', 'conference') then
    raise exception 'Bad selection mode';
  end if;
  if p_mode = 'conference' and coalesce(btrim(p_conference), '') = '' then
    raise exception 'Pick a conference';
  end if;
  if p_markets is null or array_length(p_markets, 1) is null then
    raise exception 'Turn on at least one bet type';
  end if;
  if not (p_markets <@ array['spread', 'total', 'straight_up']::text[]) then
    raise exception 'Unknown bet type';
  end if;

  -- Only for a week that already has a config: a group formed mid-Saturday can
  -- still set itself up, but from then on the freeze applies.
  if exists (select 1 from group_week_config
             where group_id = p_group and season_id = p_season
               and week = p_week and season_type = p_season_type)
     and public.group_week_is_locked(p_group, p_season, p_week, p_season_type)
  then
    raise exception 'Week % is locked — the first game has kicked off.', p_week;
  end if;

  insert into group_week_config (
    group_id, season_id, week, season_type,
    selection_mode, conference, markets, updated_by, updated_at
  )
  values (
    p_group, p_season, p_week, p_season_type,
    p_mode, case when p_mode = 'conference' then btrim(p_conference) end,
    p_markets, v_uid, now()
  )
  on conflict (group_id, season_id, week, season_type) do update
    set selection_mode = excluded.selection_mode,
        conference     = excluded.conference,
        markets        = excluded.markets,
        updated_by     = excluded.updated_by,
        updated_at     = now();

  delete from group_week_games
  where group_id = p_group and season_id = p_season
    and week = p_week and season_type = p_season_type;

  if p_mode = 'handpicked' then
    if p_game_ids is null or array_length(p_game_ids, 1) is null then
      raise exception 'Pick at least one game';
    end if;
    if exists (
      select 1 from unnest(p_game_ids) gid
      where not exists (
        select 1 from games g
        where g.id = gid and g.season_id = p_season
          and g.week = p_week and g.season_type = p_season_type
      )
    ) then
      raise exception 'That game is not on week %', p_week;
    end if;

    insert into group_week_games (group_id, season_id, week, season_type, game_id)
    select p_group, p_season, p_week, p_season_type, gid
    from unnest(p_game_ids) gid;
  end if;
  -- full_slate and conference resolve live until the freeze materialises them.
end;
$$;

-- Idempotent. Called by the freeze job on game days; safe to call at any time
-- because it no-ops until the week's first kickoff has actually passed.
create or replace function public.freeze_group_week(
  p_group       uuid,
  p_season      integer,
  p_week        integer,
  p_season_type text default 'regular'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kick timestamptz;
begin
  if not exists (select 1 from group_week_config
                 where group_id = p_group and season_id = p_season
                   and week = p_week and season_type = p_season_type
                   and locked_at is null) then
    return false;
  end if;

  v_kick := public.group_week_first_kickoff(p_group, p_season, p_week, p_season_type);
  if v_kick is null or v_kick > now() then
    return false;
  end if;

  -- Capture the live-resolved set BEFORE stamping locked_at — after the stamp
  -- group_week_game_ids reads the materialised table, which is still empty.
  insert into group_week_games (group_id, season_id, week, season_type, game_id)
  select p_group, p_season, p_week, p_season_type, gid
  from public.group_week_game_ids(p_group, p_season, p_week, p_season_type) gid
  on conflict do nothing;

  update group_week_config set locked_at = now()
  where group_id = p_group and season_id = p_season
    and week = p_week and season_type = p_season_type;

  return true;
end;
$$;

revoke execute on function public.create_group(text, text)                    from public, anon;
revoke execute on function public.join_group(text)                            from public, anon;
revoke execute on function public.leave_group(uuid)                           from public, anon;
revoke execute on function public.remove_group_member(uuid, uuid)             from public, anon;
revoke execute on function public.set_group_role(uuid, uuid, text)            from public, anon;
revoke execute on function public.archive_group(uuid)                         from public, anon;
revoke execute on function public.regenerate_join_code(uuid)                  from public, anon;
revoke execute on function public.set_group_week_config(uuid, integer, integer, text, text, text, text[], integer[])
  from public, anon;
-- The freeze job connects as service_role, which needs no grant.
revoke execute on function public.freeze_group_week(uuid, integer, integer, text)
  from public, anon, authenticated;

grant execute on function public.create_group(text, text)                     to authenticated;
grant execute on function public.join_group(text)                             to authenticated;
grant execute on function public.leave_group(uuid)                            to authenticated;
grant execute on function public.remove_group_member(uuid, uuid)              to authenticated;
grant execute on function public.set_group_role(uuid, uuid, text)             to authenticated;
grant execute on function public.archive_group(uuid)                          to authenticated;
grant execute on function public.regenerate_join_code(uuid)                   to authenticated;
grant execute on function public.set_group_week_config(uuid, integer, integer, text, text, text, text[], integer[])
  to authenticated;
