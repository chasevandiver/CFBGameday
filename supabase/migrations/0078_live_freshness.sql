-- LIVE-3 and LIVE-4 — two columns' worth of "when", so a live card can say how
-- old it is and a watchdog can tell a quiet game from a dead pipe.
--
-- Both come out of the 2026-08-20 preseason rehearsal, where the 10-second
-- refresh had never once worked (LIVE-1) and the Actions loop went dark for 27
-- minutes mid-game (LIVE-2). Neither was visible: every dashboard read green
-- and the only reason anyone noticed was an owner watching the game on TV.
--
-- ## live_heartbeat — did anything poll, as opposed to did anything change
--
-- The watchdog's liveness rule was "a game is LIVE and no scoreboard-loop
-- launch succeeded in 1.5h", read off `job_runs` with `status = 'ok'`. That
-- rule stopped working the moment LIVE-2 made runs four hours long: hourly
-- launches cancel each other, a cancelled run writes `canceled` rather than
-- `ok`, and an `ok` row now appears only when a loop survives its whole
-- deadline — which on a game day it never does. The rule would have paged
-- every Saturday afternoon while everything was healthy.
--
-- What it should have been asking all along is whether anything is actually
-- polling. That cannot be read off the games table, because a game with no
-- snaps for three minutes and a pipeline that died three minutes ago look
-- identical there. So each poller stamps a row here on every successful pull,
-- whether or not the pull changed anything.
--
-- One row per source, upserted — no history, because the only question is
-- "how long since". The two sources monitor EACH OTHER: the Actions loop pages
-- when the 10-second path goes quiet during a live game, which is exactly the
-- failure that ran unnoticed for a whole game tonight.
--
-- Deny-all, like `api_call_log` and `deleted_wagers`: RLS on, no policies, no
-- grants to `anon` or `authenticated`. Only the service key writes it and only
-- the jobs read it.
--
-- ## games.last_play_at — how old the play on the card is
--
-- `last_play` is deliberately sticky: a TV timeout must not erase the field
-- goal it follows (the 08-14 owner report), so the writer keeps the last REAL
-- play. Tonight that correct behaviour rendered as a bug — the card showed a
-- field goal from twenty minutes earlier next to a current down and distance,
-- with nothing to say the two were minutes apart, because the loop was dark
-- for the drive in between.
--
-- Nullable and unbackfilled on purpose. A timestamp invented for a play we did
-- not watch arrive is a fabrication, and the card treats null as "no age to
-- show" rather than as "now" — same rule 0073 followed for `finished_at`.
--
-- Ordering is free both ways: the column is nullable and nothing reads it
-- until the build that renders it deploys; the table is new and nothing
-- running touches it.

alter table games add column if not exists last_play_at timestamptz;

comment on column games.last_play_at is
  'When last_play last changed to a NEW real play (LIVE-4). Null = never observed changing; the card shows no age rather than guessing one.';

create table if not exists live_heartbeat (
  source   text primary key,
  beat_at  timestamptz not null default now(),
  detail   jsonb
);

comment on table live_heartbeat is
  'One row per live poller, upserted on every successful pull (LIVE-3). Answers "did anything poll", which job_runs cannot once runs outlive their launches.';

alter table live_heartbeat enable row level security;

revoke all on live_heartbeat from anon, authenticated;
