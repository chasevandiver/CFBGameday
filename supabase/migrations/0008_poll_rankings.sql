-- Human polls (AP / Coaches / CFP committee) from CFBD /rankings.
-- Display-only context next to the model's own rank — never fed to the model.

create table poll_rankings (
  season_id         integer not null references seasons(id),
  week              integer not null,
  season_type       text not null default 'regular',
  poll              text not null,     -- 'AP Top 25' | 'Coaches Poll' | 'Playoff Committee Rankings'
  team_id           integer not null references teams(id),
  rank              integer not null,
  points            integer,
  first_place_votes integer,
  fetched_at        timestamptz not null default now(),
  primary key (season_id, season_type, week, poll, team_id)
);

alter table poll_rankings enable row level security;
create policy "read poll rankings" on poll_rankings for select to authenticated using (true);
