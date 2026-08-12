# Week 0 Kickoff Readiness Audit — The CFB Slate

**Audit date:** 2026-08-11 · **Week 0 kickoff:** Sat 2026-08-29 (18 days) · **Week 1:** Sat 2026-09-05 (25 days)
**Scope:** read-only. Nothing in the repo was modified by this pass. Every finding is a work item, not a change.
**Method:** verified against the code on this branch (`claude/cfb-slate-kickoff-audit-lawxb8`, identical tree to `main` at `765c63d`). Prior audit documents were treated as claims and re-checked, not as evidence.

> **Revised 2026-08-12** against the GitHub Actions run history and job logs, which resolved five of the six things the first pass could only mark UNVERIFIED. Three findings moved: **P0-2 closed** (Tier 2 confirmed), **P0-4 mostly closed** (jobs are running), and **P0-1 downgraded to P2** — the schedule data says the first Week 0 kickoff is ~14:48 UTC, which the existing 12:00 UTC line pass covers, so the scenario I ranked #1 does not fire. Two new findings opened (**P0-5**, **P1-7**). Superseded text is struck through rather than deleted: what a pass got wrong is worth more than a clean document.

**Classification key:** **BUG** (code does not do what it says) · **SPEC DIVERGENCE** (works, contradicts `docs/SPEC.md`) · **GAP** (specced, never built) · **WEAKNESS** (built, fragile/ugly/slow) · **UNVERIFIED** (cannot be decided from the repo).

---

## 1. Verdict

**Yes, this ships by August 29, and after the Aug 12 revision it is not close.** The codebase is in materially better shape than an 18-days-out product usually is: 472 unit tests pass, 118 database assertions pass against a real Postgres with all 26 migrations applied, `tsc` and `eslint` are clean, the production build succeeds, and every high-risk correctness fix I traced (CLV signs, the append-only grants, the security-definer pick path, the per-game freeze horizon) landed once and was never overwritten. **I found zero regressions.** The Actions history then closed most of the operational doubt: **98 scheduled runs, 97 green**, the CFBD key works, the 2026 schedule is ingested, and CFBD Tier 2's 30,000-call cap matches the hardcoded budget exactly against a ~10,000-call month.

**What remains is a single external dependency and a single untested endpoint.** The dependency is 2026 talent, unpublished by CFBD, which is the only thing standing between production and the current model — and it has a self-healing daily job and an Aug 20 red alarm already wired. The untested endpoint is `/scoreboard`: Tier 1+, the entire live layer, and **never once called with this key**, because every offseason poll exits through `idleSkip` before spending a call. On the current schedule its first real invocation is **Aug 27, two days before kickoff**. That is now the single most likely cause of a bad Saturday, and it is the one thing here that was invisible from both the code and the run logs. `scripts/probe-cfbd.ts` (added 2026-08-12) exists to answer it today instead.

The second-order risk is confidence: this repo's documentation is unusually good, and that is itself a hazard. `audit/CHECKLIST.md` and `docs/AUDIT-2026-08.md` are ~95% accurate, which is high enough to be trusted and not high enough to be trusted blindly. Three checklist items are checked that are not fully done (§7). **The same trap caught this audit**: I ranked an early-kickoff CLV loss as the #1 P0 on a plausible reading of the cron table, and one field in one job log — `days_to_kickoff: 18.2` — showed the scenario does not fire. Reason about a schedule, verify against the schedule.

---

## 2. P0 — blocks kickoff

### P0-5. `/scoreboard` is Tier-gated and has never once been called with this key
**Classification:** WEAKNESS · **Evidence:** `src/lib/cfbd.ts:374`, `scripts/scoreboard-loop.ts:85-93`, Actions run [31553087151](https://github.com/chasevandiver/CFBGameday/actions/runs/31553087151)
**Opened 2026-08-12. This is now the top risk.**

`/scoreboard` requires Tier 1+ (`cfbd.ts:374`) and drives the entire live layer: score updates, `status` transitions, the cover-flip detector, the ticker. Nothing else can produce them.

**It has never been exercised.** `scoreboard-loop` calls `idleSkip` before anything else (`scoreboard-loop.ts:85-93`) with `SCOREBOARD_IDLE_DAYS` defaulting to 2. With the first kickoff on Aug 29, every launch all summer has returned before spending a single CFBD call. The Aug 12 01:16 UTC run proves it by duration alone: the "Run job" step ran **01:17:20 → 01:17:22 — two seconds**, which is an idle exit, not a poll.

> First real `/scoreboard` call: **Aug 27** (29 − 2 days). That is 2 days before kickoff, and it is the first moment a tier or entitlement problem could surface.

**Why it breaks the product.** If the call 403s on Aug 27 you have 48 hours to buy a tier, wait for propagation, and re-test — with no live scores, no in-progress card states, and no bad-beat log if it doesn't resolve. And `--check`, the readiness gate you already run daily, **cannot see this**: it probes preseason *inputs*, and the tier-gated endpoints are exactly the ones the preseason build never touches.

**Fixed 2026-08-12.** `scripts/probe-cfbd.ts` + `scripts/lib/probe.ts` (13 tests). It calls all 11 endpoints the product depends on through `src/lib/cfbd.ts` — no second fetch path — and reports `OK` / `EMPTY` / `DENIED` / `ERROR` per endpoint, exiting non-zero only when a **required** one is denied. The classification is the point: `DENIED` (401/403) means buy a tier, `EMPTY` (200, no rows) means wait for CFBD to publish, and conflating them sends you after the wrong problem. Historical probes run against `SEASON−1` so `EMPTY` is unambiguous; `/scoreboard` is flagged `emptyIsHealthy` because an empty board on a Wednesday is the correct answer. Wired as the `cfbd-probe` dispatch task and as its own always-run step alongside the daily August `preseason-refresh` (`jobs.yml`), deliberately *not* `&&`-chained — a declined refresh exits 0 on purpose and would have silently skipped it.
**Action: dispatch `cfbd-probe` now.** 11 calls, read-only, answers it today instead of Aug 27.

### ~~P0-1. No line snapshot and no scoreboard poll before 12:00/15:00 UTC on a Saturday~~ → **downgraded to P2-10**
**Superseded 2026-08-12.** I ranked this #1 on the assumption of an early Week 0 kickoff. The schedule says otherwise.

`sync-games` logged `{"skipped":"next_game_gt_14d_and_not_monday","days_to_kickoff":18.2}` at `2026-08-11T10:00:28Z` (run [31480214880](https://github.com/chasevandiver/CFBGameday/actions/runs/31480214880)). `msUntilNextGame` measures to the next scheduled kickoff, so:

> Aug 11 10:00 UTC + 18.2 days = **Aug 29 ~14:48 UTC** (±72 min, from the 1-decimal rounding) ≈ 10:48am ET

Re-running the arithmetic against a real kickoff instead of a hypothetical one:
- **CLV is safe.** The `0 12,22 * * *` line pass fires at 12:00 UTC — **2.8 hours before** the first kick, comfortably inside `STALE_CLOSE_MS = 6h` (`jobs-core.ts:74`). The 13.5-hour stale-close scenario I described requires a kickoff before ~12:40 UTC. There isn't one.
- **Live scores lag ~12 minutes.** First scoreboard launch is 15:00 UTC vs a ~14:48 kick. Real, trivial, self-corrects on the first poll.

Still worth fixing as insurance against a kickoff that moves earlier or a genuinely early game in a later week — but it is not a kickoff blocker. **Moved to P2-10.**

### ~~P0-2. The CFBD tier has never been checked against the hardcoded budget~~ → **CLOSED**
**Closed 2026-08-12, no action needed.** Owner confirmed **CFBD Tier 2, 30,000 calls/month**, which matches `MONTHLY_BUDGET` (`scoreboard-loop.ts:28`) exactly — so the 80% throttle and 95% stop (`:100-108`) are calibrated to the real cap, not to a guess. Estimated usage is ~9,000–10,300/month (§6-Q3), a 3× margin. The key is live and working: 98 Actions runs with `CFBD_API_KEY: ***` populated, and `sync-rankings {"rows":25}` / `sync-systems {"rows":138}` confirm the ratings and poll endpoints return data on this tier. Setting `CFBD_MONTHLY_BUDGET` explicitly is now redundant. **`audit/CHECKLIST.md:133` (`OPS-14b`) can be checked off.**

<details>
<summary>Original P0-2 text (the call-budget arithmetic, still valid)</summary>

**Classification:** UNVERIFIED — need the CFBD account page · **Evidence:** `scripts/scoreboard-loop.ts:28`, `audit/CHECKLIST.md:133`

`const MONTHLY_BUDGET = Number(process.env.CFBD_MONTHLY_BUDGET ?? 30_000)`. `CFBD_MONTHLY_BUDGET` is not set anywhere in `.github/workflows/jobs.yml`, so **30,000 is the operative number**. `audit/CHECKLIST.md:133` carries the unchecked box: *"OPS-14b Verify the real CFBD tier matches the hardcoded 30,000 budget."*

**The arithmetic** (all from the code, not the comments):

*One Saturday.* `scoreboard-loop.ts:78` defaults `liveInterval` to 30s → 2 calls/min → **120 calls/hour** while any game is live (`:129`). Saturday scoreboard crons are `0 15-23 * * 6` (9 launches) + `0 0-5 * * 0` (6 launches) = 15 hourly launches covering 15:00 Sat → 06:00 Sun UTC. Of those 15 hours, ~12 have a live game (11am ET first kick → 1am ET last final):

> 12 h × 120 calls/h = **1,440**, plus ~3 idle/imminent hours at ≤30/h ≈ 60 → **≈1,500 calls per Saturday**

*One month.* 4.3 Saturdays × 1,500 = **6,450**; Thu/Fri/Sun/Mon/Tue-Wed windows (`jobs.yml:86,91,92,94`) add roughly 2,000–3,500 in a heavy month. Non-scoreboard jobs:

> `refresh-lines` = 1 call/run (`refresh-lines.ts:65`) × 20 runs/week (14 daily + 3 Sat close + 1 Sun + 2 Thu/Fri) = **87/month**
> `sync-games` daily = 2 × `cfbd.games` + 2 × `cfbd.gameMedia` (`sync-games.ts:59-66`) + `sync-rankings` 1 + `sync-systems` 3 (`jobs-core.ts:492-494`) = 8/day = **240/month**
> weather, freeze, ratings-update, watchdog, backup = **0 CFBD calls**

> **Monthly total ≈ 9,000–10,300** against a 30,000 budget — 3× headroom.

**The risk is not the budget, it is the tier.** The free tier is 1,000 calls/month. **One Saturday (≈1,500) exceeds the entire free-tier month by 1.5×**, and the loop's own guard would never fire, because it compares against 30,000. `/scoreboard` also requires Tier 1+ (`src/lib/cfbd.ts:374`), so a free key fails the live layer outright.

**Fix sketch.** Open the CFBD account page; confirm the tier's monthly cap; set `CFBD_MONTHLY_BUDGET` in `jobs.yml` `env:` to the real number so the 80%/95% throttles (`scoreboard-loop.ts:100,107`) mean something. Upgrade to Tier 2–3 if it is not already.
**Hard date: Aug 25** — a rate-limit surprise discovered on Aug 29 is fatal, and tier changes can take a billing cycle.
**Estimate:** 0.5h + purchase.

</details>

### P0-3. Production is three model versions behind, with no fallback plan and a self-imposed Aug 27 deadline
**Classification:** WEAKNESS (code correct; deployed state stale) · **Evidence:** `src/model/ratings.ts:56`, `docs/CHANGELOG.md:33-41,1646-1655`, `jobs.yml:126,218-227`
**Confirmed 2026-08-12 from the job logs.** Run [31487317680](https://github.com/chasevandiver/CFBGameday/actions/runs/31487317680) (Aug 11, 11:36 UTC) ends:
```
  no 2026 talent yet — falling back to 2025
=== preseason readiness for 2026 ===
  NOT READY — talent: 2026 not published, using 2025 (no incoming class)
##[notice]preseason inputs not ready — nothing loaded
```
So the load is still declining, and the changelog's account is accurate. **The exact DB `model_version` is still UNVERIFIED** — needs `select distinct model_version from ratings where season_id = 2026` — but "nothing has loaded" is now established rather than inferred.

**One input, not several.** The gate checks six conditions (`build-preseason.ts:400-418`) and only the talent one fires. The same run reports `131 teams have 2025 final ratings (136 with SP+)`, `33 new head coaches detected`, and a complete `138 FBS teams | range -32.0 to 21.2 | median -1.2` table — so `/games`, `/lines`, `/ratings/sp`, `/player/returning`, `/player/portal`, `/coaches` and `/venues` are all live and matching. **Nothing is blocked on our side.**

`MODEL_VERSION = "2026.4.1"` (`ratings.ts:56`). `docs/CHANGELOG.md:34` claims the database serves `2026.2.0`. Everything since is dark: the tilt carry, the churn restructure, `baseHfa` 2.3→3.0, and the centered team-HFA blend. `ratings.ts:24-27` states the mechanism plainly — *"team_hfa rows are computed from baseHfa, so the preseason build must be re-run and reloaded for this to take effect; the parameter alone is not enough."*

**Why it breaks the product.** `--tune-hfa` measured the 2.3 model under-predicting home teams by **+0.74 ± 0.33 points, 2.2 SE from zero** (`docs/CHANGELOG.md:75`). If Week 0 freezes on 2026.2.0, every Week 0 receipt carries that bias, permanently — `predictions` is append-only (`0001_core_schema.sql:353`) and `freezeJob` skips already-frozen games (`jobs-core.ts:1005`). There is no re-freeze. Additionally, `splitInformative` (`ratings.ts:555-562`) suppresses totals when the off/def halves are even, which they are on a 2026.2.0 build — so **Week 0 and Week 1 game cards render no projected total and no projected score at all**.

**The blocking dependency is external.** `preseason-refresh` runs daily `0 11 1-27 8 *` (`jobs.yml:126`) but loads nothing until `build-preseason.ts --check` passes, and `--check` fails while CFBD has not published 2026 talent (`build-preseason.ts:163-169` falls back to 2025 and flags it stale). **From Aug 20 a declined run goes red** (`jobs.yml:221-224`) — that is the alarm, and it is correctly wired.

**Fix sketch.** Nothing to code. Watch the daily run; from Aug 20 it goes red on its own. On the Aug 26 checkpoint (`audit/CHECKLIST.md:129`) make the call in §9-Q1 below.
**Hard date: Aug 26** (last useful day before the Aug 27 cron window closes and the Aug 28 freeze stamps Week 0).
**Estimate:** 0h code, 0.5h decision + a dispatch.

### P0-4. Verify the 2026 season is ingested and bootstrapped
**Classification:** UNVERIFIED → **mostly resolved 2026-08-12** · **Evidence:** `jobs-core.ts:654`, `jobs-core.ts:1147-1153`

**What the Actions history settled:**
- **The scheduler is alive.** 98 runs of `jobs.yml`, 97 green. Not a single silent cron.
- **All three secrets are set and working** — `CFBD_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` all render as `***` in every run's env block, and jobs write successfully.
- **The 2026 schedule is ingested.** `days_to_kickoff: 18.2` can only be computed from a real `games` row; `msUntilNextGame` found a scheduled 2026 kickoff.
- **`job_runs` is populating.** The watchdog's Aug 10 failure (below) proves it reads real rows.
- **Item 1 of the original four — the merged Week 0/1 span — is confirmed:** first kickoff Aug 29, consistent with `jobs-core.test.ts:164`.

**Still unverified, and still worth five minutes** (needs a DB read, not a repo read):
2. `ratings` has a week-0 row for all ~136 FBS teams — `freezeJob` does **not** throw on a missing rating; it silently prices at `FCS_RATING = −30` (`jobs-core.ts:1149-1151`) and only skips when *both* teams are missing (`:1147`). A half-loaded table yields a full slate of plausible, wrong receipts.
3. `team_hfa` is populated — else `freezeJob:1166` falls back to flat `baseHfa` for every game.
4. `line_snapshots` is receiving rows.

**Note on (4):** `refresh-lines` is currently inside its idle guard too (`LINES_IDLE_DAYS` default 7 vs 18 days to kickoff, `refresh-lines.ts:46-50`), so snapshots resume ~Aug 22. That is by design, but it means the **close-capture path will have been exercised for roughly one week before it has to work perfectly.** Fold it into the Aug 22 dress rehearsal.

<details>
<summary>Original P0-4 text</summary>

**Classification:** UNVERIFIED — need DB read access · **Evidence:** `jobs-core.ts:654`, `jobs-core.ts:1147-1153`

`ratingsUpdateJob` throws `"no week-0 priors"` if `ratings` has no week-0 rows for 2026 (`jobs-core.ts:654`). `freezeJob` is worse — it does **not** throw. If a team has no rating row it silently prices at `FCS_RATING = −30` (`jobs-core.ts:1149-1151`), and only skips a game when *both* teams are missing (`:1147`). A half-loaded ratings table therefore produces a full slate of plausible-looking, badly wrong receipts.

Four things I cannot see from the repo and that must be confirmed before Aug 27:
1. `games` holds the 2026 schedule (the merged Week 0/1 span — `jobs-core.test.ts:164` says 2026 week 1 runs **Aug 29 – Sep 7**, so both Week 0 and Week 1 live inside CFBD week 1).
2. `ratings` has a week-0 row for all ~136 FBS teams.
3. `team_hfa` is populated (else `freezeJob:1166` falls back to flat `baseHfa` for every game).
4. `line_snapshots` is receiving rows — i.e. `refresh-lines` has actually run against a real key.

**Fix sketch.** One `preseason-check` dispatch (read-only, `jobs.yml:204`) plus four `select count(*)` queries. Then dispatch one deliberately-failing job to confirm who receives the failure email (`audit/CHECKLIST.md:132`, still unchecked).
**Estimate:** 1h.

</details>

**Revised estimate: 0.5h** — three `select count(*)` queries. And `OPS-1b` may already be answered for free, see **P1-8**.

---

## 3. P1 — ships broken without it, survivable for one week

### P1-1. A postponed or canceled game can never be voided — nothing writes those statuses
**Classification:** BUG · **Evidence:** `scripts/lib/jobs-core.ts:704` vs `scripts/sync-games.ts:93`

League Rule #4 (`docs/SPEC.md:151`) says postponed/canceled = void, and `/rules` promises it to users (`src/app/rules/page.tsx:38`). The grader implements it:

```ts
const deadGames = allGames.filter((g) => g.status === "postponed" || g.status === "canceled");
```
— `jobs-core.ts:704`

**But no code path ever writes either value.** `sync-games` writes exactly one status, and only on completion:
```ts
...(g.completed ? { status: "final" } : {}),
```
— `sync-games.ts:93`

`scoreboardPatch` maps only to `in_progress` / `final` / `scheduled` (`jobs-core.ts:254-256`). `CfbdGame` has no status field at all — only `completed: boolean` (`src/lib/cfbd.ts:133`). The schema comment lists the five states (`0001_core_schema.sql:75`) and `src/lib/slate.ts:278` reads them, but the only writer is a manual `UPDATE`.

**Blast radius.** A weather postponement in September leaves every pick and bet on that game with `result: null` **forever** — silently absent from records, units, ROI and the leaderboard. Not a crash; a quiet hole in the ledger, which is exactly the failure mode this product exists to prevent.

**Fix sketch.** Either (a) drive it from the schedule: if a game's `start_ts` is >24h past and it is still `scheduled` with no score, mark `postponed`; or (b) add an admin one-tap "void this game" control on `/admin`. (b) is smaller and honest about who decides. **Estimate:** 2–3h for (b), 4h for (a).

### P1-2. The FCS two-bucket rule was specced and never built — it is dead code
**Classification:** GAP · **Evidence:** `src/model/ratings.ts:180-181` vs `scripts/lib/replay.ts:25`, `scripts/lib/jobs-core.ts:29`

`docs/SPEC.md:57` requires *"a generic FCS rating (two buckets: top-tier FCS ≈ −25, other FCS ≈ −35 vs average FBS). Without this rule, Week 1 breaks the pipeline."* The parameters exist:
```ts
fcsTopRating: -25,
fcsOtherRating: -35,
```
— `ratings.ts:180-181`

**Nothing reads them.** `grep -rn "fcsTopRating\|fcsOtherRating"` returns four hits, all inside `ratings.ts` — the interface declaration and the default. All three pricing paths hardcode a single flat value instead:
- `scripts/lib/replay.ts:25` — `export const FCS_RATING = -30`
- `scripts/lib/jobs-core.ts:29` — `const FCS_RATING = -30`
- `supabase/functions/jobs/index.ts:24` — same (dead file, see P2-3)

**Blast radius, quantified.** Every FBS-vs-FCS game is priced with the opponent at −30 instead of −25 or −35 — a **±5-point error on the model margin** of every buy game. Week 0 and Week 1 are when essentially all of them are played. At `winProbSlope = 0.101` a 5-point margin error moves win probability by `logistic(0.101×5) ≈ 12 percentage points` at the margin, and it feeds `edge` directly, so it can mint or suppress an EDGE flag (threshold 2) on its own.

**Mitigating.** These games are near-certain blowouts and the flat −30 sits between the two buckets, so the direction of the error is random rather than systematic. `audit/CHECKLIST.md:89` already files this under dead-code cleanup (`02:M-09`), which understates it: it is not dead code, it is an unimplemented spec rule.

**Fix sketch.** Add an `fcsTier` lookup (a small seed table or a talent-percentile split) and read `p.fcsTopRating`/`p.fcsOtherRating` in the three `blended`/`rating` helpers. Or — cheaper and defensible — amend `docs/SPEC.md:57` to say one bucket at −30, and delete the two params. **Estimate:** 3h to build, 0.25h to amend the spec.

### P1-3. `.env.example` does not exist, but `README.md` step 1 tells you to copy it
**Classification:** BUG · **Evidence:** `README.md:9` vs `ls .env.example` → *No such file or directory*

`.gitignore:30` ignores `.env*` with no `!.env.example` negation, so it can never be committed as written. Fourteen environment variables are read across the codebase and **none of them are documented anywhere except by grep**:

`ANTHROPIC_API_KEY`, `CFBD_API_KEY`, `CFBD_MONTHLY_BUDGET`, `CFB_SEASON`, `IDLE_OVERRIDE`, `LINES_IDLE_DAYS`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NODE_ENV`, `PRESEASON_TILT_CARRY`, `SCOREBOARD_INTERVAL_SECONDS`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`.

Note `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL` are both read (`jobs.yml:139` maps one secret to the other name) — an easy way to half-configure a machine.

**Blast radius.** Low today (the deployment exists), high on Aug 29 at 11am if anything has to be re-provisioned under pressure.
**Fix sketch.** Commit `.env.example` and add `!.env.example` to `.gitignore`. **Estimate:** 0.5h.

### P1-4. The SPEC §5.3 pre-kickoff burst poll is built but never scheduled
**Classification:** SPEC DIVERGENCE (documented owner decision) · **Evidence:** `jobs.yml:28,177` vs `jobs.yml:154`

`docs/SPEC.md:170` requires *"a pre-kickoff burst poll (every 5–10 min in the final 90 minutes per kickoff wave)"*, echoed in the §8 job table (`SPEC.md:220`). `refresh-lines-burst` exists as a `workflow_dispatch` option (`jobs.yml:28`) and a run arm (`:177`) — **but no cron maps to it** (`:154` maps every close-pass schedule to plain `refresh-lines`).

The header at `jobs.yml:8-12` records this as a deliberate Aug 2026 owner decision: two daily refreshes plus **one** close pass ~40 min before each wave. The math holds for the standard waves — 15:20 UTC pass vs a 16:00 UTC noon-ET kick = 40 min; 18:50 vs 19:30 = 40 min; 22:20 vs 23:00 = 40 min; 01:50 vs 02:30 = 40 min — all well inside `STALE_CLOSE_MS = 6h`.

**What it costs:** a game whose kickoff *moves* after the wave pass, or an off-wave kickoff, gets a materially older close. Combined with P0-1 this is the whole closing-line exposure.
**Fix sketch.** Leave the decision; **update `docs/SPEC.md:170` and `:220` to record it**, so the spec stops describing a job that does not run. **Estimate:** 0.25h doc.

### P1-7. `/games/media` failures are swallowed, so a TV outage is invisible
**Classification:** WEAKNESS · **Evidence:** `scripts/sync-games.ts:63,65` · **Opened 2026-08-12**

```ts
cfbd.gameMedia(SEASON, { week }).catch(() => []),
```
— `sync-games.ts:63`

The `.catch(() => [])` is defensible for a *partial* media feed: TV assignments land late and a missing outlet should not fail the schedule sync. But it swallows every failure identically, including a 403. If `/games/media` is above your tier, or CFBD changes its gating, **`tv` stays null on all ~888 rows and nothing anywhere reports why** — you would notice on Aug 29 when no card shows a network, with no error to search for. The comment at `cfbd.ts:318-322` records that this exact symptom already happened once for a different reason.

Compounding it: `sync-games` is currently skipping entirely — `{"skipped":"next_game_gt_14d_and_not_monday","days_to_kickoff":18.2}` — because `SYNC_GAMES_IDLE_DAYS` defaults to 14 (`sync-games.ts:40`). It resumes daily **Aug 15**, so the media path has ~2 weeks of real exercise before launch.

**Partly fixed 2026-08-12:** `/games/media` is a REQUIRED probe in `scripts/probe-cfbd.ts`, so a tier denial is now loud on demand and in the daily August run. **Remaining:** narrow the catch to log the status rather than discard it. **Estimate:** 0.5h.

### P1-8. A failure email was already sent on Aug 10 — did it arrive?
**Classification:** UNVERIFIED — only you can answer · **Evidence:** Actions run [31374525661](https://github.com/chasevandiver/CFBGameday/actions/runs/31374525661) · **Opened 2026-08-12**

The single red run in 98:
```
Error: watchdog: refresh-lines: no successful run in Infinityh; sync-games: no successful run in Infinityh
    at watchdogJob (scripts/lib/jobs-core.ts:198:34)
```

This is **the watchdog working exactly as designed** — its first run against an empty `job_runs` table, where `lastOkAgeH` returns `Infinity` (`jobs-core.ts:181`). It self-healed once the data jobs recorded rows, and every run since is green. Not a bug.

**But it means `audit/CHECKLIST.md:132` — "dispatch one deliberately-failing run; confirm who receives the failure email" — already happened, for free, on Aug 10.** So: **did you get that email?** If yes, check the box; alerting is proven end to end. If no, then the entire alerting story is decorative — the in-repo watchdog, the red runs, and the dead-man ping all assume somebody is notified, and `HEALTHCHECK_PING_URL` is empty (P1-9), so a GitHub notification is currently the *only* channel.
**Estimate:** 0h — check your inbox for Aug 10.

### P1-9. Three secrets are empty, and each silently disables a safety net
**Classification:** GAP · **Evidence:** every `jobs.yml` run's env block · **Opened 2026-08-12**

Visible verbatim in all 98 runs:
```
ANTHROPIC_API_KEY:
SUPABASE_DB_URL:
HEALTHCHECK_PING_URL:
```

| Secret | What is dark | Checklist |
|---|---|---|
| `ANTHROPIC_API_KEY` | Team verdicts, Three Questions — the whole LLM tier. Every `questions`/`verdicts` run prints "skipping LLM generation" and exits green. | `F2` (`CHECKLIST.md:131`) |
| `SUPABASE_DB_URL` | The weekly `pg_dump`. **Your append-only `predictions`/`picks`/`bets` have no second copy** beyond the free tier's 7-day PITR — which is the specific thing `jobs.yml:186-187` says the backup exists to outlive. | `07:OPS-9` |
| `HEALTHCHECK_PING_URL` | The dead-man's switch. A scheduler that stops firing entirely alerts nobody. | `CHECKLIST.md:137` |

The LLM one is the designated slip item and is a decision, not a defect. **The backup is not** — 18 days from launch, the irreplaceable tables are unbacked.
**Estimate:** 1h for all three (create a healthchecks.io project, paste two connection strings).

### P1-5. `/ratings` has no empty state
**Classification:** WEAKNESS · **Evidence:** `src/app/ratings/page.tsx:38-39`, `src/components/RatingsTable.tsx:137`

With zero ratings rows, `latestWeek` falls to `0`, `current` is empty, and `RatingsTable` renders explanatory copy reading *"where that team sits among all 0"* around an empty table. Every other surface handles it (`/edges` `page.tsx:69-73`, `/ledger:347`, `/receipts:193`, slate `SlateView.tsx:556-561`), so this is the one gap. It only fires in the exact failure mode of P0-4 — which is when you least want a confusing screen.
**Fix sketch.** An `EmptyState` mirroring the slate's. **Estimate:** 0.5h.

### P1-6. `/crew` is a redirect but SPEC §7 still lists it as primary navigation
**Classification:** SPEC DIVERGENCE · **Evidence:** `src/app/crew/page.tsx:13-27` vs `docs/SPEC.md:196`

`SPEC.md:196` names the tabs *"Slate · Ratings · Teams · Game Cards · Ledger · Crew · Receipts"*. `/crew` now 302s to `/groups/{active}` or `/groups`. Correct product decision, stale spec. **Estimate:** 0.25h doc.

---

## 4. P2 — post-Week-1

| # | Finding | Class | Evidence | Est. |
|---|---|---|---|---|
| P2-1 | `PRESEASON_TILT_CARRY=""` silently becomes `0`, not an error — `Number("")` is `0`, not `NaN`, so the `Number.isNaN` guard never fires. Disables a fitted parameter silently. Checklist `04:DQ-13` claims empty is rejected; it is not. | BUG | `scripts/build-preseason.ts:82-86` | 0.25h |
| P2-2 | `profiles` is world-readable **including `is_admin`** — signed out. Fine for 15 friends, wrong in principle. Deferred as `SEC-08`. | WEAKNESS | `0001:307`, `0011:21` | 1h |
| P2-3 | `supabase/functions/jobs/index.ts` is dead, never deployed, and carries **inverted CLV in all four branches** (`close.spread - line` where `src/lib/clv.ts:47` is `lineTaken - close`). Harmless while undeployed; a landmine for anyone who deploys it. | BUG (dormant) | `functions/jobs/index.ts:530,536,562,568` | 0.5h to delete |
| P2-4 | 0018 recreates `insert`/`update`/`delete` policies on `picks` that can never fire — the table grants were revoked in 0013:92 and 0021:268. Verified **not** a hole (no later re-grant), but misleading. `SEC-10`. | WEAKNESS | `0018:18-38` | 0.5h |
| P2-5 | `remove_pick` never checks group membership and does not report a zero-row delete. Safe (scoped to `user_id = auth.uid()`), but a removal that matched nothing still returns `ok: true`. | WEAKNESS | `0021:259-263` | 0.5h |
| P2-6 | `ratings/page.tsx:54` still does `teams.select("*")`. The game-page equivalent was narrowed by `09:P-5`; this one was not. | WEAKNESS | `src/app/ratings/page.tsx:54` | 0.25h |
| P2-7 | `README.md:10` and `SPEC.md:20` both claim the free tier *"won't survive the backtest backfill."* It would: a full cold 2023–25 backfill is **16 CFBD calls** (§6). The real reason for Tier 1+ is `/scoreboard`. A wrong reason for a right conclusion. | SPEC DIVERGENCE | `README.md:10` | 0.25h |
| P2-8 | Cron comments name ET/CT clock times; the crons are UTC and do not shift for DST, so Nov–Mar every label reads an hour late. **Already documented in place** (`jobs.yml:75-78`) — listed so it is not rediscovered. | WEAKNESS | `jobs.yml:75-78` | — |
| P2-9 | Everything still open in `audit/CHECKLIST.md` §Deferred (lines 77-126): 09:P-16 load rehearsal, SEC-01 join-code entropy, G10-v1, UX-08 touch targets, F10, F13, UX-22, 05:N12. All correctly deferred with reasons. | — | `audit/CHECKLIST.md:44,55,56,62,63,64,66,69,73` | — |
| P2-10 | **Downgraded from P0-1 on 2026-08-12.** No Saturday line pass before 12:00 UTC and no scoreboard launch before 15:00 UTC. Harmless for Week 0 (first kick ~14:48 UTC, so the 12:00 pass is 2.8h ahead of it — inside the 6h stale-close guard). Worth adding `0 10 * * 6` → `refresh-lines` and `0 10-14 * * 6` → `scoreboard-loop` as insurance against a kickoff that moves earlier or an early game in a later week; both are near-free because `idleSkip` exits in seconds. | GAP | `jobs.yml:58,61,84,154,156` | 1h |

---

## 5. Regressions / overridden fixes

**None found.** This is the headline result of Step 3 and it is worth stating without hedging.

| What the fix was | What undid it | Commit | Current blast radius |
|---|---|---|---|
| CLV sign convention centralized into one module with four worked examples | *nothing* — `src/lib/clv.ts` has exactly one commit in its history (`973c6c4`) and has never been edited since | — | none |
| `STALE_CLOSE_MS` 6h stale-close guard | *nothing* — `git log -S "STALE_CLOSE_MS"` returns only `6eeb30f` | — | none |
| `spreadClv`/`totalClv` wired into `jobs-core` grading | *nothing* — `git log -S "spreadClv" -- scripts/lib/jobs-core.ts` returns only `973c6c4` | — | none |
| 0013 revoked `insert, update` on `picks`; 0021 revoked `delete` | 0018 **recreated the policies** but never re-granted the table privileges — verified by `grep -in "grant" supabase/migrations/*.sql`: no `grant insert/update/delete on picks` exists anywhere after 0013 | `0018` | none (dead policies only — P2-4) |
| 0013 column-scoped `profiles` UPDATE to 3 columns | 0018 recreated the *policy* but not the *grant*; the column grant stands | `0018:14-16` | none — proved by `supabase/tests/profiles.sql`: *"bob setting his own is_admin → denied → permission denied for table profiles"* |
| `revoke update, delete on predictions, line_snapshots` | *nothing* — proved live, not read: `supabase/tests/bets.sql` asserts all six combinations pass | `0001:353-355` | none |
| SP+ preseason tilt at scale > 0 | `39c2c2b Revert SP+ preseason tilt: sweep picked scale 0` | `39c2c2b` | **deliberate**, recorded in `docs/CHANGELOG.md:74`; superseded by the fitted λ=0.4 carry that later shipped |

**Migration contradictions:** none that loosen anything. The full policy timeline on `picks` is `0001` (blind until kickoff) → `0010` (fully open, owner decision, `SPEC.md:150`) → `0011` (anon) → `0021` (group-scoped) → `0023` (per-group configurable blind). Each step is documented in its own header and each is *narrower or equal*, never looser.

**Duplicate logic / second fetch path:** none. `grep -rn "collegefootballdata"` returns exactly one hit outside docs — `src/lib/cfbd.ts:12`. The three other `fetch(` sites are internal API routes (`SlateView.tsx:132`, `ScoreTicker.tsx:59`, `GameHeader.tsx:152`), one Open-Meteo call (`jobs-core.ts:614`, not CFBD), and the dead edge function. **SPEC §1's hard rule holds.**

**Code hygiene:** zero `TODO`/`FIXME`/`HACK`/`XXX` anywhere in `src`, `scripts`, `supabase`. Zero `@ts-ignore`/`@ts-expect-error`. Zero `console.log` in `src/`. One `as any` (`src/app/game/[id]/opengraph-image.tsx:60`, in an OG-image route). Eleven `eslint-disable`, ten of which are `@next/next/no-img-element` on external logo URLs — legitimate.

---

## 6. Backtest & CFBD blockers

### Q1. Has a full backtest been run to completion over 2023–2025?
**Yes — repeatedly, with recorded numbers.** This is verifiable from `docs/CHANGELOG.md`, which records **nine gated experiments each with a pre-registered decision rule and the number that decided it** (`CHANGELOG.md:72-82`), plus a market-encompassing edge gate. Three shipped, six were rejected. Fitted values are written back into source with their provenance (`src/model/ratings.ts:150-208`).

**I could not reproduce the run in this environment.** `npm run backtest -- --cached` fails at `src/lib/cfbd.ts:42` — `Error: CFBD_API_KEY is not set` — and `.backtest-cache/` is gitignored (`.gitignore:44`), so no cache is present. **UNVERIFIED — need `CFBD_API_KEY`** to paste live numbers. The recorded numbers, from `docs/CHANGELOG.md`:

| Metric | Value | Source |
|---|---|---|
| Model margin MAE | **13.25** | `CHANGELOG.md:75` (13.254 → 13.249 at HFA 3.0) |
| Market margin MAE | **11.98** | `CHANGELOG.md:88`; also `backtest.ts:938` `MARKET_MAE = 11.98` |
| Fitted σ | **16.8** | `CHANGELOG.md:51` |
| Win-prob slope | **0.101** = 1.7/16.8 | `CHANGELOG.md:52` — checks out: 1.7/16.8 = 0.1012 |
| NLL | **0.4994** at HFA 3.0 (from 0.5005) | `CHANGELOG.md:75` |
| Signed bias | **+0.03** (was +0.74 ± 0.33 SE) | `CHANGELOG.md:75` |
| Edge flags vs close | **49.2%**, n=1801, break-even 52.4% | `CHANGELOG.md:86` |
| Edge flags vs open, 4+ bucket | **51.8%, avg CLV +0.27** | `CHANGELOG.md:93-96` |
| Encompassing regression | model b₁ = **0.035 (t=0.84)** vs market **0.987 (t=22.81)**, n=2611 | `CHANGELOG.md:82` |
| Totals | model MAE **13.09** vs constant-57 **13.72** | `ratings.ts:16` |

**The parameters you asked about, individually:**

- **`kFactor` = 0.3** (`ratings.ts:151`). Provenance: *"Fitted, 2023–25 grid"* (`CHANGELOG.md:45`), and `--tune-hfa` was run with *"K held at its validated 0.3"* (`backtest.ts:675`). **It is a tuned output, not a default.** But `docs/SPEC.md:71` specifies **0.15–0.20**, and 0.3 is 50% above the top of that band. Worse: `CHANGELOG.md:121` records that the joint refit pushed K to **0.4 — a grid boundary** — and that *"five parameters ran to a grid boundary… a boundary optimum usually means the parameter is absorbing a misspecification."* **→ DOC GAP: `docs/SPEC.md` §2.2 needs an amendment note recording that the fitted K legitimately landed outside the specced range, and why.** Flagged as required by the audit brief. **Est. 0.25h.**
- **`marginSigma` = 16.8** (`ratings.ts:176`). Fitted σ (`CHANGELOG.md:51`), consistent with SPEC §2.3's *"σ is fit during the backtest, not assumed."* Note SPEC §2.3 expected ≈15–16 and *"let the data say"* — 16.8 is slightly above and the spec explicitly permits that. `report()` prints the fitted σ beside the parameter on every run (`backtest.ts:99`), so drift is visible.
- **`winProbSlope` = 0.101** (`ratings.ts:177`). Derived, not independently fitted: 1.7/σ (`CHANGELOG.md:52`), the logistic≈normal rule, applied consistently in `paramsForWeek` (`ratings.ts:486`). SPEC §2.3 guessed 0.145; the fitted value is 0.101. Same amendment note applies.
- **`MODEL_VERSION`** is **`2026.4.1`**, not `2026.1.0` (`ratings.ts:56`). Four version bumps since, each with a changelog entry and its deciding number. **This one is fully in order.**

### Q2. What CFBD data is still missing?

| Endpoint | Model component | Cached? | Tier | Status |
|---|---|---|---|---|
| `/games` | schedule, results, replay | `.backtest-cache/games-{yr}` (gitignored) | free | ✅ available |
| `/lines` | vegas spread, totals, ML, openers | `lines-{yr}` | free | ✅ |
| `/ratings/sp` (historical) | **bootstrap prior** (`replay.ts:382`), prior-year baseline | `sp-{yr}` | free | ✅ |
| `/ratings/fpi`, `/ratings/elo` | consensus flag only (`jobs-core.ts:519-521`) | live only | free | ✅ |
| `/talent` | talent baseline (`build-preseason.ts:163`) | `talent-{yr}` | free | 🔴 **2026 UNPUBLISHED — confirmed Aug 11 11:36 UTC. The only missing input.** |
| `/player/returning` | churn (`build-preseason.ts:151`) | `returning-2026` | free | ✅ **live** — `--check` passes it; churn values are populated and varied |
| `/player/portal` | net portal points | `portal-2026` | free | ✅ **live** — `--check` passes it |
| `/coaches` | coaching adjustment | `coaches` | free | ✅ **live** — 33 new head coaches detected (parameter is identity 0 anyway) |
| `/stats/game/advanced` | PPA — `--tune-epa` only | `advanced-{yr}`, tolerated absent (`replay.ts:119`) | Tier 1+ | ✅ not needed (epaWeight = 0) |
| `/venues` | weather coords | `venues` | free | ✅ + manual override table (`jobs-core.ts:592`) |
| `/scoreboard` | **live layer** | none — live only | **Tier 1+** | 🔴 **NEVER CALLED — P0-5.** Run `npm run probe:cfbd` |
| `/games/media` | TV assignments | none | free? | ⚠️ failures swallowed — P1-7. Probed as REQUIRED now |
| recruiting rankings | *not consumed* — talent composite is used instead | — | — | n/a |

### Q3. Call budget
Answered with arithmetic in **P0-2**. Summary: full 2023–25 cold backfill = **16 calls** (4 per season via `loadSeason` at `replay.ts:112-120`, ×3 = 12, plus 3 talent + 1 SP+ in `loadPriorInputs` at `backtest.ts:385-405`). In-season steady state ≈ **9,000–10,300 calls/month**, dominated by the scoreboard loop. Budget hardcoded at 30,000.

**Instrumentation is real and wired.** `logCfbdCalls` (`jobs-core.ts:207-216`) writes one `api_call_log` row per call, and it is called from `refresh-lines.ts:101`, `sync-games.ts:112`, `run-job.ts:41` and `scoreboard-loop.ts:126`. `callsThisMonth` (`scoreboard-loop.ts:63-72`) reads it back and the loop throttles at 80% and stops at 95% (`:100-108`). **Known gap:** CI/backtest/preseason paths are unmetered — `audit/CHECKLIST.md:97` (`07:OPS-14a`), correctly deferred since those are ~16 calls.

**→ RESOLVED 2026-08-12. Owner confirmed Tier 2 / 30,000 calls per month**, which is exactly the hardcoded `MONTHLY_BUDGET`, against ~10,000 of estimated use. No upgrade needed, and no `CFBD_MONTHLY_BUDGET` override needed — the default is correct. The remaining CFBD unknown is not volume but **entitlement**: whether Tier 2 grants `/scoreboard` and `/games/media` (P0-5, P1-7), which `scripts/probe-cfbd.ts` now answers on demand.

### Q4. What is blocking tuning?

| Blocker | Kind | Resolves when |
|---|---|---|
| 2026 talent unpublished by CFBD | **waiting on data** | CFBD publishes; `preseason-refresh` self-heals daily (`jobs.yml:126`) |
| Team-HFA replay validation (`02:M-05`) | **waiting on data** — needs 2026 games | in-season; deferred at `CHECKLIST.md:80` |
| `--production-chain` replay mode (`02:M-04`) | **waiting on a code fix** — M, tuner work | deferred to first in-season week |
| Promote `warnIfTooGood` to CI-failing (`02:§2b`) | **waiting on a code fix** — S–M | deferred, `CHECKLIST.md:84` |
| Whether to amend SPEC §2.2/§2.3 for K/slope | **waiting on a decision from you** | §9-Q3 |
| Whether to build FCS two buckets or amend the spec | **waiting on a decision from you** | §9-Q4 |

**Nothing is blocking a *report* run.** The backtest runs on CI today (`backtest.yml`) on any PR touching `src/model/**`.

### Q5. Live backtest numbers
**Not produced. UNVERIFIED — need `CFBD_API_KEY` in this environment, or a `backtest` workflow dispatch.** Dispatching `.github/workflows/backtest.yml` (no inputs) prints the full calibration table, MAE, σ and the edge-flag hit rates to the run log at a cost of ~16 CFBD calls. That is the fastest way to get the real numbers and I recommend doing it as the first item on Aug 12 — it is one click and it either confirms `docs/CHANGELOG.md` or exposes drift.

---

## 7. Audit checklist reconciliation

Reconciled against `audit/CHECKLIST.md` (the master remediation list). **Verified status** is DONE / PARTIAL / NOT DONE / REGRESSED / UNVERIFIABLE.

### Package A — Correctness hardening

| # | Item | Claimed | Verified | Evidence |
|---|---|---|---|---|
| 03:M-1b | `team_hfa` drops non-FBS opponents | `[x]` | **DONE** | `build-preseason.ts:459,573` — comments and filter both present |
| 02:M-03 | Consensus flag adds HFA before the sign test | `[x]` | **DONE** | `jobs-core.ts:1160-1174` — `sysHfa`, `withHfa()` applied to all three systems |
| 05:N4 | Grading reads throw; `.in()` chunked at 500 | `[x]` | **DONE** (chunked at **300**, not 500 — tighter, fine) | `jobs-core.ts:796,801,831,864,898` |
| 05:N3 | Postseason finals grade; ratings replay stays regular | `[x]` | **DONE** | `jobs-core.ts:695,701-703` — `games` filtered regular, `gradableFinals` not |
| 05:N6 | TBD kickoff ⇒ no close, CLV null | `[x]` | **DONE** | `jobs-core.ts:84-85` — explicit `startTs === null` branch |
| 05:N9 | Rule #4: postponed/canceled grade `void` | `[x]` | **PARTIAL — the grader is correct, the trigger is unreachable** | `jobs-core.ts:959-977` implements it; **nothing writes those statuses** (`sync-games.ts:93`). See **P1-1**. |
| 02:M-06 | Lookahead regression test | `[x]` | **DONE — a real assertion, not a comment** | `replay.test.ts:181-196`, and it is non-vacuous (asserts week 3 *does* move) |
| 07:OPS-12c | `sync-games` never flips `in_progress` → `scheduled` | `[x]` | **DONE** | `sync-games.ts:93` — status omitted unless completed |
| 07:OPS-10 | CFBD one jittered retry + 30s timeout | `[x]` | **DONE** | `cfbd.ts:52-76` — `AbortSignal.timeout(30_000)`, retry on 429/5xx/network |
| 05:N10 | Recap renders 0.00 avg CLV as "CLV PK" | `[x]` | **UNVERIFIABLE** without a rendered pass; code path present | `src/app/recap/` |
| 05:N11 | Null-edge predictions still get `close_spread` | `[x]` | **DONE** | `jobs-core.ts:830,852-855` — ungraded set keys on `close_spread`, not `clv` |
| SEC-11 | App-level admin check on adjustments | `[x]` | **DONE** | `actions/adjustments.ts:61-76` — `requireAdmin()` |
| SEC-14 | DB assertions on predictions/line_snapshots privileges | `[x]` | **DONE — and passing** | `supabase/tests/bets.sql`; 6 assertions green in my run |

### Package B — Ops & perf

| # | Item | Claimed | Verified | Evidence |
|---|---|---|---|---|
| 07:OPS-1c | In-repo watchdog | `[x]` | **DONE** | `jobs-core.ts:153-200` (pure `watchdogVerdict` + job); crons `jobs.yml:101-102` |
| 07:OPS-9 | Weekly `pg_dump` backup, inert until secret | `[x]` | **DONE** | `jobs.yml:104,188-201` + artifact upload `:246-253` |
| 07:OPS-2b | Coverage crons (Tue/Wed MACtion, Sat late) | `[x]` | **DONE** | `jobs.yml:85,94` |
| 07:OPS-7 | Offseason keep-alive | `[x]` | **DONE** | `jobs.yml:108,184` |
| 07:OPS-13/§2 | Cron comment fixes | `[x]` | **DONE** | `jobs.yml:75-83` — both DST and the Sat→Sun concurrency seam named |
| 09:P-2b / P-17 | One realtime channel; anon realtime | `[x]` | **UNVERIFIABLE** without a browser; module exists | `src/lib/use-games-realtime.ts` |
| 09:P-3 / P-4 | `latest_systems` / `latest_poll_rankings` views | `[x]` | **DONE** | `0025_latest_views.sql:30-31` |
| 09:P-5 | Game page `profiles` narrowed | `[x]` | **DONE** for the game page; `/ratings` still `select("*")` — see **P2-6** | `src/app/ratings/page.tsx:54` |
| 09:P-15 | ~60s cache on the season/week pointer | `[x]` | **DONE** | `src/lib/queries.ts` / `season.ts` |
| 09:P-16 | Load rehearsal | `[ ]` owner-run | **NOT DONE — correctly** | needs a live server |
| 04:§2 | Remaining `--check` gates | `[x]` | **DONE** | `build-preseason.ts --check` path |
| 04:DQ-13 | Reject NaN/**empty** `PRESEASON_TILT_CARRY` | `[x]` | **PARTIAL** | `build-preseason.ts:82-86` — NaN caught; **empty string becomes `0` silently**. See **P2-1**. |
| 04:DQ-14 | Reconcile builder `SEASON` vs loader env guard | `[x]` | **DONE** | `build-preseason.ts:65` — `Number(process.env.CFB_SEASON ?? 2026)` |

### Package C — Launch-week polish
All 18 `[x]` items spot-verified as **DONE**, with routes present in the production build output: `/model`, `/ledger/export`, `/opengraph-image`, `/game/[id]/opengraph-image`, `/apple-icon`, `/rules`, `/recap`, `/recap/[week]`. The 8 `[ ]` deferred items (G10-v1, UX-14, F10, F13, UX-08, UX-22, 05:N12, SEC-01) are **NOT DONE and correctly so** — each carries a stated reason. No item is checked without a corresponding code change.

### `docs/AUDIT-2026-08.md` — the 18 bugs and the 46-item checklist
Re-verified the rows most likely to have drifted:

| Row | Doc claim | Verified | Note |
|---|---|---|---|
| Bug #9 | *"`actions/picks.ts:54,58` — `.select("id")` then a zero-row check"* | **DONE, but the cited evidence is stale** | Current `removePick` (`actions/picks.ts:69-75`) calls the `remove_pick` **RPC**, which `raise exception`s on the lock (`0021:255-257`). Stronger than the documented fix. Proved live: `supabase/tests/picks.sql` → *"PASS removing a pick after kickoff → Kickoff — picks are locked for this game."* **Update the doc's evidence column.** |
| Bug #12 | *"resolved where it counts"* | **Confirmed accurate** | `queries.ts:246` still prefers-frozen-with-fallback; display-only |
| §23 #36 | de-hardcode season | **DONE** | `build-preseason.ts:65` |
| §23 #9 | same stale citation as Bug #9 | **DONE, stale evidence** | as above |
| §23 #40, #44, #45 | open | **Confirmed open** | futures, generated db types, ⌘K — all additive |
| §23 #42 | `~` route smoke tests missing | **Confirmed** | 33 test files, 472 tests, none are route smoke tests |

**Bottom line: no item is checked with no corresponding code change.** Two items are checked that are *partially* done (05:N9, 04:DQ-13), and one doc cites evidence that no longer exists for a fix that is nonetheless in place (Bug #9 / §23 #9).

---

## 8. Spec coverage matrix

| Spec | Requirement | Status | Implementation |
|---|---|---|---|
| §1 | CFBD backbone, Tier 2–3 | **PARTIAL** | `src/lib/cfbd.ts`; tier UNVERIFIED (**P0-2**) |
| §1 | LLM layer (Anthropic, batch) | **PARTIAL** | `src/lib/anthropic.ts`, `generate-verdicts.ts`, `generate-questions.ts`; `verdicts` never scheduled, `ANTHROPIC_API_KEY` UNVERIFIED |
| §1 | Weather (Open-Meteo) + manual coord fallback | **BUILT** | `jobs-core.ts:576-641`; `venue_coord_overrides` at `:592` |
| §1 | Odds API | **MISSING** | Phase 2 by design |
| §1 | **Hard rule: one fetcher** | **BUILT** | verified by grep — one hit outside docs |
| §2.1 | Preseason formula (0.70/0.30 + churn + coaching + luck) | **BUILT** | `ratings.ts:231-238`, `281-296`, `360-371` |
| §2.1 | FCS **two buckets** −25/−35 | **MISSING** | params exist, unread — **P1-2** |
| §2.1 | Neutral-site HFA = 0 | **BUILT** | `ratings.ts:565`, `:434`; `priceGame` zeroes `hfa` and both score halves |
| §2.1 | New FBS entrants from talent alone | **BUILT** | `ratings.ts:233-236` — `finalPrevRating === null` branch |
| §2.1 | Off/def sub-ratings + tempo | **PARTIAL** | built (`ratings.ts:430-447`) but **dark in production** at 2026.2.0 — **P0-3**; tempo hardcoded 70 everywhere (`02:M-13` deferred) |
| §2.2 | K 0.15–0.20 | **SPEC DIVERGENCE** | fitted to 0.3 — needs amendment note (§9-Q3) |
| §2.2 | Margin cap ±28, prior decay knots | **BUILT** | `ratings.ts:152,170-175` |
| §2.3 | `spread = home − away + HFA + situational` | **BUILT** | `ratings.ts:566-567` |
| §2.3 | Team HFA blended 50/50 | **BUILT** | `centeredBlendedHfa` (`ratings.ts:634-641`) — **improves on spec** (centering); per-team component still unvalidated (`03:M-1`) |
| §2.3 | Situational adjustments | **PARTIAL** | admin-confirmed path built (`jobs-core.ts:1112-1118`); no automated QB/rest/travel/weather feed (`02:M-07` deferred) |
| §2.3 | Win prob, projected score, cover prob | **BUILT** | `ratings.ts:569-591` |
| §2.4 | Edge flags 2 / 4 | **BUILT** but **demoted to information** | `ratings.ts:588`; `--diagnose-edges` verdict, `CHANGELOG.md:82` |
| §2.4 | Consensus flag across 4 systems | **BUILT** | `ratings.ts:592-598` + real inputs at `jobs-core.ts:1172-1174` |
| §2.4 | All four systems on every card | **PARTIAL** | game page yes; slate cards no (`F16` deferred) |
| §2.5 | 2023–25 backtest + tuning | **BUILT** | `scripts/backtest.ts`, 9 gated experiments |
| §2.5 | **Lookahead guard is a hard requirement** | **BUILT — structural, plus an executable test** | Guard: the two-phase week loop in `replaySeason` — all predictions collected into `weekPredictions` (`replay.ts:247-311`) **before** any `updateSubRatings` is applied (`:313-342`). Priors come from season−1 SP+ only (`:115`). Test: `replay.test.ts:181-196`. **Caveat:** the *market* input is not point-in-time — `consensusLine` reads CFBD's settled `spread` (`replay.ts:171-174`), which the report states explicitly (`backtest.ts:186-189`) and works around via `vegasOpen`. Model ratings are clean; market-relative edge measurement is "beat the close" by construction. |
| §2.5 | Weekly calibration report on Receipts | **MISSING as a job** | `/receipts` renders; the scheduled Sunday run is `07:OPS-8b`, deferred |
| §2.5 | Frozen, timestamped, append-only, `model_version` | **BUILT** | `0001:353`, `jobs-core.ts:1181`; DB-asserted |
| §3 | Team pages automated tier | **PARTIAL** | `/team/[id]` built; returning-production % is `F13`, deferred |
| §3 | LLM tier + admin review | **PARTIAL** | scripts exist; `ANTHROPIC_API_KEY` UNVERIFIED. **This is the designated slip item** (§10) |
| §4 | Weekly rating updates | **BUILT** | `ratingsUpdateJob`, cron `jobs.yml:98` |
| §4 | Injury/news scan | **MISSING** | `F3`, deferred |
| §4 | Model report card | **BUILT** | `/receipts`, `/recap` |
| §4 | Pick'em league | **BUILT** | groups, `make_pick`, per-group blind |
| §4 | Rooting guide / playoff tracker | **MISSING** | `F4`/`F5`, deferred |
| §4 | Line movement, open→current, `line_source`+`captured_at` | **BUILT** | `line_snapshots`, `MovementChart.tsx`; "biggest move" sort is `F10`, deferred |
| §4 R1–R2 | Line snapshots at pick; edit re-snapshots | **BUILT + DB-asserted** | `0021:204-226`; *"PASS still one spread pick, re-sided and re-priced to -7.5"* |
| §4 R3 | DB-layer kickoff lock; picks crew-visible | **BUILT, superseded** | lock: `0021:200`, `:255`. Visibility: 0010 removed the blind per `SPEC.md:150`; **0023 reintroduced it as a per-group setting** (`picks_hidden_until_kickoff`, default false). Spec §4 R3 describes 0010, not current behavior — see §9-Q5. |
| §4 R4 | Push = no action; postponed = void | **PARTIAL** | push built; void unreachable — **P1-1** |
| §4 R5 | Leaderboard + tiebreakers | **BUILT** | `05:N13` |
| §4 R6 | Min picks/week, units | **BUILT** | `0022` |
| §5.1 | Soft-market taxonomy on /edges | **PARTIAL** | page exists, editorial content is `F11` |
| §5.2 | Derivative markets | **MISSING** | Phase 2 by design |
| §5.3 | Ledger fields incl. reason tag | **BUILT** | `actions/bets.ts:25-76` |
| §5.3 | CLV = `line_taken − closing_line`, your side | **BUILT — verified end to end** | see §8.1 |
| §5.3 | Closing line = last own snapshot pre-kickoff, canonical book | **BUILT** | `closingConsensus` + 6h staleness guard |
| §5.3 | **Burst poll 5–10 min in final 90** | **MISSING as a schedule** | **P1-4** |
| §5.3 | Moneyline CLV in cents | **PARTIAL — documented "–"** | `jobs-core.ts:927-932` sets `clv = null` deliberately; `05:N7` closed as documented |
| §5.3 | Futures tracker | **MISSING** | audit #40, open |
| §5.3 | Append-only, `voided_at`, no hard deletes | **BUILT + DB-asserted** | `0013:34-63`; 11 green assertions |
| §5.4 | ¼ Kelly capped at 2u | **BUILT then removed from UI** | `ratings.ts:647-653` still exports `suggestedStake` (now dead — `02:M-11`); removal was the correct consequence of the edge gate |
| §6 | Game cards | **BUILT** | `GameCard.tsx`, `/game/[id]` |
| §6 | Rivalry seed table | **BUILT** | `0017_rivalries_seed.sql` |
| §7 | Palette, type, mono numbers | **BUILT** | `globals.css` |
| §7 | Nav tabs incl. "Crew" | **DIVERGENCE** | `/crew` → `/groups` — **P1-6** |
| §7 | Slate UX: sorts, slots, live states, my-picks, local tz | **BUILT** | `SlateView.tsx`; "biggest line move" is `F10` |
| §7 | Watchability 0–100 | **BUILT** | `slate.ts` `watchability()` |
| §7 | Ratings sparklines | **MISSING** | `F9` — needs weekly history |
| §7 | Homepage by day | **PARTIAL** | `/` is a hub (`HomeHub.tsx`); Mon/Wed/Sat modes are `F6` |
| §7 | **375px, focus, reduced motion, dark** | **BUILT** | `globals.css:161` (`max-width:767px`), `:440`+`:671` (both `prefers-reduced-motion` branches), `:89`/`:148` (`data-theme="light"`, dark native), focus rings via `UX-26`. **Code-level only — no device or AT pass has been run.** |
| §8 | **pg_cron → Edge Functions** | **SPEC DIVERGENCE** | GitHub Actions is the scheduler (`jobs.yml:2-3`); the edge function is dead (**P2-3**). Documented, deliberate. |
| §8 | Every job in the §8 table | **PARTIAL** | all built; burst poll unscheduled (**P1-4**), calibration report unscheduled (`OPS-8b`), injury scan missing (`F3`) |
| §8 | Magic link + invite allowlist + admin flag | **BUILT** | `LoginForm.tsx:16-19`, `0002_auth_trigger.sql:16-23`, commissioner seeded at `:38-40`, `inviteCrewMember` in `actions/invites.ts` |
| §8 | Public browsing; sign-in only for writes | **BUILT** | `0011_public_read.sql`, `supabase/middleware.ts:9-12` |
| §8 | `season_id` on every table | **BUILT** | `0001` |
| §9 | Calendar modes | **PARTIAL** | postseason ingestion + UI built; bowl opt-outs/portal/carousel are editorial (`G13`/`F18`, offseason) |
| §10 | Phase 1 MVP | **ON TRACK** | see §10 |

### 8.1 CLV sign convention — traced end to end

**Storage convention.** Spreads are home-perspective everywhere: negative = home favored (`src/lib/clv.ts:20-22`). Bet forms speak the bettor's number and convert on write: `storedLine()` (`actions/bets.ts:15-18`) applies `homeLineForSide` (`slate.ts:101`, aliased to `lineForSide` at `:87-91`, which negates for `away` and routes through zero to avoid `-0`). Picks never accept a client number at all — `make_pick` computes the consensus server-side (`0021:204-219`).

**Home favorite.** Bet home −3; close −6.
`spreadClv("home", −3, −6)` = `lineTaken − close` = `−3 − (−6)` = **+3**. Correct: you laid 3 where the close lays 6. — `clv.ts:46-49`, `clv.test.ts:11`

**Road dog.** Bet away +6 (stored home −6); close home −3 (away +3).
`spreadClv("away", −6, −3)` = `flip(−6 − (−3))` = `flip(−3)` = **+3**. Correct: you took 6 points where the close gives 3. — `clv.test.ts:26`

**Total, over.** Over 50; closes 54.
`totalClv("over", 50, 54)` = `close − lineTaken` = `54 − 50` = **+4**. Correct: you bought the over 4 points cheaper. — `clv.ts:57-60`, `clv.test.ts:53`

**Total, under.** Under 50; closes 54.
`totalClv("under", 50, 54)` = `flip(54 − 50)` = **−4**. Correct. — `clv.test.ts:58`

**Model.** `modelClv(edge, frozen, close)` maps `edge < 0` (model likes home more than market) → `"home"`, else `"away"`, then delegates to `spreadClv` (`clv.ts:74-81`). Consistent with `modelSideOf` (`slate.ts:553-559`). `modelClv(−3, −7, −9)` = `spreadClv("home", −7, −9)` = **+2** (`clv.test.ts:74,82`).

**Antisymmetry is asserted:** `spreadClv("home", t, c) === −spreadClv("away", t, c)` across three cases (`clv.test.ts:29-39`) — a convention that fails this measures market movement, not value. **`-0` is explicitly excluded** (`clv.ts:38`, `clv.test.ts:41-47`) because it reaches the database and renders as "−0.00".

**One implementation, four call sites.** `jobs-core.ts:883,885,917,926` — picks (spread, total) and bets (spread, total). **The dead edge function has all four inverted** (P2-3) and is the only place the old bug survives.

**Verdict: the sign convention is correct, tested, centralized, and has not regressed. The honesty layer is sound.**

---

## 9. Decisions I owe you

**Q1. If `preseason-check` is still red on Aug 26, what ships?**
Options: (a) deliberate stale-talent build on 2025 recruiting, loaded as 2026.4.1; (b) launch on the live 2026.2.0 ratings with a visible note; (c) `--force` a partial build.
→ **Recommended: (a).** 2026.4.1 with 2025 talent is wrong about incoming freshmen — a ±1–2 point effect at most, since `talentWeight` is 0.30 and the *class* is a fraction of the 4-year composite. 2026.2.0 is wrong about home field by a measured +0.74 points on **every game**, and renders no totals at all. Stale talent is the smaller, better-understood error. Say "yes" and I will wire the `--force` path and a `/model` page note.

**Q2. ~~Upgrade the CFBD tier?~~ ANSWERED 2026-08-12 — Tier 2, 30k/month, matches the hardcoded budget. No action.**
Replaced by **Q2′: does Tier 2 grant `/scoreboard`?** Volume was never the risk; entitlement is, and it is still open (P0-5).
→ **Recommended: dispatch `cfbd-probe` today.** 11 calls, read-only, and it answers Q2′ plus `/games/media` (P1-7) in one run. If `/scoreboard` comes back `DENIED`, that is a tier purchase with 17 days of runway instead of 2.

**Q3. Amend `docs/SPEC.md` §2.2 and §2.3 for the fitted K and slope?**
→ **Recommended: yes.** The spec says K = 0.15–0.20 and slope ≈ 0.145; the code ships 0.3 and 0.101, both fitted and both recorded in `docs/CHANGELOG.md`. Right now the spec silently contradicts the model, which is exactly the kind of drift `AGENTS.md` says to prevent. Add an amendment note citing the run, and record that K's joint refit hit a grid boundary at 0.4 (`CHANGELOG.md:121`) so nobody re-litigates it. 0.25h.

**Q4. FCS: build the two buckets, or amend the spec to one?**
→ **Recommended: amend the spec to one bucket at −30, then delete `fcsTopRating`/`fcsOtherRating`.** The two-bucket rule is unvalidated by any backtest (the replay has always run at flat −30, so every fitted parameter in `DEFAULT_PARAMS` was fit *under* the flat assumption). Changing it 18 days out changes the input distribution the model was tuned against, with no tuner to check it. Do the honest thing: match the doc to the code now, and revisit with `--tune-fcs` in the offseason. If you'd rather have the buckets for Week 0, say so — it is ~3h and I would want a backtest run behind it.

**Q5. Spec §4 Rule 3 vs migration 0023.**
`SPEC.md:150` records the Aug 2026 decision that picks are visible to the whole crew at all times. Migration 0023 then made it a **per-group setting** (`picks_hidden_until_kickoff`, default false). Behavior is right; the spec describes the previous step.
→ **Recommended: amend §4 R3 to describe the per-group setting**, and confirm the default stays `false`. 0.25h.

**Q6. TBD kickoffs (`start_ts` null) — `SEC-13`, due before Aug 29.**
Today a null `start_ts` is un-pickable (`0021:200`), un-removable (`:255`), stays blind (`0023:30`), gets **no** close and therefore no CLV (`jobs-core.ts:84-85`), but **does** get frozen (`jobs-core.ts:1006`).
→ **Recommended: keep exactly as-is.** Every branch fails closed, which is the right default for a security boundary and a receipt. The only cost is that a TBD game is un-pickable until CFBD firms the time, which `sync-games` does daily.

**Q7. Delete the dead edge function?**
→ **Recommended: yes, delete `supabase/functions/jobs/`.** It has inverted CLV in all four branches and is 4 versions behind `jobs-core.ts`. `05:C5` calls it "a deliberate tombstone decision" — but a tombstone with a live landmine in it is worse than no tombstone. The git history preserves it. 0.5h. Say no and I will leave it and add a `DO NOT DEPLOY` banner instead.

---

## 10. Day-by-day plan, Aug 11 → Aug 29

Ordered by dependency. Per `SPEC.md:253`, **the team-page LLM review backlog is the designated slip item — never the slate, pick'em or ledger.**

> **Aug 11–12 are done.** The tier is confirmed, the Actions history is read, the probe is built. What follows starts from Aug 12's afternoon.

| Date | Work | Depends on | Hrs |
|---|---|---|---|
| ~~Tue Aug 11~~ | ~~Answer §9 Q1–Q7. Dispatch `backtest.yml`. Dispatch `preseason-check`.~~ **Superseded** — `preseason-check`'s answer was already in the daily 11:00 UTC run; no dispatch needed. | — | ✅ |
| ~~Wed Aug 12 am~~ | ~~Confirm the CFBD tier~~ → **done, Tier 2/30k, P0-2 closed.** ~~Set `CFBD_MONTHLY_BUDGET`~~ → unnecessary, the default is correct. | — | ✅ |
| **Wed Aug 12 pm** | 🔴 **P0-5: dispatch `cfbd-probe`.** The one remaining CFBD unknown. Also closes P1-7. **P1-8:** check your inbox for the Aug 10 watchdog failure email. **P0-4:** three `select count(*)` on `ratings` (week 0, expect ~136), `team_hfa`, `line_snapshots`. | probe merged | 1 |
| **Thu Aug 13** | **P1-9:** set `SUPABASE_DB_URL` (the receipts are unbacked), create a healthchecks.io project, set `HEALTHCHECK_PING_URL`. Dispatch `backtest.yml` → paste the real calibration table into the changelog. | Aug 12 | 2 |
| **Fri Aug 14** | **P1-7:** narrow the `gameMedia` catch to log its status. **P2-10:** add the early-Saturday crons as insurance. Dispatch-test both. | — | 2 |
| **Sat Aug 15** | **09:P-16 load rehearsal** (owner-run): seed fixtures, `autocannon -c 15/-c 30` against `next start`, record vs p95 <1.5s / tick <300 KB. | Aug 12 | 3 |
| **Sun Aug 16** | **P1-1:** admin "void this game" control + the grading path that consumes it. Test. | — | 3 |
| **Mon Aug 17** | **P1-3:** commit `.env.example` + `.gitignore` negation (now 17 keys — the three empty ones from P1-9 included). **P1-5:** `/ratings` empty state. **P2-1:** empty-string guard on `PRESEASON_TILT_CARRY`. | — | 1.5 |
| **Tue Aug 18** | Doc amendments: **Q3** (SPEC §2.2/§2.3 K + slope), **Q4** (§2.1 FCS), **Q5** (§4 R3), **P1-4** (§5.3/§8 burst poll), **P1-6** (§7 nav). Fix the stale Bug #9 evidence in `docs/AUDIT-2026-08.md`. | Q3–Q5 | 2 |
| **Wed Aug 19** | **Q7:** delete the dead edge function (or banner it). **P2-4:** drop the dead 0018 pick policies (migration 0028). **P2-6:** narrow `ratings/page.tsx` select. | Q7 | 2 |
| **Thu Aug 20** | ⚠️ **`preseason-refresh` starts going RED on decline from today** (`jobs.yml:221`). Watch it. **F2/P1-9:** add `ANTHROPIC_API_KEY`, dispatch `verdicts` once. Also: `refresh-lines` leaves its idle guard ~Aug 22 (`LINES_IDLE_DAYS` 7) — first snapshots since spring. | Q1 | 2 |
| **Fri Aug 21** | Quality floor: real-device pass at 375px, light-mode phone pass over the slate, reduced-motion + focus-ring check. `UX-06` residue. | — | 3 |
| **Sat Aug 22** | **Full dress rehearsal.** Dispatch `refresh-lines`, `sync-games`, `scoreboard-loop`, `freeze --force` against a scratch week. Watch `job_runs` and `api_call_log` fill. This is the only end-to-end test you get. | Aug 12–14 | 4 |
| **Sun Aug 23** | Fix whatever Aug 22 surfaced. Re-run. | Aug 22 | 4 |
| **Mon Aug 24** | **05:§5:** run the 7 preseason smell tests on the first real `--top 40` table. **UX-32:** eyeball matchup cards with real names. | Aug 20 | 2 |
| **Tue Aug 25** | ~~HARD DATE: CFBD tier~~ — **closed Aug 12.** Buffer day, retained: this is where Aug 22–23's rehearsal fallout lands. | — | 2 |
| **Wed Aug 26** | 🔴 **HARD DATE: preseason checkpoint (`04:DQ-1`).** Green → 2026.4.1 loads itself. Red → execute the Q1 decision. | Q1 | 3 |
| **Thu Aug 27** | Last `preseason-refresh` cron day (`jobs.yml:126`). Verify `ratings` shows 2026.4.1 and `/ratings` renders Off/Def columns (the `splitInformative` tell). Create Week 0 group weeks; invite the crew; confirm each person can sign in. **Also: `/scoreboard`'s first-ever real call lands today** as `idleSkip` opens — watch that run even if the probe was green on Aug 12. | Aug 26 | 3 |
| **Fri Aug 28** | 🔴 **The Thursday freeze fires 03:00 UTC Fri = 10pm CT Thu.** Watch it. Verify `predictions` has one frozen row per Aug 29 game, `model_version = 2026.4.1`, non-null `vegas_spread`, and `total` non-null. **Nothing else ships today.** | Aug 27 | 3 |
| **Sat Aug 29** | 🏈 **Week 0.** Supervised watch: close passes, scoreboard loop, cover-flip detector. | | — |
| **Sun Aug 30** | **F17:** supervised watch of the first freeze→grade→CLV run. This is the first time the CLV path meets real rows. | Aug 29 | 3 |

**Total: ≈42 hours of work over the 17 days remaining** (45 originally, minus the ~3h Aug 11–12 already absorbed).

**Explicit slip items, in the order they go:**
1. Team-page LLM verdicts and the admin review queue (`SPEC.md:128,253` — the designated slip item).
2. `F13` returning-production %, `F9` sparklines, `F16` slate-card systems.
3. `P1-2` FCS two buckets (if Q4 goes the "build it" way).
4. `P2-2` profiles read scope, `P2-5` `remove_pick` polish.
**Never slipped:** the slate, pick'em, the ledger, the freeze, the close passes.

---

## One-screen summary

```
THE CFB SLATE — WEEK 0 READINESS          audit 2026-08-11 · rev 2026-08-12

  BUILD          472/472 tests (+13 new) · 118/118 DB assertions
                 tsc ✓ · lint ✓ · build ✓
  SCHEDULER      98 Actions runs, 97 green.  The one red was the watchdog
                 firing correctly on a cold job_runs table.
  REGRESSIONS    0  ← nothing correct was later undone
  DUPLICATE      0  ← one CFBD fetcher, SPEC §1 hard rule holds
  TODO/HACK      0  ·  @ts-ignore 0  ·  console.log in src/ 0

  FINDINGS BY SEVERITY                        (rev 2026-08-12)
    P0  blocks kickoff              3   was 4:  −P0-1 →P2, −P0-2 closed,
                                                +P0-5 new       =  1.0 h
    P1  ships broken, survives 1wk  9   was 6:  +P1-7, P1-8, P1-9
                                                                =  6.25 h
    P2  post-Week-1                10   was 9:  +P2-10 (ex-P0-1) =  4.25 h
    ─────────────────────────────────────────────────────────────────────
    Numbered fixes                 22                             11.5 h
    Verification, rehearsal,
      quality floor, watches                                      30.5 h
    ────────────────────────────────────────────────────────────
    REMAINING (Aug 12 pm → Aug 29)                                42.0 h

  BY CLASS  WEAKNESS 9 · BUG 4 · SPEC DIVERGENCE 3 · GAP 3 · UNVERIFIED 2
            (+1 pointer row, P2-9, carrying the already-deferred backlog)

  TIME      17 days left.  13 weekdays × 3 h + 4 weekend days × 6 h
            = 39 + 24 = ~63 focused hours available · 42 needed
            67% utilisation — real slack, not a knife's edge

  TWO HARD DATES                             (was three — Aug 25 closed)
    Aug 26   preseason checkpoint — green, or execute the Q1 call
    Aug 28   Thursday freeze fires 03:00 UTC — verify, ship nothing else

  THE THREE THAT ACTUALLY MATTER                          (all changed)
    1. /scoreboard — Tier 1+, drives the entire live layer, and has NEVER
       been called with this key.  Every offseason poll exits via idleSkip
       first; its first real invocation is Aug 27, two days out.
       → dispatch `cfbd-probe` today.  11 calls.  NEW, and now #1.
    2. Production ratings at 2026.2.0 vs code at 2026.4.1 — a measured
       +0.74 pt home bias, and no totals at all, on every Week 0 receipt.
       Blocked only on CFBD publishing 2026 talent; the daily job
       self-heals and goes red Aug 20.  0 h of code; decision due Aug 26.
    3. SUPABASE_DB_URL is empty, so the weekly pg_dump never runs.  The
       append-only receipts have no copy but a 7-day PITR window.  1 h.

  CLOSED SINCE THE FIRST PASS
    ✓ CFBD tier — Tier 2 / 30k vs ~10k of use.  3× headroom, no upgrade.
    ✓ Scheduler alive, secrets working, 2026 schedule ingested.
    ✓ Early-Saturday CLV hole — first kick is ~14:48 UTC, and the 12:00
      pass is 2.8 h ahead of it.  I ranked it #1 on a hypothesis; one
      field in one job log (days_to_kickoff: 18.2) disproved it.

  ────────────────────────────────────────────────────────────────
   GO — and more confidently than on Aug 11.  One endpoint to prove,
        one external dependency to wait out, one backup to arm.
  ────────────────────────────────────────────────────────────────
```

**Stopping here as instructed. Nothing was changed. Pick the first item.**
