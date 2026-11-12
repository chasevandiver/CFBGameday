-- College basketball as the third league (CBB-1…CBB-9, docs/STATUS.md).
--
-- Owner request 2026-11-12: "I want to add a CBB section in the slate since
-- CFB season is coming to an end… like how we have the NFL with updated
-- scores from ESPN", with the model and the spreads from the cbbmodel repo.
--
-- The shape follows 0042 exactly, because that shape held: CBB is a third
-- SEASONS ROW and a third value of `sport`, not a new set of tables. Every
-- season-scoped football job filters by season_id and never sees a
-- basketball row; the slate, the ledger, the grader and the betting sheet are
-- season-agnostic already and need no schema to carry it.
--
-- Id spaces (src/lib/league.ts is the TS mirror):
--   * seasons: 200000 + the year the season STARTS. 2026-27 is 202026, so it
--     sits beside CFB 2026 and NFL 102026 in every cross-league read.
--   * teams/venues: 200000 + the ESPN id. Not optional: ESPN gives a school
--     one id across sports, so Auburn basketball is team 2 exactly as Auburn
--     football is. Without the offset the basketball sync would overwrite the
--     football row.
--   * games: the raw ESPN event id, as for both football leagues. The ingest
--     refuses to overwrite a row whose sport is not 'cbb'.
--
-- What is deliberately NOT here:
--   * `groups.leagues` stays ('cfb','nfl'). No pick'em group or survivor pool
--     plays basketball (owner call). The betting group has no league scope —
--     its sheet follows the bets — so it carries CBB with no change.
--   * No weeks. `games.week` holds the DAY for a basketball game (days since
--     Nov 1, on ESPN's Eastern board date); src/lib/cbb.ts explains why that
--     reuses every week-keyed loader unchanged. `season_type` is always
--     'regular'.

alter table public.seasons drop constraint seasons_sport_check;
alter table public.seasons
  add constraint seasons_sport_check check (sport in ('cfb', 'nfl', 'cbb'));

alter table public.teams drop constraint teams_sport_check;
alter table public.teams
  add constraint teams_sport_check check (sport in ('cfb', 'nfl', 'cbb'));

alter table public.games drop constraint games_sport_check;
alter table public.games
  add constraint games_sport_check check (sport in ('cfb', 'nfl', 'cbb'));

-- ---------------------------------------------------------------------------
-- Team standing, as the feed states it
--
-- Football derives a team's record on every slate load from the season's
-- finals — ~900 rows. A basketball season is ~5,800 games, past PostgREST's
-- 1,000-row ceiling and far too much to read per poll, and ESPN's board
-- already prints each team's record, conference record and AP rank beside
-- every game. So the basketball sync stores what the board says and the slate
-- reads it. Null on every football row; nothing football reads these.
-- ---------------------------------------------------------------------------

alter table public.teams
  add column if not exists record      text,
  add column if not exists conf_record text,
  add column if not exists poll_rank   integer;

comment on column public.teams.record is
  'CBB only (0084): overall W-L as ESPN''s scoreboard states it. Football records are derived from finals.';
comment on column public.teams.conf_record is
  'CBB only (0084): conference W-L from ESPN''s scoreboard; null before league play.';
comment on column public.teams.poll_rank is
  'CBB only (0084): AP rank 1-25 from ESPN''s scoreboard; null when unranked.';

-- ---------------------------------------------------------------------------
-- Basketball's live state
--
-- { "h": [33, 27], "a": [34, 23],          points by half, then overtimes
--   "run": { "side": "home", "pts": 9 },   unanswered points, or null
--   "wp": 0.755 }                          ESPN's live home win probability
--
-- One jsonb rather than four columns: it is read and written as a unit, it is
-- null on ~10,700 football rows, and the line score is a list whose length is
-- the number of overtimes. Rides the existing realtime publication (0009) —
-- `games` is published whole.
-- ---------------------------------------------------------------------------

alter table public.games
  add column if not exists hoops jsonb;

comment on column public.games.hoops is
  'CBB only (0084): {h, a, run, wp} — line score by period, current run, live win probability. See src/lib/cbb.ts CbbLive.';

-- ---------------------------------------------------------------------------
-- The live pull: every 30 seconds, gated
--
-- Same construction as 0044: pg_cron ticks locally for free and `net.http_post`
-- sits behind `where exists`, so the edge function is invoked only while a
-- basketball game is live or about to be.
--
-- 30 seconds, not the NFL's 10. Basketball is live for far more of the week —
-- most evenings from November to April and all day on Saturdays, roughly 55
-- hours against the NFL's 20 — so 10s would be ~80,000 invocations a month
-- (16% of the free quota) where 30s is ~27,000 (5%). A basketball score also
-- moves every thirty seconds or so anyway; a 10s pull would mostly re-read
-- the same number.
--
-- Timeout is 20s: one response is the whole Division I night (~1.2 MB on a
-- 67-game Wednesday, more on a Saturday), where the NFL's is sixteen games.
-- ---------------------------------------------------------------------------

do $unschedule$
begin
  perform cron.unschedule('cbb-scoreboard-30s');
exception when others then
  null; -- first run
end
$unschedule$;

select cron.schedule(
  'cbb-scoreboard-30s',
  '30 seconds',
  $cmd$
  select net.http_post(
    url := 'https://mjijyutmbtnwcjspozsx.supabase.co/functions/v1/cbb-scoreboard',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  )
  where exists (
    select 1
    from public.games
    where sport = 'cbb'
      and (
        status = 'in_progress'
        or (
          status = 'scheduled'
          and start_ts >= now() - interval '4 hours'
          and start_ts <= now() + interval '15 minutes'
        )
      )
  );
  $cmd$
);
