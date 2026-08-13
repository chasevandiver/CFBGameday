-- `preseason_components.returning_prod_def` never held a defensive metric
-- (04:DQ-5).
--
-- It is fed from `build-preseason.ts:375` — `retDef: ret?.usage ?? null` —
-- and CFBD's returning-production endpoint has no defensive counterpart at all:
-- `usage`, `passingUsage`, `rushingUsage` and `receivingUsage` are every one of
-- them offensive usage shares (`src/lib/cfbd.ts:161`). So the column is a
-- second offense number sitting under a name that says otherwise.
--
-- The consequence this had on the model was already found and fixed elsewhere.
-- `backtest.ts:1556` records it: "The 'defense' input was a second offense
-- metric, so the effective weight was ~10 on one correlated quantity rather
-- than 5+5 on two independent ones — and it saturated the ±6 clamp for four of
-- the top 40 teams in the 2026 build." What was left is the name, which is what
-- would send the next reader back down the same path.
--
-- Cheaper than the tracked row assumed ("schema churn during launch isn't worth
-- it"): the column has **zero** readers. Nothing in `src/` selects it, the
-- churn term the model actually uses is computed from `percentPPA` rather than
-- from these columns, and `retDef` is write-only in the builder. One rename,
-- one line of TypeScript, no backfill, no data movement — the stored numbers
-- are correct and stay exactly as they are. Only the label was wrong.
--
-- `returning_prod_off` keeps its name: it is fed from `retOverall` and is
-- genuinely the overall returning-production figure.
alter table public.preseason_components
  rename column returning_prod_def to returning_prod_usage;

comment on column public.preseason_components.returning_prod_usage is
  'CFBD returning-production `usage` — an offensive usage share, not a '
  'defensive metric. Recorded for the audit trail; the model reads percentPPA '
  'instead (04:DQ-5).';
