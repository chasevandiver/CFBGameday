-- Confidence tier on a bet (SHARE-2).
--
-- The share card is organised by conviction, and the product had nowhere to
-- put it: `units` is a stake, `reason_tag` is a *why* and not a *how strongly*,
-- and `edge_flag` belongs to the model, not to the user. So: one column, six
-- rungs, low to high.
--
--   lean < bet < slate < day < year < century
--
-- A lean is the bottom rung of this same ladder, not a separate unstaked
-- object — it is still a real wager with real units, just the one you would
-- defend least. "Bet of the Slate" takes its broadcast window from the bet's
-- own kickoff at render time (src/lib/kick.ts kickSlot()), so no column here
-- carries "Afternoon".
--
-- WHY THIS IS NOT JUST AN ALTER TABLE. 0013 §2 put enforce_bet_void_only() on
-- this table, and its rule is absolute: the only user-driven edit to a bet is
-- ungraded → voided. Every other column is rebuilt from OLD. Add a column and
-- nothing more, and the tier could be written once at insert and never
-- corrected — a typo would be permanent.
--
-- So the trigger's whitelist grows by exactly one transition, and the
-- boundary is kickoff, not grading. That is the whole point. The append-only
-- thesis (Honest Note #5) is about the *numbers* being unhideable — the line
-- you took, the stake, the result. A self-assigned label is not a wager term
-- and freezing it the moment you log the bet would be strictly worse for the
-- product. But letting it move after kickoff would quietly destroy the reason
-- to store it at all: "how do my Bet of the Day picks actually do?" is only
-- answerable if the tier was set before anyone knew the answer. Kickoff is
-- where those two facts stop fighting, and it is the same line League Rules #1
-- already draws for picks.
--
-- Futures (game_id null) have no kickoff. They freeze at grading instead,
-- which the `old.result is not null` guard at the top of the trigger already
-- covers. A scheduled game with a null start_ts has not kicked off either —
-- TBD is not "started" — so it stays editable.

alter table public.bets
  add column confidence text not null default 'bet';

-- Existing rows land on the neutral rung. NOT NULL + a default means no code
-- downstream ever branches on a null tier.
alter table public.bets
  add constraint bets_confidence_check
  check (confidence in ('lean', 'bet', 'slate', 'day', 'year', 'century'));

comment on column public.bets.confidence is
  'Self-assigned conviction, low to high: lean < bet < slate < day < year < '
  'century. Set at insert, editable until kickoff, frozen after — see '
  'enforce_bet_void_only(). Sorts the share card above kickoff time.';

-- ---------------------------------------------------------------------------
-- The trigger, with one more permitted transition
-- ---------------------------------------------------------------------------
-- Unchanged from 0013 except for the retag branch. The shape is deliberately
-- the same: decide what may change, rebuild the row from OLD, then re-apply
-- only that. Anything the caller smuggled alongside is discarded rather than
-- rejected, exactly as a void that also tries to move the units is today.

create or replace function public.enforce_bet_void_only()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_voided_at  timestamptz;
  v_confidence text;
  v_kick       timestamptz;
begin
  -- Grading jobs connect as service_role and keep full write access.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if old.result is not null then
    raise exception 'settled or voided bets cannot be changed';
  end if;

  -- Retag: the tier is the one column a user may move on a live bet.
  if new.result is null
     and new.voided_at is null
     and new.confidence is distinct from old.confidence
  then
    -- No row (a future) leaves v_kick null, and so does a game with no
    -- announced kickoff. Neither has started, so both stay editable.
    select start_ts into v_kick from games where id = old.game_id;
    if v_kick is not null and v_kick <= now() then
      raise exception 'kickoff — the confidence tier is frozen for this bet';
    end if;
    v_confidence := new.confidence;
    new := old;
    new.confidence := v_confidence;
    return new;
  end if;

  if new.result is distinct from 'void' or new.voided_at is null then
    raise exception 'bets are append-only — the only permitted edit is voiding';
  end if;
  v_voided_at := new.voided_at;
  new := old;
  new.result := 'void';
  new.voided_at := v_voided_at;
  return new;
end;
$$;

-- The policy is unchanged and still ownership-only — it was never the gate,
-- the trigger is. Renaming it would break the trail back to audit 06/SEC-03,
-- so the drift is recorded here instead.
comment on policy "void own bets" on public.bets is
  'Ownership check only. Despite the name this now also carries the '
  'pre-kickoff confidence retag (0045); enforce_bet_void_only() decides which '
  'edits are actually permitted.';
