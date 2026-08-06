-- Performance advisor remediation (Supabase linter, post-0013 audit pass).
--
-- 1. auth_rls_initplan: auth.uid() inside a policy is re-evaluated per row;
--    wrapping it in (select auth.uid()) lets the planner evaluate it once.
--    Policies are recreated verbatim otherwise.
-- 2. Unindexed foreign keys on hot paths: picks/bets by game (grading, game
--    pages, weekly grid), games by team (team pages), system_ratings by
--    season+team (game-page systems table), rivalries pair lookups.

-- ---------------------------------------------------------------------------
-- 1. initplan-safe policies
-- ---------------------------------------------------------------------------

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "insert own pick before kickoff" on public.picks;
create policy "insert own pick before kickoff" on public.picks for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from games g where g.id = picks.game_id and g.start_ts > now())
  );

drop policy if exists "edit own pick before kickoff" on public.picks;
create policy "edit own pick before kickoff" on public.picks for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from games g where g.id = picks.game_id and g.start_ts > now())
  )
  with check (user_id = (select auth.uid()));

drop policy if exists "delete own pick before kickoff" on public.picks;
create policy "delete own pick before kickoff" on public.picks for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from games g where g.id = picks.game_id and g.start_ts > now())
  );

drop policy if exists "insert own bets" on public.bets;
create policy "insert own bets" on public.bets for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "void own bets" on public.bets;
create policy "void own bets" on public.bets for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "admins read adjustments" on public.rating_adjustments;
create policy "admins read adjustments" on public.rating_adjustments for select to authenticated
  using (exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_admin));

drop policy if exists "admins confirm adjustments" on public.rating_adjustments;
create policy "admins confirm adjustments" on public.rating_adjustments for update to authenticated
  using (exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_admin));

drop policy if exists "admins insert adjustments" on public.rating_adjustments;
create policy "admins insert adjustments" on public.rating_adjustments for insert to authenticated
  with check (exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_admin));

drop policy if exists "admins delete adjustments" on public.rating_adjustments;
create policy "admins delete adjustments" on public.rating_adjustments for delete to authenticated
  using (exists (select 1 from profiles p where p.id = (select auth.uid()) and p.is_admin));

-- ---------------------------------------------------------------------------
-- 2. hot-path foreign-key indexes
-- ---------------------------------------------------------------------------

create index if not exists picks_game on public.picks (game_id);
create index if not exists bets_game on public.bets (game_id);
create index if not exists bets_user on public.bets (user_id);
create index if not exists games_home_team on public.games (home_team_id);
create index if not exists games_away_team on public.games (away_team_id);
create index if not exists system_ratings_season_team on public.system_ratings (season_id, team_id);
create index if not exists rivalries_team_a on public.rivalries (team_a_id);
create index if not exists rivalries_team_b on public.rivalries (team_b_id);
