-- 09:P-9 — the blind board fires one RPC per hidden game.
--
-- `group_game_pick_count` (0023) answers for a single game, and the week page
-- calls it inside a `Promise.all` over every blind game on the board. On a
-- full-slate blind group that is **one round trip per game** — 60 on a CFB
-- Saturday, and the Week 1 NFL board resolves to 91 games (DB-7), so this is
-- not a hypothetical shape. Each is a separate PostgREST request with its own
-- auth check, connection acquisition and planning.
--
-- Same answer, one call. The singular stays: it is granted, tested, and there
-- is no reason to break a working function to add a batched one beside it.
--
-- ## The contract mirrors the singular deliberately
--
-- A non-member gets a row of zeros for every game asked about, not an empty
-- result and not an error — exactly what `group_game_pick_count` returns for
-- them. A caller that cannot tell "you are not a member" from "nobody has
-- picked" is the point: a public group's board is readable by anyone, and a
-- non-member must not be able to poll it for who has committed. Returning zero
-- rows would leak membership through the shape of the response.
--
-- Every requested game comes back, including ones with no picks — the caller
-- builds a Map from the result and a missing key would silently read as
-- undefined rather than 0.
--
-- `search_path = ''` with every reference qualified, per 0050's note: a
-- SECURITY DEFINER function without it is the classic escalation.

create or replace function public.group_game_pick_counts(
  p_group uuid,
  p_games integer[]
)
returns table (game_id integer, n integer)
language sql
security definer
stable
set search_path = ''
as $$
  -- Columns map to RETURNS TABLE positionally, so the inner aliases are
  -- deliberately NOT called game_id: RETURNS TABLE puts those names in scope
  -- and a reference to `game_id` inside the body would be ambiguous.
  select req.gid,
         case when public.is_group_member(p_group) then coalesce(c.cnt, 0) else 0 end
  from unnest(p_games) as req(gid)
  left join (
    select p.game_id as gid, count(*)::integer as cnt
    from public.picks p
    where p.group_id = p_group
      and p.game_id = any(p_games)
    group by p.game_id
  ) c on c.gid = req.gid;
$$;

revoke execute on function public.group_game_pick_counts(uuid, integer[]) from public, anon;
grant  execute on function public.group_game_pick_counts(uuid, integer[]) to authenticated;
