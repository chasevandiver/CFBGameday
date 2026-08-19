-- DQ-14 — one book stored under two names, and the duplicate rows behind it.
--
-- `consensusFromSnapshots` takes the latest snapshot PER PROVIDER and means
-- them. A book under two spellings is therefore averaged against itself and
-- carries double the weight of every other book — wrong in a way that still
-- produces a plausible half-point, and CLV is graded against it.
--
-- ## The tracked row understated this twice, and the second half changed the fix
--
-- DQ-14 recorded "one book under two provider names" on game 401873278, and
-- prescribed normalising in the ESPN parser. Reading `line_snapshots` rather
-- than the one game:
--
--   * It is **82 games**, not one.
--   * `Draft Kings` is 102 rows from `cfbd-backfill` against 33 from `espn`.
--     Fixing the ESPN parser alone would have left three quarters of the defect
--     in place and ticked the box. CFBD emits both spellings too.
--
-- The code fix is therefore one normaliser (`src/lib/providers.ts`) applied at
-- every writer, with a test that fails if a writer stops using it. This
-- migration is the other half: the rows already written.
--
-- ## Regional books are deliberately left alone
--
-- `Caesars`, `Caesars (Pennsylvania)` and `Caesars Sportsbook (Colorado)` look
-- like the same defect and are not. They hang different numbers, and checked
-- against the table they never co-occur on a single game (0 of 9,496) — their
-- date ranges are disjoint. Merging them would invent a double-count rather
-- than remove one.
--
-- ## The dedupe, and why it has to happen in the same migration
--
-- The archive backfill wrote exact duplicates: 1,487 (game_id, provider,
-- captured_at) groups hold more than one row once the rename collapses the two
-- spellings, 1,579 rows in total. Left alone they are mostly harmless — the
-- latest-per-provider fold keeps one — but in **9 groups the rows disagree on
-- the spread**, and there the fold picks whichever row the planner returned
-- first. That is a nondeterministic consensus line, which is worse than the
-- double-count it replaces: today's answer and tomorrow's could differ with no
-- write in between.
--
-- So: rename, then keep the highest `id` per (game_id, provider, captured_at).
-- Highest id is "last written wins", the same precedence an append-only table
-- already implies everywhere else.
--
-- `line_snapshots` has no unique constraint (surrogate `id` PK, two non-unique
-- indexes), so the rename cannot collide and needs no conflict handling.

begin;

-- 1. One book, one name. Only this pair — see the note on regional books above.
update line_snapshots
   set provider = 'DraftKings'
 where provider = 'Draft Kings';

-- 2. Collapse the duplicates the rename exposes, keeping the last written.
delete from line_snapshots a
 using line_snapshots b
 where a.game_id = b.game_id
   and a.provider = b.provider
   and a.captured_at = b.captured_at
   and a.id < b.id;

commit;
