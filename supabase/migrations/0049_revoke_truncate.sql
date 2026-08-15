-- TRUNCATE is granted to anon and authenticated on every public table.
--
-- Recorded in docs/STATUS.md §6 on 2026-08-14 while verifying 0048's grants,
-- and it is project-wide and pre-existing rather than anything a migration in
-- this repo did: Supabase provisions
--   alter default privileges in schema public grant all on tables to ...
-- for both `postgres` and `supabase_admin`, and `all` on a table is
-- `arwdDxtm` — the `D` is TRUNCATE.
--
-- ## Why it matters, given nothing can reach it today
--
-- TRUNCATE is a *table* privilege and is **not subject to RLS**. The policies
-- that make `bets` and `picks` append-only (0013) filter rows; they have no say
-- over a statement that removes the whole table at once. So the append-only
-- guarantee currently rests on PostgREST not exposing a TRUNCATE verb — an
-- external fact about the API surface, not a property of the database.
--
-- Practical exposure today is nil and that is why this waited for its own
-- change rather than being bolted onto a UI branch. What it costs is defence
-- in depth: the day any `security definer` function runs dynamic SQL, or the
-- Data API grows a verb, this becomes reachable. 0013's whole point is that
-- the guarantee should not depend on the API staying the shape it is today.
--
-- ## Two statements, and the second is the one that lasts
--
-- The revoke fixes the 47 tables that exist. The `alter default privileges`
-- fixes the next one — without it, the very next `create table` re-inherits
-- TRUNCATE and this migration reads as done while the hole reopens.
--
-- Scoped to the migration's own role (`postgres`), which is the role that
-- creates every table in this repo, so its default ACL is the one that governs
-- new app tables. `supabase_admin` carries a second, identical default ACL for
-- tables *it* creates — Supabase's own — and altering that needs membership in
-- that role, which a project migration does not have and should not want. Not
-- attempted here rather than attempted and swallowed: a `DO` block catching
-- insufficient_privilege would make a migration that silently did half its job
-- look identical to one that did all of it, which is the failure mode this
-- whole file exists to argue against.

revoke truncate on all tables in schema public from anon, authenticated;

alter default privileges in schema public
  revoke truncate on tables from anon, authenticated;
