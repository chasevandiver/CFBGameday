-- Voidable games (P1-1), and the re-pick that never worked.
--
-- League Rule #4 says a postponed or canceled game voids every wager on it.
-- The grader has implemented that correctly since 0013 and it had never run
-- once, because nothing in the system writes those statuses: sync-games only
-- ever asserts 'final', the scoreboard patch is a closed map to
-- in_progress/final, and CFBD's game feed carries a bare `completed` boolean
-- with no cancellation signal at all. The writer is a human, via /admin.
--
-- Two changes here, both prerequisites for that control.
--
-- 1. `games.status` becomes a real enumeration. It has been plain `text` since
--    0001 with the five valid values listed only in a trailing comment. Now an
--    admin can write the column, the comment needs to be executable. Added
--    NOT VALID so it cannot fail on a legacy row: it constrains every future
--    write, which is the whole point, without auditing 888 existing ones.
--    (Nothing writes an unlisted value today — checked every writer.)
--
-- 2. `make_pick` clears `result` and `clv` when a pick is replaced.
--    jobs-core has carried a comment since 0013 saying voided picks stay
--    voided and "the member re-picks on the revived game". They could not.
--    The upsert set only side, line_at_pick and locked_at, so re-picking a
--    revived game updated the row that already held result='void', and the
--    grader selects picks with `.is("result", null)` — so that pick was never
--    graded, and never would be. The rest of the function is re-issued
--    unchanged; plpgsql has no partial edit, so the body below is the 0021
--    text with three lines added to the ON CONFLICT clause.
--
--    This also fixes the general case, which is not specific to voids: any
--    pick replaced after grading would have kept its old result.

alter table public.games
  add constraint games_status_valid
  check (status in ('scheduled', 'in_progress', 'final', 'postponed', 'canceled'))
  not valid;

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
        locked_at = now(),
        -- A replaced pick is a NEW pick: it must not inherit the grade of the
        -- one it replaced. Without this a re-pick on a revived game keeps
        -- result='void' and the grader's `.is("result", null)` filter skips it
        -- forever.
        result = null,
        clv = null;
end;
$$;
