-- Enable Supabase Realtime postgres_changes on games so live score writes from
-- the scoreboard job push straight to subscribed browsers. Events respect RLS
-- (games is authenticated-read), so the client socket must carry a valid JWT.
--
-- Default replica identity (PK) is enough — subscribers only need the `new`
-- record on UPDATE, and it keeps WAL small. Idempotent: hosted Supabase ships
-- the supabase_realtime publication; guard for local/fresh databases.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'games'
    ) then
      alter publication supabase_realtime add table public.games;
    end if;
  else
    create publication supabase_realtime for table public.games;
  end if;
end $$;
