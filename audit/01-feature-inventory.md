# 01 — Feature Inventory (docs/SPEC.md walked section by section)

**Audit date 2026-08-09 · 20 days to Week 0 (Aug 29).** Verified against `main` at
`327e74c`, not against the requester's early-August snapshot — many of that
prompt's hypotheses were true and have since been fixed (see Status column).

**Summary.** Phase 1 is substantially built, and much of Phase 2 shipped early.
Every scheduled job the spec's §8 table demands exists and is on a live cron in
`.github/workflows/jobs.yml` (GitHub Actions, a deliberate divergence from the
spec's pg_cron — the edge-function path is dead by choice and still carries an
inverted CLV formula as documented). Grading, CLV, the freeze, weather, the
scoreboard loop, the calibration surface, League Rules, the reason-tag audit,
the units curve, watchability, kickoff-slot groupings, PWA manifest, rankings,
standings, recap, and a full groups/pools layer (beyond spec) are all real and
wired end to end. What is genuinely missing from the spec: the injury/news LLM
scan (admin manual path exists), the rooting guide, the playoff race tracker,
homepage-by-day, the futures mark-to-market, ratings sparklines, the §5.1
soft-market taxonomy content, team-page LLM depth (starters/trenches/QB — the
spec's own designated slip item), preseason-page freeze-at-kickoff, and OG share
images. The one ship-critical risk is not a feature at all: **production serves
2026.2.0 ratings** while the code is 2026.4.0, waiting on the automated
`preseason-refresh` job and CFBD's 2026 talent publish.

---

## Findings table

| ID | Severity | Type | Status | One-line | Evidence |
|---|---|---|---|---|---|
| F1 | **P0 SHIP-BLOCKER (conditional)** | ops | STILL OPEN (self-resolving) | Production `ratings` are 2026.2.0; tilt carry, churn fix, HFA 3.0 all dark until `preseason-refresh` loads — automated daily, but gated on CFBD publishing 2026 talent; needs a human look if still red ~Aug 26 | `.github/workflows/jobs.yml:90,155-166`; `docs/CHANGELOG.md` "Open items" |
| F2 | P1 | spec-div (content) | NEW | LLM Verdict generation is **dispatch-only, never scheduled** — the one-time August batch (spec §3 LLM tier) must be manually fired (and needs `ANTHROPIC_API_KEY` secret) or team pages ship without Verdicts | `jobs.yml:33,167-174`; `scripts/generate-verdicts.ts:1-10` |
| F3 | P2 | spec-div | STILL OPEN | Injury/news LLM scan (spec §4, §8 "Daily 7am") does not exist — no script writes `rating_adjustments` with an unconfirmed/LLM source; the confirm UI waits on a producer that was never built. Manual admin adjustments cover the QB-out case | only writer is `src/app/actions/adjustments.ts:41-50` (manual, pre-confirmed); consumer works: `scripts/lib/jobs-core.ts:676-679,705-711,747` |
| F4 | P2 | spec-div | STILL OPEN | Rooting guide (§4) missing — favorites exist (`/me`, server-side `favorite_team_ids`, slate pinning) but no "what needs to happen this week" surface | `src/app/me/page.tsx:12-13`; no route or component references rooting |
| F5 | P2 | spec-div | STILL OPEN | Playoff race tracker (§4) missing — `/rankings` shows the CFP committee poll with model dissent and `/standings` exists, but no scenarios or bowl projections | `src/app/rankings/page.tsx:12,95-99`; `src/app/standings/page.tsx` |
| F6 | P3 | spec-div | STILL OPEN | Homepage-by-day (§7 Mon results / Wed lines / Sat slate) never built — `/` always redirects to `/slate` | `src/app/page.tsx:3-5` |
| F7 | P3 | spec-div | STILL OPEN (acknowledged #40) | Futures tracker (§5.3) — `future` is an accepted `bet_type` but there is no mark-to-market, and the Sunday grader never touches futures (manual grading is a documented gap) | `src/components/BetForm.tsx:13`; `src/app/ledger/page.tsx:113-118`; `jobs-core.ts:563-582` grades spread/total/moneyline only |
| F8 | P3 | spec-div | STILL OPEN (acknowledged #46) | No OG share images — `generateMetadata` exists, but zero `opengraph-image` routes; shared links get text-only cards | `find src/app -name "opengraph-image*"` → empty; `src/app/layout.tsx:23,31` |
| F9 | P3 | spec-div | STILL OPEN | Ratings-page sparklines (§7 "Ratings UX: … sparklines") missing; movement arrows only | `src/components/RatingsTable.tsx:59,198-203` |
| F10 | P3 | spec-div | NEW | §7 sort toggles: watchability/edge sorts exist but no "biggest line move" sort — movement is per-card display only | `src/components/slate/SlateView.tsx:25-32` (SORTS: kickoff/watch/spread-big/spread-close/total/edge) |
| F11 | P3 | spec-div | STILL OPEN | §5.1 soft-market taxonomy ("permanent Edges page" brain: G5, MACtion, September rosters, backup QBs) — `/edges` is a clean flagged list with the honest 49.2% framing, but none of the taxonomy content | `src/app/edges/page.tsx:20-28,55-67` |
| F12 | P3 | spec-div | STILL OPEN | Preseason team pages do not freeze at Week-1 kickoff (§3 "freeze … receipts!"); page renders live ratings + stored preseason components, no frozen copy | `src/app/team/[id]/page.tsx:72-89,150-180` |
| F13 | P3 | spec-div | NEW | §3 item 4 (returning production % with FBS percentile) not on the team page — churn appears only as a single component number with a hint | `src/app/team/[id]/page.tsx:249` |
| F14 | P2 | spec-div (deliberate, evidence-backed) | FIXED-verified (as divergence) | §5.4 ¼-Kelly stake **removed on evidence**, not missed: `--diagnose-edges` found model b₁=0.035 (t=0.84) vs market 0.987 (t=22.81), flagged edges 49.2% ATS (n=1801, breakeven 52.4%); `stakeForPrediction` → `modelSideOf`, edges relabeled "information, not recommendations" on-page | `docs/CHANGELOG.md` decisions table; `src/app/edges/page.tsx:20-27,56-59,62-67`; `src/lib/slate.ts` `modelSideOf` |
| F15 | P3 | spec-div (deliberate) | FIXED-verified | §8 scheduler is GitHub Actions, not pg_cron; `supabase/functions/jobs/index.ts` is dead, undeployed, and knowingly retains the inverted-CLV formula | `jobs.yml:1-6`; changelog Aug 7 CLV entry |
| F16 | P3 | spec-div | NEW | §2.4 "all four systems side by side **on every game card**" — implemented on the game detail page, not on slate cards; the freeze does pass real SP+/FPI/Elo margins into the consensus flag | `src/app/game/[id]/page.tsx:145-151,248-258`; `jobs-core.ts:713-761` |
| F17 | P2 | design | NEW | Receipts, Edges, and the group leaderboards are all **BUILT but data-empty until the first freeze (Thu Aug 27/Sep 3) and first grading (Sun)** — the launch-day product shows several correctly-explained empty states; unavoidable, but worth knowing before demoing | `src/app/receipts/page.tsx:178-181`; `src/app/edges/page.tsx:69-76`; changelog "CLV has no data yet" |
| F18 | P3 | bug (latent) | STILL OPEN (documented) | `build-preseason.ts` still hardcodes `SEASON = 2026` (checklist #36 partial) — a 2027 problem, not an Aug 29 one | `audit/AUDIT-2026-08.md` #36; `scripts/build-preseason.ts:60` |
| F19 | P3 | spec-div | STILL OPEN (Phase 2/3, correctly deferred) | Derivative pricing (§5.2), Odds API splits (§5.5), PWA push (§ Phase 3), bowl opt-outs/portal mode (§9) — all SPEC-ONLY by phase | spec §10 |

Stale-prompt hypotheses resolved: Teams/Receipts "stub tabs" — **NEVER TRUE
NOW** (both are full pages; nav has no `ready` flag, `src/components/nav-items.ts:20-33`).
"No grading job / no CLV" — **FIXED** (see below). "Crew leaderboard without a
data source" — **FIXED**; `/crew` is now a redirect into groups
(`src/app/crew/page.tsx:13-24`) and group leaderboards tally graded picks.
"Slate locked to current week" — **NEVER TRUE NOW** (`?week=` 1–20 + `?st=post`,
`src/app/slate/page.tsx:23-37`; selector renders Weeks 1–16 + "Bowls & CFP",
`SlateView.tsx:615-627`).

---

## Spec walk — feature inventory

Status legend: **BUILT** (works end to end) / **PARTIAL** (UI without data, or
data without UI) / **STUBBED** / **MISSING** / **SPEC-ONLY** (Phase 2/3,
correctly deferred). "Dark-until-refresh" = built and correct, but production
ratings are 2026.2.0 so the surface hides or under-reports itself (F1).

### §1 Data sources

| Spec § | Feature | Status | Evidence | Notes |
|---|---|---|---|---|
| §1 | CFBD client, jobs-only fetch path | BUILT | `src/lib/cfbd.ts`; all writes via `scripts/` + `jobs.yml` | Call metering into `api_call_log` (`jobs-core.ts:67-76`); scoreboard loop budgets itself (`scoreboard-loop.ts:1-29`) |
| §1 | LLM layer — Three Questions | BUILT | `scripts/generate-questions.ts`; cron Fri 09:00 UTC `jobs.yml:77,124`; rendered `game/[id]/page.tsx` | Green no-op until `ANTHROPIC_API_KEY` secret exists — verify the secret is set |
| §1 | LLM layer — team Verdicts | PARTIAL | `scripts/generate-verdicts.ts`; dispatch-only `jobs.yml:33`; rendered `team/[id]/page.tsx:261-276` | Code + UI complete; **the batch has to be fired by hand** (F2) |
| §1 | LLM layer — injury/news scan | MISSING | no producer anywhere in `scripts/` | F3 |
| §1 | Weather (Open-Meteo, manual coord fallback) | BUILT | `jobs-core.ts:252-317` writes `weather_forecasts`; `venue_coord_overrides` honored (`:265-280`); cron Sat 10:00 UTC `jobs.yml:70,121`; rendered `game/[id]/page.tsx:625-646` with the >15mph totals flag | Spec's "6am local per stadium" approximated by one 10:00 UTC run over a 7-day horizon — fine |
| §1 | The Odds API | SPEC-ONLY | — | Phase 2 by spec |

### §2 The model

| Spec § | Feature | Status | Evidence | Notes |
|---|---|---|---|---|
| §2.1 | Preseason rating pipeline (prior, churn, coaching, luck, FCS buckets, new-entrant rule) | BUILT, dark-until-refresh | `scripts/build-preseason.ts`; params table in `docs/CHANGELOG.md` | Coaching/EPA/sigma machinery at identity defaults per the gated experiments — that is the process working, not a gap |
| §2.2 | In-season Elo update, prior decay, off/def sub-ratings | BUILT | `jobs-core.ts:324-448` (stateless replay, `updateSubRatings`, `blendWithPrior`); cron Sun 13:00 UTC `jobs.yml:72,122` | Unexercised on real 2026 finals until Week 1 Sunday |
| §2.3 | Pricing: spread, team HFA, situational adj, win prob, projected score, cover prob | BUILT | `src/model/ratings.ts` `priceGame`; freeze applies confirmed adjustments `jobs-core.ts:747` | Totals gated by `splitInformative` — nulls, not a constant 57.0 (old bug fixed; `jobs-core.ts:727-731,776-778`) |
| §2.4 | Edge flags + consensus flag | BUILT (demoted to information) | `jobs-core.ts:757-761,788-790`; `/edges` | F14 — deliberate, evidence-backed |
| §2.4 | Four systems side by side | PARTIAL | game page yes (`game/[id]/page.tsx:248-258`); slate cards no | F16, minor |
| §2.5 | Backtest + tuning + CI gate | BUILT | `scripts/backtest.ts` (12 tuners), `.github/workflows/backtest.yml` | 296 unit tests + ~90 DB assertions |
| §2.5 | Weekly calibration report on Receipts | BUILT (data pending) | computed live from frozen rows, `receipts/page.tsx:100-176` | No separate cron needed — page derives SU/ATS/flagged/CLV stats on read; grader feeds `predictions.clv` (`jobs-core.ts:481-509`) |
| §2.5 | Frozen, append-only, versioned predictions | BUILT | `freezeJob` `jobs-core.ts:616-799`; cron Fri 03:00 UTC (Thu 10pm CT) `jobs.yml:74,123`; UPDATE revoked, grader touches only post-freeze columns (0019) | 8-day horizon guard prevents August spam (`:640-654`); works for week 2+ via `fetchCurrentSlate` (`src/lib/season.ts`) — the old min-scheduled-week pinning bug is gone |

### §3 Preseason team pages

| Spec § | Feature | Status | Evidence | Notes |
|---|---|---|---|---|
| §3 auto tier | Header, rating, components (churn/coaching/luck/talent), schedule map with win probs + projected record, FCS tags | BUILT | `team/[id]/page.tsx:72-89,150-180,276-300` | |
| §3.4 | Returning production % + percentile | MISSING | F13 | Data feeds the churn score; never surfaced |
| §3 LLM tier | The Verdict | PARTIAL | F2 — UI + script done, batch not run/scheduled | |
| §3 LLM tier | Starters grid, trenches, QB block | MISSING | nothing renders these | **Spec's own designated slip item** — severable by design |
| §3 | Freeze pages at Week-1 kickoff | MISSING | F12 | |

### §4 Regular-season features

| Spec § | Feature | Status | Evidence | Notes |
|---|---|---|---|---|
| §4 | Weekly rating updates + movement | BUILT | Sunday job; Δwk arrows `RatingsTable.tsx:59,198-203`; Off/Def columns behind `splitInformative` honesty gate | Off/Def dark-until-refresh (all 138 prod rows are even splits) |
| §4 | Injury/news tracker | PARTIAL | Manual admin adjustments + confirm-gated flow BUILT and **applied to frozen predictions** (`adjustments.ts:18-55`; `AdjustmentsPanel.tsx`; `jobs-core.ts:676-679,747`); LLM scan MISSING (F3) | Data without its automated producer |
| §4 | Model report card | BUILT (data pending) | Receipts calibration + `/recap/[week]` (`recap/[week]/page.tsx:76-156`: report card, upsets, movers, CLV leaders) | |
| §4 | Pick'em league | BUILT (exceeds spec) | groups layer, migrations 0020–0023; boards, per-week markets, blind option, weekly matchup grid (`groups/[slug]/week/[week]/page.tsx:94-116`) | Spec §4 rule 3's "visible to whole crew" superseded by per-group blind — owner decision, documented |
| §4 | Rooting guide | MISSING | F4 | |
| §4 | Playoff race tracker / bowl projections | MISSING | F5 | Rankings + standings pages are adjacent but not it |
| §4 | Line movement: opener + snapshots, open→current, ≥1.5 flags vs model | BUILT | `refresh-lines.ts` (`spread_open`, `source`, `captured_at`); `MoveIndicator`; `spreadMoveRead` ≥1.5 vs model (`slate.ts:529-551`); `MovementChart` with time axis on game page (`game/[id]/page.tsx:511`) | Movement colour deliberately removed (Aug 8) — flag survives as text/title |
| §4 League Rules | Displayed in-app | BUILT | `src/app/rules/page.tsx:10-66` — 9 rules, rewritten for groups; min-picks displayed not enforced (0022, deliberate) | |

### §5 Betting layer

| Spec § | Feature | Status | Evidence | Notes |
|---|---|---|---|---|
| §5.1 | Soft-market taxonomy on Edges | MISSING (content) | F11 | Page exists; brain doesn't |
| §5.2 | Derivative markets | SPEC-ONLY | Phase 2 by spec | |
| §5.3 | Bet log with reason tags, append-only void-not-delete | BUILT | `ledger/page.tsx`; `REASON_TAGS`; `enforce_bet_void_only` (0013) | |
| §5.3 | CLV per bet vs captured closing consensus; burst poll | BUILT (data pending) | `src/lib/clv.ts` (tested, sign verified in bettor's terms); grader writes `bets.clv/closing_line/payout_units` `jobs-core.ts:543-600`; burst crons `jobs.yml:56-57` | The old inverted-sign bug was fixed **before any row was ever graded** — nothing to backfill |
| §5.3 | Season dashboard: record, units, ROI, avg CLV, cumulative curve | BUILT | `ledger/page.tsx:119-138,189-219` | |
| §5.3 | Reason-tag audit | BUILT | `ledger/page.tsx:125-130,221-277` | The spec's marquee — real, with the CLV-over-record footnote |
| §5.3 | Futures tracker + weekly mark-to-market | PARTIAL | F7 | Loggable, never marked or auto-graded |
| §5.4 | ¼-Kelly stake display | Deliberate spec divergence | F14 | Report as evidence-backed removal, not a miss |
| §5.5 | Betting % / money % | SPEC-ONLY | Phase 2 | |

### §6 Game cards

| Spec § | Feature | Status | Evidence | Notes |
|---|---|---|---|---|
| §6 | Game page: live header, realtime, last play, market table w/ open+model, weather, Three Questions, rivalry module, systems row, movement chart, ATS "fun box", read-only pick display | BUILT | `game/[id]/page.tsx:115-151,248-259,310-318,511,625-653` | Rivalry seeded (0017) and joined into watchability too |
| §6 | Tale of the tape / unit-vs-unit grid | MISSING | not in `game/[id]/page.tsx` | Depends on team season stats never ingested; Phase-2-ish depth |

### §7 Design language & slate UX

| Spec § | Feature | Status | Evidence | Notes |
|---|---|---|---|---|
| §7 | Nav: 7 spec tabs | BUILT (evolved) | `nav-items.ts:20-33` — 9 items; Crew→Groups, plus Rankings/Standings; mobile bottom bar 4 primary + More (`BottomNav.tsx`) | "Game Cards" tab folded into Slate→game pages; sensible |
| §7 | Week selector + score ticker | BUILT | `SlateView.tsx:615-627`; `ScoreTicker.tsx` + `/api/ticker` (anon-open) | |
| §7 | Watchability score 0–100, defined formula | BUILT | `slate.ts:568-586` (closeness/quality/total/rivalry); WATCH figure + band on cards | Rivalry term real since Aug 8 |
| §7 | Sort toggles | PARTIAL | `SlateView.tsx:25-32`: kickoff/watchability/spread×2/total/edge — no line-move sort | F10 |
| §7 | "My picks" filter | BUILT | `SlateView.tsx:62,263,458-459` | |
| §7 | Noon/Afternoon/Primetime/Late groupings | BUILT | `SlateView.tsx:326-354` | Kickoff sort only, by design |
| §7 | Live/final card states | BUILT | GameCard live/final/bubble/cover-strip system; live urgency sort `SlateView.tsx:331` | The product's strongest area |
| §7 | Local-timezone kickoffs | BUILT | `src/lib/kick.ts`, `tzLabel` throughout | |
| §7 | Ratings UX: arrows, sortable, conference chips, sparklines | PARTIAL | all but sparklines (F9) | |
| §7 | Homepage by day | MISSING | F6 | |
| §7 | Quality floor (375px, focus, reduced motion, dark native) | BUILT | prior audit's a11y batch verified in status tables | AT/tool-audited pass still unclaimed, per that audit's own honesty note |

### §8 Operations

| Spec § | Feature | Status | Evidence | Notes |
|---|---|---|---|---|
| §8 | All eight scheduled jobs | BUILT | `jobs.yml:50-90` crons → `run-job.ts` / dedicated scripts; freeze-groups chained onto lines runs (`jobs.yml:137-138`) | Scheduler is Actions, not pg_cron (F15, deliberate); calibration is computed on read rather than a job — equivalent |
| §8 | Live scoreboard → `games.current_period/current_clock/last_play/possession` | BUILT | `jobs-core.ts:81-111`; `scoreboard-loop.ts` adaptive 30s/120s/idle, budget-aware; crons `jobs.yml:66-68,120,141` | Client realtime + poll-heal on the slate |
| §8 | Pick locking in data layer, magic-link + allowlist + admin RLS | BUILT | 0013 lockdown; `make_pick` definer; `db-test.sh` 3-role assertions | |
| §8 | PWA manifest + icons | BUILT | `src/app/manifest.ts:4-19`; `src/app/icon.svg`, `favicon.ico` | Push notifications SPEC-ONLY (Phase 3); OG images MISSING (F8) |
| §8 | `season_id` everywhere / multi-season | BUILT (one hardcode) | F18 | |

### §9–10 Calendar modes & phases

| Spec § | Feature | Status | Evidence | Notes |
|---|---|---|---|---|
| §9 | Postseason ingestion + Bowls/CFP UI | BUILT | `?st=post` slate mode `slate/page.tsx:27-37`; postseason ingestion per audit checklist #35 | |
| §9 | Bowl opt-outs, portal carousel, offseason mode | SPEC-ONLY | Phase 3 / editorial by design | |

### Built but NOT in the spec (counts toward completion)

Groups/pools layer (create/join/admin/settings/rename/archive, per-week game +
market config, hidden-until-kickoff blind, min-picks display, matchup-first
week grid, group leaderboards sorted `byLeagueRules` — migrations 0020–0023,
`groups/*`, `records.ts`); `/rankings` with model-dissent column; `/standings`;
`/recap` + `/recap/[week]`; share-text generation (`ShareButton`, `share-text.ts`);
`/me` profile (display name, server-side favorites, sign-out); `/rules`;
`/admin` (invites, adjustments, CFBD budget); live game page realtime with
win-prob history; upset alerts; multi-game focus mode; theme toggle; ticker;
`db:test` RLS harness; idle-season guards; `load-preseason` safety rails.

---

## The specific questions, resolved

1. **Teams/Receipts pages** — both fully real. `/teams` is a rated-FBS grid off
   `latest_ratings` + poll ranks (`teams/page.tsx:17-55`); `/receipts` is
   season-scoped, renders per-week frozen tables with edge/CLV columns and the
   4-stat calibration header (`receipts/page.tsx:32-37,100-176`). Prompt's
   "stub tab" claim: NEVER TRUE NOW.
2. **Grading job** — `ratingsUpdateJob` writes `picks.result`, `picks.clv`,
   `bets.result`, `bets.clv`, `bets.closing_line`, `bets.payout_units`, and
   `predictions.clv/close_spread` (`jobs-core.ts:450-609`), scheduled Sundays
   13:00 UTC (`jobs.yml:72,122`). Group leaderboards have a data source
   (`groups/[slug]/page.tsx:131-137` via `tallyBy`/`byLeagueRules`). Moneyline
   grading fixed Aug 9; futures remain manual (F7). Ungraded games with no
   closing line stay null, not zero — correct.
3. **Weekly freeze** — exists, scheduled Thu-night (Fri 03:00 UTC), derives the
   week from kickoffs so week 2+ just works; 8-day horizon stops August
   duplicate batches (`jobs-core.ts:616-654`).
4. **Calibration report** — no separate job; Receipts computes it from frozen +
   graded rows on read. BUILT; empty until first freeze + first Sunday (F17).
5. **Weather** — `weatherJob` writes `weather_forecasts` (`jobs-core.ts:252-317`),
   Sat 10:00 UTC cron, rendered on game page with the wind>15 totals flag.
6. **Live scoreboard** — `scoreboardJob` writes `current_period/current_clock`
   (`jobs-core.ts:91-96`) via the hourly-handoff `scoreboard-loop.ts`, crons on
   Fri/Sat/Sun windows.
7. **Injury/news** — producer MISSING; manual admin producer + confirm UI +
   freeze-time application all BUILT (F3). Adjustments **are** applied: `adjFor`
   feeds `situationalPoints` into `priceGame` at freeze (`jobs-core.ts:747`).
8. **Week navigation** — any of weeks 1–16 plus Bowls & CFP reachable, URL-
   addressable (`slate/page.tsx:23-37`; `SlateView.tsx:615-627`). Week 0 games
   carry CFBD's week-1 label, so "Week 1 ·" is the Aug 29 slate.
9. **§7 affordances** — watchability BUILT, slots BUILT, my-picks BUILT,
   live/final BUILT; sort toggles PARTIAL (no line-move sort, F10).
10. **§5.3** — reason-tag audit BUILT, units curve BUILT, futures PARTIAL (F7).
11. **§5.4** — stake removed deliberately on `--diagnose-edges` evidence (F14).
    Reported as spec divergence with receipts, per instruction.
12. **§4** — rooting guide MISSING, playoff tracker MISSING, report card BUILT,
    line-movement display BUILT.
13. **League Rules** — BUILT at `/rules`, linked from nav (`also: ["/rules"]`).
14. **PWA/meta** — manifest + icon.svg + favicon.ico BUILT; `metadataBase` +
    per-page `openGraph` text BUILT (`layout.tsx:23,31`); **OG images confirmed
    still missing** (F8), matching the changelog.

---

## Phase 1 completion, and the ship call

**Phase 1 completion: ~92%.** Reasoning: the §10 Phase-1 list has 18 concrete
deliverables (schema+RLS, CFBD client, backfill, backtest+tuning, preseason
ratings, slate, game cards, auth+invite, pick'em with line-snapshot+lock,
ledger+CLV, scheduled jobs, team pages auto tier, team pages LLM tier, three
questions, injury scan, confirm UI, freeze job, calibration report). Fifteen
are BUILT end to end. Three are not: injury scan (MISSING, manual fallback
exists — half credit at best), team-page LLM tier (Verdict built but unrun,
starters/trenches never started — the spec's own designated slip item), and
the automated tier's returning-production percentile block. 15.5/18 ≈ 86% on
the strict list — and the product also banked a large share of Phase 2 early
(receipts page, reason-tag audit, movement tracking, live states + ticker,
weekly grid), which is why I round the honest overall to ~90–92% of "what
Phase 1 was for." No page in the nav is a stub; every route has real data
behind it or an honestly-labeled empty state waiting on the season to start.

**Can it ship Aug 29? Yes — with one condition and one chore.**

- **The condition (F1, the only P0):** production ratings are 2026.2.0. The
  fix is fully automated (`preseason-refresh`, daily 11:00 UTC through Aug 27,
  gated on `--check`), but it is hostage to CFBD publishing 2026 talent. If
  the job is still declining by **Aug 26**, a human must decide: force a build
  on 2025-talent fallback (explicitly what `--check` exists to prevent) or
  ship Week 0 on stale-but-coherent 2026.2.0 ratings, which the site already
  handles honestly (`hasCalibratedTotals`/`splitInformative` suppress totals
  and Off/Def rather than showing wrong numbers). Either way the site *works*;
  what's at stake is model quality, not availability. **Put a calendar check
  on Aug 26.**
- **The chore (F2):** dispatch `verdicts` (and confirm `ANTHROPIC_API_KEY` is
  set so Friday `questions` isn't silently no-oping) before Aug 29, or team
  pages launch without their editorial layer.

**Minimum severable scope** (already in hand, nothing to cut to reach it):
slate + game pages + auth + groups pick'em + ledger/CLV + freeze + Sunday
grading + rules + receipts. The features that would slip if time ran out —
injury LLM scan, team-page LLM depth, rooting guide, playoff tracker, futures
M2M, OG images — are exactly the spec's designated slip items or Phase-2+
material, and none blocks the slate/pick'em/ledger core the spec says must
never slip. The larger launch risk isn't missing features; it's that the
grading/CLV/receipts pipeline runs against real rows for the first time the
Sunday after Week 0 (F17) — worth a deliberate dry-run watch that weekend.

---

## For 00-SUMMARY.md

- **P0 (conditional)** F1 — Production ratings stuck at 2026.2.0 pending CFBD talent publish; automated fix in place; **needs a human check ~Aug 26** and a fallback decision if still red. (S — monitoring + one decision)
- **P1** F2 — Verdicts batch is dispatch-only and unrun; fire `verdicts` workflow + confirm `ANTHROPIC_API_KEY` before Aug 29 or team pages ship without the LLM layer. (S)
- **P1 (watch)** F17 — First real exercise of freeze→grade→CLV→receipts happens the Sunday after Week 0; schedule a supervised watch of that run. (S)
- P2 F3 — Injury/news LLM scan never built (manual admin path covers launch). (M)
- P2 F4/F5 — Rooting guide and playoff race tracker missing (spec §4). (M each)
- P2 F14 — ¼-Kelly stake removed **deliberately, evidence-backed** — record as spec divergence, not a gap. (—)
