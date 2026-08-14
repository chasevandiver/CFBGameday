-- Admin cancellation of wagers (ADM-1, ADM-2).
--
-- Owner request 2026-08-14: "There needs to be a way to fully cancel bets
-- before and after they kickoff and finish as someone with admin power. I'm
-- doing test bets so i want to be able to cancel them. The voided bets still
-- sit in the ledger. The betting and pickem groups also need to have an admin
-- cancel pick option."
--
-- Two separate powers, deliberately not one:
--
--   ADM-1  a SITE admin (profiles.is_admin) deletes a bet outright.
--   ADM-2  a GROUP admin (group_members.role = 'admin') cancels a member's
--          pick in a group they run.
--
-- ---------------------------------------------------------------------------
-- The append-only exception, stated rather than buried
--
-- 0001:210 opens the bets table with "Append-only ledger: no deletes;
-- voided_at instead (Honest Note #5)", and docs/SPEC.md §5.3 says the same.
-- Hard delete is a deliberate owner decision against that, taken because
-- voiding does not solve the problem it was asked to solve: a voided bet is
-- still a row in the ledger at 40% opacity forever, and the whole request was
-- to get test rows OUT.
--
-- So the invariant is narrowed rather than abandoned. It was "nothing is ever
-- removed"; it is now "nothing is removed without a record". Every deletion
-- copies the whole row into deleted_wagers first, and the archive is deny-all.
-- A restore is therefore always possible by hand, which is the property the
-- original rule actually existed to protect.
--
-- Why an archive TABLE rather than a soft-delete flag: a flag is what voided_at
-- already is, and the report is that voided rows still sit in the ledger. A
-- third state would need filtering at every one of the ledger's ~8 tallies, and
-- one missed filter puts test bets back in the units curve.

-- ---------------------------------------------------------------------------
-- The archive
--
-- Deny-all, like api_call_log (0001:292) and group_join_attempts (0039:89-90):
-- written by a security-definer function or the service role, read by /admin
-- behind its own is_admin gate. No RLS policy is created, so RLS denies
-- everything and the grant revocation makes that explicit at the SQL layer too.
create table public.deleted_wagers (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('bet','pick')),
  -- The whole row as it stood, not a column subset: the point of an archive is
  -- that nobody has to have predicted which field would matter later.
  payload     jsonb not null,
  -- Nullable because a service-role script has no auth.uid() to record, and a
  -- null "who" is honest where a fabricated one is not.
  deleted_by  uuid references public.profiles(id),
  deleted_at  timestamptz not null default now(),
  note        text
);

create index deleted_wagers_recent on public.deleted_wagers (deleted_at desc);

alter table public.deleted_wagers enable row level security;
revoke all on table public.deleted_wagers from anon, authenticated;

-- ---------------------------------------------------------------------------
-- ADM-2 — admin_remove_pick
--
-- remove_pick (0038:35-74) cannot be reused for this, in two ways that both
-- matter. It deletes `user_id = (select auth.uid())`, so an admin calling it
-- removes their OWN pick and reports 1 row happily. And it raises on kickoff
-- (0038:62-64), which is exactly the case an admin needs — a pick that has to
-- be cancelled after the game started is the whole reason this exists.
--
-- Shape copied from remove_group_member (0038:114), the repo's existing
-- admin-acts-on-another-member RPC.
--
-- No kickoff lock, deliberately, and no status check either. Cancelling a
-- graded pick is a supported action: it is how a test row placed against a
-- finished game gets cleared. The grader will not re-create it — picks are
-- written only by make_pick.
create function public.admin_remove_pick(
  p_group_id uuid,
  p_user_id  uuid,
  p_game_id  integer,
  p_market   text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_deleted integer;
begin
  if v_uid is null then
    raise exception 'Sign in to manage picks';
  end if;

  -- Group admin of THIS group. A site admin has no standing here on purpose:
  -- is_admin is a platform role, and reaching into a group's picks with it
  -- would make every group's board editable by someone who is not in it.
  -- A site admin who needs that removes the row through ADM-1's service path.
  if not public.is_group_admin(p_group_id) then
    raise exception 'Only a group admin can cancel someone else''s pick';
  end if;

  -- Archive before deleting, same rule as bets. to_jsonb(p) captures every
  -- column including ones added after this migration.
  insert into public.deleted_wagers (kind, payload, deleted_by, note)
  select 'pick', to_jsonb(p), v_uid, 'admin_remove_pick'
  from picks p
  where p.group_id = p_group_id
    and p.user_id = p_user_id
    and p.game_id = p_game_id
    and p.market = p_market;

  delete from picks
  where group_id = p_group_id
    and user_id = p_user_id
    and game_id = p_game_id
    and market = p_market;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Zero rows stays a success, for the reason 0038:24-30 gives for remove_pick:
-- cancellation is idempotent, and the second tap of a double-tap asks for a
-- state the pick is already in. The count is what tells the caller which
-- happened.
revoke execute on function public.admin_remove_pick(uuid, uuid, integer, text) from public, anon;
grant  execute on function public.admin_remove_pick(uuid, uuid, integer, text) to authenticated;
