# Audit master checklist

Single source of truth for what remains from the August 2026 audit
(`audit/00`–`10`). Every remaining actionable item, one box each, with its
audit ID, file reference, and effort. **A box is checked in the same commit
that lands the fix** — the file is truthful at every commit. Any session can
resume the program by reading this file alone.

Packages A–C are the pre-season program (approved Aug 10): buildable now, no
real-2026-game data needed, one PR per package. Deferred and Calendar sections
explain themselves.

---

## Package A — Correctness hardening

- [ ] **03:M-1b** Spec-compliant `team_hfa` source: drop non-FBS-opponent games from the home/away margin averages (FCS buy-game inflation at its source), keep the centered blend — `scripts/build-preseason.ts` · S · must merge before the refresh goes green
- [ ] **02:M-03** Consensus flag compares like with like: add the game's blended HFA to each `sysMargin` before the sign test in `freezeJob`; "HFA-adjusted" footnote on the game-page Systems table — `scripts/lib/jobs-core.ts` · S
- [ ] **05:N4** Grading reads throw on error (snapshots/predictions/picks/bets) + chunk `.in("game_id", …)` at 500 — `scripts/lib/jobs-core.ts:499-560` · S
- [ ] **05:N3** Postseason finals grade: grading pass fetches both season types (ratings replay stays regular-only) — `scripts/lib/jobs-core.ts:349-356` · S–M
- [ ] **05:N6** TBD kickoff (`start_ts` null) = no close, CLV null (today `closingConsensus` passes through and can bank a post-game snapshot) — `scripts/lib/jobs-core.ts` + test · S
- [ ] **05:N9** Rule #4 enforced: picks/bets on postponed/canceled games grade `void` — grading pass + test · S–M
- [ ] **02:M-06** Lookahead regression test: perturb week-N scores ⇒ week-N predictions unchanged — `scripts/lib/replay.test.ts` · S
- [ ] **07:OPS-12c** `sync-games` upsert never flips `in_progress` → `scheduled` (omit status unless completed) — `scripts/sync-games.ts` · S
- [ ] **07:OPS-10** CFBD `get()`: one jittered retry on 429/5xx + 30s timeout — `src/lib/cfbd.ts` · S
- [ ] **05:N10** Recap renders 0.00 avg CLV as "CLV PK" (`fmtSpread` misuse on an average) — `src/app/recap/` · S
- [ ] **05:N11** Predictions with null edge/vegas_spread still get `close_spread` written so they leave the ungraded partial index — `scripts/lib/jobs-core.ts:523-551` · S
- [ ] **SEC-11** `confirmAdjustment`/`removeAdjustment` get an app-level admin check (no silent `ok:true` no-op) — `src/app/actions/adjustments.ts:57-81` · S
- [ ] **SEC-14** DB assertions that `predictions`/`line_snapshots` UPDATE/DELETE stay revoked (`has_table_privilege`) — `supabase/tests/` · S

## Package B — Ops & perf before the first Saturday

- [ ] **07:OPS-1c** In-repo `watchdog` task: exit 1 when `job_runs` shows refresh-lines silent >26h, or scoreboard silent >90min with a game live/imminent — `scripts/lib/jobs-core.ts` + `jobs.yml` · S
- [ ] **07:OPS-9** Weekly `pg_dump` backup job (Sun after grading) → Actions artifact; inert until `SUPABASE_DB_URL` secret exists — `jobs.yml` · M
- [ ] **07:OPS-2b** Coverage crons: scoreboard Tue/Wed nights (Nov MACtion) + Sat late window for Hawaii; one Hawaii close pass — `jobs.yml` · S
- [ ] **07:OPS-7** Offseason keep-alive against the 60-day Actions auto-disable — `jobs.yml` / workflow · S
- [ ] **07:OPS-13/§2** Cron comment fixes: DST-drifted local times; Sat→Sun scoreboard concurrency-seam note — `jobs.yml` · S
- [ ] **09:P-2b** One realtime channel per client (SlateView + ScoreTicker share) — `src/lib/use-games-realtime.ts` + callers · S
- [ ] **09:P-17** Verify/fix anon realtime (no session ⇒ `setAuth` never called; games are public-read since 0011) — `src/lib/use-games-realtime.ts` · S
- [ ] **09:P-3** `latest_systems` view — stop shipping every week's system_ratings per tick (migration 0025) · S
- [ ] **09:P-4** `poll_rankings` latest-week view (same migration) · S
- [ ] **09:P-5** Game-page `profiles.select("*")` → `id, display_name` — `src/app/game/[id]/page.tsx` · S
- [ ] **09:P-15** In-module ~60s cache for the season/week pointer (`fetchCurrentSeasonWeek` feeds every route + ticker) — `src/lib/queries.ts`/`season.ts` · S
- [ ] **09:P-16** Load rehearsal on synthetic seed (~60 games, ~15k snapshots): `/api/slate` size + TTFB, `autocannon -c 15/-c 30`; record numbers vs bars (p95 <1.5s, tick <300 KB) in the changelog · S
- [ ] **04:§2** Remaining `--check` gates: partial coach rows, empty portal feed, empty lines file · S
- [ ] **04:DQ-13** Reject NaN/empty `PRESEASON_TILT_CARRY` loudly — `scripts/build-preseason.ts` · S
- [ ] **04:DQ-14** Reconcile builder `SEASON = 2026` hardcode vs loader `CFB_SEASON` env guard — `scripts/build-preseason.ts` / `load-preseason.ts` · S

## Package C — Launch-week product polish

- [ ] **UX-12/F8** OG share images via `next/og` ImageResponse: site-wide + per-game matchup card — `src/app/opengraph-image.tsx`, `src/app/game/[id]/opengraph-image.tsx` · S–M
- [ ] **UX-13** `apple-icon.tsx` via ImageResponse (iOS Add-to-Home-Screen tile) · S
- [ ] **G6** `/model` page rendering the changelog's Current-state + decisions tables, linked from Receipts · S
- [ ] **G12** Ledger CSV export route (own bets + picks; RLS scopes) + link on `/ledger` · S
- [ ] **G10-v1** Copy-digest ShareButton mode: Thursday (frozen slate/edges/"N haven't picked") + Sunday (results/movers/CLV) — `src/lib/share-text.ts` pattern · S–M
- [ ] **UX-14** Groups first-run pointer on the slate ("picks: {group}" chip / link to /groups when none) · S
- [ ] **UX-23** Human empty-state copy on the slate (drop "data ingestion" engineer-speak) — `SlateView.tsx:499-502` · S
- [ ] **UX-29** Team page says "verdict pending" instead of silently omitting the promised block — `team/[id]/page.tsx` · S
- [ ] **UX-17** One week range everywhere (settings strip reaches 16+post; align three validators) — `SlateView.tsx:621`, `groups/[slug]/page.tsx:58`, `settings/page.tsx:120` · S
- [ ] **UX-19** Login page gets nav / back-to-slate link — `LoginForm.tsx` · S
- [ ] **UX-18** Ratings rows link to team pages; `/teams` gets a name filter — `RatingsTable.tsx`, `TeamsGrid.tsx` · S
- [ ] **F10** "Biggest line move" slate sort toggle — `SlateView.tsx` · S
- [ ] **F13** Returning-production % on team pages (lights up when data lands) — `team/[id]/page.tsx` · S
- [ ] **UX-08** Remaining sub-44px targets: star, pin, BetSlip remove, void link, units input — `GameCard.tsx`, `BetSlip.tsx`, `VoidBetButton.tsx` · S–M
- [ ] **UX-26** Visible focus ring on form inputs/selects (not just a 1px 60%-alpha border tint) — `SlateView.tsx:437,694`, `BetForm.tsx:53`, `BetSlip.tsx:133` · S
- [ ] **UX-22** MatchupCard push results get icon+colour (not sr-only text) — `MatchupCard.tsx:270-297` · S
- [ ] **UX-15** Replace 8 hardcoded `#5b6472` + 1 `#9aa1ad` fallbacks with `var(--push)` — `TeamMark.tsx`, `GameCard.tsx`, `WinProbBar.tsx`, `GameHeader.tsx` · S
- [ ] **UX-20** Receipts private `fmtLine` → shared `fmtSpread` · S
- [ ] **05:N12** Pin one numeric-arrival convention in `records` (drop the false strings-from-PostgREST premise) — `records.test.ts` · S
- [ ] **05:N13** ROI column on group standings; ROI denominator stated user-visibly; SPEC §4 rule amended to match code (units primary) · S
- [ ] **05:N7** Moneyline CLV in cents from the captured ml consensus (or documented "–" in /rules) · S
- [ ] **05:N8** `team_total`/`first_half` marked manual-grade in the ledger instead of open-forever; fix stale comment · S
- [ ] **SEC-01** Join codes to 10-char base32 + per-user attempt throttle in `join_group` (migration 0026) · S
- [ ] **SEC-09** Ledger short-circuits `if (!user)` instead of `.eq("user_id","")` — `ledger/page.tsx:41` · S
- [ ] **04:§4** SPEC §5.1 churn claim softened to the defensible version ("priced before the market finishes learning rosters") · S

## Deferred — in-season (reason noted)

- [ ] **02:M-04** `--production-chain` replay mode (measure backtest↔production prior drift) — M, tuner/CI-key work; first in-season week
- [ ] **02:M-05/03-M-1v** Team-HFA replay validation with pre-registered rule (else set blend 0) — M, tuner work
- [ ] **03:M-3** Signed-error-by-slice table in `report()` — S–M, needs backtest run
- [ ] **02:M-13/03:M-4** Real per-team tempo + `--tune-tempo` — M, tuner work
- [ ] **03:M-6/M-7/M-8b/M-9a** Decay-knot grid, heteroscedastic σ, smooth cap, rest/travel tuner — S each, tuner work
- [ ] **02:§2b** Promote `warnIfTooGood`/negative-coefficient checks to CI-failing assertions — S–M, backtest CI
- [ ] **07:OPS-8b** Scheduled Sunday calibration report run — M, needs season data flowing
- [ ] **03:M-5** Opener-relative CLV aggregate on Receipts (+1.0 / n≥200 pre-registered) — S code now, meaningful with in-season data
- [ ] **02:M-07/03:M-9b** "incl. adj" display beside adjusted spreads + admin warning that spec magnitudes are unvalidated — S
- [ ] **02:M-08** In-sample caveat line on Receipts explainer — S
- [ ] **02:M-09/M-10/M-11/M-12** Dead-code cleanup: fcs params, `updateFromResult`, `suggestedStake`, stale replay comment — S
- [ ] **04:DQ-5** Rename/drop `returning_prod_def` column storing an offense metric — S, schema churn during launch not worth it
- [ ] **04:DQ-6** `qbReturns` from roster facts instead of passing-PPA proxy — M, player-level data
- [ ] **04:DQ-11** Real `turnoverMargin` for the luck rule — S/M, CFBD data
- [ ] **04:DQ-12** Portal scoring from `rating` (S) then production/snaps (M) + changelog decision row
- [ ] **04:DQ-15** `cached()` shouldn't persist empty CFBD responses — S, local-dev only
- [ ] **05:C5/07:OPS-11/SEC-12** Delete the dead edge function (inverted CLV, baked secrets) — S, deliberate tombstone decision
- [ ] **07:OPS-6** Backfill mode for null-CLV rows (post-kickoff `captured_at` excluded forever) — S–M, only matters after a missed close
- [ ] **07:OPS-14a** Meter unmetered CFBD calls (CI/backtest/preseason paths) — S
- [ ] **07:OPS-18** App-token PRs trigger no CI — process fix — S
- [ ] **09:P-1b** Slim `/api/slate-live` heal endpoint — M, decide after P-16 numbers
- [ ] **09:P-11** Cacheable weekly-static pages — M
- [ ] **09:P-6** `fetchTeamAtsSeason` snapshot re-fetch per game view — M
- [ ] **09:P-9/P-10/P-12/P-13** Blind-count aggregate RPC; board picks-query collapse; ratings latest-in-Postgres; receipts pagination — S–M each
- [ ] **G5** Prediction attribution ("why this number") — M, freeze the decomposition; design the column set before first retune
- [ ] **G7/G8/G9/G11** Crew disagreement roll-up; fade-the-crew; bad-beat log; pick nudge — need real picks/games data
- [ ] **G13/F18** Season archive + `SEASON` rollover — offseason
- [ ] **F3** Injury/news LLM scan producer — M–L
- [ ] **F4/F5/F6** Rooting guide; playoff race tracker; homepage-by-day — M each
- [ ] **F7** Futures mark-to-market — M
- [ ] **F9** Ratings sparklines — needs weekly rating history
- [ ] **F11** §5.1 soft-market taxonomy content on /edges — editorial
- [ ] **F12** Preseason team pages freeze at Week-1 kickoff — M, revisit before Week 1 if time
- [ ] **F16** Systems side-by-side on slate cards (game page has it) — S–M
- [ ] **F-§3/F-§6** Team-page LLM depth; tale of the tape — L / needs season stats
- [ ] **UX-06 (residue)** Remaining sub-4.5 tokens: light `chalk/50–55` table headers, dark `/35–/45` decorative labels, edge-on-card — S–M, needs a rendered pass
- [ ] **UX-21** Ledger "today" keyed to CT for non-CT bettors — S
- [ ] **UX-24** Week page passes raw string `line_at_pick` into `pickSideLabel` ("0" ≠ "PK") — S
- [ ] **UX-25** `profiles.timezone` surfaced on /me and used server-side — S–M
- [ ] **UX-27/UX-28** error.tsx without nav; standings name truncation at 375px — S
- [ ] **UX-31** Week changes via `pushState` so Back traverses weeks — S
- [ ] **UX-33** Whether /edges keeps a permanent bottom-nav slot post-demotion — owner call
- [ ] **SEC-02** Removed admin rejoins as admin; removal not durable — S
- [ ] **SEC-08** `profiles` world-readable incl. `is_admin` — S
- [ ] **SEC-10** Drop dead 0018 pick policies — S
- [ ] **07:OPS-16** Snapshot coarsening job — 2027, explicitly not now

## Calendar / human — cannot be coded

- [ ] **04:DQ-1/F1 — Aug 26 checkpoint**: `preseason-refresh` green? If not: deliberate stale-talent build vs launch on 2026.2.0 with a note (refresh goes red on its own from Aug 20)
- [ ] **04:§5** Run the 7 preseason smell tests on the first real `--top 40` table before/at load
- [ ] **F2** Add `ANTHROPIC_API_KEY` secret + dispatch `verdicts` once (questions then runs Fridays)
- [ ] **OPS-1b** Dispatch one deliberately-failing run; confirm who receives the failure email
- [ ] **OPS-14b** Verify the real CFBD tier matches the hardcoded 30,000 budget
- [ ] **09:§3** Re-verify current Supabase free-tier limits against the pricing page
- [ ] **SEC-13** Decide TBD-kickoff pick policy (null `start_ts` = un-pickable + blind-hidden today) before Aug 29
- [ ] **UX-32** Eyeball the matchup cards with real names on the first real Saturday
- [ ] Optional: healthchecks.io project + `HEALTHCHECK_PING_URL` secret (ping already wired); `SUPABASE_DB_URL` secret to arm the backup job (Package B)
- [ ] **F17** Supervised watch of the first freeze→grade→CLV run (Sun Aug 30)
- [ ] Light-mode phone pass over the slate (contrast changes are computed, not eyeballed)

<details>
<summary><strong>Done — shipped in PRs #19–#21 (Aug 10)</strong></summary>

- [x] **UX-01/A1 (P0)** Bet slip/form `line_taken` home-perspective at write; displays via `lineForSide`; round-trip test
- [x] **05:N1/C1** `snapToHalf` ties away from zero, matching Postgres `round()`
- [x] **09:P-1** Dead `spreadHistory` week-wide snapshot fetch removed (~1 MB/tick)
- [x] **09:P-2** `scoreboardPatch` no-op-aware writes (finals stop re-broadcasting)
- [x] **05:N2 + cadence** Minimal line schedule: 2×/day + close pass per wave incl. Thu/Fri
- [x] **05:N5/G4** `closingConsensus` stale-close guard (>6h ⇒ CLV null) + Receipts note
- [x] **02:M-01** Edges "Model lean" away-sign fix (`lineForSide`)
- [x] **02:M-02** Systems table market-convention fix
- [x] **08:UX-02/03** Crew list + pick chip via `pickSideLabel`
- [x] **03:M-2** Cover-prob stat removed from /edges
- [x] **03:M-1 (fix half)** `centeredBlendedHfa`, model 2026.4.1
- [x] **04:DQ-2** `--check` fails on partial talent file; counts printed
- [x] **07:OPS-4** Loud refresh decline from Aug 20
- [x] **07:OPS-1 (core)** `job_runs` + `recordJobRun` + admin freshness card + dead-man ping step
- [x] **07:OPS-3/G2** `line_consensus.as_of` + "lines as of" stamps (slate, game page)
- [x] **07:OPS-2** Sun/Mon scoreboard crons
- [x] **G1** Disclaimer footer (1-800-GAMBLER)
- [x] **Freeze** Per-game horizon + already-frozen skip (`freezableGames`) — merged Week 0/1 double-stamp prevented
- [x] **SEC-03** `bets.sql` + `profiles.sql` DB regression nets (19 assertions)
- [x] **UX-04** tz labels on groups/matchups/settings/bet form
- [x] **UX-05** Groups week prev/next navigation
- [x] **UX-09** Staleness cue visible on phones
- [x] **UX-10** PickButtons 44px + per-button in-flight state (mid-flight test)
- [x] **UX-06 (main)** Light-mode `text-accent`/`text-win`/`text-loss` mixes + two label alphas (ratios computed)
- [x] **UX-11** /rules Rule 3 matches the per-group blind
- [x] **04:DQ-3** Conference-mean talent fallback
- [x] **H3** Verified live: Aug 29–30 slate stored `week = 1` — reachable
- [x] Migration 0024 applied to the live project

</details>
