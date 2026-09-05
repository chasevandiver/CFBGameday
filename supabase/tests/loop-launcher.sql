-- LIVE-10: the database-side launcher for scoreboard-loop (0084).
--
-- The launcher has two gates and one action. Offline there is no Vault, no
-- network and an inert pg_net stub, so the assertions cover the gates — the
-- decisions that determine whether a dispatch is even attempted — and the
-- point at which the function stops for want of a token. Each expected result
-- is the one 0084's comment lists.

\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on
\pset format unaligned

create function pg_temp.chk(label text, ok boolean) returns text
language sql as $$ select case when ok then 'PASS  ' else 'FAIL  ' end || label; $$;

\o /dev/null
insert into seasons (id, label, week0_start, is_current)
values (2026, '2026', date '2026-08-29', true);

insert into teams (id, school, abbreviation, conference, classification) values
  (1, 'Georgia', 'UGA',  'SEC', 'fbs'),
  (2, 'Alabama', 'BAMA', 'SEC', 'fbs');

insert into invite_allowlist (email, make_admin) values ('ann@example.com', false);
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'ann@example.com');

-- Nothing scheduled anywhere near now.
insert into games (id, season_id, week, season_type, start_ts, home_team_id, away_team_id, status)
values (501, 2026, 2, 'regular', now() + interval '3 days', 1, 2, 'scheduled');
\o

select pg_temp.chk('nothing within 15 minutes: idle',
  public.launch_live_loop_if_needed() = 'idle');
select pg_temp.chk('the state row records the idle decision',
  (select result from loop_launcher_state where id) = 'idle');

-- A game kicks in ten minutes and no loop has ever beaten.
\o /dev/null
update games set start_ts = now() + interval '10 minutes' where id = 501;
\o

select pg_temp.chk('imminent kickoff, no heartbeat, no Vault offline: stops at no_vault',
  public.launch_live_loop_if_needed() = 'no_vault');
select pg_temp.chk('the state row names the reason it wanted a loop',
  (select reason from loop_launcher_state where id) = 'imminent');
select pg_temp.chk('no dispatch was recorded without a token',
  (select count(*) from loop_launches) = 0);

-- The loop is polling: a beat 30 seconds ago.
\o /dev/null
insert into live_heartbeat (source, beat_at) values ('actions-loop', now() - interval '30 seconds');
\o

select pg_temp.chk('a fresh beat means the loop is alive: polling, no dispatch',
  public.launch_live_loop_if_needed() = 'polling');

-- The beat goes stale with a game live.
\o /dev/null
update live_heartbeat set beat_at = now() - interval '4 minutes' where source = 'actions-loop';
update games set status = 'in_progress' where id = 501;
\o

select pg_temp.chk('live game, beat 4 minutes old: the loop is dead, try to launch',
  public.launch_live_loop_if_needed() = 'no_vault');
select pg_temp.chk('reason is live when a game is in progress',
  (select reason from loop_launcher_state where id) = 'live');

-- A game that kicked 20 minutes ago and never flipped counts as kicked.
\o /dev/null
update games set status = 'scheduled', start_ts = now() - interval '20 minutes' where id = 501;
select public.launch_live_loop_if_needed();
\o
select pg_temp.chk('a scheduled game past kickoff reads as kicked',
  (select reason from loop_launcher_state where id) = 'kicked');

-- A game that kicked five hours ago and never flipped is outside the window.
\o /dev/null
update games set start_ts = now() - interval '5 hours' where id = 501;
\o
select pg_temp.chk('a scheduled game 5 hours past kickoff is not held onto',
  public.launch_live_loop_if_needed() = 'idle');

-- The ten-minute hold after a dispatch.
\o /dev/null
update games set status = 'in_progress' where id = 501;
update loop_launcher_state set last_dispatched_at = now() - interval '2 minutes' where id;
\o
select pg_temp.chk('a dispatch 2 minutes ago holds the next one: pending',
  public.launch_live_loop_if_needed() = 'pending');
\o /dev/null
update loop_launcher_state set last_dispatched_at = now() - interval '11 minutes' where id;
\o
select pg_temp.chk('a dispatch 11 minutes ago no longer holds',
  public.launch_live_loop_if_needed() = 'no_vault');

-- The token-bearing function and its tables are not reachable from the API.
select expect_denied('a member cannot call the launcher',
  '00000000-0000-0000-0000-000000000001',
  'select public.launch_live_loop_if_needed()', 'permission denied');
select expect_denied('a visitor cannot call the launcher',
  null, 'select public.launch_live_loop_if_needed()', 'permission denied');
select expect_denied('a member cannot read the launcher state',
  '00000000-0000-0000-0000-000000000001',
  'select * from loop_launcher_state', 'permission denied');
select expect_denied('a member cannot read the dispatch log',
  '00000000-0000-0000-0000-000000000001',
  'select * from loop_launches', 'permission denied');
