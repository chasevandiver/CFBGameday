# The CFB Slate — Status

**The one file that answers "what's left."** Reconciled 2026-08-12 against the
code on `main` at `d2a4bbb`. Week 0 is **Sat Aug 29** — 17 days.

Every open item in this repo lives here, once, with its original audit ID. If
it isn't in this file, it isn't queued. Boxes are checked in the commit that
lands the fix, so the file is truthful at every commit.

## Which document is which

| File | What it is | Live? |
|---|---|---|
| **`docs/STATUS.md`** (this file) | Every open item, one list | ✅ **the tracker** |
| `docs/CHANGELOG.md` | What shipped + the decisions table (incl. rejections) | ✅ append here on every change |
| `docs/SPEC.md` | What we're building and why | ✅ |
| `docs/DESIGN.md` | Design rules; read before UI work | ✅ |
| `audit/CHECKLIST.md` | The Aug 10 Package A–C program — **completed record** | 📕 history |
| `audit/KICKOFF_READINESS.md` | Aug 11–12 readiness audit (P0/P1/P2 analysis, backtest re-run, day plan) | 📕 history — findings tracked here |
| `audit/00`–`10` | Aug 9 workstream reports; source of the `NN:XX-N` IDs | 📕 history |
| `docs/AUDIT-2026-08.md` | Aug 6 product audit: 18 bugs, 46-item checklist, score card | 📕 history |

Historical documents are kept intact and are not edited to look better in
hindsight. When one of them contradicts this file, **this file is right** — its
rows were decided by reading code, not by reading commit messages.

---

## 1. Where we stand

| | |
|---|---|
| **Ships Aug 29?** | Yes. `audit/KICKOFF_READINESS.md` §1, unhedged, after two revisions. |
| **Build** | 488 tests, 118 DB assertions, `tsc`/lint/build green in CI (last run 2026-08-12; `node_modules` is not installed in every session, so this line is carried from CI, not re-run here) |
| **Scheduler** | 98 Actions runs, 97 green. The one red was the watchdog firing correctly on a cold `job_runs` table. |
| **Regressions** | 0. Nothing correct was later undone (`KICKOFF_READINESS` §5). |
| **CFBD** | Tier 2, 30,000 calls/month, confirmed against ~10k of use. All 11 endpoints probed live and reachable, including `/scoreboard`. |
| **Model in code** | `2026.5.0` — tilt carry, `baseHfa` 3.0, centered team-HFA, portal fix, market-anchored tier recentre |
| **Model in production** | ⚠️ `2026.2.0`. **Four versions behind**, pricing every cross-classification opener ~10 points toward the G5. Waiting on CFBD to publish 2026 talent; `preseason-refresh` retries daily and loads itself the first morning `--check` is green. |
| **The edge verdict** | b₁ = 0.035 (t = 0.84) for the model vs 0.987 (t = 22.81) for the market, n = 2611; flagged edges 49.2% ATS vs the close. Edges are **information, not bets** — and no model-accuracy work belongs in the next 17 days. |

**What's built:** slate, game page (live), pick'em with O/U + weekly grid +
weekly winners, betting groups + boards, ledger with reason-tag audit and units
curve, receipts, rankings, standings, recap, postseason ingestion + UI,
rivalries, watchability, movement charts, SP+/FPI/Elo side-by-side, `/model`,
`/rules`, `/me`, PWA manifest + icons, OG share images, CSV export, cover-flip
detection, job-run observability + watchdog.

**Phase 1 is ~92% built** (`audit/01-feature-inventory.md`). What follows is the
other 8% plus the deliberate deferrals.

---

## 2. Blocking Week 0 — do these first

Dated per `KICKOFF_READINESS` §10. Total ≈ 20 h of code plus the checkpoints.

### 2.1 Now (Aug 12–14)

- [ ] **🔑 Rotate the CFBD key** — it was pasted into a chat transcript to run
      the Aug 12 probe and backtest. `collegefootballdata.com/key`, then update
      the GitHub secret. · 0.25 h · human
- [ ] **P1-9a** Set `SUPABASE_DB_URL`. Empty in all 98 runs, so the weekly
      `pg_dump` has **never executed** — the append-only `predictions` / `picks`
      / `bets` have no copy beyond the 7-day PITR window. By elimination this is
      the largest open risk in the product. · 1 h
- [ ] **P1-9b** Create a healthchecks.io project, set `HEALTHCHECK_PING_URL`
      (the ping step is already wired). · 0.5 h
- [ ] **P1-9c / F2** Add `ANTHROPIC_API_KEY`, dispatch `verdicts` once, or team
      pages launch without the LLM tier. · 0.5 h
- [ ] **P1-8** Check the inbox: a watchdog failure email fired Aug 10 — did it
      arrive? An unverified failure channel is no failure channel. · human
- [ ] **P0-4** Three `select count(*)`: `ratings` (week 0, expect ~136),
      `team_hfa`, `line_snapshots`. Jobs are running; this confirms the rows
      landed. · 0.5 h

### 2.2 This week (Aug 14–18)

- [ ] **P1-1** A postponed or canceled game can never be voided. The grader
      implements Rule #4 correctly (`jobs-core.ts:953-977`) but **nothing writes
      those statuses** — `sync-games.ts:93` only ever asserts `final`. Needs an
      admin "void this game" control plus the grading path that consumes it.
      *(This is why `05:N9` is a `[x]` in `audit/CHECKLIST.md` that is really a
      partial — see §7.)* · 3 h
- [ ] **09:P-16** Load rehearsal — **owner-run**, needs a live server. Seed via
      `scripts/seed-fixtures.ts`, `autocannon -c 15 / -c 30` against
      `next start`, record against the bars: p95 < 1.5 s, tick < 300 KB. The
      only zero-evidence area left before a 60-game Saturday. · 3 h
- [ ] **P1-3** Commit `.env.example` (17 keys) + the `.gitignore` negation.
      `README.md` step 1 tells you to copy a file that does not exist. · 0.5 h
- [ ] **P1-5** `/ratings` has no empty state. · 0.25 h
- [ ] **P2-1** `PRESEASON_TILT_CARRY=""` silently becomes `0`, not an error —
      `Number("")` is `0`, so the `Number.isNaN` guard at
      `build-preseason.ts:82-86` never fires and a fitted parameter disables
      itself in silence. *(`04:DQ-13` claims empty is rejected; it is not.)* · 0.25 h
- [ ] **P2-10** Add `0 10 * * 6` → `refresh-lines` and `0 10-14 * * 6` →
      `scoreboard-loop` as insurance against a kickoff that moves earlier. Both
      near-free — `idleSkip` exits in seconds. *(Verified 08-12: the existing
      `0 10 * * 6` is the weather cron, not lines.)* · 1 h
- [ ] **P2-11** Narrow `sync-games.ts:63`'s `gameMedia` catch to log the HTTP
      status, so a future entitlement change shows up in the job log rather than
      only in a probe. · 0.5 h
- [ ] **P1-4** Schedule the burst poll, or say in the spec that it's
      dispatch-only. `refresh-lines --burst` exists and is in the dispatch list
      (`jobs.yml:28`), but no cron maps to it (`jobs.yml:163`). · 0.5 h

### 2.3 Docs that contradict the code (Aug 18)

One sitting, ~2 h. Each is a doc edit, not a code change.

- [ ] **Q3** `SPEC.md` §2.2/§2.3 still say K = 0.15–0.20 and slope ≈ 0.145; the
      code ships the fitted 0.3 and 0.101. Amend with the run cited, and record
      that K's joint refit hit a grid boundary at 0.4 so nobody re-litigates it.
- [ ] **Q4 / P1-2** FCS two-bucket rule: specced, never built —
      `fcsTopRating`/`fcsOtherRating` are dead constants
      (`ratings.ts:112,200`) and every fitted parameter was fit under the flat
      −30 the replay actually runs. **Recommended: amend the spec to one bucket
      at −30 and delete the constants**; revisit with `--tune-fcs` in the
      offseason. Owner call — see §3.
- [ ] **Q5** `SPEC.md` §4 R3 describes migration 0010's crew-wide picks; 0023
      made it a per-group setting (`picks_hidden_until_kickoff`, default false).
      Behavior is right, the spec is one step behind.
- [ ] **P1-6** `SPEC.md` §7 lists `/crew` as primary nav; `/crew` is a redirect
      to `/groups`.
- [ ] **P2-7** `README.md:10` and `SPEC.md:20` claim the CFBD free tier "won't
      survive the backtest backfill." It would — a full cold 2023–25 backfill is
      16 calls. The real reason for Tier 1+ is `/scoreboard`.
- [ ] **Bug #9 evidence** `docs/AUDIT-2026-08.md` cites `actions/picks.ts:54,58`
      for a fix that now lives in the `remove_pick` RPC (`0021:255-257`) —
      stronger than what's documented, but the citation is stale.
- [ ] **probe.ts:52** still says `/scoreboard` "returns `[]` all week and only
      fills on a Saturday." The Aug 12 probe disproved it (whole season, 889
      rows) — and that sentence is the stated justification for
      `emptyIsHealthy`, which today would mask a genuinely empty board.

### 2.4 Model work that is not accuracy work (Aug 18–20)

- [ ] **Q8** Re-run `--tune-churn`. The Aug 12 portal fix changed the input
      distribution that `returningProdWeight = 6` and `talentReloadStrength = 1`
      were fitted against, so both are now fitted on something that no longer
      exists. Its recorded gain was already inside the ~0.25 SE, so **the honest
      outcome may be `netPortalPoints = 0`** — every other unearned parameter
      here sits at an identity default. Either way it gets a decisions-table
      row. Caveat: `replaySeason` never calls `churnAdjustment`; read how
      `tuneChurn` builds its evaluation before trusting a number from it. · 1 h
- [ ] **Dispatch `observe-scoreboard` over the Aug 29 openers.** The probe
      proved `/scoreboard` **answers**; nothing yet proves it **moves**. A feed
      that renames a status string produces zero writes, `{live_or_final: 0}`
      and a *green* run — a dead live layer and a quiet Saturday are currently
      the same observation. Liveness is only measurable over a live game, once,
      unrepeatably. The instrument exists; the measurement does not. · dispatch

### 2.5 The hard dates

- [ ] **Aug 20** — `preseason-refresh` starts going **red** on decline
      (`jobs.yml:221`). Watch it. Also: `refresh-lines` leaves its idle guard
      ~Aug 22 (`LINES_IDLE_DAYS` 7) — first snapshots since spring.
- [ ] **Aug 21** — Quality floor: real-device pass at 375 px, light-mode phone
      pass over the slate (contrast changes are computed, never eyeballed),
      reduced-motion + focus-ring check, `UX-06` residue.
- [ ] **Aug 22–23** — **Full dress rehearsal.** Dispatch `refresh-lines`,
      `sync-games`, `scoreboard-loop`, `freeze --force` against a scratch week.
      Watch `job_runs` and `api_call_log` fill. This is the only end-to-end test
      there is. Sunday: fix what it surfaced, re-run.
- [ ] **Aug 24** — Run the 7 preseason smell tests (`04:§5`) on the first real
      `--top 40` table. **UX-32:** eyeball the matchup cards with real names.
- [ ] **Aug 26** — 🔴 **HARD CHECKPOINT (`04:DQ-1` / P0-3).** Is
      `preseason-refresh` green? Green → 2026.5.0 loads itself. Red → execute
      the Q1 decision below. **Do not let this get decided by silence.**
- [ ] **Aug 27** — Last refresh cron day. Verify `ratings` shows 2026.5.0 and
      `/ratings` renders the Off/Def columns (the `splitInformative` tell).
      Create Week 0 group weeks, invite the crew, confirm each person signs in.
      **`/scoreboard`'s first-ever real call lands today** as `idleSkip` opens.
- [ ] **Aug 28** — 🔴 The Thursday freeze fires 03:00 UTC Fri = 10 pm CT Thu.
      Verify one frozen row per Aug 29 game, correct `model_version`, non-null
      `vegas_spread` and `total`. **Nothing else ships this day.**
- [ ] **Aug 29** — 🏈 Week 0. Supervised watch: close passes, scoreboard loop,
      cover-flip detector, `observe-scoreboard`.
- [ ] **Aug 30** — **F17** Supervised watch of the first freeze → grade → CLV
      run. The first time the CLV path meets real rows.

---

## 3. Decisions owed by the owner

These block nothing today but change what gets built. Recommendations are from
`KICKOFF_READINESS` §9.

| # | Question | Recommendation |
|---|---|---|
| **Q1** | If `preseason-check` is still red Aug 26, what ships? | **Stale-talent build on 2025 recruiting, loaded as 2026.5.0.** Wrong about incoming freshmen is a ±1–2 pt error at `talentWeight` 0.30; 2026.2.0 is wrong about home field by +0.74 on *every* game, renders no totals, and carries the ~10-pt tier mis-level. Say yes and the `--force` path plus a `/model` note get wired. |
| **Q4** | FCS: build the two buckets, or amend the spec to one? | **Amend to one bucket at −30, delete the dead constants.** Changing the input distribution 17 days out with no tuner behind it is the bad trade. `--tune-fcs` in the offseason. |
| **Q7** | Delete the dead edge function? | **Delete `supabase/functions/jobs/`.** It has inverted CLV in all four branches and is 4+ versions behind `jobs-core.ts`. `05:C5` calls it a deliberate tombstone — but a tombstone with a live landmine in it is worse than none. Git preserves it. Say no and it gets a `DO NOT DEPLOY` banner instead. |
| **Q6 / SEC-13** | TBD kickoffs (`start_ts` null) — policy before Aug 29 | **Keep as-is.** Un-pickable, un-removable, stays blind, no close and therefore no CLV, but still frozen. Every branch fails closed, which is right for a security boundary and a receipt. Cost: a TBD game is un-pickable until CFBD firms the time, which `sync-games` does daily. |
| **UX-33** | Does `/edges` keep a permanent bottom-nav slot now that edges are demoted to information? | Owner call. |
| **09:§3** | Re-verify current Supabase free-tier limits against the pricing page | Human, 0.25 h. |
| **OPS-1b** | Dispatch one deliberately-failing run and confirm who receives the email | Human, 0.25 h. Pairs with P1-8. |

---

## 4. Queued for after launch

Real work, deliberately not before Aug 29.

**Correctness / security**
- [ ] **P2-4 / SEC-10** Drop the dead `picks` policies 0018 recreated — the
      table grants were revoked in `0013:92` and `0021:268`, so they can never
      fire. Verified *not* a hole, but misleading. Migration 0028. · 0.5 h
- [ ] **P2-5** `remove_pick` never checks group membership and returns `ok:true`
      on a zero-row delete. Safe (scoped to `user_id = auth.uid()`), untidy. · 0.5 h
- [ ] **P2-2 / SEC-08** `profiles` is world-readable **including `is_admin`**,
      signed out. Fine for 15 friends, wrong in principle. · 1 h
- [ ] **SEC-02** A removed admin rejoins as admin — removal isn't durable. · S
- [ ] **SEC-01** Join codes → 10-char base32 + per-user attempt throttle in
      `join_group`. Needs a full-function migration rewriting
      `create_group`/`regenerate_join_code` (next free number is **0028**).
      ~0 real private groups pre-launch, so brute force is negligible until
      after. · S

**Ops / perf**
- [ ] **P2-3 / 05:C5 / 07:OPS-11 / SEC-12** Delete the dead edge function
      (pending Q7). · 0.5 h
- [ ] **P2-6** `ratings/page.tsx:56` still does `teams.select("*")`; the
      game-page equivalent was narrowed by `09:P-5`. · 0.25 h
- [ ] **09:P-1b** Slim `/api/slate-live` heal endpoint — decide after P-16's
      numbers. · M
- [ ] **09:P-11** Cacheable weekly-static pages · M
- [ ] **09:P-6** `fetchTeamAtsSeason` re-fetches every snapshot per game view · M
- [ ] **09:P-9/P-10/P-12/P-13** Blind-count aggregate RPC; board picks-query
      collapse; ratings latest-in-Postgres; receipts pagination · S–M each
- [ ] **07:OPS-6** Backfill mode for null-CLV rows (post-kickoff `captured_at`
      is excluded forever) — only matters after a missed close · S–M
- [ ] **07:OPS-14a** Meter the unmetered CFBD calls (CI, backtest, preseason) · S
- [ ] **07:OPS-18** App-token PRs trigger no CI — process fix · S
- [ ] **07:OPS-8b** Scheduled Sunday calibration report — needs season data · M
- [ ] **07:OPS-16** Snapshot coarsening job — 2027, explicitly not now

**Model, in-season (all tuner work, none of it accuracy-chasing)**
- [ ] **02:M-04** `--production-chain` replay mode: measure backtest↔production
      prior drift · M · first in-season week
- [ ] **02:M-05 / 03:M-1v** Team-HFA replay validation with a pre-registered
      rule (else set blend 0) · M
- [ ] **02:M-13 / 03:M-4** Real per-team tempo + `--tune-tempo` · M
- [ ] **03:M-6/M-7/M-8b/M-9a** Decay-knot grid, heteroscedastic σ, smooth cap,
      rest/travel tuner · S each
- [ ] **02:§2b** Promote `warnIfTooGood` / negative-coefficient checks to
      CI-failing assertions · S–M
- [ ] **03:M-5** Opener-relative CLV aggregate on Receipts (+1.0 / n ≥ 200,
      pre-registered) · S to code, meaningful with in-season data
- [ ] **02:M-07 / 03:M-9b** "incl. adj" beside adjusted spreads + an admin
      warning that the spec's magnitudes are unvalidated · S
- [ ] **02:M-08** In-sample caveat on the Receipts explainer · S
- [ ] **02:M-09/M-10/M-11/M-12** Dead code: fcs params (see Q4),
      `updateFromResult`, `suggestedStake`, stale replay comment · S
- [ ] **G5** Prediction attribution ("why this number") — freeze the
      decomposition and design the column set before the first retune · M

**Data quality**
- [ ] **04:DQ-12** Portal scoring from the `rating` field (S, present on 65% of
      entries) then production/snaps (M) + a decisions-table row. Today the
      term measures **headcount, not talent**: 91% of entries are 2–3 star, so a
      team shedding 20 backups scores like one losing 20 starters.
- [ ] **04:DQ-5** Rename/drop `returning_prod_def`, which stores an offense
      metric — schema churn during launch isn't worth it · S
- [ ] **04:DQ-6** `qbReturns` from roster facts instead of the passing-PPA
      proxy · M
- [ ] **04:DQ-11** Real `turnoverMargin` for the luck rule · S/M
- [ ] **04:DQ-15** `cached()` shouldn't persist empty CFBD responses · S, local-dev only

**Product / UX**
- [ ] **G10-v1** Copy-digest ShareButton: Thursday (frozen slate / edges / "N
      haven't picked") + Sunday (results / movers / CLV) — best paired with the
      group board's real first Saturday · S–M
- [ ] **UX-14** Groups first-run pointer on the slate — pairs with G10, needs a
      live active-group cookie flow to test · S
- [ ] **F10** "Biggest line move" slate sort — needs real movement data · S
- [ ] **F13** Returning-production % on team pages — lights up when data lands · S
- [ ] **UX-08** Remaining sub-44px targets: star, pin, BetSlip remove, void
      link, units input · S–M
- [ ] **UX-22** MatchupCard push results get icon + colour, not sr-only text · S
- [ ] **UX-06 (residue)** Sub-4.5 tokens: light `chalk/50–55` table headers,
      dark `/35–/45` decorative labels, edge-on-card — needs a rendered pass · S–M
- [ ] **UX-21** Ledger "today" keyed to CT for non-CT bettors · S
- [ ] **UX-24** Week page passes raw `line_at_pick` into `pickSideLabel`
      ("0" ≠ "PK") · S
- [ ] **UX-25** `profiles.timezone` surfaced on `/me` and used server-side · S–M
- [ ] **UX-27/28** `error.tsx` without nav; standings name truncation at 375px · S
- [ ] **UX-31 / §23 #19** Week changes via `pushState` so Back traverses weeks
      (`SlateView.tsx:263` is `replaceState` — deliberate, revisit) · S
- [ ] **05:N12** Pin one numeric-arrival convention in `records` · S, no
      user-facing effect
- [ ] **G7/G8/G11** Crew disagreement roll-up; fade-the-crew; pick nudge — need
      a *sample* of graded picks before they say anything true; pre-register n
      before building
- [ ] **F3** Injury/news LLM scan producer · M–L
- [ ] **F4/F5/F6** Rooting guide; playoff race tracker; homepage-by-day · M each
- [ ] **F9** Ratings sparklines — needs weekly rating history
- [ ] **F11** §5.1 soft-market taxonomy content on `/edges` — editorial
- [ ] **F12** Preseason team pages freeze at Week-1 kickoff · M
- [ ] **F16** Systems side-by-side on slate cards (the game page has it) · S–M
- [ ] **F-§3 / F-§6** Team-page LLM depth; tale of the tape · L / needs season stats
- [ ] **G13 / F18 / §23 #36 residue** Season archive + `SEASON` rollover · offseason

---

## 5. Not built, by choice

Additive features, no defect behind any of them. Verified still open 2026-08-12.

| ID | Item | Why it's fine |
|---|---|---|
| §23 #40 / F7 | Futures tracker with weekly mark-to-market — `future` is a valid `bet_type` and BetForm accepts it; nothing marks it to market | · M, and nobody has logged one |
| §23 #44 | Generated db types — `src/lib/db-types.ts` is still hand-written | Drift risk is real but slow; `next typegen` in CI covers the route layer only |
| §23 #45 | ⌘K quick-switcher + keyboard navigation | Table stakes for a "command center", zero users blocked today |
| §23 #38 | PWA **push** notifications — manifest and icons exist, the notification path does not | Phase 3 |
| §23 #31 | BetForm game **search** — labels, validation and the −3d/+9d window shipped; the picker is a plain `<select>` | Fine at 60 games/week |
| §23 #42 | **Route smoke tests** — 37 test files, 488 tests, none exercise a route | The one partial that touches correctness; named, not rounded up |

**Explicit slip order** if time runs out (`SPEC.md:253`): team-page LLM verdicts
and the admin review queue first, then F13/F9/F16, then P1-2 FCS buckets, then
P2-2/P2-5. **Never slipped:** the slate, pick'em, the ledger, the freeze, the
close passes.

---

## 6. Known residuals — recorded, not queued

Things that are true, understood, and deliberately not being fixed. They are
here so they aren't rediscovered as bugs.

- **The FCS anchor (flat −30) was calibrated against the old G5 level.** With G5
  down ~5.1 after the tier recentre, September FCS buy games will pull the pools
  back together ~1–1.5 points through the Elo before prior decay makes it moot.
  Watched by the FBS-vs-FCS slice row.
- **Within-pool rating spread is compressed** — our SD ~8 vs SP+'s ~10.5–11. A
  separate, smaller defect the recentre deliberately does not touch.
- **The 2026 gate's week-1 lines are the fit set**, so t < 2 there is by
  construction. Out-of-sample evidence is the 2024–25 weeks 2–4 result, and
  going forward the weeks-2+ 2026 lines as they post.
- **The blind reads `start_ts`, not status.** A game whose `status` goes final
  while `start_ts` is stale stays hidden. Left as-is: one source of truth in a
  security boundary beats two.
- **P2-8** Cron comments name ET/CT; the crons are UTC and don't shift for DST,
  so Nov–Mar every label reads an hour early. Documented in place at
  `jobs.yml:75-78`.
- **CLV has no data yet.** Built, migrated, tested — the first real values
  arrive the Sunday after Week 1.
- **The matchup split has only been seen with a synthetic second member.**
  Geometry, lean bar and graded chips are verified; nobody has seen the card
  with two real names and a full week of picks (`UX-32`).
- Untested model ideas that remain plausible: pass/rush splits, special teams
  and field position, QB modeling from player PPA (one boolean today),
  re-expanding the compressed within-pool spread, letting the FCS anchor follow
  the recentred G5 pool. **Check `docs/CHANGELOG.md`'s decisions table before
  proposing any model idea** — per-play efficiency, SP+ blending, and widening
  early-season σ have each already been tested and rejected on evidence.

---

## 7. Corrections from this reconciliation (2026-08-12)

What the previous checklists got wrong, found by re-reading the code. Nothing
here was decided by a commit message.

| Where | Claimed | Actually |
|---|---|---|
| `audit/CHECKLIST.md` `05:N9` | `[x]` postponed/canceled grade void | **Partial.** The grader is right; nothing writes those statuses. Re-opened as **P1-1** in §2.2. |
| `audit/CHECKLIST.md` `04:DQ-13` | `[x]` rejects NaN/empty `PRESEASON_TILT_CARRY` | **Partial.** NaN is caught, empty string silently becomes `0`. Re-opened as **P2-1**. |
| `audit/CHECKLIST.md` `SEC-01` | "migration 0026" | Stale — 0026 and 0027 are taken; next free is **0028**. |
| `docs/AUDIT-2026-08.md` §23 | 46 raw `[ ]` boxes, all unchecked, below a table saying 38 are done | The boxes now carry their verified status. The table was right; the boxes were three months of drift. |
| `docs/AUDIT-2026-08.md` Bug #9 | cites `actions/picks.ts:54,58` | The fix moved into the `remove_pick` RPC (`0021:255-257`) and got *stronger*. Citation queued for correction in §2.3. |
| `docs/CHANGELOG.md` Aug 12 (portal) | — | Created a new open item (**Q8**, re-run `--tune-churn`) that no checklist carried. Now in §2.4. |
| `docs/CHANGELOG.md` Aug 12 (observe) | — | Same: the `observe-scoreboard` dispatch and the stale `probe.ts:52` comment existed only in prose. Now in §2.4 and §2.3. |
| `audit/KICKOFF_READINESS.md` P0-1/P0-2/P0-5, P1-7, P1-10 | open | All closed on 2026-08-12 (early-kickoff scenario doesn't fire; Tier 2 confirmed; all 11 endpoints reachable; portal fix shipped in `5c58fb3`). |

**Verified open today by reading the code, not the docs:** P1-1
(`sync-games.ts:93`), P1-3 (no `.env.example`), P1-4 (`jobs.yml:163` maps no
cron to `refresh-lines-burst`), P1-6 (`crew/page.tsx` is a redirect), P2-1
(`build-preseason.ts:82-86`), P2-3 (`supabase/functions/jobs/index.ts` present),
P2-6 (`ratings/page.tsx:56`), P2-10 (`0 10 * * 6` is the weather cron), P2-11
(`sync-games.ts:63`), §23 #40/#44/#45, #31, #38, #42.
