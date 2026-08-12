-- 0028 — Clear the triple-stamped bootstrap receipts so the Thursday freeze can fire.
--
-- WHY THIS TOUCHES AN APPEND-ONLY TABLE, ONCE, DELIBERATELY.
--
-- `load-preseason.ts --bootstrap` ran three times during development — Aug 5
-- 15:38, Aug 5 16:26 and Aug 7 04:44 — at model versions 2026.1.0, 2026.2.0 and
-- 2026.3.0. `predictions` has an identity primary key, so an upsert appends
-- rather than replaces (see docs/CHANGELOG.md, Operations reference). The result
-- is 297 frozen rows across the 99 games of CFBD's merged Week 0/1: three
-- receipts per game, from three different models, none of them the model that
-- will actually price the openers.
--
-- The damage is not the duplication, it is what the duplication silences.
-- `freezeJob` builds `alreadyFrozen` from any `frozen = true` row and
-- `freezableGames` drops those games (scripts/lib/jobs-core.ts:1004-1008), so
-- the Thursday 03:00 UTC freeze before the openers would return
-- `{frozen: 0, already_frozen: 99}` and go GREEN. Week 1 would ship receipts
-- computed on Aug 5 against Aug 5 lines; 2026.5.0's market-anchored tier
-- recentre — the fix for a measured ~10-point cross-classification lean — could
-- never reach the openers; the grader would count every game three times across
-- three model versions; and two of the three rows per game carry `total = 57.0`,
-- the constant-for-every-game bug the original audit filed as #4.
--
-- The append-only guarantee exists so that a receipt somebody acted on is never
-- rewritten. Nobody acted on these: `picks` is 0 rows and `profiles` is 1 (the
-- owner) at the time of writing. These are development artifacts that would
-- otherwise masquerade as the season's first receipts, and keeping them means
-- launching with a receipts table whose Week 1 rows are provably worse than the
-- model that shipped. Deleting them restores the guarantee rather than bending
-- it: after this runs, every receipt in the table was written by a freeze.
--
-- Scoped hard, so a re-run or a later season cannot widen it:
--   * season 2026 only
--   * games that have not started (`start_ts > now()`), so nothing already
--     played or graded is reachable
--   * only rows written by the bootstrap runs, identified by the three model
--     versions that predate the current one — a freeze-written row at 2026.4.x
--     or 2026.5.x is never touched
--   * `clv is null and close_spread is null`, so a row that has already been
--     through grading is left alone even if it matches everything else
--
-- NOT INCLUDED: `line_snapshots`. An earlier reading of this data called 400 of
-- its 808 rows duplicates. That was wrong — the grouping key omitted `provider`,
-- and the pairs are DraftKings and Bovada at the same capture instant with
-- genuinely different numbers (e.g. -28.5 vs -25.5). That is a two-book
-- consensus working correctly. The table is not touched here.

do $$
declare
  n_rows int;
  n_games int;
begin
  select count(*), count(distinct p.game_id) into n_rows, n_games
  from public.predictions p
  join public.games g on g.id = p.game_id
  where p.season_id = 2026
    and p.frozen
    and p.model_version in ('2026.1.0', '2026.2.0', '2026.3.0')
    and p.clv is null
    and p.close_spread is null
    and g.start_ts > now();

  -- A no-op re-run is fine and says so. A run that would delete more than the
  -- three bootstrap passes left behind is not fine, and stops here rather than
  -- taking the receipts table with it.
  if n_rows = 0 then
    raise notice '0028: nothing to clear — already applied, or no bootstrap rows present';
    return;
  end if;

  if n_rows > 3 * n_games then
    raise exception '0028: refusing to delete % rows across % games (> 3 per game) — inspect before running', n_rows, n_games;
  end if;

  delete from public.predictions p
  using public.games g
  where g.id = p.game_id
    and p.season_id = 2026
    and p.frozen
    and p.model_version in ('2026.1.0', '2026.2.0', '2026.3.0')
    and p.clv is null
    and p.close_spread is null
    and g.start_ts > now();

  raise notice '0028: cleared % bootstrap prediction rows across % games; the Thursday freeze now has work to do', n_rows, n_games;
end $$;
