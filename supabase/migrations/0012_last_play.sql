-- Last play from the CFBD scoreboard, so someone reopening the app sees what
-- just changed without watching the game. Written by the scoreboard job while
-- a game is in_progress, nulled on final alongside current_situation.

alter table games
  add column last_play text;

-- Covered by the existing games select policies (authenticated + anon).
