-- The "Why" tag stops being asked for (LEDGER-1).
--
-- Owner, 2026-08-14: "Do we need the Why question on bets? I think it's only
-- useful for tails or fades, but that should be automatic if betting with or
-- against people in your betting groups."
--
-- That reading is right, and the automatic half already exists. `bets.reason_tag`
-- has carried eight values since 0001:233 — model_edge, travel_rest, weather,
-- revenge, qb_news, feel, **tail**, **fade** — and `src/lib/tailing.ts` derives
-- the last two from the one fact nobody has to be asked for: who got their
-- money down first on that game and market. Its own docblock argues the point
-- better than this one can — a stored pointer "would only be set on the ones
-- who used the Tail button, which would make the stats a measure of button
-- usage rather than of who is worth following."
--
-- So the required picker comes out of the bet slip and the bet form, and the
-- ledger's reason-tag audit is rebuilt on the derived relation.
--
-- ---------------------------------------------------------------------------
-- Why the column stays
--
-- Dropping it would be tidier and is wrong twice over. Existing rows carry real
-- values that were true when they were entered, and `ledger/export/route.ts`
-- ships `reason_tag` in the CSV — deleting the column would silently change an
-- export people may already have downloaded copies of. Append-only applies to
-- history as much as to rows.
--
-- The CHECK constraint stays too, and needs no change: a CHECK passes on NULL
-- by definition, so it keeps constraining the values that ARE written while
-- permitting the absence the app now produces.
alter table public.bets alter column reason_tag drop not null;

comment on column public.bets.reason_tag is
  'Legacy self-reported reason (0001). Written until 2026-08-14, nullable since '
  'LEDGER-1; new bets leave it null and the ledger reads tail/fade from '
  'src/lib/tailing.ts instead. Retained for history and for the CSV export.';
