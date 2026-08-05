-- LLM editorial layer (docs/SPEC.md §3.10, §6.6): Anthropic-generated team
-- verdicts and per-game swing questions. Written only by service-role scripts
-- (scripts/generate-verdicts.ts, scripts/generate-questions.ts); the app reads.

create table team_verdicts (
  season_id     integer not null references seasons(id),
  team_id       integer not null references teams(id),
  verdict       jsonb not null,
  model         text not null,
  generated_at  timestamptz not null default now(),
  primary key (season_id, team_id)
);

create table game_questions (
  game_id       integer primary key references games(id),
  questions     jsonb not null,
  model         text not null,
  generated_at  timestamptz not null default now()
);

alter table team_verdicts enable row level security;
alter table game_questions enable row level security;

create policy "read verdicts" on team_verdicts for select to authenticated using (true);
create policy "read questions" on game_questions for select to authenticated using (true);
