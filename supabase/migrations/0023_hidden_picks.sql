-- Picks hidden until kickoff, per group.
--
-- Migration 0010 made picks visible to the whole crew the moment they were made
-- — "sweating each other's cards before kickoff is part of the product". That
-- was one pool's call, and with many pools it becomes a setting: a group that
-- runs a serious pick'em does not want the sharpest member's card readable by
-- everyone still deciding.
--
-- Off by default, so no existing group changes behaviour.

alter table public.groups
  add column picks_hidden_until_kickoff boolean not null default false;

/**
 * Whether a group's picks on one game are readable by people other than their
 * owner. Security definer because it is called from a policy on `picks` and has
 * to read `groups` and `games` regardless of the caller's own grants.
 */
create or replace function public.picks_revealed(p_group uuid, p_game integer)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select not coalesce(
           (select picks_hidden_until_kickoff from groups where id = p_group), false)
      -- A TBD kickoff (start_ts null) stays hidden: `<= now()` is null, which
      -- is not true, which is the safe answer for a blind.
      or exists (select 1 from games g where g.id = p_game and g.start_ts <= now());
$$;

grant execute on function public.picks_revealed(uuid, integer) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- The read split
--
-- One policy covered every pick in a visible group. It becomes three, because
-- "mine" and "everyone else's" now answer differently. RLS ORs permissive
-- policies together, so your own picks stay visible whatever the group setting.
-- ---------------------------------------------------------------------------

drop policy if exists "read picks in visible groups" on public.picks;
drop policy if exists "anon read picks in public groups" on public.picks;

create policy "read own picks" on public.picks for select to authenticated
  using (user_id = (select auth.uid()) and public.is_group_visible(group_id));

create policy "read others picks when revealed" on public.picks for select to authenticated
  using (
    user_id <> (select auth.uid())
    and public.is_group_visible(group_id)
    and public.picks_revealed(group_id, game_id)
  );

create policy "anon read revealed picks in public groups" on public.picks
  for select to anon
  using (public.is_group_visible(group_id) and public.picks_revealed(group_id, game_id));

/**
 * How many picks a group has on one game, regardless of the blind.
 *
 * With picks hidden, RLS returns nothing, so the board cannot even say how many
 * are in — and "4 in, hidden until kickoff" is the socially useful half without
 * leaking a side. Members only: a public group's board is readable by anyone,
 * and a non-member should not be able to poll it for who has committed.
 */
create or replace function public.group_game_pick_count(p_group uuid, p_game integer)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select case
    when public.is_group_member(p_group)
      then (select count(*)::integer from picks
            where group_id = p_group and game_id = p_game)
    else 0
  end;
$$;

revoke execute on function public.group_game_pick_count(uuid, integer) from public, anon;
grant execute on function public.group_game_pick_count(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- update_group carries the new setting
-- ---------------------------------------------------------------------------

drop function if exists public.update_group(uuid, text, text);

create or replace function public.update_group(
  p_group      uuid,
  p_name       text,
  p_visibility text,
  p_hide_picks boolean default false
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
  set name = btrim(p_name),
      slug = v_slug,
      visibility = p_visibility,
      picks_hidden_until_kickoff = coalesce(p_hide_picks, false)
  where id = p_group;

  return v_slug;
end;
$$;

revoke execute on function public.update_group(uuid, text, text, boolean) from public, anon;
grant execute on function public.update_group(uuid, text, text, boolean) to authenticated;
