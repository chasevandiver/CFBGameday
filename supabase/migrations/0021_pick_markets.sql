-- Picks belong to a group, and carry a market.
--
-- Two limits fall here. `picks` was unique on (user_id, game_id) with `side`
-- as the only market discriminator, so a user could not hold a spread and a
-- total on the same game — and with groups, could not hold a different side in
-- two different pools. And there was no way to record a straight-up winner at
-- all: home/away implied a spread.
--
-- Straight-up is winner-only by owner decision: no line, no price, no CLV.
-- That is what makes `line_at_pick` nullable, guarded by a check so the two
-- priced markets still cannot be written without one.
--
-- The backfill puts every existing pick into one group so `group_id` can be
-- NOT NULL with no window in between. A nullable column in a unique index does
-- not deduplicate, which would silently allow two spread picks on one game.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table public.picks
  add column group_id uuid references public.groups(id) on delete cascade;

alter table public.picks
  add column market text not null default 'spread'
  check (market in ('spread', 'total', 'straight_up'));

-- The default is only right for the spread picks. Existing over/unders would
-- otherwise be relabelled as spreads and graded against the wrong number.
update public.picks set market = 'total' where side in ('over', 'under');

-- ---------------------------------------------------------------------------
-- 2. Backfill: the existing crew becomes the first group
--
-- "Everyone in profiles" was the implicit crew, and the leaderboard on /crew is
-- its history. Materialising it as a real group keeps that history addressable
-- instead of stranding it behind a NOT NULL.
-- ---------------------------------------------------------------------------

do $$
declare
  v_group uuid;
  v_admin uuid;
  v_code  text;
begin
  if not exists (select 1 from public.profiles) then
    return;  -- fresh project: no crew to carry over, and no picks either
  end if;

  select id into v_admin
  from public.profiles
  order by is_admin desc, created_at asc, id asc
  limit 1;

  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from public.groups where join_code = v_code);
  end loop;

  insert into public.groups (name, slug, visibility, join_code, created_by)
  values ('The Crew', 'the-crew', 'private', v_code, v_admin)
  returning id into v_group;

  insert into public.group_members (group_id, user_id, role)
  select v_group, p.id, case when p.id = v_admin then 'admin' else 'member' end
  from public.profiles p;

  update public.picks set group_id = v_group where group_id is null;

  -- Every week the crew has already played, as handpicked lists of exactly the
  -- games somebody picked, already frozen. Reconstructing them as full_slate
  -- would retroactively put games on the board that were never in play.
  insert into public.group_week_config (
    group_id, season_id, week, season_type,
    selection_mode, markets, locked_at, updated_by
  )
  select distinct v_group, g.season_id, g.week, g.season_type,
         'handpicked', array['spread', 'total'], now(), v_admin
  from public.picks pk
  join public.games g on g.id = pk.game_id;

  insert into public.group_week_games (group_id, season_id, week, season_type, game_id)
  select distinct v_group, g.season_id, g.week, g.season_type, g.id
  from public.picks pk
  join public.games g on g.id = pk.game_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Constraints
-- ---------------------------------------------------------------------------

alter table public.picks alter column group_id set not null;

alter table public.picks drop constraint picks_user_id_game_id_key;
create unique index picks_group_user_game_market
  on public.picks (group_id, user_id, game_id, market);
create index picks_group_season on public.picks (group_id, season_id);

-- Straight-up has no number to snapshot; the priced markets must have one.
alter table public.picks alter column line_at_pick drop not null;
alter table public.picks add constraint picks_line_present check (
  (market in ('spread', 'total') and line_at_pick is not null)
  or market = 'straight_up'
);

-- ---------------------------------------------------------------------------
-- 4. Visibility follows the group
--
-- 0010 made picks readable crew-wide and 0011 opened them to anon. Both
-- predated groups: with a private pool the board is members-only, and with a
-- public one it stays open to everybody. is_group_visible decides.
-- ---------------------------------------------------------------------------

drop policy if exists "read all picks" on public.picks;
drop policy if exists "anon read picks" on public.picks;

create policy "read picks in visible groups" on public.picks
  for select to authenticated using (public.is_group_visible(group_id));
create policy "anon read picks in public groups" on public.picks
  for select to anon using (public.is_group_visible(group_id));

-- ---------------------------------------------------------------------------
-- 5. make_pick, now group- and market-aware
-- ---------------------------------------------------------------------------

drop function if exists public.make_pick(integer, text);

create or replace function public.make_pick(
  p_group_id uuid,
  p_game_id  integer,
  p_market   text,
  p_side     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g       record;
  cfg     record;
  v_line  numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to save your picks';
  end if;
  if not public.is_group_member(p_group_id) then
    raise exception 'You are not in this group';
  end if;
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
    -- half point (mirrors src/lib/queries.ts consensusFromSnapshots).
    select round(avg(x.v) * 2) / 2 into v_line
    from (
      select distinct on (provider)
        case when p_market = 'spread' then spread else total end as v
      from line_snapshots
      where game_id = p_game_id
        and (case when p_market = 'spread' then spread else total end) is not null
      order by provider, captured_at desc
    ) x;
    if v_line is null then
      raise exception 'No line posted yet for this game';
    end if;
  end if;

  insert into picks (season_id, group_id, user_id, game_id, market, side, line_at_pick, units, locked_at)
  values (g.season_id, p_group_id, (select auth.uid()), p_game_id, p_market, p_side, v_line, 1, now())
  on conflict (group_id, user_id, game_id, market) do update
    set side = excluded.side,
        line_at_pick = excluded.line_at_pick,
        locked_at = now();
end;
$$;

-- Removing a pick was the one write still going through an RLS policy, and it
-- reported the kickoff lock by deleting zero rows — the caller had to infer it.
-- With `market` in the key that predicate gets worse, so removal joins the
-- other mutations behind an RPC that can say what happened.
create or replace function public.remove_pick(
  p_group_id uuid,
  p_game_id  integer,
  p_market   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to change your picks';
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
end;
$$;

drop policy if exists "delete own pick before kickoff" on public.picks;
revoke delete on table public.picks from authenticated, anon;

revoke execute on function public.make_pick(uuid, integer, text, text) from public, anon;
revoke execute on function public.remove_pick(uuid, integer, text)     from public, anon;
grant execute on function public.make_pick(uuid, integer, text, text)  to authenticated;
grant execute on function public.remove_pick(uuid, integer, text)      to authenticated;
