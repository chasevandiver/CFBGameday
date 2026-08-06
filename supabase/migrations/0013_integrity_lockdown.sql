-- Integrity lockdown (audit Aug 2026, bugs #1–#3).
--
-- The product's thesis — unhideable ledger, frozen receipts, line-at-pick — was
-- policy at the row level but not at the column level. Three holes closed here:
--
--   1. profiles: the "update own profile" policy let any member set is_admin
--      on their own row. Column-level grants now limit self-service updates to
--      display_name / favorite_team_ids / timezone.
--   2. bets: the "void own bets" policy let owners update ANY column — result,
--      payout_units, clv, units — and the Sunday grader skips rows whose result
--      is already set, so forged wins stuck. A trigger now permits exactly one
--      user-driven transition: ungraded → voided, with every other column
--      frozen to its old value. Inserts are sanitized so grading fields can't
--      be pre-set. Service-role jobs are unaffected.
--   3. picks: insert/update policies validated ownership and kickoff but not
--      content — line_at_pick and units could be set to any number via direct
--      PostgREST calls, bypassing League Rule #1 (the line snapshots at pick
--      time). Direct writes are revoked; picks now go through a security-definer
--      make_pick() that computes the consensus line server-side. Deletes keep
--      their pre-kickoff policy.

-- ---------------------------------------------------------------------------
-- 1. profiles: no self-service privilege escalation
-- ---------------------------------------------------------------------------

revoke update on table public.profiles from authenticated;
grant update (display_name, favorite_team_ids, timezone)
  on table public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. bets: append-only means append-only
-- ---------------------------------------------------------------------------

create or replace function public.enforce_bet_void_only()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_voided_at timestamptz;
begin
  -- Grading jobs connect as service_role and keep full write access.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if old.result is not null then
    raise exception 'settled or voided bets cannot be changed';
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

drop trigger if exists bets_void_only on public.bets;
create trigger bets_void_only
  before update on public.bets
  for each row execute function public.enforce_bet_void_only();

create or replace function public.enforce_bet_insert_clean()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.result := null;
    new.clv := null;
    new.closing_line := null;
    new.payout_units := null;
    new.voided_at := null;
    new.placed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists bets_insert_clean on public.bets;
create trigger bets_insert_clean
  before insert on public.bets
  for each row execute function public.enforce_bet_insert_clean();

-- ---------------------------------------------------------------------------
-- 3. picks: the line snapshots server-side, or not at all
-- ---------------------------------------------------------------------------

revoke insert, update on table public.picks from authenticated, anon;

create or replace function public.make_pick(p_game_id integer, p_side text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  v_line numeric;
begin
  if auth.uid() is null then
    raise exception 'Sign in to save your picks';
  end if;
  if p_side not in ('home', 'away', 'over', 'under') then
    raise exception 'Bad side';
  end if;

  select id, season_id, start_ts into g from games where id = p_game_id;
  if not found then
    raise exception 'Game not found';
  end if;
  if g.start_ts is null or g.start_ts <= now() then
    raise exception 'Kickoff — picks are locked for this game.';
  end if;

  -- Consensus: latest non-null value per provider, averaged, snapped to the
  -- half point (mirrors src/lib/queries.ts consensusFromSnapshots).
  select round(avg(x.v) * 2) / 2 into v_line
  from (
    select distinct on (provider)
      case when p_side in ('home', 'away') then spread else total end as v
    from line_snapshots
    where game_id = p_game_id
      and (case when p_side in ('home', 'away') then spread else total end) is not null
    order by provider, captured_at desc
  ) x;
  if v_line is null then
    raise exception 'No line posted yet for this game';
  end if;

  insert into picks (season_id, user_id, game_id, side, line_at_pick, units, locked_at)
  values (g.season_id, auth.uid(), p_game_id, p_side, v_line, 1, now())
  on conflict (user_id, game_id) do update
    set side = excluded.side,
        line_at_pick = excluded.line_at_pick,
        locked_at = now();
end;
$$;

revoke execute on function public.make_pick(integer, text) from public, anon;
grant execute on function public.make_pick(integer, text) to authenticated;
