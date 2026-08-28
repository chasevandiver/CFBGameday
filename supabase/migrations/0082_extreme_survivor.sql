-- Extreme survivor: as many teams a week as you dare, first to a win target.
--
-- Owner request 2026-08-28: "add a parameter for the survivor pool where I can
-- toggle an option to pick multiple teams per week, but if one loses you're
-- out. My friend found a fun version of first to 100 without getting one wrong
-- as a survival group. Maybe make another group format called extreme
-- survivor."
--
-- ## The format, precisely
--
-- `survivor_pools.format` is 'classic' (everything that existed before this
-- migration, unchanged) or 'extreme':
--
--   * Any number of picks per week, each locking at its own game's kickoff and
--     each removable until then. No replace semantics — a second pick is a
--     second pick, not a change of mind about the first.
--   * Every won pick is a win; the pool is a race to `target_wins` (the
--     friend's version: 100).
--   * One losing pick — a loss or a tie, same as classic — and you are out,
--     whole weeks of wins notwithstanding. Extreme is single-elimination by
--     definition, so `strikes` is pinned to 1 at creation.
--   * A missed week is NOT a strike. Classic needs that rule or stalling would
--     be a strategy; in a race, sitting a week out is its own punishment.
--   * The no-repeat rule and the conference scope apply per pick exactly as in
--     classic. Picking both sides of one game is refused — it is a guaranteed
--     elimination wearing a strategy's clothes, and the button that allows it
--     would only ever be tapped by mistake.
--
-- Like elimination, "finished" is derived, not stored: whoever's computed wins
-- reach the target without a strike has won, and a corrected score moves that
-- verdict the same way it moves everything else (see 0053's header).
--
-- ## The key had to widen
--
-- `survivor_picks`' primary key was (group, season, season_type, week, user) —
-- literally "one pick per member per week", the classic invariant expressed as
-- schema. Extreme breaks exactly that invariant and nothing else, so the key
-- gains `team_id` and the one-per-week rule moves into `make_survivor_pick`'s
-- classic branch, which now spells out what its ON CONFLICT used to imply.
--
-- Both survivor RPCs are also recreated with 0081's `p_for`, so a group admin
-- can run a seat's survivor entry the same way they run its pick'em card.

-- ---------------------------------------------------------------------------
-- The pool learns its format
-- ---------------------------------------------------------------------------

alter table public.survivor_pools
  add column format text not null default 'classic'
    check (format in ('classic', 'extreme')),
  add column target_wins integer
    check (target_wins between 5 and 500);

-- A race has a finish line; classic has none. One fact, not two that drift.
alter table public.survivor_pools
  add constraint survivor_pools_target_matches_format
  check ((format = 'extreme') = (target_wins is not null));

comment on column public.survivor_pools.format is
  'classic = one pick a week, strikes and you are out. extreme = any number of '
  'picks a week, race to target_wins, one losing pick eliminates.';
comment on column public.survivor_pools.target_wins is
  'The finish line of an extreme pool ("first to 100"). Null for classic.';

-- ---------------------------------------------------------------------------
-- One row per pick, not one row per week
-- ---------------------------------------------------------------------------

alter table public.survivor_picks drop constraint survivor_picks_pkey;
alter table public.survivor_picks
  add primary key (group_id, season_id, season_type, week, user_id, team_id);

-- ---------------------------------------------------------------------------
-- Creating a pool: the format and its finish line join the arguments.
-- Dropped and recreated — a defaulted-argument overload is an ambiguous
-- PostgREST call (same reason as 0081's make_pick).
-- ---------------------------------------------------------------------------

drop function if exists public.create_survivor_group(text, text, text, text, integer, boolean);

create or replace function public.create_survivor_group(
  p_name        text,
  p_visibility  text default 'private',
  p_sport       text default 'cfb',
  p_conference  text default null,
  p_strikes     integer default 1,
  p_reuse_teams boolean default false,
  p_format      text default 'classic',
  p_target_wins integer default null
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
  v_target integer;
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
  if coalesce(p_format, 'classic') not in ('classic', 'extreme') then
    raise exception 'Bad format';
  end if;
  if p_format = 'extreme' then
    -- One losing pick and you are out — that IS the format. A strikes knob on
    -- it would be a second, contradictory statement of the same rule.
    if coalesce(p_strikes, 1) <> 1 then
      raise exception 'Extreme survivor is one loss and out — strikes do not apply';
    end if;
    v_target := coalesce(p_target_wins, 100);
    if v_target not between 5 and 500 then
      raise exception 'The race has to be to between 5 and 500 wins';
    end if;
  else
    if p_target_wins is not null then
      raise exception 'Only extreme pools race to a win count';
    end if;
    if coalesce(p_strikes, 1) not between 1 and 3 then
      raise exception 'Strikes has to be 1, 2 or 3';
    end if;
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

  insert into survivor_pools (
    group_id, season_id, conference, strikes, reuse_teams, format, target_wins, start_week
  )
  values (
    v_id, v_season, v_conf, coalesce(p_strikes, 1), coalesce(p_reuse_teams, false),
    coalesce(p_format, 'classic'), v_target,
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
-- Making a pick, in either format, for yourself or for a seat
-- ---------------------------------------------------------------------------

drop function if exists public.make_survivor_pick(uuid, integer, integer);

create or replace function public.make_survivor_pick(
  p_group uuid,
  p_game  integer,
  p_team  integer,
  p_for   uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid;
  pool   record;
  g      record;
  v_conf text;
  held   record;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to make your pick';
  end if;
  if not public.is_group_member(p_group) then
    raise exception 'You are not in this pool';
  end if;
  v_uid := public.acting_user(p_group, p_for);

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
  -- being written: in classic so that re-picking the same team for the same
  -- week is the no-op it looks like, in extreme because a same-week row for
  -- this team IS this pick.
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

  if pool.format = 'extreme' then
    -- Both sides of one game is a guaranteed loss; refuse it as the mistake
    -- it can only be.
    if exists (
      select 1 from survivor_picks sp
      where sp.group_id = p_group and sp.user_id = v_uid
        and sp.game_id = p_game and sp.team_id <> p_team
    ) then
      raise exception 'You already have the other side of that game';
    end if;
    -- One row per pick. The conflict arm makes a re-tap of the same team the
    -- no-op it looks like.
    insert into survivor_picks (
      group_id, season_id, season_type, week, user_id, game_id, team_id, picked_at
    )
    values (p_group, pool.season_id, g.season_type, g.week, v_uid, p_game, p_team, now())
    on conflict (group_id, season_id, season_type, week, user_id, team_id) do update
      set game_id = excluded.game_id,
          picked_at = now();
    return;
  end if;

  -- Classic: one pick a week. The key no longer says so (it widened for
  -- extreme), so the rule its ON CONFLICT used to imply is spelled out:
  -- changing your mind is allowed until the game you ALREADY hold kicks off,
  -- not just until the new one does — without that, a member could sit on an
  -- early Thursday pick, watch it lose, and swap into Sunday.
  select sp.game_id, sp.team_id, gm.start_ts
    into held
  from survivor_picks sp
  join games gm on gm.id = sp.game_id
  where sp.group_id = p_group
    and sp.season_id = pool.season_id
    and sp.user_id = v_uid
    and sp.season_type = g.season_type
    and sp.week = g.week;

  if not found then
    insert into survivor_picks (
      group_id, season_id, season_type, week, user_id, game_id, team_id, picked_at
    )
    values (p_group, pool.season_id, g.season_type, g.week, v_uid, p_game, p_team, now());
    return;
  end if;

  if held.game_id = p_game and held.team_id = p_team then
    -- The re-tap: same pick, refreshed timestamp, nothing else.
    update survivor_picks
    set picked_at = now()
    where group_id = p_group and season_id = pool.season_id and user_id = v_uid
      and season_type = g.season_type and week = g.week and team_id = p_team;
    return;
  end if;

  if held.start_ts is null or held.start_ts <= now() then
    raise exception 'Your current pick has already kicked off.';
  end if;

  update survivor_picks
  set game_id = p_game, team_id = p_team, picked_at = now()
  where group_id = p_group and season_id = pool.season_id and user_id = v_uid
    and season_type = g.season_type and week = g.week;
end;
$$;

-- ---------------------------------------------------------------------------
-- Clearing a pick. Extreme weeks can hold several, so the team names which;
-- classic callers keep omitting it. A team-less call on a multi-pick week is
-- refused rather than guessed at.
-- ---------------------------------------------------------------------------

drop function if exists public.remove_survivor_pick(uuid, integer, text);

create or replace function public.remove_survivor_pick(
  p_group       uuid,
  p_week        integer,
  p_season_type text default 'regular',
  p_team        integer default null,
  p_for         uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_n   integer;
  v_row record;
begin
  v_uid := public.acting_user(p_group, p_for);

  select count(*) into v_n
  from survivor_picks sp
  where sp.group_id = p_group and sp.user_id = v_uid
    and sp.week = p_week and sp.season_type = p_season_type
    and (p_team is null or sp.team_id = p_team);
  if v_n = 0 then
    return;
  end if;
  if v_n > 1 then
    raise exception 'Say which team to clear';
  end if;

  select sp.team_id, gm.start_ts into v_row
  from survivor_picks sp join games gm on gm.id = sp.game_id
  where sp.group_id = p_group and sp.user_id = v_uid
    and sp.week = p_week and sp.season_type = p_season_type
    and (p_team is null or sp.team_id = p_team);

  if v_row.start_ts is null or v_row.start_ts <= now() then
    raise exception 'Kickoff — that pick is locked.';
  end if;

  delete from survivor_picks
  where group_id = p_group and user_id = v_uid
    and week = p_week and season_type = p_season_type
    and team_id = v_row.team_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.create_survivor_group(
  text, text, text, text, integer, boolean, text, integer) from public, anon;
revoke execute on function public.make_survivor_pick(uuid, integer, integer, uuid)
  from public, anon;
revoke execute on function public.remove_survivor_pick(uuid, integer, text, integer, uuid)
  from public, anon;

grant execute on function public.create_survivor_group(
  text, text, text, text, integer, boolean, text, integer) to authenticated;
grant execute on function public.make_survivor_pick(uuid, integer, integer, uuid)
  to authenticated;
grant execute on function public.remove_survivor_pick(uuid, integer, text, integer, uuid)
  to authenticated;
