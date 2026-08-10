-- Betting groups: the second kind of group.
--
-- A pick'em group is a *format*: an admin says which games are in play and
-- which markets count, and members make one pick per market against that
-- board. Everything about it lives in `picks`, `group_week_config` and
-- `group_week_games`.
--
-- A betting group is not a format at all. It is a lens over what its members
-- already do: every bet they log from the slate lands on their ledger, and the
-- group's sheet is those ledgers laid side by side on the slate. Whoever gets
-- to a game first is the source; anyone behind them is tailing or fading.
--
-- ## Why this migration is one column
--
-- The obvious design is `bets.group_id` — assign each bet to a betting group
-- at the moment it is logged. That is worse in three ways, and the third is
-- fatal:
--
--   1. It asks a question at the wrong time. Someone tapping an odds cell on
--      the slate is placing a bet, not filing it.
--   2. It cannot express one bet in two groups, which is the normal case for
--      anybody in a work pool and a friends pool.
--   3. It duplicates a fact the ledger already holds. A bet's existence and
--      its owner are enough; group membership is the join. Storing it twice
--      creates a state where the ledger says one thing and the sheet another,
--      and there is no principled way to reconcile them.
--
-- So a bet belongs to a user, full stop, and a group's sheet is derived. The
-- consequence worth stating: origination is *per group*. The same bet can be
-- the source in one group and a tail in another, because a different member
-- got there first. That is correct — "first" is only meaningful inside a
-- crowd, and each group is a different crowd.
--
-- Nothing in `bets` changes. `reason_tag` has carried 'tail' and 'fade' since
-- 0001, which is the shape of this feature showing up in the schema two years
-- before the feature did.

-- ---------------------------------------------------------------------------
-- The kind
-- ---------------------------------------------------------------------------

alter table public.groups
  add column if not exists kind text not null default 'pickem'
  check (kind in ('pickem', 'betting'));

comment on column public.groups.kind is
  'pickem = admin-configured board, members make picks. betting = a lens over '
  'members'' own ledgers; no board, no week config, no picks.';

-- Reading a member's bets for a sheet is "every bet by these users this
-- season", which is exactly the existing (season_id, user_id, placed_at) index
-- — but the classification then groups by game, and a week's sheet asks for a
-- few dozen game ids at once.
create index if not exists bets_game_placed
  on public.bets (game_id, placed_at)
  where voided_at is null;

-- ---------------------------------------------------------------------------
-- create_group learns the kind
--
-- Dropped and recreated rather than replaced: adding a defaulted argument
-- makes a NEW overload, and a two-argument call would then be ambiguous.
-- ---------------------------------------------------------------------------

drop function if exists public.create_group(text, text);

create or replace function public.create_group(
  p_name       text,
  p_visibility text default 'private',
  p_kind       text default 'pickem'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_id   uuid;
  v_base text;
  v_slug text;
  v_code text;
  v_n    integer := 0;
begin
  if v_uid is null then
    raise exception 'Sign in to create a group';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Give the group a name';
  end if;
  if length(btrim(p_name)) > 60 then
    raise exception 'Group names are 60 characters or fewer';
  end if;
  if p_visibility not in ('private', 'public') then
    raise exception 'Bad visibility';
  end if;
  if p_kind not in ('pickem', 'betting') then
    raise exception 'Bad group kind';
  end if;

  v_base := btrim(regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'), '-');
  if v_base = '' then
    v_base := 'group';
  end if;
  v_slug := v_base;
  while exists (select 1 from groups where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from groups where join_code = v_code);
  end loop;

  insert into groups (name, slug, visibility, join_code, created_by, kind)
  values (btrim(p_name), v_slug, p_visibility, v_code, v_uid, p_kind)
  returning id into v_id;

  insert into group_members (group_id, user_id, role)
  values (v_id, v_uid, 'admin');

  return v_id;
end;
$$;

grant execute on function public.create_group(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- A betting group has no board
--
-- The UI never offers these on a betting group, but a server action is not a
-- security boundary (0020's rule) — so the RPCs refuse. Without this, a
-- hand-rolled PostgREST call could hang a pick'em board off a betting group
-- and produce a group that is both, which nothing downstream knows how to
-- read.
-- ---------------------------------------------------------------------------

create or replace function public.group_is_betting(p_group uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from groups g where g.id = p_group and g.kind = 'betting');
$$;

grant execute on function public.group_is_betting(uuid) to authenticated, anon;

-- Triggers rather than a guard clause inside make_pick / set_group_week_config:
-- those live in 0020–0023 and have been amended twice, so adding one line to
-- each means re-emitting two large plpgsql bodies here and keeping the copies
-- in step forever. A trigger states the invariant once, next to the table it
-- protects, and fires no matter which path writes.

create or replace function public.forbid_pickem_on_betting_group()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.group_is_betting(new.group_id) then
    raise exception 'That is a betting group — it has no pick''em board';
  end if;
  return new;
end;
$$;

drop trigger if exists picks_not_on_betting_group on public.picks;
create trigger picks_not_on_betting_group
  before insert or update on public.picks
  for each row execute function public.forbid_pickem_on_betting_group();

drop trigger if exists week_config_not_on_betting_group on public.group_week_config;
create trigger week_config_not_on_betting_group
  before insert or update on public.group_week_config
  for each row execute function public.forbid_pickem_on_betting_group();
