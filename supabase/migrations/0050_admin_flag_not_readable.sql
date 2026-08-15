-- SEC-08b: `profiles.is_admin` is readable by any signed-in user.
--
-- The other half of P2-2/SEC-08. Migration 0040 closed the signed-out side by
-- narrowing `anon` to (id, display_name); `authenticated` kept the whole row,
-- so any member could list who the admins are. That is not an escalation —
-- 0013 already made the column unwritable, so knowing is not becoming — but it
-- is an inventory of who to go after, and it is free to close.
--
-- ## Split from the revoke on purpose (deploy ordering)
--
-- This migration only ADDS: the function and its grants. The revoke that
-- actually closes the hole is 0052, and they are separate files because the
-- order across a deploy matters and a single migration cannot be half-applied.
--
--   1. apply THIS  — inert against the running code, which still SELECTs the
--                    column and still may
--   2. deploy      — the new code calls the function, which now exists
--   3. apply 0052  — takes the column away, with nothing left reading it
--
-- Run as one migration, the middle step has no safe position: applied before
-- the deploy it breaks every admin gate (the old code's SELECT is denied), and
-- applied after it leaves a window where the new code asks for a function that
-- is not there. `lib/admin.ts` fails closed, so that window is admins quietly
-- losing their admin links rather than an error — which is worse, being the
-- kind of thing nobody reports.
--
-- ## Why a function instead of just revoking the column
--
-- Seven call sites gate on this flag by SELECTing it as the signed-in user.
-- Revoking the column alone would break all seven closed: `data?.is_admin`
-- becomes undefined, every gate reads false, and the admin pages 404 for
-- admins. So the read has to move somewhere that can still see the column.
--
-- `is_current_user_admin()` is that somewhere. SECURITY DEFINER, so it reads
-- `profiles` as the owner rather than as the caller, and returns one boolean —
-- the only fact a gate needs. A caller learns whether *they* are an admin and
-- nothing about anyone else, which is the whole difference from a SELECT.
--
-- STABLE, not VOLATILE: it reads and does not write, so PostgREST will let it
-- be called and the planner can cache it within a statement.
--
-- `search_path` is pinned empty and every reference schema-qualified. A
-- SECURITY DEFINER function without that is the classic Postgres privilege
-- escalation — a caller who can create a `public.profiles` earlier in the
-- search path gets the definer's rights over their own table.
--
-- Returns false, never null, for a signed-out caller or a user with no profile
-- row. A gate that reads `null` and treats it as falsy is right by accident;
-- this makes it right on purpose.

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false);
$$;

revoke execute on function public.is_current_user_admin() from public, anon;
grant  execute on function public.is_current_user_admin() to authenticated;
