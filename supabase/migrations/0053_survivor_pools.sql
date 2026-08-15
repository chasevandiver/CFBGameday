-- Survivor pools: the third kind of group.
--
-- Owner request 2026-08-15: "For the Groups Tab — add a survivor pickem option
-- for a survivor pool for both CFB and NFL. For CFB most will do by conference,
-- the NFL would just be the NFL."
--
-- ## Why it is a kind, not a market
--
-- The obvious cheap version is a pick'em week whose only market is
-- `straight_up` with a one-pick minimum. It is wrong in the two ways that
-- matter, and both are about state that pick'em does not have:
--
--   1. **A survivor pick is constrained by every earlier pick.** You cannot
--      take a team twice. `picks` has no notion of a season-long constraint
--      across weeks, and adding one would put a survivor rule on every pool.
--   2. **A survivor entrant can be out.** Pick'em has no failure state — you
--      pick badly and your record is bad. Survivor's whole shape is that a
--      wrong answer removes you from the game, and a schema with no way to say
--      so cannot render the one screen the format is about.
--
-- So it is a third `groups.kind`, sharing the roster, the join code, the slug
-- and the visibility rules with the other two, and sharing nothing else — the
-- same relationship `betting` (0027) has to `pickem`.
--
-- ## Scope
--
-- A pool is one league and, optionally, one conference: "SEC survivor" is the
-- normal CFB shape and the NFL's is the whole league. `conference` null means
-- the whole league. The scope constrains which TEAM may be picked, not which
-- game: an SEC team playing a non-conference opponent is a legal pick, which
-- is how these pools are actually run.
--
-- ## What is enforced here and what is derived
--
-- Enforced in the RPC and by constraints, because they are invariants a direct
-- PostgREST call must not be able to break: one pick per week, the picked team
-- is in the game, the team is inside the pool's scope, no team twice unless the
-- pool allows it, and nothing after kickoff.
--
-- **Elimination is derived, not stored.** Whether you are out is a function of
-- your picks and the final scores, and storing it would create a second source
-- of truth that a re-grade or a corrected score could contradict — the same
-- reason `cover_flips` logs events and the card computes the verdict. It is
-- computed in `src/lib/survivor.ts` and rendered from there. The consequence,
-- stated rather than hidden: an eliminated member CAN still insert a pick via
-- the RPC. It has no effect on anything, because every standing is recomputed
-- from the whole history each read.

-- ---------------------------------------------------------------------------
-- The kind
-- ---------------------------------------------------------------------------

alter table public.groups drop constraint if exists groups_kind_check;
alter table public.groups
  add constraint groups_kind_check check (kind in ('pickem', 'betting', 'survivor'));

comment on column public.groups.kind is
  'pickem = admin-configured board, members make picks. betting = a lens over '
  'members'' own ledgers; no board, no week config, no picks. survivor = one '
  'winner per week, no repeats, wrong answer and you are out.';

-- ---------------------------------------------------------------------------
-- The pool
-- ---------------------------------------------------------------------------

create table public.survivor_pools (
  group_id    uuid primary key references public.groups(id) on delete cascade,
  -- The league AND the year: `seasons.sport` is what makes this a CFB pool or
  -- an NFL one, so no separate league column can drift out of step with it.
  season_id   integer not null references public.seasons(id),
  -- Null = the whole league. Matched against `teams.conference`, which is the
  -- same string `group_week_config.conference` matches (0020).
  conference  text,
  -- Wrong answers allowed before you are out. 1 is the classic single
  -- elimination; 2 is the common "one mulligan" house rule.
  strikes     integer not null default 1 check (strikes between 1 and 3),
  -- Most pools ban re-using a team all season. The ones that don't are usually
  -- short pools, so it is a setting rather than a rule.
  reuse_teams boolean not null default false,
  -- The first week that counts. A pool started in week 6 must not eliminate
  -- everyone for the five weeks it did not exist.
  start_week  integer not null default 1 check (start_week >= 0),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The picks
--
-- One row per member per week. `team_id` is the answer; `game_id` is which game
-- settles it, stored rather than looked up so a rescheduled game keeps its pick
-- attached to the fixture that was actually picked.
-- ---------------------------------------------------------------------------

create table public.survivor_picks (
  group_id    uuid    not null references public.groups(id) on delete cascade,
  season_id   integer not null references public.seasons(id),
  season_type text    not null default 'regular',
  week        integer not null,
  user_id     uuid    not null references public.profiles(id) on delete cascade,
  game_id     integer not null references public.games(id),
  team_id     integer not null references public.teams(id),
  picked_at   timestamptz not null default now(),
  primary key (group_id, season_id, season_type, week, user_id)
);

create index survivor_picks_entrant
  on public.survivor_picks (group_id, season_id, user_id);
create index survivor_picks_game on public.survivor_picks (game_id);

-- ---------------------------------------------------------------------------
-- A survivor group has no board either
--
-- 0027 introduced this guard for betting groups. Extended rather than copied:
-- the two triggers it hangs off `picks` and `group_week_config` stay exactly as
-- they are, and the predicate underneath them learns the third kind.
-- ---------------------------------------------------------------------------

create or replace function public.group_is_survivor(p_group uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from groups g where g.id = p_group and g.kind = 'survivor');
$$;

grant execute on function public.group_is_survivor(uuid) to authenticated, anon;

create or replace function public.forbid_pickem_on_betting_group()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.group_is_betting(new.group_id) then
    raise exception 'That is a betting group — it has no pick''em board';
  end if;
  if public.group_is_survivor(new.group_id) then
    raise exception 'That is a survivor pool — it has no pick''em board';
  end if;
  return new;
end;
$$;

-- And the mirror: survivor picks belong only to survivor pools.
create or replace function public.require_survivor_group()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.group_is_survivor(new.group_id) then
    raise exception 'That group is not a survivor pool';
  end if;
  return new;
end;
$$;

drop trigger if exists survivor_picks_need_survivor_group on public.survivor_picks;
create trigger survivor_picks_need_survivor_group
  before insert or update on public.survivor_picks
  for each row execute function public.require_survivor_group();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Reads follow `picks` exactly (0023): your own always, everyone else's once
-- the game they are on has kicked off — or immediately, if the group has not
-- turned the blind on. A survivor pool with visible picks is a different game
-- (everyone waits to see what the leader takes), so it reuses the group's
-- existing setting rather than inventing a second one.
--
-- Writes are revoked outright. Everything goes through the RPCs below, which is
-- the only place the no-repeat rule can be enforced.
-- ---------------------------------------------------------------------------

alter table public.survivor_pools enable row level security;
alter table public.survivor_picks enable row level security;

create policy "read visible survivor pools" on public.survivor_pools
  for select to authenticated using (public.is_group_visible(group_id));
create policy "anon read public survivor pools" on public.survivor_pools
  for select to anon using (public.is_group_visible(group_id));

create policy "read own survivor picks" on public.survivor_picks
  for select to authenticated
  using (user_id = (select auth.uid()) and public.is_group_visible(group_id));

create policy "read others survivor picks when revealed" on public.survivor_picks
  for select to authenticated
  using (
    user_id <> (select auth.uid())
    and public.is_group_visible(group_id)
    and public.picks_revealed(group_id, game_id)
  );

create policy "anon read revealed survivor picks" on public.survivor_picks
  for select to anon
  using (public.is_group_visible(group_id) and public.picks_revealed(group_id, game_id));

revoke insert, update, delete on public.survivor_pools from anon, authenticated;
revoke insert, update, delete on public.survivor_picks from anon, authenticated;
grant select on public.survivor_pools to anon, authenticated;
grant select on public.survivor_picks to anon, authenticated;
-- 0049's posture: no role gets TRUNCATE on a public table.
revoke truncate on public.survivor_pools from anon, authenticated;
revoke truncate on public.survivor_picks from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Creating a pool
--
-- A separate RPC rather than three more defaulted arguments on `create_group`:
-- that function has already been dropped and recreated once to add a parameter
-- (0027), each overload is a chance for an ambiguous call, and the pool's
-- settings are meaningless for the other two kinds.
-- ---------------------------------------------------------------------------

create or replace function public.create_survivor_group(
  p_name        text,
  p_visibility  text default 'private',
  p_sport       text default 'cfb',
  p_conference  text default null,
  p_strikes     integer default 1,
  p_reuse_teams boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_id     uuid;
  v_base   text;
  v_slug   text;
  v_code   text;
  v_n      integer := 0;
  v_season integer;
  v_conf   text := nullif(btrim(coalesce(p_conference, '')), '');
begin
  if v_uid is null then
    raise exception 'Sign in to create a pool';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Give the pool a name';
  end if;
  if length(btrim(p_name)) > 60 then
    raise exception 'Group names are 60 characters or fewer';
  end if;
  if p_visibility not in ('private', 'public') then
    raise exception 'Bad visibility';
  end if;
  if p_sport not in ('cfb', 'nfl') then
    raise exception 'Bad league';
  end if;
  if coalesce(p_strikes, 1) not between 1 and 3 then
    raise exception 'Strikes has to be 1, 2 or 3';
  end if;
  -- The NFL is one conference-less pool by construction; an AFC-only survivor
  -- is not a thing anyone runs, and allowing it would mean matching against
  -- `teams.conference` values that mean something different there.
  if p_sport = 'nfl' and v_conf is not null then
    raise exception 'NFL pools run across the whole league';
  end if;

  select id into v_season from seasons where is_current and sport = p_sport;
  if not found then
    raise exception 'No current % season', upper(p_sport);
  end if;

  if v_conf is not null and not exists (
    select 1 from teams t where t.conference = v_conf
  ) then
    raise exception 'No teams in conference %', v_conf;
  end if;

  v_base := btrim(regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'), '-');
  if v_base = '' then
    v_base := 'pool';
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

  insert into groups (name, slug, visibility, join_code, created_by, kind, leagues)
  values (btrim(p_name), v_slug, p_visibility, v_code, v_uid, 'survivor', array[p_sport])
  returning id into v_id;

  insert into group_members (group_id, user_id, role) values (v_id, v_uid, 'admin');

  insert into survivor_pools (group_id, season_id, conference, strikes, reuse_teams, start_week)
  values (
    v_id, v_season, v_conf, coalesce(p_strikes, 1), coalesce(p_reuse_teams, false),
    -- Start at the week the pool is created in, so nobody takes a strike for
    -- the weeks before it existed. Preseason never counts.
    coalesce(
      (select min(g.week) from games g
       where g.season_id = v_season and g.season_type = 'regular'
         and g.start_ts > now()),
      1)
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Making a pick
-- ---------------------------------------------------------------------------

create or replace function public.make_survivor_pick(
  p_group uuid,
  p_game  integer,
  p_team  integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := (select auth.uid());
  pool   record;
  g      record;
  v_conf text;
begin
  if v_uid is null then
    raise exception 'Sign in to make your pick';
  end if;
  if not public.is_group_member(p_group) then
    raise exception 'You are not in this pool';
  end if;

  select * into pool from survivor_pools where group_id = p_group;
  if not found then
    raise exception 'That group is not a survivor pool';
  end if;

  select id, season_id, week, season_type, start_ts, home_team_id, away_team_id, status
    into g
  from games where id = p_game;
  if not found then
    raise exception 'Game not found';
  end if;
  if g.season_id <> pool.season_id then
    raise exception 'That game is not in this pool''s season';
  end if;
  if g.season_type = 'preseason' then
    raise exception 'Preseason games do not count';
  end if;
  if g.week < pool.start_week then
    raise exception 'This pool starts in week %', pool.start_week;
  end if;
  if p_team not in (g.home_team_id, g.away_team_id) then
    raise exception 'That team is not playing in that game';
  end if;

  if pool.conference is not null then
    select conference into v_conf from teams where id = p_team;
    if v_conf is distinct from pool.conference then
      raise exception 'This pool only takes % teams', pool.conference;
    end if;
  end if;

  -- Same lock as `make_pick` (0013): a pick closes at its own game's kickoff,
  -- and a TBD kickoff counts as locked rather than as open forever.
  if g.start_ts is null or g.start_ts <= now() then
    raise exception 'Kickoff — this game is locked.';
  end if;

  -- No team twice. Scoped to the entrant and the season, and ignoring the week
  -- being written so that re-picking the same team for the same week is the
  -- no-op it looks like.
  if not pool.reuse_teams and exists (
    select 1 from survivor_picks sp
    where sp.group_id = p_group
      and sp.season_id = pool.season_id
      and sp.user_id = v_uid
      and sp.team_id = p_team
      and not (sp.season_type = g.season_type and sp.week = g.week)
  ) then
    raise exception 'You have already used that team';
  end if;

  insert into survivor_picks (
    group_id, season_id, season_type, week, user_id, game_id, team_id, picked_at
  )
  values (p_group, pool.season_id, g.season_type, g.week, v_uid, p_game, p_team, now())
  on conflict (group_id, season_id, season_type, week, user_id) do update
    set game_id = excluded.game_id,
        team_id = excluded.team_id,
        picked_at = now()
    -- Changing your mind is allowed until the game you ALREADY hold kicks off,
    -- not just until the new one does. Without this a member could sit on an
    -- early Thursday pick, watch it lose, and swap into Sunday.
    where survivor_picks.game_id = excluded.game_id
       or (select start_ts from games where id = survivor_picks.game_id) > now();

  if not found then
    raise exception 'Your current pick has already kicked off.';
  end if;
end;
$$;

create or replace function public.remove_survivor_pick(
  p_group       uuid,
  p_week        integer,
  p_season_type text default 'regular'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row record;
begin
  select sp.*, g.start_ts into v_row
  from survivor_picks sp join games g on g.id = sp.game_id
  where sp.group_id = p_group and sp.user_id = v_uid
    and sp.week = p_week and sp.season_type = p_season_type;
  if not found then
    return;
  end if;
  if v_row.start_ts is null or v_row.start_ts <= now() then
    raise exception 'Kickoff — that pick is locked.';
  end if;
  delete from survivor_picks
  where group_id = p_group and user_id = v_uid
    and week = p_week and season_type = p_season_type;
end;
$$;

revoke execute on function public.create_survivor_group(text, text, text, text, integer, boolean)
  from public, anon;
revoke execute on function public.make_survivor_pick(uuid, integer, integer)   from public, anon;
revoke execute on function public.remove_survivor_pick(uuid, integer, text)    from public, anon;

grant execute on function public.create_survivor_group(text, text, text, text, integer, boolean)
  to authenticated;
grant execute on function public.make_survivor_pick(uuid, integer, integer)    to authenticated;
grant execute on function public.remove_survivor_pick(uuid, integer, text)     to authenticated;
