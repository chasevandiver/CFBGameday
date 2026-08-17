-- Past CFB seasons, so there is something to backfill INTO.
--
-- `games.season_id` references `seasons(id)`, so a 2023 game cannot land
-- until a 2023 season row exists. This seeds the three the Guess the Game
-- deck was written against and never got: the literal `[2023, 2024, 2025]` in
-- `src/app/api/guess-game/route.ts` named seasons that were never ingested
-- here, which is why the puzzle has said "no puzzle today" every day since
-- R2-C3 shipped.
--
-- The route no longer names seasons at all — it discovers whatever CFB
-- seasons exist — so this file's job is only to make the rows insertable.
-- The games themselves come from `backfill-games`, which is dispatch-only.
--
-- **`is_current` stays false, and that matters.** Two rows already carry true
-- (2026 CFB and 2026 NFL) and `fetchCurrentSeasonWeek` resolves the pointer
-- with `is_current = true AND sport = ?`. A fourth true row would make that
-- `maybeSingle()` ambiguous and take the whole slate down. This is also why
-- the backfill must never run `sync-reference` against a past season:
-- `scripts/sync-reference.ts:17` hardcodes `is_current: true` and a
-- `week0_start` of 2026-08-29, so pointing it at 2024 would both mislabel the
-- season and steal the pointer.
--
-- Week 0 dates are the real ones (all Saturdays), not derived: 2023-08-26,
-- 2024-08-24, 2025-08-23.
--
-- Apply-vs-deploy order is free: new rows in a table nothing writes at
-- runtime, and a season with no games contributes nothing to the deck.

insert into public.seasons (id, label, week0_start, is_current, sport)
values
  (2023, '2023', '2023-08-26', false, 'cfb'),
  (2024, '2024', '2024-08-24', false, 'cfb'),
  (2025, '2025', '2025-08-23', false, 'cfb')
on conflict (id) do nothing;
