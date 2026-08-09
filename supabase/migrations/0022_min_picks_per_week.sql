-- A minimum number of picks per week, per group.
--
-- League Rules #6 has always stated "3 picks/week minimum to stay on the
-- leaderboard" and nothing has ever enforced or even displayed it. With
-- per-group formats the number stops being a site-wide fact anyway: a pool
-- handpicking six games cannot ask for the same minimum as one playing the
-- full slate.
--
-- 0 means no minimum, which is the default and what every existing week gets.
-- The rule is displayed, not enforced: a member below the line sees how far
-- off they are and so does everyone else on the board. Blocking a pick or
-- voiding a week would be a bigger decision than a settings row, and this
-- schema does not presume it.

alter table public.group_week_config
  add column min_picks_per_week integer not null default 0
  constraint group_week_min_picks_sane check (min_picks_per_week between 0 and 50);

-- The signature changes, so the old one goes rather than lingering as a
-- callable overload that silently ignores the new setting.
drop function if exists public.set_group_week_config(
  uuid, integer, integer, text, text, text, text[], integer[]);

create or replace function public.set_group_week_config(
  p_group       uuid,
  p_season      integer,
  p_week        integer,
  p_season_type text,
  p_mode        text,
  p_conference  text,
  p_markets     text[],
  p_game_ids    integer[] default null,
  p_min_picks   integer default 0
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
  if coalesce(p_min_picks, 0) < 0 or coalesce(p_min_picks, 0) > 50 then
    raise exception 'A weekly minimum has to be between 0 and 50';
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
    selection_mode, conference, markets, min_picks_per_week, updated_by, updated_at
  )
  values (
    p_group, p_season, p_week, p_season_type,
    p_mode, case when p_mode = 'conference' then btrim(p_conference) end,
    p_markets, coalesce(p_min_picks, 0), v_uid, now()
  )
  on conflict (group_id, season_id, week, season_type) do update
    set selection_mode     = excluded.selection_mode,
        conference         = excluded.conference,
        markets            = excluded.markets,
        min_picks_per_week = excluded.min_picks_per_week,
        updated_by         = excluded.updated_by,
        updated_at         = now();

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

revoke execute on function public.set_group_week_config(
  uuid, integer, integer, text, text, text, text[], integer[], integer)
  from public, anon;
grant execute on function public.set_group_week_config(
  uuid, integer, integer, text, text, text, text[], integer[], integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Renaming a group, and changing who can see it
--
-- create_group set both and nothing could change either afterwards, so a
-- typo in a group name was permanent and a pool could never be opened up or
-- closed off. The slug moves with the name, which changes the group's URL —
-- acceptable for a pool of friends who reach it from the Groups tab, and the
-- alternative is a slug that contradicts the name forever.
-- ---------------------------------------------------------------------------

create or replace function public.update_group(
  p_group      uuid,
  p_name       text,
  p_visibility text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_slug text;
  v_n    integer := 0;
begin
  if not public.is_group_admin(p_group) then
    raise exception 'Only a group admin can change the group';
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
  -- Its own current slug is not a collision.
  while exists (select 1 from groups where slug = v_slug and id <> p_group) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  update groups
  set name = btrim(p_name), slug = v_slug, visibility = p_visibility
  where id = p_group;

  return v_slug;
end;
$$;

revoke execute on function public.update_group(uuid, text, text) from public, anon;
grant execute on function public.update_group(uuid, text, text) to authenticated;
