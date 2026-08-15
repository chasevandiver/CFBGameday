-- SEC-08b, part two: take `is_admin` off the `authenticated` column grant.
--
-- Split from 0050 so the deploy has a safe order. 0050 adds
-- `is_current_user_admin()` and is inert against the running code; this file is
-- the half that changes what existing code can read, so it goes LAST:
--
--   1. 0050    — the function appears; old code is unaffected
--   2. deploy  — new code calls the function, which now exists
--   3. THIS    — the column goes away, with nothing left reading it
--
-- Applied before the deploy, this breaks every admin gate: the old code does
-- `select("is_admin")` and would be denied — including `/me`, which reads it
-- inside a multi-column list and would throw rather than degrade.
--
-- Same shape as 0013:26 and 0040:28 — the table-level grant has to go before
-- the column grants can bite, because a column-level revoke against a live
-- table-level SELECT is a no-op.
--
-- Every column except `is_admin`. `created_at` stays because it was readable
-- before and this migration has one subject.

revoke select on public.profiles from authenticated;
grant  select (id, display_name, favorite_team_ids, timezone, created_at)
  on public.profiles to authenticated;
