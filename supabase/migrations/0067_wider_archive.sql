-- BF-1/BF-2 — widen the archive to 2015, and store conference AT GAME TIME.
--
-- Two changes, one file, because they are the same job: make the historical
-- archive usable as puzzle material. Guess the Game's replacement games (The
-- Tape, Chains, Depth Chart) all read history, and today the archive is three
-- seasons of bare game rows.
--
-- ## Part 1 — eight more seasons
--
-- `games.season_id` references `seasons(id)`, so a 2015 game cannot land until
-- a 2015 season row exists. Migration 0063 did this for 2023–25; this does the
-- same for 2015–22. The games themselves come from `backfill-games`, which is
-- dispatch-only and already DISCOVERS every non-current CFB season
-- (`backfillTargets`), so no job code changes to pick these up.
--
-- **`is_current` stays false, and with eight rows that matters eight times
-- over.** `fetchCurrentSeasonWeek` resolves the live pointer with
-- `is_current = true AND sport = ?` through `maybeSingle()`. A ninth true row
-- makes that ambiguous and takes the whole slate down. 0063's header made this
-- point for three rows; it is repeated here rather than referenced because the
-- next person to add a season will read this file, not that one.
--
-- Week 0 dates are the real last-Saturday-of-August openers, verified against
-- a calendar rather than derived from a formula:
--   2015-08-29  2016-08-27  2017-08-26  2018-08-25
--   2019-08-24  2020-08-29  2021-08-28  2022-08-27
-- They are not load-bearing for a past season — `src/lib/season.ts` derives the
-- live week from games, not from this column, and the only writers are the
-- reference syncs — but a wrong date in a reference table is a trap for
-- whoever reads it next.
--
-- ## Part 2 — conference at game time
--
-- `teams.conference` is the team's CURRENT conference. That is correct for the
-- season being played and wrong for every season before the last realignment:
-- reading it for a 2016 game files Texas under the SEC and Maryland under the
-- ACC. Any clue, question or puzzle category built on conference would be
-- confidently wrong, in a way a fan spots instantly — the same failure mode
-- GTG-9 avoided by deriving region from venues rather than from the conference.
--
-- CFBD already publishes it per game: `CfbdGame.homeConference` /
-- `awayConference` are the alignment AT KICKOFF (`src/lib/cfbd.ts`), and
-- `backfillRows()` simply dropped them on the floor. So this is a column to
-- catch data we were already fetching, not a new fetch.
--
-- **Nullable, no default, and deliberately NOT backfilled from
-- `teams.conference`.** Copying today's alignment into a column whose entire
-- purpose is that it is not today's alignment would destroy the distinction
-- this migration exists to draw, and it would be unrecoverable — nothing
-- downstream could tell a real 2016 value from a fabricated one. NULL means
-- "not known at game time", which is the truth for every row written before
-- this and for any row CFBD omits it on. Readers fall back to `teams` and say
-- so.
--
-- ## Apply-vs-deploy order
--
-- The season rows are free (nothing reads them at runtime, and a season with
-- no games contributes nothing to any deck). The two columns are APPLY FIRST:
-- `sync-games` and `backfill-games` both start writing them, and a job that
-- writes a column the database does not have fails the whole upsert batch.

insert into public.seasons (id, label, week0_start, is_current, sport)
values
  (2015, '2015', '2015-08-29', false, 'cfb'),
  (2016, '2016', '2016-08-27', false, 'cfb'),
  (2017, '2017', '2017-08-26', false, 'cfb'),
  (2018, '2018', '2018-08-25', false, 'cfb'),
  (2019, '2019', '2019-08-24', false, 'cfb'),
  (2020, '2020', '2020-08-29', false, 'cfb'),
  (2021, '2021', '2021-08-28', false, 'cfb'),
  (2022, '2022', '2022-08-27', false, 'cfb')
on conflict (id) do nothing;

alter table public.games
  add column if not exists home_conference text,
  add column if not exists away_conference text;

comment on column public.games.home_conference is
  'Home team conference AT KICKOFF, from CFBD. Null = unknown; fall back to teams.conference and say so. Never backfilled from teams.conference — see migration 0067.';
comment on column public.games.away_conference is
  'Away team conference AT KICKOFF, from CFBD. Null = unknown; fall back to teams.conference and say so. Never backfilled from teams.conference — see migration 0067.';
