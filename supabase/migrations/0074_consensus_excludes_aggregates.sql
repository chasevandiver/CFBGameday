-- DQ-15 — stop averaging CFBD's `consensus` against the books it is made of.
--
-- `/lines` returns a synthetic `consensus` provider ALONGSIDE the individual
-- books, and the archive backfill stored it like any other. Every consensus
-- site here takes the latest snapshot per provider and means them, so a blend
-- was being averaged with its own components — DQ-14's double-count under a
-- different name and about seventy times the reach.
--
-- Measured on the exact fold these sites use (`distinct on (game_id,
-- provider)`, latest first), 2026-08-19:
--
--   * 9,496 games have a line at all
--   * 6,515 carry `consensus`
--   * 6,029 carry it BESIDE at least one real book
--   * the snapped line moves on **1,813** of those (30.1%), by **0.85 points**
--     where it moves at all
--
-- ## The fallback is the design, not a safety net
--
-- 486 games have `consensus` and nothing else, and 2015-2018 has no per-book
-- coverage in this table at all — the only providers there are `consensus`,
-- `teamrankings` and `numberfire`. Dropping the aggregate outright would not
-- correct those games, it would delete their market and take the early seasons
-- of the puzzle archive with them.
--
-- So: prefer books, fall back to the aggregate when there are none. An
-- aggregate is a bad thing to average WITH a book and a perfectly good thing to
-- use INSTEAD of one.
--
-- ## `teamrankings` and `numberfire` are treated as books, deliberately
--
-- They are aggregator sites rather than sportsbooks, so the case for calling
-- them aggregates is real. It is refused for one decisive reason: they are the
-- ONLY market for 2015-2018. Excluding them would leave those seasons with the
-- `consensus` row alone, which is the fallback path — the same number, reached
-- by a longer route — or with nothing at all if `consensus` went too. There is
-- no version of that change that improves a single line.
--
-- ## Why all three sites in one migration
--
-- `src/lib/consensus.ts` says the SQL "mirrors" it, and that is an obligation
-- rather than a note: when they disagree, a pick is graded against a line the
-- app never showed. `consensus.ts`'s own header records that exact bug from a
-- half-point rounding mismatch. So the TypeScript, the view and `make_pick`
-- change together, and a test asserts this file and `AGGREGATE_PROVIDERS` name
-- the same providers.
--
-- ## Inert against live play
--
-- The newest `consensus` row is 2023-09-04 — it exists only in the archive that
-- BF-4 backfilled. No 2026 game has one, so `make_pick` and the slate compute
-- exactly what they computed yesterday. What changes is the puzzle archive
-- (Guess the Lines grades against `openingSpread`) and anything reading a
-- historical line.

-- ## The rule is PER MARKET, and that is not a detail
--
-- The first cut of this filtered whole rows: drop the aggregate whenever any
-- book is present. Checking the view against the rule afterwards — rather than
-- trusting that it did what it said — turned up three archive games where
-- `consensus` posts a spread and no total while teamrankings and numberfire
-- post a total and no spread. Row-level, "a book exists" was true, the
-- aggregate was dropped, and the only spread those games had became NULL. The
-- fix was deleting lines.
--
-- So each market asks its own question: are there books quoting THIS market? A
-- book that only hangs a total says nothing about who is quoting the spread.
-- `make_pick` needs no such change — it already selects one market and filters
-- its nulls before the rule applies.
--
-- The aggregate list lives in exactly two places, this literal and
-- AGGREGATE_PROVIDERS in src/lib/providers.ts, and a test pins them together.
create or replace view public.line_consensus
with (security_invoker = true) as
select
  t.game_id,
  round(avg(t.spread)      filter (where t.is_book or t.books_spread      = 0) * 2) / 2 as spread,
  round(avg(coalesce(t.spread_open, t.spread))
                           filter (where t.is_book or t.books_spread_open = 0) * 2) / 2 as spread_open,
  round(avg(t.total)       filter (where t.is_book or t.books_total       = 0) * 2) / 2 as total,
  round(avg(coalesce(t.total_open, t.total))
                           filter (where t.is_book or t.books_total_open  = 0) * 2) / 2 as total_open,
  round(avg(t.ml_home)     filter (where t.is_book or t.books_ml_home     = 0))         as ml_home,
  round(avg(t.ml_away)     filter (where t.is_book or t.books_ml_away     = 0))         as ml_away,
  max(t.captured_at)                                                                    as as_of
from (
  select
    d.*,
    d.provider <> all (array['consensus']) as is_book,
    count(*) filter (where d.provider <> all (array['consensus']) and d.spread is not null)
      over (partition by d.game_id) as books_spread,
    count(*) filter (where d.provider <> all (array['consensus']) and coalesce(d.spread_open, d.spread) is not null)
      over (partition by d.game_id) as books_spread_open,
    count(*) filter (where d.provider <> all (array['consensus']) and d.total is not null)
      over (partition by d.game_id) as books_total,
    count(*) filter (where d.provider <> all (array['consensus']) and coalesce(d.total_open, d.total) is not null)
      over (partition by d.game_id) as books_total_open,
    count(*) filter (where d.provider <> all (array['consensus']) and d.ml_home is not null)
      over (partition by d.game_id) as books_ml_home,
    count(*) filter (where d.provider <> all (array['consensus']) and d.ml_away is not null)
      over (partition by d.game_id) as books_ml_away
  from (
    select distinct on (game_id, provider)
      game_id, provider, spread, spread_open, total, total_open, ml_home, ml_away, captured_at
    from public.line_snapshots
    order by game_id, provider, captured_at desc
  ) d
) t
group by t.game_id;

grant select on public.line_consensus to anon, authenticated;

-- Same rule inside make_pick. Inert today (no 2026 game has a `consensus` row),
-- and changed anyway: the three implementations drifting is the failure this
-- codebase has already paid for once.
create or replace function public.make_pick(
  p_group_id uuid, p_game_id integer, p_market text, p_side text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    -- half point (mirrors consensusFromSnapshots in src/lib/consensus.ts).
    -- DQ-15: books when there are books, the aggregate alone when there are not.
    with latest as (
      select distinct on (provider)
        provider,
        case when p_market = 'spread' then spread else total end as v
      from line_snapshots
      where game_id = p_game_id
        and (case when p_market = 'spread' then spread else total end) is not null
      order by provider, captured_at desc
    )
    select round(avg(l.v) * 2) / 2 into v_line
    from latest l
    where l.provider <> all (array['consensus'])
       or not exists (
            select 1 from latest b where b.provider <> all (array['consensus'])
          );
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
        -- forever. (0034, preserved verbatim.)
        result = null,
        clv = null;
end;
$function$;
