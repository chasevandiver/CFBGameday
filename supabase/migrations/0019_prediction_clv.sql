-- Closing line value on the frozen model predictions.
--
-- The Aug 2026 edge investigation demoted the model's leans from bets to
-- information: flagged edges went 49.2% ATS against a 52.4% break-even, and the
-- encompassing regression put the model at 0.035 (t=0.84) beside the market's
-- 0.987. That left the product with no in-season scoreboard at all — the ATS
-- record was the measure while the leans were bets, and nothing replaced it.
--
-- CLV is the replacement, and it is a better question anyway: not "did the
-- model win" but "did the market move toward the model after it committed".
-- It converges on one season of data where a win rate does not, and it can
-- report a coherent result the ATS column cannot — a losing record with
-- positive CLV, which is roughly what the backtest found.
--
-- Three columns, filled at two different times:
--   open_spread  — the consensus opener, captured by the Thursday freeze job
--                  alongside the line the model was actually priced against
--                  (vegas_spread, already stored).
--   close_spread — the consensus at kickoff, written by the Sunday grader.
--   clv          — signed value of vegas_spread against close_spread, in the
--                  direction of the model's edge. src/lib/clv.ts owns the sign.
--
-- predictions stays append-only for users: `revoke update, delete ... from
-- authenticated, anon` in 0001 already covers these columns, and the grader
-- runs as the service role. The frozen prediction fields are never rewritten —
-- the grader touches close_spread and clv only.

alter table predictions
  add column if not exists open_spread  numeric(5,1),
  add column if not exists close_spread numeric(5,1),
  add column if not exists clv          numeric(5,2);

comment on column predictions.open_spread is
  'Consensus opening spread (home perspective), captured at freeze.';
comment on column predictions.close_spread is
  'Consensus spread at kickoff (home perspective), written by the Sunday grader.';
comment on column predictions.clv is
  'Signed closing line value of vegas_spread vs close_spread, in the direction of edge. Positive = the market moved toward the model. See src/lib/clv.ts.';

-- The grader looks up ungraded frozen rows for a set of finished games. Without
-- this it seq-scans predictions every Sunday, and the table only grows.
create index if not exists predictions_ungraded
  on predictions (game_id)
  where frozen and clv is null;
