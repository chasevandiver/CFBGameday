-- F3 v1 — team news without the LLM. The specced injury/news scan assumed
-- Claude-with-web-search was the only way to find the news; ESPN's
-- unauthenticated team-scoped news feed turned out to carry it already
-- (verified live 2026-08-25: team-tagged headlines including QB1 naming).
-- What no free feed carries is *structured CFB injury data* — college has no
-- league-mandated injury report — so this v1 stores headlines, not statuses,
-- and the classify-and-propose-adjustment layer stays open in docs/STATUS.md.
--
-- Same posture as 0005/0056: written only by the service-role producer
-- (scripts/lib/team-news.ts, daily), the app reads. One row per
-- (team, article) — an article that tags both sides of a game inserts a row
-- per slate team, and the display dedupes by article. Re-fetching upserts:
-- ESPN edits headlines in place, and stale copy is worse than a rewrite.
--
-- Apply-vs-deploy order is free: additive table; the game and team pages
-- treat a missing table exactly like a team with no news yet.

create table public.team_news (
  team_id      integer not null references public.teams(id),
  article_id   bigint not null,            -- ESPN article id
  type         text not null,              -- HeadlineNews | Story | …
  headline     text not null,
  description  text,
  url          text,
  premium      boolean not null default false,
  published_at timestamptz not null,
  fetched_at   timestamptz not null default now(),
  primary key (team_id, article_id)
);

-- The only read shape: newest first for a team (or a game's two teams).
create index team_news_team_published on public.team_news (team_id, published_at desc);

alter table public.team_news enable row level security;

create policy "read team news" on public.team_news
  for select to authenticated using (true);
-- The signed-out game page renders the news block too (0011's posture: the
-- site reads public).
create policy "anon read team news" on public.team_news
  for select to anon using (true);

revoke insert, update, delete, truncate on public.team_news
  from public, anon, authenticated;
