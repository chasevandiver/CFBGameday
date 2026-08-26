-- F3b — pregame notes: the classify layer over what F3 stores. 0079's feed
-- answered "what happened"; this answers the owner's actual question, "what
-- about THIS game" — the projected QB who is suddenly gone, the coach exodus
-- a poll rank hasn't priced. The producer (scripts/generate-notes.ts) hands
-- the LLM only our stored headlines and the model's own stored numbers
-- (ratings, poll ranks, preseason components, the frozen line) and asks for
-- 0–3 notes per game, zero being the normal case. No web search — discovery
-- stayed free; this is kilobytes of classification per game.
--
-- Same posture as 0005/0056/0079: written only by the service-role producer,
-- the app reads. One row per game; the daily regenerate overwrites, because
-- yesterday's notes on today's news is exactly the staleness F3 exists to
-- kill. Additive table; the game page treats a missing row as no notes.

create table public.game_notes (
  game_id       integer primary key references public.games(id),
  -- [{ kind, note }] — the shape zod enforces in the producer.
  notes         jsonb not null,
  model         text not null,
  generated_at  timestamptz not null default now()
);

alter table public.game_notes enable row level security;

create policy "read game notes" on public.game_notes
  for select to authenticated using (true);
-- The signed-out game page renders the notes block too (0011's posture).
create policy "anon read game notes" on public.game_notes
  for select to anon using (true);

revoke insert, update, delete, truncate on public.game_notes
  from public, anon, authenticated;
