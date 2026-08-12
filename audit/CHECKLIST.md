# Audit master checklist — Packages A–C (completed record)

> **Superseded 2026-08-12 as a tracker. → `docs/STATUS.md`.**
>
> This file was the single source of truth for the August 2026 remediation
> program; it is now the **record of what that program shipped**. Every open
> item it carried — the deferred list, the calendar checkpoints, `09:P-16`, and
> the eight deferred Package C items — moved to `docs/STATUS.md` with its reason
> intact, alongside the `KICKOFF_READINESS` P-findings and the open items that
> lived only in the changelog. One list, one place.
>
> Two boxes below are checked that are only **partially** done. They are left
> checked so the record matches what the commit believed, and re-opened under
> new IDs in `docs/STATUS.md` §7:
> - `05:N9` (postponed/canceled → void) — the grader is right, but nothing
>   writes those statuses ⇒ **P1-1**
> - `04:DQ-13` (reject NaN/empty tilt carry) — NaN is caught, `""` silently
>   becomes `0` ⇒ **P2-1**

Packages A–C were the pre-season program (approved Aug 10): buildable then, no
real-2026-game data needed, one PR per package. Each box was checked in the
commit that landed its fix, and every one was independently re-verified against
the code in `audit/KICKOFF_READINESS.md` §7.

---

## Package A — Correctness hardening

- [x] **03:M-1b** Spec-compliant `team_hfa` source: drop non-FBS-opponent games from the home/away margin averages (FCS buy-game inflation at its source), keep the centered blend — `scripts/build-preseason.ts` · S · must merge before the refresh goes green
- [x] **02:M-03** Consensus flag compares like with like: add the game's blended HFA to each `sysMargin` before the sign test in `freezeJob`; "HFA-adjusted" footnote on the game-page Systems table — `scripts/lib/jobs-core.ts` · S
- [x] **05:N4** Grading reads throw on error (snapshots/predictions/picks/bets) + chunk `.in("game_id", …)` at 500 — `scripts/lib/jobs-core.ts:499-560` · S
- [x] **05:N3** Postseason finals grade: grading pass fetches both season types (ratings replay stays regular-only) — `scripts/lib/jobs-core.ts:349-356` · S–M
- [x] **05:N6** TBD kickoff (`start_ts` null) = no close, CLV null (today `closingConsensus` passes through and can bank a post-game snapshot) — `scripts/lib/jobs-core.ts` + test · S
- [x] **05:N9** Rule #4 enforced: picks/bets on postponed/canceled games grade `void` — grading pass + test · S–M
- [x] **02:M-06** Lookahead regression test: perturb week-N scores ⇒ week-N predictions unchanged — `scripts/lib/replay.test.ts` · S
- [x] **07:OPS-12c** `sync-games` upsert never flips `in_progress` → `scheduled` (omit status unless completed) — `scripts/sync-games.ts` · S
- [x] **07:OPS-10** CFBD `get()`: one jittered retry on 429/5xx + 30s timeout — `src/lib/cfbd.ts` · S
- [x] **05:N10** Recap renders 0.00 avg CLV as "CLV PK" (`fmtSpread` misuse on an average) — `src/app/recap/` · S
- [x] **05:N11** Predictions with null edge/vegas_spread still get `close_spread` written so they leave the ungraded partial index — `scripts/lib/jobs-core.ts:523-551` · S
- [x] **SEC-11** `confirmAdjustment`/`removeAdjustment` get an app-level admin check (no silent `ok:true` no-op) — `src/app/actions/adjustments.ts:57-81` · S
- [x] **SEC-14** DB assertions that `predictions`/`line_snapshots` UPDATE/DELETE stay revoked (`has_table_privilege`) — `supabase/tests/` · S

## Package B — Ops & perf before the first Saturday

- [x] **07:OPS-1c** In-repo `watchdog` task: exit 1 when `job_runs` shows refresh-lines silent >26h, or scoreboard silent >90min with a game live/imminent — `scripts/lib/jobs-core.ts` + `jobs.yml` · S
- [x] **07:OPS-9** Weekly `pg_dump` backup job (Sun after grading) → Actions artifact; inert until `SUPABASE_DB_URL` secret exists — `jobs.yml` · M
- [x] **07:OPS-2b** Coverage crons: scoreboard Tue/Wed nights (Nov MACtion) + Sat late window for Hawaii; one Hawaii close pass — `jobs.yml` · S
- [x] **07:OPS-7** Offseason keep-alive against the 60-day Actions auto-disable — `jobs.yml` / workflow · S
- [x] **07:OPS-13/§2** Cron comment fixes: DST-drifted local times; Sat→Sun scoreboard concurrency-seam note — `jobs.yml` · S
- [x] **09:P-2b** One realtime channel per client (SlateView + ScoreTicker share) — `src/lib/use-games-realtime.ts` + callers · S
- [x] **09:P-17** Verify/fix anon realtime (no session ⇒ `setAuth` never called; games are public-read since 0011) — `src/lib/use-games-realtime.ts` · S
- [x] **09:P-3** `latest_systems` view — stop shipping every week's system_ratings per tick (migration 0025) · S
- [x] **09:P-4** `poll_rankings` latest-week view (same migration) · S
- [x] **09:P-5** Game-page `profiles.select("*")` → `id, display_name` — `src/app/game/[id]/page.tsx` · S
- [x] **09:P-15** In-module ~60s cache for the season/week pointer (`fetchCurrentSeasonWeek` feeds every route + ticker) — `src/lib/queries.ts`/`season.ts` · S
- ⟳ **09:P-16** Load rehearsal — **owner-run** (needs a live server; running it from CI would burn real Supabase egress). Harness: seed via `scripts/seed-fixtures.ts`, `autocannon -c 15/-c 30` against `next start`, record vs bars (p95 <1.5s, tick <300 KB) · S · **moved → `docs/STATUS.md`**
- [x] **04:§2** Remaining `--check` gates: partial coach rows, empty portal feed, empty lines file · S
- [x] **04:DQ-13** Reject NaN/empty `PRESEASON_TILT_CARRY` loudly — `scripts/build-preseason.ts` · S
- [x] **04:DQ-14** Reconcile builder `SEASON = 2026` hardcode vs loader `CFB_SEASON` env guard — `scripts/build-preseason.ts` / `load-preseason.ts` · S

## Package C — Launch-week product polish

- [x] **UX-12/F8** OG share images via `next/og` ImageResponse: site-wide + per-game matchup card — `src/app/opengraph-image.tsx`, `src/app/game/[id]/opengraph-image.tsx` · S–M
- [x] **UX-13** `apple-icon.tsx` via ImageResponse (iOS Add-to-Home-Screen tile) · S
- [x] **G6** `/model` page rendering the changelog's Current-state + decisions tables, linked from Receipts · S
- [x] **G12** Ledger CSV export route (own bets + picks; RLS scopes) + link on `/ledger` · S
- ⟳ **G10-v1** Copy-digest ShareButton mode: Thursday (frozen slate/edges/"N haven't picked") + Sunday (results/movers/CLV) — `src/lib/share-text.ts` pattern · S–M — **deferred**: S–M, best paired with the group board's real first Saturday · **moved → `docs/STATUS.md`**
- ⟳ **UX-14** Groups first-run pointer on the slate ("picks: {group}" chip / link to /groups when none) · S — **deferred**: pairs with G10; needs a live active-group cookie flow to test · **moved → `docs/STATUS.md`**
- [x] **UX-23** Human empty-state copy on the slate (drop "data ingestion" engineer-speak) — `SlateView.tsx:499-502` · S
- [x] **UX-29** Team page says "verdict pending" instead of silently omitting the promised block — `team/[id]/page.tsx` · S
- [x] **UX-17** One week range everywhere (settings strip reaches 16+post; align three validators) — `SlateView.tsx:621`, `groups/[slug]/page.tsx:58`, `settings/page.tsx:120` · S
- [x] **UX-19** Login page gets nav / back-to-slate link — `LoginForm.tsx` · S
- [x] **UX-18** Ratings rows link to team pages; `/teams` gets a name filter — `RatingsTable.tsx`, `TeamsGrid.tsx` · S
- ⟳ **F10** "Biggest line move" slate sort toggle — `SlateView.tsx` · S — **deferred**: needs real line-movement data to be meaningful · **moved → `docs/STATUS.md`**
- ⟳ **F13** Returning-production % on team pages (lights up when data lands) — `team/[id]/page.tsx` · S — **deferred**: renders only once returning-production data lands · **moved → `docs/STATUS.md`**
- ⟳ **UX-08** Remaining sub-44px targets: star, pin, BetSlip remove, void link, units input — `GameCard.tsx`, `BetSlip.tsx`, `VoidBetButton.tsx` · S–M — **deferred**: touch-target sweep, S–M, low Saturday-morning impact · **moved → `docs/STATUS.md`**
- [x] **UX-26** Visible focus ring on form inputs/selects (not just a 1px 60%-alpha border tint) — `SlateView.tsx:437,694`, `BetForm.tsx:53`, `BetSlip.tsx:133` · S
- ⟳ **UX-22** MatchupCard push results get icon+colour (not sr-only text) — `MatchupCard.tsx:270-297` · S — **deferred**: MatchupCard push icon, cosmetic · **moved → `docs/STATUS.md`**
- [x] **UX-15** Replace 8 hardcoded `#5b6472` + 1 `#9aa1ad` fallbacks with `var(--push)` — `TeamMark.tsx`, `GameCard.tsx`, `WinProbBar.tsx`, `GameHeader.tsx` · S
- [x] **UX-20** Receipts private `fmtLine` → shared `fmtSpread` · S
- ⟳ **05:N12** Pin one numeric-arrival convention in `records` (drop the false strings-from-PostgREST premise) — `records.test.ts` · S — **deferred**: records string-convention pin, no user-facing effect · **moved → `docs/STATUS.md`**
- [x] **05:N13** ROI column on group standings; ROI denominator stated user-visibly; SPEC §4 rule amended to match code (units primary) · S
- [x] **05:N7** Moneyline CLV in cents from the captured ml consensus (or documented "–" in /rules) · S
- [x] **05:N8** `team_total`/`first_half` marked manual-grade in the ledger instead of open-forever; fix stale comment · S
- ⟳ **SEC-01** Join codes to 10-char base32 + per-user attempt throttle in `join_group` (migration 0026) · S — **deferred**: needs full-function migration to rewrite create_group/regenerate_join_code; ~0 real private groups pre-launch, so brute-force risk is negligible until after launch · **moved → `docs/STATUS.md`**
- [x] **SEC-09** Ledger short-circuits `if (!user)` instead of `.eq("user_id","")` — `ledger/page.tsx:41` · S
- [x] **04:§4** SPEC §5.1 churn claim softened to the defensible version ("priced before the market finishes learning rosters") · S

## Deferred and calendar items → `docs/STATUS.md`

The 47 in-season deferrals and the 12 calendar/human checkpoints that used to be
listed here now live in `docs/STATUS.md` — §4 (queued for after launch), §3
(decisions owed) and §2.5 (the hard dates), each carrying the same ID and the
same stated reason. They were moved rather than copied: keeping two lists of
open work is exactly the drift this consolidation was for.

Two items from those sections shipped before the move and are recorded here:

- [x] **03:M-3** Signed-error-by-slice table in `report()` — shipped 2026-08-12
      (`scripts/lib/slices.ts` + CI job summary), after its absence let a
      +9.8-pt cross-tier lean into the 2026 build
- [x] **G9** Bad-beat / backdoor-cover log — late ATS and total flips caught
      live by the scoreboard poll, logged to `cover_flips` (0026), rendered on
      `/recap/[week]`. **Was mis-filed as "needs real data":** a flip is a
      transition between two polls and nothing records it after the fact, so
      the detector had to exist before kickoff or Week 0–1 was lost permanently.
- [x] **OPS-14b** CFBD tier verified — **Tier 2, 30,000/month, confirmed
      2026-08-12**, matching `scoreboard-loop.ts:28` against ~9–10k of estimated
      monthly use. Volume was never the risk; entitlement was, and
      `npm run probe:cfbd` closed that too.

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
