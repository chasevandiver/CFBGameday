-- NFL alongside CFB (docs/SPEC.md addendum; docs/BRAND.md §17 has wanted the
-- product to carry both leagues since v1.0).
--
-- The design decision this migration encodes: NFL is a second SEASONS ROW
-- (id = 100000 + year, so 2026 NFL is 102026), not a second week-space inside
-- the CFB season. Every season-scoped CFB job — model pricing (freezeJob),
-- the ratings replay, weather, rankings — filters by season_id and therefore
-- never sees an NFL row without a single filter change. CFB week 3 and NFL
-- week 1 overlap on the calendar but never in a query, a realtime channel, or
-- a group_week_config key. Cross-league reads (ledger, grading, home) opt in
-- with .in("season_id", [year, 100000+year]).
--
-- Id spaces (src/lib/league.ts is the TS mirror of these rules):
--   * teams/venues: ESPN NFL ids are 1–34 and CFBD's college ids include that
--     range, so NFL rows are stored offset by 100000.
--   * games: stored under their raw ESPN event id — CFBD game ids ARE ESPN
--     event ids (college), and ESPN allocates event ids globally across
--     leagues, so they cannot collide. The NFL ingest still refuses to
--     overwrite any row whose sport reads 'cfb', making the assumption fail
--     loud instead of silently corrupting a CFB game.
--
-- Existing rows are all CFB; the default backfills them as such.

alter table public.seasons
  add column sport text not null default 'cfb' check (sport in ('cfb', 'nfl'));
alter table public.teams
  add column sport text not null default 'cfb' check (sport in ('cfb', 'nfl'));
alter table public.games
  add column sport text not null default 'cfb' check (sport in ('cfb', 'nfl'));

-- fetchCurrentSeasonWeek resolves "the current season" per sport with
-- .eq("sport", ...).maybeSingle(); two concurrent current seasons must be
-- possible across sports and impossible within one.
create unique index seasons_one_current_per_sport
  on public.seasons (sport) where is_current;

-- ---------------------------------------------------------------------------
-- Pick'em league scope
--
-- A pick'em group plays CFB by default; its admin can open it to NFL, or to
-- both. Betting groups carry no scope — a betting group is a lens over what
-- its members already bet (0027), and the ledger spans both leagues.
-- ---------------------------------------------------------------------------

alter table public.groups
  add column leagues text[] not null default '{cfb}'
  constraint groups_leagues_sane
  check (leagues <@ array['cfb', 'nfl']::text[] and array_length(leagues, 1) >= 1);

create or replace function public.set_group_leagues(p_group uuid, p_leagues text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_group_admin(p_group) then
    raise exception 'Only a group admin can change the leagues';
  end if;
  if public.group_is_betting(p_group) then
    raise exception 'A betting group has no league scope — the sheet follows the bets';
  end if;
  if p_leagues is null or array_length(p_leagues, 1) is null then
    raise exception 'Keep at least one league on';
  end if;
  if not (p_leagues <@ array['cfb', 'nfl']::text[]) then
    raise exception 'Unknown league';
  end if;

  update groups
  set leagues = (select array_agg(distinct l order by l) from unnest(p_leagues) l)
  where id = p_group;
end;
$$;

revoke execute on function public.set_group_leagues(uuid, text[]) from public, anon;
grant execute on function public.set_group_leagues(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Week configs stay inside the group's leagues
--
-- Same body as 0022 plus one guard: the season being configured must belong
-- to a league the group plays. Signature unchanged, so this replaces in place.
-- ---------------------------------------------------------------------------

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
  if not exists (
    select 1 from seasons s, groups g
    where s.id = p_season and g.id = p_group and s.sport = any (g.leagues)
  ) then
    raise exception 'This group does not play that league';
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
