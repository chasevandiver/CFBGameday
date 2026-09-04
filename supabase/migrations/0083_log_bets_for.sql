-- Logging a bet for a member of your betting group.
--
-- Owner request 2026-09-04: "my friends aren't using the site that much. Can I
-- log their bets for them cause they send them in the text, but sometimes it's
-- after kick off" — and, asked what shape that should take: "as the admin of
-- the betting group, impersonate a user or make the picks easily as another
-- person in the group."
--
-- ## What this is, and what it is not
--
-- The seats work (0081) let a pick'em admin pick for someone with no login. The
-- people here HAVE logins; they just text their bets instead of logging them.
-- So the target of "log for" is any active member of a betting group the caller
-- runs — a real account or an unclaimed seat, the rule does not care which —
-- and the row that lands is the member's own bet in every respect: their
-- ledger, their sheet position, their tail/fade record, graded by the same job.
-- What is added is a byline: `logged_by` says the admin typed it in. A row
-- with no byline is one its owner logged themselves, exactly as before.
--
-- Why the byline is mandatory on a proxy row: the ledger's one integrity claim
-- is that nobody can quietly put a number on somebody else's record. An admin
-- CAN now put a number there — that is the request — so the row has to say
-- so, and the policy below refuses a proxy insert that does not sign itself.
-- The same policy refuses a self-logged row that names anyone else as the
-- logger: a byline is a fact about who wrote the row, not a free-text column.
--
-- ## The grant, precisely
--
-- `can_log_bet_for(p_user)` is true when the caller is a current admin of a
-- live (not archived) BETTING group in which `p_user` is a current member, and
-- `p_user` is not the caller. Pick'em and survivor groups do not qualify —
-- they have no ledger to log to — and neither does a removed member or an
-- archived roster, since neither is "in the group" any more. It is SECURITY
-- DEFINER for the same reason `is_group_admin` is: policies and actions ask
-- it, and the roster tables it reads are not all visible to the caller.
--
-- The void policy widens the same way. An admin who typed the wrong number
-- from a text needs to void the row they just wrote, and "void" is the ledger's
-- only edit (0013, 0045's `enforce_bet_void_only` still decides which columns
-- may move — this migration changes who may ask, not what may change).
--
-- `placed_at` is still stamped by the insert sanitizer (0013) and cannot be
-- backdated. A bet logged from a text after kickoff therefore carries the time
-- it was LOGGED, not the time the text arrived — recorded in STATUS §6 as a
-- known residual rather than solved here, because letting any authenticated
-- caller choose `placed_at` would let anyone backdate their own rows.
--
-- ## Ordering against the deploy
--
-- Free in both directions. Old code inserts without `logged_by` (null → the
-- self branch of the new policy, unchanged behaviour). New code deployed
-- before this migration still logs for yourself; only the proxy path fails,
-- and it fails closed with the RPC missing rather than open.

-- ---------------------------------------------------------------------------
-- The byline
-- ---------------------------------------------------------------------------
alter table public.bets
  add column if not exists logged_by uuid references public.profiles(id);

comment on column public.bets.logged_by is
  'Who wrote this row when it was not the bettor: an admin of a betting group '
  'the bettor is in, logging a bet they were sent (0083). Null when the bettor '
  'logged it themselves. The insert policy refuses a proxy row without it and '
  'a self row that names anyone else.';

-- ---------------------------------------------------------------------------
-- "May the caller log a bet for this person?" — stated once, asked by the
-- insert and update policies and by the server actions.
-- ---------------------------------------------------------------------------
create or replace function public.can_log_bet_for(p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select p_user is not null
     and (select auth.uid()) is not null
     and p_user <> (select auth.uid())
     and exists (
       select 1
       from group_members me
       join groups g          on g.id = me.group_id
       join group_members them on them.group_id = me.group_id
       where me.user_id     = (select auth.uid())
         and me.role        = 'admin'
         and me.removed_at  is null
         and g.kind         = 'betting'
         and g.archived_at  is null
         and them.user_id   = p_user
         and them.removed_at is null
     );
$$;

revoke execute on function public.can_log_bet_for(uuid) from public, anon;
grant execute on function public.can_log_bet_for(uuid) to authenticated;

comment on function public.can_log_bet_for(uuid) is
  'True when the caller is a current admin of a live betting group that '
  'p_user is a current member of, and p_user is not the caller (0083). '
  'Fails closed: signed out, null, self, other group kinds, removed members '
  'and archived groups are all false.';

-- ---------------------------------------------------------------------------
-- The policies. Names kept (the audit trail from 06/SEC-03 and 0045 points at
-- them); the comments say what they now carry.
-- ---------------------------------------------------------------------------
drop policy if exists "insert own bets" on public.bets;
create policy "insert own bets" on public.bets for insert to authenticated
  with check (
    case
      when user_id = (select auth.uid())
        then logged_by is null or logged_by = (select auth.uid())
      else logged_by = (select auth.uid()) and public.can_log_bet_for(user_id)
    end
  );

comment on policy "insert own bets" on public.bets is
  'Your own row (logged_by null or yourself), or — since 0083 — a row for a '
  'member of a betting group you admin, which must carry your id in '
  'logged_by. Grading fields are still stripped by enforce_bet_insert_clean().';

drop policy if exists "void own bets" on public.bets;
create policy "void own bets" on public.bets for update to authenticated
  using (user_id = (select auth.uid()) or public.can_log_bet_for(user_id))
  with check (user_id = (select auth.uid()) or public.can_log_bet_for(user_id));

comment on policy "void own bets" on public.bets is
  'Ownership check, widened in 0083 to the admins of a betting group the '
  'owner is in. Despite the name this also carries the pre-kickoff confidence '
  'retag (0045); enforce_bet_void_only() decides which edits are actually '
  'permitted, this only decides who may ask.';
