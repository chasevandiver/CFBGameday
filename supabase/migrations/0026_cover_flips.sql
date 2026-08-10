-- Bad beats and backdoor covers (audit 10/G9).
--
-- A cover flip is a TRANSITION, not a state: the ATS or O/U result changing
-- between two scoreboard polls late in a game. Nothing in the schema records
-- it after the fact — `games` holds only the current score, and `last_play`
-- (the line that makes an entry worth reading) is nulled the moment a game
-- goes final. So the detector has to be running live or the moment is gone.
--
-- This is a receipt, same as `predictions`: append-only, written by the
-- scoreboard job through the service role, read by everyone.

create table public.cover_flips (
  id                bigint generated always as identity primary key,
  game_id           integer not null references public.games(id) on delete cascade,
  season_id         integer not null references public.seasons(id),
  week              integer not null,
  market            text    not null check (market in ('spread', 'total')),
  -- the consensus number the flip was measured against
  line              numeric(6,1) not null,
  -- 'home' | 'away' | 'push' for spreads; 'over' | 'under' | 'push' for totals
  from_side         text    not null,
  to_side           text    not null,
  home_points       integer not null,
  away_points       integer not null,
  prev_home_points  integer not null,
  prev_away_points  integer not null,
  period            integer,
  clock             text,
  -- parsed from `clock`; null when the feed gave us nothing usable
  seconds_left      integer,
  -- what the feed said just happened. The whole point of catching this live.
  last_play         text,
  -- true backdoor = the game's winner never changed, only the cover did
  winner_changed    boolean not null,
  detected_at       timestamptz not null default now(),
  -- Football scores only go up, so a given post-flip score happens once per
  -- game. That makes this the natural idempotency key: a tick that wrote and
  -- then died cannot double-log when it re-runs.
  unique (game_id, market, home_points, away_points)
);

-- The recap reads a week at a time, oldest first.
create index cover_flips_season_week_idx on public.cover_flips (season_id, week, detected_at);

-- Job writes (service role bypasses RLS), everyone reads — the shape from
-- 0016_system_ratings. No insert policy on purpose.
alter table public.cover_flips enable row level security;
create policy "read cover flips" on public.cover_flips
  for select to authenticated using (true);
create policy "anon read cover flips" on public.cover_flips
  for select to anon using (true);

-- Append-only, like predictions (0001): a receipt nobody can quietly rewrite.
revoke update, delete on public.cover_flips from authenticated, anon;
