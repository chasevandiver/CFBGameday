-- The site is public to browse (owner decision, Aug 2026): anyone can view
-- the slate, games, ratings, ledgers, and crew picks without an account.
-- Signing in is only required to save picks and log bets.
--
-- Anon gets read-only access to the same tables authenticated users can read.
-- Every write policy still requires an authenticated crew member, and the
-- deny-all tables (venue_coord_overrides, invite_allowlist, api_call_log) and
-- admin-only rating_adjustments stay service-role / admin only.

create policy "anon read seasons" on seasons for select to anon using (true);
create policy "anon read teams" on teams for select to anon using (true);
create policy "anon read venues" on venues for select to anon using (true);
create policy "anon read games" on games for select to anon using (true);
create policy "anon read lines" on line_snapshots for select to anon using (true);
create policy "anon read weather" on weather_forecasts for select to anon using (true);
create policy "anon read ratings" on ratings for select to anon using (true);
create policy "anon read preseason" on preseason_components for select to anon using (true);
create policy "anon read hfa" on team_hfa for select to anon using (true);
create policy "anon read predictions" on predictions for select to anon using (true);
create policy "anon read rivalries" on rivalries for select to anon using (true);
create policy "anon read profiles" on profiles for select to anon using (true);
create policy "anon read picks" on picks for select to anon using (true);
create policy "anon read bets" on bets for select to anon using (true);
create policy "anon read verdicts" on team_verdicts for select to anon using (true);
create policy "anon read questions" on game_questions for select to anon using (true);
create policy "anon read poll rankings" on poll_rankings for select to anon using (true);
