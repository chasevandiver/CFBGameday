-- 0030 — Follow the games: the crew's board moves to the week its games are in.
--
-- Migration 0029 split CFBD's merged week 1 into week 0 (Aug 29–30) and week 1
-- (Sep 3–7). The one existing pick'em board was configured at week 1 with four
-- handpicked games — TCU/North Carolina, Virginia/NC State, Stanford/Hawai'i,
-- UNLV/Memphis. Every one of those kicks on Aug 29 or 30, so all four are now
-- `games.week = 0`. It was always a Week 0 board; only the label was wrong,
-- because until 0029 there was no Week 0 to file it under.
--
-- Left alone, this misfiles in both directions. `group_week_games_for` resolves
-- a handpicked board from `group_week_games` keyed on `(group_id, season_id,
-- week, season_type)` and never re-checks `games.week` (0020:175-182), so the
-- board would keep rendering its four Aug 29 games under a "Week 1" heading —
-- beside a slate that now starts Sep 3 — while the real Week 1, 91 games
-- including the Georgia opener, would have no board at all.
--
-- So: move the config row and its pinned games from week 1 to week 0, together,
-- keeping `selection_mode`, `markets`, `conference`, `min_picks_per_week` and
-- `updated_by` exactly as the owner set them. Nothing is created and nothing is
-- chosen on the owner's behalf.
--
-- Safe to run once and only once, by construction:
--   * only a board whose pinned games have ALL moved to week 0 is touched — a
--     board that legitimately spans the new week 1 is left alone
--   * only unlocked boards (`locked_at is null`), so a week that has already
--     kicked off is never re-filed
--   * refuses if a week-0 board already exists for that group, rather than
--     colliding with a deliberate one
--
-- AFTER THIS: week 1 (Sep 3–7) has no board. That is a real choice — which
-- games, handpicked or full slate — and belongs to the owner, in
-- /groups/[slug]/settings, not to a migration.

do $$
declare
  r record;
  n_games int;
  n_moved int := 0;
begin
  for r in
    select c.group_id, c.season_id, c.season_type
    from public.group_week_config c
    where c.season_id = 2026
      and c.week = 1
      and c.season_type = 'regular'
      and c.locked_at is null
      -- every pinned game moved to week 0, and there is at least one
      and exists (
        select 1 from public.group_week_games w
        where w.group_id = c.group_id and w.season_id = c.season_id
          and w.week = 1 and w.season_type = c.season_type
      )
      and not exists (
        select 1
        from public.group_week_games w
        join public.games g on g.id = w.game_id
        where w.group_id = c.group_id and w.season_id = c.season_id
          and w.week = 1 and w.season_type = c.season_type
          and g.week <> 0
      )
      and not exists (
        select 1 from public.group_week_config c0
        where c0.group_id = c.group_id and c0.season_id = c.season_id
          and c0.week = 0 and c0.season_type = c.season_type
      )
  loop
    -- `group_week_games` carries a composite FK onto `group_week_config`
    -- (group, season, week, season_type), so the week-0 parent has to exist
    -- before any child can point at it, and the week-1 parent cannot go until
    -- its last child has left. Copy → move → drop, in that order; a plain
    -- `update ... set week = 0` on either table alone violates the constraint.
    insert into public.group_week_config (
      group_id, season_id, week, season_type,
      selection_mode, conference, markets, locked_at, updated_by, updated_at, min_picks_per_week
    )
    select group_id, season_id, 0, season_type,
           selection_mode, conference, markets, locked_at, updated_by, updated_at, min_picks_per_week
    from public.group_week_config
    where group_id = r.group_id and season_id = r.season_id
      and week = 1 and season_type = r.season_type;

    update public.group_week_games
    set week = 0
    where group_id = r.group_id and season_id = r.season_id
      and week = 1 and season_type = r.season_type;
    get diagnostics n_games = row_count;

    delete from public.group_week_config
    where group_id = r.group_id and season_id = r.season_id
      and week = 1 and season_type = r.season_type;

    n_moved := n_moved + 1;
    raise notice '0030: group % → week 0 with % pinned games', r.group_id, n_games;
  end loop;

  if n_moved = 0 then
    raise notice '0030: no board to move — already applied, or no week-1 board is entirely week-0 games';
  end if;
end $$;
