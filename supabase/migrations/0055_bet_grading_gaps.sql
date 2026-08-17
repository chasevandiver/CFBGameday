-- R2-A4 — grade what the ledger accepts.
--
-- `bets.bet_type` has always admitted team_total, first_half and future
-- (0001's comment enumerates them), but the grader settles only
-- spread/total/moneyline — the rest sat as manual settles. Three additive
-- columns close the gap:
--
--   team_side   the SUBJECT of a team total. `side` on those rows is
--               over/under; which team's total was bet lived only in the
--               free-text description, which is why old rows are not
--               auto-gradable and the grader skips any row with team_side
--               null rather than guessing. Fix-forward only.
--   marked_odds a futures position's manual weekly mark. Auto-marking was
--   marked_at   REJECTED (docs/CHANGELOG.md): neither sanctioned feed module
--               (src/lib/cfbd.ts, src/lib/espn.ts) carries futures odds, so a
--               weekly mark job would fetch nothing and record green runs —
--               the silent-no-op shape PUSH-11 was. The ledger takes a manual
--               mark instead, and nags when an open future goes stale.
--
-- Member writes stay governed by 0013's triggers, not by column grants:
-- `enforce_bet_void_only` is re-created below with marking an open future as
-- the SECOND permitted edit (voiding was the first). The mark path rebuilds
-- `new` from `old` exactly like the void path, so result/clv/payout can never
-- ride along in a mark. `enforce_bet_insert_clean` (0013) is untouched — it
-- nulls only grading fields, so `team_side` set at insert survives.
--
-- Apply-vs-deploy order: apply THIS MIGRATION FIRST (or with the deploy).
-- The old code never reads these columns and the widened trigger accepts
-- every write it makes, so applying early is free — but the R2-A4 grader
-- selects `team_side`, so deploying that code against a database without
-- this migration fails the bets read loudly on the next grade pass.

alter table public.bets
  add column team_side   text check (team_side in ('home', 'away')),
  add column marked_odds numeric,
  add column marked_at   timestamptz;

comment on column public.bets.team_side is
  'team_total only: whose total. Null on legacy rows = not auto-gradable.';
comment on column public.bets.marked_odds is
  'future only: last manual mark, American odds. Display-only — never graded.';

-- The function below is 0045's definition — the retag branch included, which
-- a rewrite from 0013's shape would silently destroy — plus one more
-- permitted transition. Same construction as both predecessors: decide what
-- may change, rebuild the row from OLD, re-apply only that. One edit per
-- statement: an update that moves both the tier and the mark takes the retag
-- branch and the mark is discarded, exactly as a void that tries to move the
-- units is today.

create or replace function public.enforce_bet_void_only()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_voided_at  timestamptz;
  v_confidence text;
  v_kick       timestamptz;
  v_marked_odds numeric;
begin
  -- Grading jobs connect as service_role and keep full write access.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if old.result is not null then
    raise exception 'settled or voided bets cannot be changed';
  end if;

  -- Retag (0045): the tier is one column a user may move on a live bet.
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

  -- Mark (R2-A4): an OPEN future may be marked to market. Clearing the mark
  -- clears its timestamp with it; the trigger stamps marked_at so a client
  -- cannot back-date a mark.
  if new.result is null
     and new.voided_at is null
     and old.bet_type = 'future'
     and new.marked_odds is distinct from old.marked_odds
  then
    v_marked_odds := new.marked_odds;
    new := old;
    new.marked_odds := v_marked_odds;
    new.marked_at := case when v_marked_odds is null then null else now() end;
    return new;
  end if;

  if new.result is distinct from 'void' or new.voided_at is null then
    raise exception 'bets are append-only — the only permitted edits are voiding, retagging and marking a future';
  end if;
  v_voided_at := new.voided_at;
  new := old;
  new.result := 'void';
  new.voided_at := v_voided_at;
  return new;
end;
$$;
