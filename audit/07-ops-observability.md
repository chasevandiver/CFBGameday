# 07 — Ops & Observability

**Scope:** scheduling (`.github/workflows/jobs.yml`), job implementations (`scripts/`, `scripts/lib/jobs-core.ts`), the dead edge function, CFBD budgeting, data freshness surfaces, storage growth, backup, secrets.
**Prime directive under test:** the site runs itself. **The question:** when a job dies at 2am Saturday, how does anyone find out?

**Summary.** The automation layer is genuinely good for a v1 — idle guards with tests, CFBD metering that actually writes `api_call_log`, a budget throttle, a self-healing Sunday grader, a per-tick try/catch that keeps the scoreboard loop alive through a CFBD outage. What it lacks is the last mile: **nothing records that a job ran, nothing alerts when a job stops running, and no user-facing surface says how old the lines are.** Every failure mode below degrades to "stale data rendered as current," and the only detection path is a human noticing. Three findings are launch-window material: the scoreboard cron covers no Sunday/Monday games (Week 1 launches into Labor Day weekend), the `preseason-refresh` job can decline every day through Aug 27 and go silent leaving the site on model 2026.2.0, and the closing-line consensus has no staleness bound — a dead Saturday burst poll permanently banks Thursday's line as "the close." The prompt's storage-blowout and burst-corruption worst cases are both smaller than hypothesized (arithmetic below); the alerting gap is bigger.

---

## Findings table

| ID | Severity | Type | Status | One-line | Evidence |
|---|---|---|---|---|---|
| OPS-1 | **P1** | design | NEW | No job_runs record, no dead-man's switch, no alerting; scheduled-run failure emails likely go to nobody (workflow last committed by the bot) | `scripts/run-job.ts:20-42`, `.github/workflows/jobs.yml:97-176` |
| OPS-2 | **P1** | bug | NEW | Scoreboard cron windows cover no Sunday or Monday games — Week 1's Labor Day slate (and Nov MACtion Tue/Wed) gets no live scores | `.github/workflows/jobs.yml:66-68` |
| OPS-3 | **P1** | design | NEW | No "lines as of" anywhere; slate header renders page-fetch time which reads as data freshness; `make_pick` snapshots a stale line with no age bound | `src/components/slate/SlateView.tsx:401-404`, `supabase/migrations/0015_consensus_views.sql:19-35`, `supabase/migrations/0021_pick_markets.sql:207-218` |
| OPS-4 | **P1** | design | STILL OPEN (documented) | `preseason-refresh` declining exits 0 by design; if still NOT READY Aug 26 the site launches on 2026.2.0 with zero escalation | `.github/workflows/jobs.yml:150-160`, `docs/CHANGELOG.md` (Open items) |
| OPS-5 | **P2** | design | NEW | Closing consensus has no staleness bound: a dead burst poll silently banks Thursday's line as "close," permanently (CLV written once, never regraded) | `src/lib/consensus.ts:38-44`, `scripts/lib/jobs-core.ts:467-509` |
| OPS-6 | **P2** | bug (comment vs behavior) | NEW | The advertised "later lines backfill can still catch null-CLV rows" cannot work: backfilled snapshots carry `captured_at` > kickoff and the `before` cutoff excludes them forever | `scripts/lib/jobs-core.ts:494-497`, `src/lib/consensus.ts:41`, `scripts/refresh-lines.ts:69,83` |
| OPS-7 | **P2** | spec-div | STILL OPEN (deliberate) | Scheduler is GitHub Actions, not spec §8's pg_cron→Edge Functions; consequences: minute-0 skip risk, 5–30 min drift (documented), and the 60-day-inactivity auto-disable which the offseason will trigger | `docs/SPEC.md:216`, `.github/workflows/jobs.yml:1-6,50-90` |
| OPS-8 | **P2** | spec-div | NEW | Spec §8 jobs missing: injury/news LLM scan (nothing exists), calibration report never scheduled (backtest.yml is PR/dispatch only); verdicts dispatch-only | `docs/SPEC.md:218-227`, `.github/workflows/backtest.yml:9-32`, `.github/workflows/jobs.yml:14-49` |
| OPS-9 | **P2** | design | NEW | No backup story: Supabase free tier has no automated backups; `predictions` (the receipts the product's honesty pitch rests on) and all picks/bets/groups are unrecoverable; no dump job exists | `docs/SPEC.md:233,235`, absence in `.github/workflows/` |
| OPS-10 | P3 | design | NEW | `cfbd.ts` has no retry, no backoff, no 429 handling, no timeout; one 5xx kills a one-shot job run (scoreboard-loop is resilient — verified) | `src/lib/cfbd.ts:40-61`, `scripts/scoreboard-loop.ts:128-132` |
| OPS-11 | P3 | design | STILL OPEN (deliberate) | Dead edge function still in-tree with the inverted CLV formula and `__JOBS_SECRET__` string-replace secrets | `supabase/functions/jobs/index.ts:19-20,527-537,558-569` |
| OPS-12 | P3 | design | NEW | Residual idempotency gaps, all manual-dispatch-only: freeze rerun inside 8-day horizon appends a duplicate batch; double `--bootstrap` dupes append-only tables (no code guard, procedural only); `sync-games` during a live window flips `in_progress`→`scheduled` | `scripts/lib/jobs-core.ts:640-654`, `scripts/load-preseason.ts:78-93,127-135`, `scripts/sync-games.ts:69` |
| OPS-13 | P3 | bug (comments) | NEW | Cron comments state EDT-era local times; all drift 1h after DST ends Nov 1 ("Sunday 8am ET" is actually 9am EDT today); no correctness impact found | `.github/workflows/jobs.yml:51,71-74` |
| OPS-14 | — | — | FIXED-verified | `api_call_log` is now written (Aug-audit said nothing ever wrote it); budget meter + admin panel + loop throttle all real | `scripts/lib/jobs-core.ts:67-76`, `scripts/scoreboard-loop.ts:99-113`, `src/app/admin/page.tsx:117-141` |
| OPS-15 | — | — | FIXED-verified | Freeze-job August-dupe hazard closed by the 8-day horizon guard; freeze-groups chaining is idempotent and clock-safe as claimed | `scripts/lib/jobs-core.ts:635-654,225-250` |
| OPS-16 | — | — | NEVER TRUE (at current cadence) | `line_snapshots` does not threaten the 500MB tier: ~45 MB/season all-in (arithmetic below); no pruning needed for years | `supabase/migrations/0001_core_schema.sql:86-99` |
| OPS-17 | — | — | NEVER TRUE (as hypothesized) / partial | Burst failure does not "corrupt a week of CLV" via nulls — the grader nulls only when *no* snapshot exists; the real (smaller, still silent) failure is OPS-5's stale close | `scripts/lib/jobs-core.ts:494-509` |
| OPS-18 | P3 | design | STILL OPEN (documented) | Backtest gate does not fire on app-token PRs — the primary development mode; requires human close/reopen | `docs/CHANGELOG.md` ("Note on workflow runs"), `.github/workflows/backtest.yml:26-32` |

---

## 1. Job inventory: spec §8 vs what is actually scheduled

Spec §8 (`docs/SPEC.md:214-235`) says "**All jobs run on Supabase pg_cron → Edge Functions**." Reality: the live scheduler is `.github/workflows/jobs.yml`, and the edge function was never deployed (`audit/AUDIT-2026-08.md:28-29`, `docs/CHANGELOG.md` Open items). Inventory against the spec's table, quoting the actual cron (all UTC):

| Spec §8 job | Spec schedule | Actual | Cron (`jobs.yml`) | Verdict |
|---|---|---|---|---|
| Refresh betting lines | 3–4×/day; hourly Sat; burst every 5–10 min pre-kickoff | Scheduled | `0 3,12,17,22 * * *` (L52), `0 13-23 * * 6` (L54), burst `*/10 15-23 * * 6` + `*/10 0-3 * * 0` (L56-57) | ✅ matches; burst is 10-min not 5 |
| Update ratings from results | Sunday 8am ET | Scheduled | `0 13 * * 0` (L72) | ✅ (actually **9am EDT** — comment says 8am ET; correct only after Nov 1, OPS-13) |
| Weather pull | Saturday 6am **local per stadium** | Scheduled, one global run | `0 10 * * 6` (L70) = 6am ET / 3am PT | ~✅ acceptable simplification |
| Injury/news LLM scan | Daily 7am, admin confirms | **MISSING** — no script exists; nearest substitute is the manual `rating_adjustments` admin panel (`src/app/admin/page.tsx:143-151`) | — | ❌ OPS-8 |
| Live scoreboard poll | Every 2–5 min on game days | Scheduled loop, 30s cadence | `0 15-23 * * 6`, `0 0-4 * * 0`, `0 0-3 * * 5,6` (L66-68) → `scoreboard-loop.ts --minutes 63` | ✅ better cadence than spec, ❌ wrong day coverage (OPS-2) |
| Snapshot opening lines | When lines first post | Folded into refresh-lines: CFBD's `spreadOpen`/`overUnderOpen` captured on every snapshot (`scripts/refresh-lines.ts:74-81`) | — | ~✅ divergent mechanism, adequate |
| Freeze weekly predictions | Thursday night | Scheduled | `0 3 * * 5` (L74) = Thu 11pm EDT / 10pm CDT | ✅ |
| Calibration report | Sunday after rating update | **Not scheduled** — `backtest.yml` runs on model-touching PRs and dispatch only (`backtest.yml:9-32`) | — | ❌ OPS-8 |
| — (new) | — | `sync-games` daily + chained `sync-rankings`/`sync-systems` | `0 9 * * *` (L59), chain at L140 | ✅ |
| — (new) | — | `questions` (LLM) Friday | `0 9 * * 5` (L77); green no-op while `ANTHROPIC_API_KEY` unset (L168-169) | manual-ish: silent absence if key never set |
| — (new) | — | `verdicts` (LLM) | dispatch-only (L33) | manual |
| — (new) | — | `preseason-refresh` daily 11:00 UTC Aug 1–27 | `0 11 1-27 8 *` (L90) | ✅, see OPS-4 |
| — (new) | — | `freeze-groups` chained onto every lines run | L137-138 (`&&` chain) | ✅ idempotent, clock-safe (OPS-15) |
| — (new) | — | `preseason-bootstrap` | dispatch-only, deliberately never scheduled (L46-49) | ✅ |

**DST cross-check (OPS-13).** During EDT (through Nov 1, 2026): `0 3,12,17,22` = 11pm/8am/1pm/6pm ET ✅ as commented; `0 3 * * 5` = Thu 10pm CDT ✅ as commented; `0 13 * * 0` = **9am** EDT, not the commented "8am ET" — the comment is wrong now and becomes right in November. After Nov 1 everything shifts an hour earlier local. I checked each shifted time against what the job needs (burst window still covers a 7:00pm EST kick = `00:00 UTC` via `*/10 0-3 * * 0`; Saturday windows still open before noon kicks) and found **no correctness impact** — this is comment drift only.

## 2. GitHub Actions as scheduler — honest reliability assessment (OPS-7)

Labeled **spec divergence, deliberate and documented** (`jobs.yml:1-6` acknowledges it; the prior audit accepted it, `audit/AUDIT-2026-08.md:476`). The specific risks for *this* repo:

1. **Schedule drift/skips.** Actions cron is best-effort: delays of 5–30+ min are routine at peak, and runs can be dropped entirely; the top of the hour is the worst time — and **every cron here except the burst fires at minute 0** (`jobs.yml:52-90`). Consequences by job: refresh-lines/sync-games/weather — harmless. Scoreboard — the 63-minute loop with ~3-min overlap (`jobs.yml:60-65`) absorbs a delayed start but a **dropped** hourly launch leaves up to an hour of dead score coverage mid-Saturday. Burst — a skipped 10-min tick just makes the closing proxy 10–20 min staler (documented, `jobs.yml:4-6`). Acceptable, but note the coverage seam: the Sat (`0 15-23 * * 6`) and Sun (`0 0-4 * * 0`) scoreboard schedules are *different concurrency groups* (`jobs.yml:92-95` keys on the schedule string), so the advertised cancel-handoff doesn't apply at the 23:00→00:00 boundary — you get a 3-min double-poll instead of a handoff. Harmless, just not what the comment says.
2. **No minute precision.** Only matters for the closing proxy; already documented as approximate (spec §5.3 proxy note in `jobs.yml:4-6`).
3. **60-day inactivity auto-disable.** GitHub disables scheduled workflows in repositories with no activity for 60 days (documented for public repos; widely reported on private ones — this repo is `github.com/chasevandiver/CFBGameday`, visibility should be confirmed). During the season this is moot. **The offseason (Dec→Jul) is exactly a >60-day quiet window**, and the design leans on year-round crons with idle guards (`scripts/lib/idle.ts:1-17`) rather than seasonal cron edits — so next June the entire scheduler can be switched off by GitHub, silently, and the Aug 2027 `preseason-refresh` cycle never fires. The failure email goes to whoever GitHub attributes the workflow to (see OPS-1). **Mitigation is one line:** any commit resets the clock; a monthly no-op keep-alive or a calendar reminder suffices — but today nothing exists.

The dead edge function (`supabase/functions/jobs/index.ts`) is the other half of this divergence: never deployed, drifted behind `jobs-core.ts` (no idle guard, no freeze horizon, no `spread_open` in its snapshot selects — `index.ts:500,639` — no groups, no moneyline grading), and it still carries the **inverted CLV formula** in all four branches (`index.ts:529-537,561-569`: home backer computed as `close - line`; bet home −3, close −6 → stored −3, truth +3). Left deliberately (`docs/CHANGELOG.md`, Aug 7 CLV entry). That's a defensible choice, but the file's own header still advertises itself as "the future pg_cron path" (`jobs.yml:2-3`, `index.ts:1-4`) — a reviver following the docs would deploy a CLV corrupter. Recommend deleting it or replacing its body with a tombstone comment (OPS-11, S).

## 3. Failure modes, ranked by silence

Ranked by "what does the user see, and who is told." **Nothing in this codebase notifies anyone of anything** — see §4 — so "loud" below means "a red run in an Actions tab nobody is required to look at."

| Rank (most silent first) | Failure | What renders | Detection today |
|---|---|---|---|
| 1 | **refresh-lines dead** (bad key, CFBD 5xx streak, workflow disabled) | Slate shows Friday's consensus as the current line — beside a **live clock** (`SlateView.tsx:403` renders `data.fetchedAt`, the *page* fetch time). `make_pick` records the stale number as `line_at_pick` (`0021:207-218`) and grades against it. CLV grades against a stale "close" (OPS-5). | None. UI has no line-age surface (§5). |
| 2 | **preseason-refresh still declining Aug 26** | Site launches Week 0 on ratings 2026.2.0: HFA 2.3-derived, even off/def splits, totals suppressed, Off/Def columns hidden. Every run was **green** (`jobs.yml:150-160`: declined `--check` → `exit 0`). | Only a `::notice` in green logs and the absence of Off/Def on `/ratings`. Changelog itself flags "if still red ~Aug 26, worth looking at" — but nothing will *tell* anyone. |
| 3 | **Burst poll dead on Saturday** | Nothing visibly wrong Saturday. Sunday's grader banks a stale close permanently (worked example §6). | None. |
| 4 | **sync-games dead** | Kick times/TBD flags/schedule changes go stale; a postponed game stays on the board. | None for days. |
| 5 | **Weather dead** | Stale forecast rendered "when notable" as current (`weather_forecasts.fetched_at` never surfaced). Job also swallows per-venue fetch failures silently — `res.ok` → `continue`, still returns success (`jobs-core.ts:290-291`). | None. |
| 6 | **freeze dead Thursday** | Friday: no model numbers on cards, Receipts missing the week. Users notice the *absence* — semi-silent. Rerun via dispatch recovers (predictions for the week simply arrive late). | User reports. |
| 7 | **ratings-update dead Sunday** | Leaderboard/ledger stuck ungraded Monday — users notice. **Self-healing**: the job is a stateless replay and grades only `.is("result", null)` / `.is("clv", null)` rows (`jobs-core.ts:324-, 481-486, 511-515, 543-548`), so next Sunday (or a manual dispatch) catches everything up. Best-designed job in the file. | User reports; recovers automatically. |
| 8 | **scoreboard-loop dead mid-Saturday** | Cards freeze at a stale "Q2 7:43" rendered as live (`ScoreTicker.tsx:113-115` prints period+clock with no staleness check). Loudest failure — users see it in minutes. Note the loop itself is robust: CFBD down all morning = caught per tick, retried every 60s, never crashes the run (`scoreboard-loop.ts:128-132`). The realistic "death" is OPS-2's schedule gap, not a crash. | User reports, immediately. |

**Does GitHub email on failure, and to whom?** Actions failure emails go to the *actor* of the run; for `schedule` events that is the user who last modified the workflow file. `jobs.yml`'s last three commits are authored and committed by `Claude <noreply@anthropic.com>` (git log). If attribution resolves to the bot/app rather than to the owner's account, **failure emails go to nobody**; if it resolves to the pushing account, they go to an inbox that must have Actions notifications enabled. This is unverifiable from the repo — it must be tested once (dispatch a deliberately failing run, see who gets mail). Until verified, assume nobody is notified.

## 4. job_runs / dead-man's switch (OPS-1) — the core gap

Nothing records that a job ran. `run-job.ts:34-36` prints the result JSON to a log that expires with the runner; `api_call_log` (`0001:261-266`) records *CFBD calls*, not runs — a job that made zero calls (freeze, ratings-update off-season, an idle skip) leaves no trace, and a job that *stopped being scheduled* leaves exactly the same trace as one that never existed. Absence-alerting is precisely the part that's missing, and it is the only thing that catches the two scariest scenarios (workflow auto-disabled; secret expired so every run fails at `npm ci`-adjacent setup).

**Concrete recommendation** (all three layers are small):

1. **Record runs** — migration:
   ```sql
   create table job_runs (
     id          bigint generated always as identity primary key,
     job         text not null,
     started_at  timestamptz not null default now(),
     finished_at timestamptz,
     ok          boolean,
     detail      jsonb
   );
   -- deny-all RLS like api_call_log (0001:292)
   ```
   Write it in `run-job.ts` around the `job(db)` call (insert at start, update in a `finally`), and in the three standalone scripts' `main()`s (`refresh-lines.ts`, `sync-games.ts`, `scoreboard-loop.ts`). ~30 lines total.
2. **Absence alerting** — a free external dead-man's service (healthchecks.io-style: per-check expected period + grace, alerts on *missed* ping). One secret (`HC_BASE`), one line per task in the `jobs.yml` run step: `curl -fsS -m 10 "$HC_BASE/refresh-lines"` after success. This catches failure, non-scheduling, disablement, and secret rot — everything §3 lists — and pages a phone at 2am Saturday, which GitHub email never will. This is the single highest-leverage ops change available before Aug 29.
3. **Visibility** — an admin-panel table (last success per job vs expected cadence, amber/red like the existing CFBD budget card, `admin/page.tsx:117-141`) reading `job_runs`. Catches slow drift the pager doesn't.

An in-repo alternative to (2) — a `watchdog` cron task that queries `job_runs` and exits 1 when e.g. refresh-lines hasn't succeeded in 26h or the scoreboard in 90 min on a game day — turns silence into a red run, but still depends on §3's unverified email path. Do it only in addition to, not instead of, the external ping.

## 5. Data freshness in the UI (OPS-3)

Grepped every `captured_at` consumer in `src/` (`src/lib/queries.ts:154`, `src/lib/consensus.ts`, `src/components/game/MovementChart.tsx`). Result:

- **Slate**: no line timestamp exists anywhere. The `line_consensus` view (`0015:19-35`) aggregates away `captured_at` entirely — the UI *cannot* know the line's age. Worse, the slate header renders a clock — `SlateView.tsx:401-404`: `{clockTime(data.fetchedAt, tz)}` next to a refresh icon — where `fetchedAt` is `new Date()` at page-fetch (`queries.ts:125`). A user reads that as "lines as of 11:42am." If refresh-lines died Friday, this is a *false freshness claim*.
- **Game page**: `MovementChart.tsx:106-107` does render the last snapshot's timestamp — the only line-age surface in the product — but labels it "`now {spread} · {date} {time}`", and only renders at ≥3 points (`MovementChart.tsx:11`).
- **ScoreTicker / GameCard**: live period+clock rendered with no staleness check (`ScoreTicker.tsx:113-115`).

For a betting product this is correctness, not polish: `make_pick` (`0021:207-218`) records the latest-snapshot consensus as the user's line **with no age bound**, and it's graded (`jobs-core.ts:516-541`). Stale pipeline ⇒ users are handed, and graded on, a number the market left behind. **Fix (S/M):** add `max(t.captured_at) as captured_at` to `line_consensus` (0015 is `create or replace`-able), render "lines HH:MM" on the slate header instead of — not next to — the page-fetch clock, amber it past ~2h on a game day.

## 6. Closing-line integrity: the burst-failure scenario, re-derived (OPS-5, OPS-6, OPS-17)

The prompt's canonical worst case was "burst-poll failure corrupts a week of CLV." Checked against current code, it splits into three:

**(a) The grader does null CLV when no close exists** — `jobs-core.ts:497` (`if (close === null) continue`) and analogous guards for picks (`:533-537`) and bets (`:567,576`). So the *hypothesized* mechanism (nulls or garbage banked as zeros) is **NEVER TRUE** in current code. ✔

**(b) But "no close" almost never happens — "stale close" does.** `consensusFromSnapshots(snaps, before=start_ts)` takes the latest snapshot per provider before kickoff **with no maximum age** (`src/lib/consensus.ts:38-44`). If everything Saturday dies but Friday's daily 22:00 UTC run landed, every game has a "close": Friday evening's line. Worked example: model froze Thursday at home −3 with `vegas_spread` −3; line drifts to −6 by kickoff; burst dead since Friday when it sat −4.5. Grader computes `modelClv(edge, −3, close=−4.5)` and picks graded `spreadClv("home", −3, −4.5)` = −3 − (−4.5) = **+1.5**, truth **+3.0**. Every spread/total CLV that week is understated/overstated by the Saturday drift, written once, and never revisited — the grade queries filter `.is("clv", null)` / `.is("result", null)` (`jobs-core.ts:486,515`), so a non-null wrong value is permanent. Silent, permanent, plausible: **P2**. Fix (S): in `closing()`, treat a consensus whose newest contributing snapshot is older than ~6h before kickoff as null (leaves the row pending instead of banking a stale number).

**(c) The advertised recovery path for null-CLV rows is broken (OPS-6).** The comment at `jobs-core.ts:494-496` (echoed in the changelog): "a later lines backfill can still catch it." But a backfill runs `refresh-lines.ts`, which stamps `captured_at = new Date()` (`refresh-lines.ts:69,83`) — *after* kickoff — and the closing selection discards any snapshot with `captured_at >= start_ts` (`consensus.ts:41`). So a row left null because Saturday had no snapshots can never be graded by any future run: the backfill's rows are invisible to `closing()`. The null-is-recoverable design premise is false as implemented. (CFBD's `/lines` does serve final lines for past games, so recovery is *possible* — it just needs a backfill mode that either stamps a pre-kickoff `captured_at` or a grader that accepts post-kickoff snapshots explicitly marked as closes.) **Bug (comment/design vs behavior), P2**, and it compounds (b): once you add the staleness guard, this becomes the path stale games take, so both fixes belong together.

## 7. Scoreboard schedule coverage (OPS-2) — worked against the real calendar

Schedules (`jobs.yml:66-68`): `0 15-23 * * 6` (Sat 15:00→last launch 23:00, +63 min ⇒ coverage to ~00:03 Sun), `0 0-4 * * 0` (Sun 00:00–04:00 ⇒ ~05:03), `0 0-3 * * 5,6` (Fri+Sat 00:00–03:00 UTC = **Thu and Fri nights ET** ⇒ ~04:03).

- **Covered:** Sat 11am ET → ~1:03am ET Sun; Thu night; Fri night. ✔
- **Not covered:** *Sunday* afternoon/evening ET (Mon 00:00 UTC windows, Sun 16:00–23:00 UTC — no cron matches), *Monday* night ET (Tue 00:00 UTC), *Tue/Wed* nights ET (Nov MACtion). **Week 1 (Sep 5–7, and opening weekend generally) traditionally carries Sunday and Labor Day Monday games.** For those, `scoreboard-loop` never launches; scores arrive at the next `sync-games` (09:00 UTC = 4–5am ET, `jobs.yml:59`), so a 7pm Sunday kickoff shows "7:00 PM" on the ticker all night and flips straight to Final the next morning. Two days after launch. Also note the Sat window ends ~05:03 UTC: a late Hawaii kick (~03:00 UTC) loses live updates for its final ~90 minutes.
- Fix (S): add `0 16-23 * * 0`, `0 0-4 * * 1,2` (Sun day/night + Mon night, which also catches Tue/Wed MACtion if extended `* * 3,4`) — the idle guard (`scoreboard-loop.ts:85-93`) makes over-scheduling free: no games within 2 days ⇒ instant exit, zero CFBD calls, a few Actions minutes.

## 8. CFBD budgeting (OPS-14 — FIXED, with projection)

The Aug audit's "api_call_log existed since 0001 but nothing ever wrote it" is **fixed**: `logCfbdCalls` (`jobs-core.ts:67-76`) is called by `run-job.ts:35`, `refresh-lines.ts:88`, `sync-games.ts:74`, and per-tick by `scoreboard-loop.ts:123`. The loop reads the month's count back (`scoreboard-loop.ts:63-72`), throttles at 80%, refuses at 95% (`:99-113`), and the admin panel shows n/30,000 with amber at 22.5k, red at 27k (`admin/page.tsx:126-139`).

**Projection at the cron frequencies actually in jobs.yml** (assumption, per brief: purchased tier is CFBD Tier 2 ≈ 30k calls/mo at ~$5, Tier 3 ≈ 75k at ~$10 — `MONTHLY_BUDGET` defaults to 30,000, `scoreboard-loop.ts:28`, and the admin panel hardcodes /30,000, so the code assumes Tier 2; **verify the actual subscription matches, since both the throttle and the panel are wrong otherwise**):

- refresh-lines: 1 call/run. Daily 4×7 = 28; Sat hourly 11; burst 6/hr × (9h Sat + 4h Sun) = 78. ⇒ 117/wk ≈ **510/mo**
- sync-games chain: games 2 + rankings 1 + systems 3 = 6/day ⇒ **~180/mo**
- scoreboard-loop: 120 calls/live-hour. Sat ~14h ≈ 1,700; Thu+Fri nights ~8h ≈ 950 ⇒ ~2,650/wk ≈ **~11,500/mo** worst case (script's own estimate "~9–10k", `scoreboard-loop.ts:16-18`, is consistent)
- weather/freeze/ratings-update: 0 CFBD. August-only preseason builds: ~10–30/day, unmetered (below).

**Total ≈ 12–13k/mo ≈ 40% of Tier 2.** Comfortable, with the throttle as backstop. Real gaps, all minor: calls made by `backtest.yml` CI runs (~10/run) and `build-preseason` in the preseason-refresh job are **not metered** (no db sink in those paths); a job that crashes mid-run loses its count (logged only at the end for one-shot scripts); and if `api_call_log` inserts fail, `logCfbdCalls` only `console.error`s (`jobs-core.ts:75`) — an undercounting meter reads as budget headroom. Acceptable; note and move on.

## 9. Idempotency (OPS-12, OPS-15)

- **refresh-lines twice in a minute**: appends duplicate snapshots, but every consensus reader — the view (`0015:30-33`), `consensusFromSnapshots` (`consensus.ts:39-44`), the grader — reduces to *latest per provider* before averaging, so duplicates change nothing. ✔ Not a problem (the prompt's "skew closing selection" hypothesis is **NEVER TRUE**: averaging is across providers, not rows).
- **sync-games rerun**: upsert by PK `id` (`ingest.ts:33-37`); scores/status overwrite correctly. One hazard: it maps `status = completed ? "final" : "scheduled"` (`sync-games.ts:69`), so a manual dispatch during a live window flips `in_progress` → `scheduled` until the next 30s scoreboard tick flips it back. The 09:00 UTC cron (4–5am ET) never coincides with live games. P3.
- **freeze rerun**: the horizon guard (`jobs-core.ts:640-654`, `FREEZE_HORIZON_DAYS=8`) closes the August-cron dupe the changelog describes — **FIXED-verified** (logic re-derived: min kickoff >8 days ⇒ skip; `idleOverridden` lets dispatch force it). Residual: a rerun *inside* the horizon (e.g. dispatching `freeze` on Friday after Thursday's cron) appends a second full batch into append-only `predictions` — no per-(game, model_version, frozen) uniqueness exists. Display copes (`queries.ts:235-239` keeps one row per game), but Receipts aggregates could double-count. Manual-only exposure. P3.
- **load-preseason double `--bootstrap`**: `planLoad` includes the append-only tables whenever `bootstrap` is true (`load-preseason.ts:88-92`); `seasonHasStarted` (`:127-135`) only refuses once finals exist — i.e. **not** during August. The guard against duplication is purely procedural: dispatch-only, "never scheduled" (`jobs.yml:46-49`), documented in the changelog. A code guard (refuse `--bootstrap` when week-0 `predictions` rows already exist for the season, absent `--force`) is ~10 lines. STILL OPEN as documented risk; P3.
- **freeze-groups**: verified idempotent and clock-safe as claimed — `freeze_group_week` returns false for future weeks, lock authority is `group_week_is_locked` reading the clock, missed runs cost only materialisation (`jobs-core.ts:210-250`). ✔

## 10. `cfbd.ts` resilience (OPS-10)

`get()` (`cfbd.ts:40-61`): single `fetch`, no retry, no backoff, no 429 branch (a 429 throws `CfbdError` like any 4xx), **no timeout** (Node undici's defaults leave ~300s before a hung connection errors — inside the 75-min job timeout, `jobs.yml:100`, but a 5-min stall per call). Consequences by caller:

- One-shot jobs (refresh-lines, sync-games, freeze, systems): a single 5xx = red run, nothing written. The cadence self-heals (burst retries in 10 min; daily jobs next day) — but combined with §3/§4, a red run is a silent run.
- **Saturday-morning CFBD outage**: `scoreboard-loop` does *not* crash — each tick is wrapped (`scoreboard-loop.ts:118-132`, "one bad tick never kills the hour"), waits 60s, retries. Verified good. The budget meter keeps counting failed calls' attempts (callCount increments before the fetch, `cfbd.ts:49`) — arguably correct, since CFBD likely counted them too.

Recommend (S): one retry with jitter on 429/5xx + an `AbortSignal.timeout(30_000)` in `get()`. Not launch-blocking given the cadences.

## 11. Storage: `line_snapshots` growth (OPS-16 — hypothesis rejected with arithmetic)

Row shape (`0001:86-98`): ~24B tuple header + bigint id 8 + int game_id 4 + provider text ~10 + source ~6 + 4×numeric(5,1) ~32 + 2×int 8 + timestamptz 8 ≈ **~110B heap**, plus two indexes (`0001:99`, `0015:48-49`) ≈ ~70B ⇒ **~180–200B/row all-in**.

Rows/week in-season: full refresh ≈ 60 games × ~4 books ≈ 240 rows. Daily 28 runs × 240 = 6,720; Sat hourly 11 × 240 = 2,640; burst 78 runs × (~10 games in window × 4 books) ≈ 3,120. ⇒ **~12.5k rows/week ≈ 225k rows over an 18-week season ≈ 40–45 MB/season including indexes.** `api_call_log` adds ~13k rows/mo ≈ <1MB/mo. Against the 500MB free tier (`docs/SPEC.md:233`), snapshots alone blow the tier after **~10 seasons**. No pruning job exists and none is needed this season or next; a coarsening job (thin pre-Thursday snapshots to hourly after grading) is a fine 2027 item. The prompt's blowout hypothesis: **NEVER TRUE at current cadence** — worth this arithmetic precisely so nobody adds a "fix" for it.

## 12. Backup / restore (OPS-9)

Supabase free tier includes **no automated backups** — scheduled daily backups start at Pro ($25/mo), PITR is a paid add-on above that (verify against current pricing at time of decision; the spec's cost sheet `docs/SPEC.md:235` explicitly plans "$0 Supabase"). Today's recovery story if the project is lost or a bad write lands:

- `ratings` — **recoverable**: `ratingsUpdateJob` is a stateless replay from week-0 priors + finals (`jobs-core.ts:319-448`); week-0 priors re-emit from `build-preseason`.
- Reference data (teams/venues/games/rankings/systems/weather) — recoverable from CFBD via the sync jobs.
- `line_snapshots` — intra-week movement history **unrecoverable** (CFBD serves final/open lines for past games, not the path between).
- **`predictions` — unrecoverable and irreplaceable.** These are the frozen receipts; the product's entire honesty pitch ("the number the model committed to on Thursday") rests on them being tamper-evident history. A lost DB deletes the track record.
- **picks / bets / groups / profiles — unrecoverable user data.**

No dump job exists (grep of workflows: none). The emitted preseason JSON (`load-preseason.ts` input dirs) covers only the bootstrap tables, and jobs.yml's preseason builds write to `$RUNNER_TEMP` and are discarded (`jobs.yml:144,156-166`) — partial mitigation at best. The append-only tables make logical dumps trivially incremental. **Recommend (M): weekly `jobs.yml` task running `pg_dump` (needs a `SUPABASE_DB_URL` secret — the service-role key alone can't run pg_dump) uploaded as an Actions artifact (90-day retention) or committed to a private backup repo; even a Sunday-only dump after grading bounds loss to one week.** P2 — not launch-blocking, but the exposure grows every graded week.

## 13. Secrets (OPS-11, OPS-18)

- Actions secrets: `CFBD_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional `ANTHROPIC_API_KEY` (`jobs.yml:8-9,101-105`). Standard and fine for a solo project. Known properties, not findings: anyone with repo write can exfiltrate via a workflow edit; fork PRs don't receive secrets (so `backtest.yml`'s CFBD-dependent run fails on fork PRs — moot for a solo repo); `ci.yml` correctly builds with placeholders (`ci.yml:31-33`).
- `JOBS_SECRET` exists **only** in the dead edge function as a `__JOBS_SECRET__` deploy-time string-replace (`index.ts:19-20`) — the pattern the prior audit already called brittle (`audit/AUDIT-2026-08.md:476-477`). Since the function is undeployed there is no live exposure; it's one more reason to delete the file (OPS-11).
- Rotation: nothing automated anywhere; rotating the service key = update one Actions secret. Acceptable.
- Process hole worth restating (OPS-18): **PRs opened by an app token trigger no workflows** (`docs/CHANGELOG.md`, "Note on workflow runs") — so the backtest gate and CI both silently don't run on the repo's primary development mode until a human closes/reopens. The gate exists; the trigger path has a manual step that will eventually be forgotten.

---

## For 00-SUMMARY.md

- **P1 · OPS-1 — No alerting/dead-man's switch: no job_runs table, no absence check, failure emails unverified (workflow last committed by the bot); every §3 failure is silent to the operator.** Fix: job_runs migration + external ping in jobs.yml + admin freshness card. **(S/M)**
- **P1 · OPS-2 — Scoreboard crons cover no Sunday/Monday games; Week 1's Labor Day slate gets no live scores (and Nov Tue/Wed MACtion never will).** Fix: add Sun/Mon(–Wed) night cron lines; idle guard makes it free. **(S)**
- **P1 · OPS-3 — No line-age surface anywhere; slate header's page-fetch clock reads as line freshness; `make_pick` records stale lines with no age bound.** Fix: `max(captured_at)` in line_consensus + "lines as of" stamp. **(S/M)**
- **P1 · OPS-4 — `preseason-refresh` can decline green every day through Aug 27 and strand launch on model 2026.2.0 with zero escalation.** Fix: make declines exit non-zero after Aug 20, or wire OPS-1's ping with an Aug-26 deadline check. **(S)**
- (P2 headliners for the body: OPS-5/6 stale-close CLV banked permanently + broken backfill promise (S together); OPS-7 60-day Actions auto-disable will hit next offseason (S); OPS-9 no backups — `predictions` receipts unrecoverable (M); OPS-8 spec §8's injury scan and scheduled calibration report don't exist (M/L).)
