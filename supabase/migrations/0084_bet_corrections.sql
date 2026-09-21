-- ADM-3 — an admin corrects the line on a bet that was logged at the wrong one.
--
-- Owner request 2026-09-21, after doing it by hand twice in two days: the book
-- gave a number the site did not have, and the logged row carried the site's.
-- 2026-09-20, UCLA: ledger −14 (a push on a 14-point win), ticket −13.5 (a
-- win) — deleted and re-logged, which threw away the original placed_at. Same
-- day, GB @ NYJ: two rows at −3.5 that should have been −3, corrected by a
-- direct UPDATE because the app has no path for it.
--
-- ---------------------------------------------------------------------------
-- Why this needs a table and not just an UPDATE
--
-- `bets_void_only` (0045) is what makes the ledger append-only in practice: a
-- signed-in user may void, retag, or mark a future, and nothing else. The
-- trigger passes the service role straight through, so an admin action CAN
-- rewrite `line_taken` — which is precisely why it should not do so silently.
--
-- So the same narrowing ADM-1 made for deletes (0046: "nothing is removed
-- without a record") applies to corrections: nothing is REWRITTEN without a
-- record. The whole row as it stood goes here first, and only then is the live
-- row changed. A correction is therefore always reversible by hand, and the
-- ledger can still answer "what did this bet say before somebody changed it".
--
-- A separate table rather than a `kind` on `deleted_wagers`: that table means
-- "this row is gone", and an operator reading it has to be able to trust that.
-- A corrected bet is still there.
--
-- No foreign key to `bets`, deliberately, matching `deleted_wagers`. ADM-1 can
-- delete a bet that was corrected earlier, and the correction record should
-- survive that — a cascade would erase the history at exactly the moment the
-- archive is the only copy left.

create table public.bet_corrections (
  id           bigint generated always as identity primary key,
  bet_id       bigint not null,
  -- The whole row BEFORE the correction, not a column subset — same reason
  -- 0046 gives: nobody has to have predicted which field would matter later.
  payload      jsonb not null,
  -- What changed, in the bettor's own numbers, so the log is readable without
  -- reconstructing the home-perspective convention from the payload.
  old_line     numeric,
  new_line     numeric,
  -- Nullable for the same reason as `deleted_wagers.deleted_by`: a service-role
  -- script has no auth.uid(), and a null "who" is honest where an invented one
  -- is not.
  corrected_by uuid references public.profiles(id),
  corrected_at timestamptz not null default now(),
  note         text
);

create index bet_corrections_recent on public.bet_corrections (corrected_at desc);
create index bet_corrections_bet on public.bet_corrections (bet_id, corrected_at desc);

-- Deny-all, like `deleted_wagers` (0046) and `api_call_log` (0001:292): written
-- by the service role, read by /admin behind its own is_admin gate. No policy
-- is created, so RLS denies everything, and the revoke says the same thing at
-- the SQL layer.
alter table public.bet_corrections enable row level security;
revoke all on table public.bet_corrections from anon, authenticated;

comment on table public.bet_corrections is
  'ADM-3 archive: the bet row as it stood before an admin corrected its line. Append-only exception, recorded — see migration 0084.';
