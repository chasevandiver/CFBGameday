-- The CFB Slate — core schema
-- Principles enforced here, not in app code:
--   * predictions and bets are append-only (receipts / unhideable ledger)
--   * picks are invisible to other users until kickoff, and immutable after kickoff
--   * every domain table carries season_id (year-round, multi-season product)

-- pg_cron is enabled separately (dashboard/extensions) when jobs are promoted
-- to schedules; not created here so the migration runs on a fresh project.

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

create table seasons (
  id            integer primary key,          -- e.g. 2026
  label         text not null,                -- "2026"
  week0_start   date not null,
  is_current    boolean not null default false
);

create table teams (
  id              integer primary key,        -- CFBD team id
  school          text not null,
  mascot          text,
  abbreviation    text,
  conference      text,
  division        text,                       -- fbs | fcs
  classification  text not null default 'fbs',
  color           text,
  alt_color       text,
  logo_url        text,
  -- Odds API and other feeds use different names than CFBD school names
  alt_names       text[] not null default '{}'
);

create table venues (
  id          integer primary key,            -- CFBD venue id
  name        text not null,
  city        text,
  state       text,
  latitude    double precision,               -- nullable in CFBD; see venue_coord_overrides
  longitude   double precision,
  elevation   double precision,
  capacity    integer,
  dome        boolean not null default false,
  timezone    text
);

-- CFBD venue coords are nullable; manual fallback so weather never silently skips
create table venue_coord_overrides (
  venue_id    integer primary key references venues(id),
  latitude    double precision not null,
  longitude   double precision not null,
  note        text
);

-- ---------------------------------------------------------------------------
-- Games & lines
-- ---------------------------------------------------------------------------

create table games (
  id                integer primary key,      -- CFBD game id
  season_id         integer not null references seasons(id),
  week              integer not null,
  season_type       text not null default 'regular',  -- regular | postseason
  start_ts          timestamptz,
  start_time_tbd    boolean not null default false,
  neutral_site      boolean not null default false,
  conference_game   boolean not null default false,
  venue_id          integer references venues(id),
  home_team_id      integer not null references teams(id),
  away_team_id      integer not null references teams(id),
  home_points       integer,
  away_points       integer,
  status            text not null default 'scheduled', -- scheduled | in_progress | final | postponed | canceled
  current_period    integer,
  current_clock     text,
  tv                text,
  notes             text
);
create index games_season_week on games(season_id, week);
create index games_start_ts on games(start_ts);

-- Append-only. Every external line observation lands here; nothing updates in place.
-- closing line := last snapshot with captured_at < games.start_ts for the canonical provider.
create table line_snapshots (
  id            bigint generated always as identity primary key,
  game_id       integer not null references games(id),
  provider      text not null,                -- book name from source
  source        text not null,                -- 'cfbd' | 'oddsapi'
  spread        numeric(5,1),                 -- home perspective (negative = home favored)
  spread_open   numeric(5,1),
  total         numeric(5,1),
  total_open    numeric(5,1),
  ml_home       integer,
  ml_away       integer,
  captured_at   timestamptz not null default now()
);
create index line_snapshots_game on line_snapshots(game_id, provider, captured_at desc);

create table weather_forecasts (
  game_id       integer primary key references games(id),
  temp_f        numeric(5,1),
  wind_mph      numeric(5,1),
  wind_gust_mph numeric(5,1),
  precip_prob   numeric(5,2),
  precip_in     numeric(5,2),
  fetched_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Model
-- ---------------------------------------------------------------------------

-- One row per team per season per week ("as of before week N games").
-- week 0 row = preseason prior. Never overwrite past weeks: point-in-time history
-- is what makes the backtest and receipts honest.
create table ratings (
  season_id     integer not null references seasons(id),
  team_id       integer not null references teams(id),
  week          integer not null,
  overall       numeric(6,2) not null,
  offense       numeric(6,2) not null,
  defense       numeric(6,2) not null,
  tempo         numeric(6,2),                 -- plays/game estimate
  prior_weight  numeric(4,3),                 -- decayed preseason blend at this week
  model_version text not null,
  computed_at   timestamptz not null default now(),
  primary key (season_id, team_id, week)
);

-- Preseason build components, kept for the team-page churn ledger and audit
create table preseason_components (
  season_id       integer not null references seasons(id),
  team_id         integer not null references teams(id),
  final_prev_rating   numeric(6,2),
  talent_baseline     numeric(6,2),
  churn_adjustment    numeric(5,2),
  coaching_adjustment numeric(5,2),
  luck_correction     numeric(5,2),
  returning_prod_off  numeric(5,2),
  returning_prod_def  numeric(5,2),
  detail          jsonb not null default '{}'::jsonb,
  primary key (season_id, team_id)
);

create table team_hfa (
  team_id     integer primary key references teams(id),
  raw_hfa     numeric(4,2),                   -- from 2015–2024 residual backfill
  blended_hfa numeric(4,2) not null           -- 50/50 with FBS average
);

-- Append-only. Written by the Thursday freeze job (and pre-game pricing runs).
-- The UI reads frozen rows; it never recomputes. No UPDATE/DELETE grants exist.
create table predictions (
  id              bigint generated always as identity primary key,
  game_id         integer not null references games(id),
  model_version   text not null,
  frozen          boolean not null default false,  -- true = Thursday receipts row
  spread          numeric(5,1) not null,           -- home perspective
  total           numeric(5,1),
  home_score      numeric(5,1),
  away_score      numeric(5,1),
  home_win_prob   numeric(5,4) not null,
  cover_prob      numeric(5,4),                    -- vs vegas_spread below
  vegas_spread    numeric(5,1),                    -- canonical line at pricing time
  edge            numeric(5,1),                    -- model_spread - vegas_spread
  edge_flag       text,                            -- null | 'EDGE' | 'BIG_EDGE'
  consensus_flag  boolean not null default false,
  adjustments     jsonb not null default '{}'::jsonb, -- situational components applied
  created_at      timestamptz not null default now()
);
create index predictions_game on predictions(game_id, frozen, created_at desc);

-- ---------------------------------------------------------------------------
-- Users, picks, ledger
-- ---------------------------------------------------------------------------

create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  favorite_team_ids integer[] not null default '{}',
  timezone      text not null default 'America/Chicago',  -- whole crew is CT; kept as escape hatch, not surfaced in UI
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Invite-only: sign-ins allowed only for allowlisted emails (checked by auth hook / server)
create table invite_allowlist (
  email       text primary key,
  invited_by  uuid references profiles(id),
  created_at  timestamptz not null default now()
);

create table picks (
  id            bigint generated always as identity primary key,
  season_id     integer not null references seasons(id),
  user_id       uuid not null references profiles(id),
  game_id       integer not null references games(id),
  side          text not null,                -- 'home' | 'away' | 'over' | 'under'
  line_at_pick  numeric(5,1) not null,        -- League Rules #1: snapshot at pick time
  units         numeric(4,2) not null default 1,
  locked_at     timestamptz not null default now(),  -- re-set on each pre-kickoff edit
  result        text,                          -- null | 'win' | 'loss' | 'push' | 'void'
  clv           numeric(5,2),                  -- computed post-close
  unique (user_id, game_id)
);
create index picks_season_user on picks(season_id, user_id);

-- Append-only ledger: no deletes; voided_at instead (Honest Note #5)
create table bets (
  id            bigint generated always as identity primary key,
  season_id     integer not null references seasons(id),
  user_id       uuid not null references profiles(id),
  game_id       integer references games(id),  -- null for futures
  bet_type      text not null,                 -- spread | total | moneyline | team_total | first_half | future
  description   text not null,                 -- freeform ("Michigan -3.5", "OSU win total o10.5")
  side          text,
  line_taken    numeric(6,1),
  odds          integer not null default -110, -- american odds
  units         numeric(5,2) not null,
  book          text,
  reason_tag    text not null,                 -- model_edge | travel_rest | weather | revenge | qb_news | feel | tail | fade
  placed_at     timestamptz not null default now(),
  closing_line  numeric(6,1),
  clv           numeric(6,2),                  -- points for spread/total, cents for ML
  result        text,                          -- null | win | loss | push | void
  payout_units  numeric(6,2),
  voided_at     timestamptz
);
create index bets_season_user on bets(season_id, user_id, placed_at desc);

alter table bets add constraint bets_reason_tag_check
  check (reason_tag in ('model_edge','travel_rest','weather','revenge','qb_news','feel','tail','fade'));

-- Admin-confirmed situational adjustments (QB out etc.) proposed by the news scan
create table rating_adjustments (
  id            bigint generated always as identity primary key,
  season_id     integer not null references seasons(id),
  team_id       integer not null references teams(id),
  game_id       integer references games(id),  -- null = until further notice
  points        numeric(4,1) not null,
  reason        text not null,
  source        text not null default 'llm_scan',  -- llm_scan | manual
  proposed_at   timestamptz not null default now(),
  confirmed_by  uuid references profiles(id),      -- null = pending, not applied
  confirmed_at  timestamptz
);

-- Manual editorial data with no API source (rivalries, trophies)
create table rivalries (
  id            serial primary key,
  team_a_id     integer not null references teams(id),
  team_b_id     integer not null references teams(id),
  name          text,
  trophy        text,
  notes         text
);

-- CFBD monthly call budgeting (Section 1 caching hard rule)
create table api_call_log (
  id          bigint generated always as identity primary key,
  source      text not null,
  endpoint    text not null,
  called_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table profiles         enable row level security;
alter table picks            enable row level security;
alter table bets             enable row level security;
alter table rating_adjustments enable row level security;

-- Reference/model tables: readable by any authenticated user; written only by
-- service-role jobs (no policies needed — service role bypasses RLS).
alter table seasons enable row level security;
alter table teams enable row level security;
alter table venues enable row level security;
alter table venue_coord_overrides enable row level security;  -- deny-all: service role only
alter table games enable row level security;
alter table line_snapshots enable row level security;
alter table weather_forecasts enable row level security;
alter table ratings enable row level security;
alter table preseason_components enable row level security;
alter table team_hfa enable row level security;
alter table predictions enable row level security;
alter table rivalries enable row level security;
alter table invite_allowlist enable row level security;       -- deny-all: service role only
alter table api_call_log enable row level security;           -- deny-all: service role only

create policy "read reference data" on seasons for select to authenticated using (true);
create policy "read teams" on teams for select to authenticated using (true);
create policy "read venues" on venues for select to authenticated using (true);
create policy "read games" on games for select to authenticated using (true);
create policy "read lines" on line_snapshots for select to authenticated using (true);
create policy "read weather" on weather_forecasts for select to authenticated using (true);
create policy "read ratings" on ratings for select to authenticated using (true);
create policy "read preseason" on preseason_components for select to authenticated using (true);
create policy "read hfa" on team_hfa for select to authenticated using (true);
create policy "read predictions" on predictions for select to authenticated using (true);
create policy "read rivalries" on rivalries for select to authenticated using (true);

-- profiles: everyone in the crew can see each other; only you edit yours
create policy "read profiles" on profiles for select to authenticated using (true);
create policy "update own profile" on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- picks: League Rules #1–#3 enforced here
-- Your own picks: full pre-kickoff control
create policy "read own picks" on picks for select to authenticated
  using (user_id = auth.uid());
-- Others' picks: visible only after kickoff
create policy "read others picks after kickoff" on picks for select to authenticated
  using (
    exists (select 1 from games g where g.id = picks.game_id and g.start_ts <= now())
  );
create policy "insert own pick before kickoff" on picks for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from games g where g.id = picks.game_id and g.start_ts > now())
  );
create policy "edit own pick before kickoff" on picks for update to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from games g where g.id = picks.game_id and g.start_ts > now())
  )
  with check (user_id = auth.uid());
create policy "delete own pick before kickoff" on picks for delete to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from games g where g.id = picks.game_id and g.start_ts > now())
  );

-- bets: unhideable — all crew members can read everyone's ledger; append-only
create policy "read all bets" on bets for select to authenticated using (true);
create policy "insert own bets" on bets for insert to authenticated
  with check (user_id = auth.uid());
-- The only permitted "edit" is voiding your own bet (and grading fields are set
-- by service-role jobs). No delete policy exists: deletes are impossible.
create policy "void own bets" on bets for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- rating_adjustments: admins only
create policy "admins read adjustments" on rating_adjustments for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));
create policy "admins confirm adjustments" on rating_adjustments for update to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

-- predictions append-only enforcement for every non-service role
revoke update, delete on predictions from authenticated, anon;
revoke update, delete on line_snapshots from authenticated, anon;
revoke delete on bets from authenticated, anon;
