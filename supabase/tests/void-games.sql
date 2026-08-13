-- Voiding a game, and re-picking a revived one (0034 / P1-1).
--
-- Two invariants that only exist at the database layer:
--
--   * `games.status` is constrained. It was plain text with the five valid
--     values in a comment, which was survivable while only the sync jobs wrote
--     it and stops being survivable once an admin can.
--
--   * `make_pick` clears `result` when it replaces a pick. jobs-core has said
--     "the member re-picks on the revived game" since 0013; before 0034 the
--     upsert set only side/line_at_pick/locked_at, so the re-pick inherited
--     result='void' and the grader — which selects on `result is null` — would
--     never have graded it.

\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on
\pset format unaligned

create function pg_temp.chk(label text, ok boolean) returns text
language sql as $$ select case when ok then 'PASS  ' else 'FAIL  ' end || label; $$;

create function pg_temp.raises(label text, stmt text) returns text
language plpgsql as $$
begin
  execute stmt;
  return 'FAIL  ' || label || ' (no error raised)';
exception when others then
  return 'PASS  ' || label || ' -> ' || sqlerrm;
end; $$;

\o /dev/null
insert into seasons (id, label, week0_start, is_current)
values (2026, '2026', date '2026-08-29', true);

insert into teams (id, school, abbreviation, conference, classification) values
  (1, 'Georgia', 'UGA',  'SEC',     'fbs'),
  (2, 'Alabama', 'BAMA', 'SEC',     'fbs');

insert into games (id, season_id, week, season_type, start_ts, home_team_id, away_team_id) values
  (301, 2026, 2, 'regular', now() + interval '3 days', 1, 2);

insert into line_snapshots (game_id, provider, source, spread, total) values
  (301, 'bookA', 'cfbd', -3.0, 52.0),
  (301, 'bookB', 'cfbd', -4.0, 53.0);

insert into invite_allowlist (email, make_admin) values ('ann@example.com', true);
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ann@example.com');
\o

\set ann '''11111111-1111-1111-1111-111111111111'''

-- ---------------------------------------------------------------------------
\echo '# games.status is a real enumeration now'
-- ---------------------------------------------------------------------------
select pg_temp.raises('an invented status',
  $$update games set status = 'weather_delay' where id = 301$$);
-- One L. The codebase spells it 'canceled' everywhere, and isDeadStatus() in
-- src/lib/void.ts deliberately does not recognise the British form — so the
-- constraint must reject it too, rather than storing a value the app reads as
-- alive.
select pg_temp.raises('the British spelling',
  $$update games set status = 'cancelled' where id = 301$$);
select pg_temp.raises('an empty status',
  $$update games set status = '' where id = 301$$);

\o /dev/null
update games set status = 'postponed' where id = 301;
\o
select pg_temp.chk('postponed is accepted',
                   (select status from games where id = 301) = 'postponed');
\o /dev/null
update games set status = 'canceled' where id = 301;
update games set status = 'scheduled' where id = 301;
\o
select pg_temp.chk('and so is the way back to scheduled',
                   (select status from games where id = 301) = 'scheduled');

-- ---------------------------------------------------------------------------
\echo '# a re-picked game does not inherit the grade it was voided with'
-- ---------------------------------------------------------------------------
\o /dev/null
begin;
  select test_as(:ann::uuid);
  select create_group('Pool', 'private') as pool \gset
  select set_group_week_config(:'pool'::uuid, 2026, 2, 'regular', 'full_slate', null,
                               array['spread'], null);
commit;
\o

begin;
  select test_as(:ann::uuid);
  \o /dev/null
  select make_pick(:'pool'::uuid, 301, 'spread', 'home');
  \o
  select pg_temp.chk('the pick starts ungraded',
                     (select result is null from picks where game_id = 301) = true);
commit;

-- The game dies, and the grader (service role, RLS-exempt) voids the pick
-- exactly as voidWagersForGames does.
\o /dev/null
update picks set result = 'void' where game_id = 301 and result is null;
update games set status = 'postponed' where id = 301;
\o
select pg_temp.chk('the void landed',
                   (select result from picks where game_id = 301) = 'void');

-- It is rescheduled, and the member picks again.
\o /dev/null
update games set status = 'scheduled', start_ts = now() + interval '10 days' where id = 301;
\o
begin;
  select test_as(:ann::uuid);
  \o /dev/null
  select make_pick(:'pool'::uuid, 301, 'spread', 'away');
  \o
  select pg_temp.chk('the re-pick took the new side',
                     (select side from picks where game_id = 301) = 'away');
  -- The assertion this file exists for. Before 0034 this stayed 'void' and the
  -- grader's `result is null` filter skipped the row forever.
  select pg_temp.chk('the re-pick is gradable again',
                     (select result is null from picks where game_id = 301) = true);
  select pg_temp.chk('and carries no stale CLV',
                     (select clv is null from picks where game_id = 301) = true);
commit;

-- One row throughout: a re-pick updates, it does not accumulate.
select pg_temp.chk('still exactly one pick on the game',
                   (select count(*) from picks where game_id = 301) = 1);
