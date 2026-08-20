-- MIG-1 — filed after the fact. THIS IS ALREADY APPLIED.
--
-- Applied to the live project on 2026-08-19 as `20260819034059`, one minute
-- after 0074, and never committed. Found on 2026-08-20 by counting the
-- migration directory against `schema_migrations` while verifying 0076's
-- apply: 74 files, 75 recorded rows, and this was the row with no file.
--
-- The body below is **verbatim** from `schema_migrations.statements` for that
-- version, so the repo cannot drift from what production actually ran. Nothing
-- has re-created `line_consensus` since (0075 adds a table, 0076 touches two
-- rows in `job_runs`), which is what makes copying it forward safe.
--
-- ## Why this is filed as its own migration rather than folded into 0074
--
-- 0074 ran as written, and the ledger should keep saying so. Editing it would
-- make the repo describe an apply that never happened, and the defect this
-- corrects — a row-level filter where the rule is per-market — is only legible
-- as a correction if the thing it corrects is still there to read.
--
-- ## Why the number is out of order
--
-- It is 0077 and it was applied before 0075 and 0076. Both orderings are
-- correct for what reads them: Supabase replays by the timestamp it recorded
-- (this one sorts where it actually ran), and a rebuild from this directory
-- replays by filename, where all that matters is that it lands after 0074 —
-- it does. Nothing between them touches this view.
--
-- ## Do not re-apply
--
-- `create or replace view` is idempotent, so running it again is harmless
-- rather than destructive; it is simply already the live definition.
--
-- ## What the rule is
--
-- Below, verbatim:

-- DQ-15, corrected: the rule is PER MARKET.
-- Row-level filtering dropped the aggregate whenever any book was present, even
-- one quoting a different market — three archive games where consensus posts a
-- spread and no total, while teamrankings/numberfire post a total and no
-- spread, lost the only spread they had. See
-- supabase/migrations/0074_consensus_excludes_aggregates.sql.

create or replace view public.line_consensus
with (security_invoker = true) as
select
  t.game_id,
  round(avg(t.spread)      filter (where t.is_book or t.books_spread      = 0) * 2) / 2 as spread,
  round(avg(coalesce(t.spread_open, t.spread))
                           filter (where t.is_book or t.books_spread_open = 0) * 2) / 2 as spread_open,
  round(avg(t.total)       filter (where t.is_book or t.books_total       = 0) * 2) / 2 as total,
  round(avg(coalesce(t.total_open, t.total))
                           filter (where t.is_book or t.books_total_open  = 0) * 2) / 2 as total_open,
  round(avg(t.ml_home)     filter (where t.is_book or t.books_ml_home     = 0))         as ml_home,
  round(avg(t.ml_away)     filter (where t.is_book or t.books_ml_away     = 0))         as ml_away,
  max(t.captured_at)                                                                    as as_of
from (
  select
    d.*,
    d.provider <> all (array['consensus']) as is_book,
    count(*) filter (where d.provider <> all (array['consensus']) and d.spread is not null)
      over (partition by d.game_id) as books_spread,
    count(*) filter (where d.provider <> all (array['consensus']) and coalesce(d.spread_open, d.spread) is not null)
      over (partition by d.game_id) as books_spread_open,
    count(*) filter (where d.provider <> all (array['consensus']) and d.total is not null)
      over (partition by d.game_id) as books_total,
    count(*) filter (where d.provider <> all (array['consensus']) and coalesce(d.total_open, d.total) is not null)
      over (partition by d.game_id) as books_total_open,
    count(*) filter (where d.provider <> all (array['consensus']) and d.ml_home is not null)
      over (partition by d.game_id) as books_ml_home,
    count(*) filter (where d.provider <> all (array['consensus']) and d.ml_away is not null)
      over (partition by d.game_id) as books_ml_away
  from (
    select distinct on (game_id, provider)
      game_id, provider, spread, spread_open, total, total_open, ml_home, ml_away, captured_at
    from public.line_snapshots
    order by game_id, provider, captured_at desc
  ) d
) t
group by t.game_id;

grant select on public.line_consensus to anon, authenticated;
