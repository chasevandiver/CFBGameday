-- The scoring timeline (SCORE-1).
--
-- Owner request 2026-08-14: "For both cfb and nfl game cards when you click
-- into it. Show the individual scores in that game. So example it'd say first
-- quarter Texas wr (insert name) caught a 17 yard touchdown from (insert name)
-- Texas logo 7 Ohio state logo 0 with the time left in the quarter. But do that
-- for all scores in that game."
--
-- ---------------------------------------------------------------------------
-- Nothing like this exists, and the reason matters
--
-- `games` carries only the CURRENT live state — status, points, period, clock,
-- `current_situation`, `possession`, `last_play` — and every one of those is a
-- moving value. Worse, `current_situation` and `last_play` are deliberately
-- NULLED the moment a game goes final (0007's header comment,
-- `jobs-core.ts:365,373`), so postgame there is no play text left in the
-- database at all. `cover_flips` (0026) is the only per-event table and it is a
-- Q4+ betting-verdict log, not a scoring log.
--
-- So this is the first table in the project that keeps a record of what
-- happened DURING a game rather than what is true about it now.
--
-- ---------------------------------------------------------------------------
-- Shape
--
-- `sequence` is the feed's own ordering (ESPN's `scoringPlays` array index;
-- CFBD's play id ordering), not a timestamp. Clocks run backwards, reset every
-- quarter and stop, so they cannot order anything — and two scores can share a
-- clock value. The unique key is (game_id, sequence), which is what makes the
-- writer idempotent: a poll that re-reads the same summary re-upserts the same
-- rows rather than appending the game's history a second time.
--
-- `home_points` / `away_points` are the score AFTER this play, which is the
-- number the request asks to render beside each line. Stored rather than
-- accumulated at read time, because a feed occasionally reports a score we
-- never saw the play for, and a running total computed in the UI would then be
-- wrong for every row after it.
create table public.scoring_plays (
  game_id         integer not null references public.games(id) on delete cascade,
  sequence        integer not null,
  period          integer,
  -- Text, not an interval: "12:34" as the broadcast shows it, and null in the
  -- gaps where a feed omits it rather than a fabricated 0:00.
  clock           text,
  -- Nullable: a safety has no scoring team in some feeds' framing, and an
  -- unmatched abbreviation must not cost us the play. The UI falls back to no
  -- crest rather than dropping the row.
  scoring_team_id integer references public.teams(id),
  -- ESPN's `type.text` ("Passing Touchdown", "Field Goal Good"); null for CFBD,
  -- which publishes no type on the plays route.
  play_type       text,
  play_text       text not null,
  home_points     integer not null,
  away_points     integer not null,
  source          text not null,
  created_at      timestamptz not null default now(),
  primary key (game_id, sequence)
);

create index scoring_plays_game on public.scoring_plays (game_id, sequence);

-- ---------------------------------------------------------------------------
-- Grants: public read, service write
--
-- Read matches `games` — the site is browsable signed-out (0011) and a scoring
-- summary is no more private than the score it adds up to. Writes are the
-- ingest jobs' alone: this is a record of what happened, and nothing a user
-- does should be able to edit it. Same posture as `cover_flips` (0026), which
-- is the closest existing thing.
alter table public.scoring_plays enable row level security;

create policy "anyone reads scoring plays" on public.scoring_plays
  for select using (true);

revoke insert, update, delete on public.scoring_plays from anon, authenticated;
grant select on public.scoring_plays to anon, authenticated;
