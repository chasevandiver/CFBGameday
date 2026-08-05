-- Live in-game situation from the CFBD scoreboard (docs/SPEC.md §7).
-- Written by the scoreboard job while a game is in_progress, nulled on final
-- so finished games never show a stale down-and-distance.

alter table games
  add column current_situation text,   -- verbatim CFBD string, e.g. "2nd & 10 at OSU 34"
  add column possession text;          -- 'home' | 'away' | null

-- Covered by the existing "read games" select policy.
