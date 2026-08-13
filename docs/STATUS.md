# The CFB Slate — Status

**The one file that answers "what's left."** Reconciled 2026-08-13 against the
code on `claude/status-md-tasks-ivmbtb`. Week 0 is **Sat Aug 29** — 16 days.

**As of 2026-08-13, §2 has no code or docs work left in it.** Everything still
unchecked below is either owner-run (P1-8, 09:P-16 — P1-9b closed the same
day), a dispatch
(`--tune-fcs`, `observe-scoreboard`, Q8), or a dated watch. That is the whole
remaining blocking list.

**§4 was opened early, 2026-08-13, by owner decision** — the post-launch queue
is marked "deliberately not before Aug 29" and eleven rows were pulled forward
anyway because §2 had nothing buildable left. Landed: the four security rows
(P2-5, SEC-01, SEC-02, P2-2/SEC-08) as migrations 0038–0040, five UX rows, and
five ops/data-quality rows including migration 0041. **Migrations 0038–0041 are
in the repo and proved against a local Postgres; they have NOT been applied to
the live project** — that is a production write on new schema and it is the
owner's call. Nothing in the app requires them until they are.
**Nine tracked rows described their own defect wrongly**, and in four cases the
wrong detail changed the fix. Each correction is in the row.

§1's numbers are point-in-time and go stale between reconciliations; the boxes
do not, because they are checked in the commit that lands the fix. If §1
disagrees with a box, trust the box.

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
| `docs/BRAND.md` | Brand System v1.0 — the mark, the palette, the launch surfaces | ✅ identity spec |
| **`audit/`** (14 files) | Four point-in-time passes, Aug 6 → Aug 12. **`audit/README.md` is the index** — it says which pass is which and, more usefully, how to resolve an ID: the number in `04:DQ-13` is the file. | 📕 all history, nothing open |

Historical documents are kept intact and are not edited to look better in
hindsight. When one of them contradicts this file, **this file is right** — its
rows were decided by reading code, not by reading commit messages.

---

## 1. Where we stand

| | |
|---|---|
| **Ships Aug 29?** | Yes. `audit/KICKOFF_READINESS.md` §1, unhedged, after two revisions. |
| **Build** | **659 tests across 47 files**, `tsc`, lint and `next build` clean — all run in-session 2026-08-13 after the §4 pull-forward below, and green on CI for PRs #58/#59/#60. **155 DB assertions** (was 129), run in-session against a real Postgres 16 cluster rather than carried from CI; the 26 new ones were each checked to fail against the pre-fix schema. *(Run `npm ci` first: a stale `node_modules` fails two suites on missing deps and looks like a regression.)* |
| **Scheduler** | 111 completed runs. Reds to date: one watchdog firing correctly on a cold `job_runs` table, and runs #107–109 — the backup verification sequence, each a real defect, all closed. |
| **Regressions** | 0. Nothing correct was later undone (`KICKOFF_READINESS` §5). |
| **CFBD** | Tier 2, 30,000 calls/month, confirmed against ~10k of use. All 11 endpoints probed live and reachable, including `/scoreboard`. |
| **Model in code** | `2026.5.0` — tilt carry, `baseHfa` 3.0, centered team-HFA, portal fix, market-anchored tier recentre |
| **Database** | **40 migration files, 40 recorded rows, in sync** — verified live 2026-08-13 after PR #58 merged and deployed. 0038–0041 were applied in order once the production build carried the code they depend on, which was the whole reason they waited: 0039 makes `join_group` return null on a bad code (the old action read that as success), 0040 revokes `is_admin` from anon while the old `fetchProfiles` still did `select("*")`, and 0041 renames a column the old `build-preseason` still wrote — which would have failed `preseason-refresh`, the job the Aug 26 checkpoint waits on. Verified after applying: join codes mint at 10 Crockford characters, `normalize_join_code('il o-1')` → `1101`, `group_join_attempts` exists deny-all, and anon can read neither `groups.join_code` nor `profiles.is_admin`. Before this pass it was 36/36, and 0034–0037 **are applied** — an earlier version of this row said 0034 and 0035 were "not yet applied to the live project" and gave the count as 32/32, and both were stale by the time they were written. It matters because two ticked rows depend on them: P1-1's re-pick fix *is* 0034 (`make_pick` confirmed carrying it live), and OPS-2's watchdog push needs 0036's enum value and 0037's `notification_settings` row — `notifyWatchdog` returns `{notified: 0, errors: 0}` when that row is missing (`notify-jobs.ts:375`), so it would have been a silent no-op. Both confirmed live, along with 2 admin push subscriptions for it to reach. The `0017` ledger gap (DB-3) was repaired 08-12. 0031–0033 add the push tables. `ratings` 138 @ wk0, `team_hfa` 138, `games` 888 (**wk0 = 8 Aug 29–30, wk1 = 91 Sep 3–7**), `rivalries` 29, `predictions` 0 and every week-0/1 game freezable, jobs running today. Advisors clean — the four findings are the intentional deny-all tables and the by-design definer functions. |
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

Dated per `KICKOFF_READINESS` §10. **The code and docs in this section are
done as of 2026-08-13** — what remains is the owner-run items and the dated
watches, plus two migrations to apply.

### 2.1 Now (Aug 12–14)

- [x] **CFBD key — rotation declined, 2026-08-12, owner call.** The key was
      pasted into a chat transcript to run the Aug 12 probe and backtest. Not
      rotating is defensible and is recorded rather than nagged about: the key
      grants **read-only** public sports data on Tier 2, no writes, no personal
      data, no billing surface. The whole worst case is quota theft — someone
      burning the 30,000/month against an expected ~10,000 — and that failure is
      already instrumented: every call meters into `api_call_log`,
      `scoreboard-loop` throttles at 80% and refuses to poll at 95%
      (`scoreboard-loop.ts:100-112`). **What to watch instead of rotating:** the
      monthly call count on the admin freshness card. A jump toward 24,000 with
      no matching activity is the tell, and the consequence of ignoring it is
      degraded live scores on a Saturday, not a breach. Revisit only if the
      transcript is ever shared outside the account.
- [x] **P1-9a** `SUPABASE_DB_URL` set — **by the owner, 2026-08-12.** It had been
      empty in all 98 runs, so the weekly `pg_dump` had never executed and the
      append-only `predictions` / `picks` / `bets` had no copy beyond the 7-day
      PITR window — by elimination the largest open risk in the product. The
      secret existing is not yet proof the dump runs; the row below is.
      **Where it came from:** the **`Connect` button in the dashboard top bar**
      for project
      `the-cfb-slate` (ref `mjijyutmbtnwcjspozsx`, us-east-2) —
      `dashboard/project/mjijyutmbtnwcjspozsx?showConnect=true`. *Not* Settings →
      Database, which in the current UI holds only pool sizing; the strings live
      in the Connect modal. Take the **Session pooler** row (IPv4-compatible),
      **URI** tab:
      `postgresql://postgres.mjijyutmbtnwcjspozsx:[PASSWORD]@aws-N-us-east-2.pooler.supabase.com:5432/postgres`.
      The other two rows both fail here and fail confusingly: **Direct
      connection** resolves `db.<ref>.supabase.co`, which is IPv6-only while
      Actions runners are not, and **Transaction pooler** (6543) drops the
      session-level features `pg_dump` needs. Copy the host from the modal —
      the `aws-0-`/`aws-1-` prefix varies by provisioning date. Password: reset
      at Settings → Database → Database password if unknown; nothing else in
      this repo uses it (the app talks REST with the service-role key).
      Then GitHub → Settings → Secrets and variables → Actions → `SUPABASE_DB_URL`.
- [x] **`backup` is dispatchable, and can now fail.** It was cron-only
      (`0 15 * * 0`), so the secret above could not be verified until a Sunday —
      the next proofs being Aug 16, Aug 23, then **Aug 30, after launch**. Added
      to the `workflow_dispatch` list. Adding the dispatch surfaced the reason it
      mattered: the step ran `pg_dump … | gzip > file` under Actions' default
      `bash -e`, which is **not** `pipefail`, so a `pg_dump` that died on a bad
      password closed the pipe, gzip compressed nothing, the step exited **0**,
      and a 20-byte artifact uploaded as the week's backup. Now `set -o
      pipefail`, `gzip -t`, and an assertion that every one of the 11 tables
      emitted its `COPY` block. Verified against a stubbed `pg_dump` in all
      three modes: good → green, auth failure → red, partial → red naming the
      missing tables.
- [x] **The backup runs, proved on real rows.** Run #110, `jobs · backup`,
      green 2026-08-12 20:26 UTC: `wrote backup-20260812.sql.gz (16K, 11
      tables)`, artifact `db-backup` 14,261 bytes, 90-day retention. **P1-9a is
      closed** — the append-only `predictions` / `picks` / `bets` now have a
      copy outside the 7-day PITR window, which was the largest open risk in the
      product by elimination.
      **Three red runs (#107–109) and two silent misfires, five distinct
      defects** — an earlier note here said "five red runs", which conflated
      defects with runs and is corrected: two of the five never produced a red
      run at all, which was the point. Wrong task dispatched → a *green* run of
      `refresh-lines` (`run-name`, #42); `backup` unfindable at position 14 of
      20 → no run to look at (moved first, #43); unqualified pooler username
      (preflight, #45); `pg_dump` 16 against a 17.6 server (client major
      pinned, #46); and `postgresql-client-17` not installable from the stock
      image, which the PGDG fallback caught on its first real run. None of the
      three reds would have been *visible* a week ago — the step exited 0 with a
      20-byte artifact regardless.
- [x] **P1-9b — the scheduler now has a witness outside itself, 2026-08-13.**
      Proved on run #122, `jobs · backup`: `dead-man ping ok — backup
      (HTTP 200)`. **This was the only thing that catches the scheduler dying
      entirely** — `watchdogJob` cannot report its own death, and OPS-2's push
      is sent by that job, so a total stop takes both down. It is now the one
      alert that does not depend on this repo running at all.
      **Proven for `backup` only.** The other five slugs are configured but
      unobserved until their first cron fires — `watchdog` at 20:00 UTC,
      `refresh-lines` at 22:00, `sync-games` 09:00, `ratings-update` and
      `backup` Sunday, `keepalive` Sep 1. A slug that does not match its check
      now says so in the run log rather than passing silently, so the next
      firing of each is its own proof. **Watch that `watchdog` goes green
      tonight**; it is the one carrying the load.
      **Two wrong values first, and the failure mode is the point.** Run #120
      was green with the secret set and pinged nothing: `curl: (3) URL
      rejected: No host part in the URL` — malformed, never sent. Run #121,
      `(22) 404` — well-formed, delivered, but the value was an API key rather
      than the project ping key, which healthchecks answers identically to a
      missing check. Both runs were green, because `curl -fsS … > /dev/null ||
      true` discarded the outcome. **A dead-man switch that did not exist was
      indistinguishable from one that did**, which is exactly the defect the
      backup step above was fixed for. The step now reports (below), so #122
      is the first run whose green means anything.
      **The recipe, for when this is rebuilt.** `jobs.yml` pings
      `"$HEALTHCHECK_PING_URL/<task>"` —
      that is healthchecks' *slug* form, so the secret is the project's **ping
      key** URL, `https://hc-ping.com/<ping-key>` (Project Settings → Ping
      key), and **not** a check's UUID URL: a UUID with a task name appended
      matches nothing. **No trailing slash** — one makes every ping `//<task>`
      and 404s forever, silently.
      Six checks, each schedule type **Cron**, timezone **UTC**, slug exactly
      the task name, cron string copied from `jobs.yml`: `watchdog`
      `0 8,14,20 * * *` grace 2 h; `refresh-lines` `0 12,22 * * *` grace 2 h;
      `sync-games` `0 9 * * *` grace 2 h; `ratings-update` `0 13 * * 0` grace
      6 h; `backup` `0 15 * * 0` grace 6 h; `keepalive` `0 6 1 * *` grace
      48 h. Grace is not padding: Actions cron lags 5–30 min by design (the
      `jobs.yml` header budgets for it), so anything under an hour alerts on a
      healthy scheduler. **`watchdog` is the one that matters** — it pings
      3×/day, and the step is `if: success()`, so a red watchdog *withholds*
      its ping and that single check covers both "a data job went silent" and
      "the scheduler is gone". Do it first if only one gets done.
      Those slugs only, and **do not append `?create=1`.** All 24 task names
      ping, so auto-provisioning would create a check for each — 24 against
      the free tier's 20, at a default period nobody chose. An unmatched slug
      404s and is reported as a `::notice::`, which is the designed behaviour,
      not a gap.
      Route the alerts **anywhere but email**: P1-8 below is the evidence —
      nine delivered failure emails, zero opened. Everything but SMS, voice
      and WhatsApp is on the free tier (ntfy, Telegram, Pushover, Discord,
      Slack all qualify); the requirement is a channel that is not the GitHub
      notification stream, the same reasoning that produced OPS-2.
      **Verify without waiting on a cron:** `backup` is dispatchable and
      read-only, so dispatch `jobs · backup` and read the Dead-man ping step —
      `dead-man ping ok — <task> (HTTP 200)` on success, and a `::warning::`
      naming the URL's required shape when the request never lands. That
      reporting is what made #120 and #121 diagnosable in one run each; before
      it, all three runs looked the same from the outside.
- [x] **P1-8 — answered 2026-08-13, and the answer changes P1-9b's shape.** The
      Aug 10 email **arrived**: `Run failed: jobs - main (de8e7f2)`, 09:26 UTC,
      inbox, "Failed in 19 seconds" — the watchdog on a cold `job_runs` table,
      exactly as described. So the channel works.
      **It is also still unread, and so are eight others** from Aug 10–12,
      including all three `jobs · backup` failures. Nine delivered alerts, zero
      opened. They arrive in a stream of a few hundred GitHub notifications and
      look identical to a Vercel build comment. An alert channel that delivers
      into a place nobody reads is not much better than one that does not fire,
      which is why OPS-2 below was built rather than just ticking this row.
- [x] **OPS-2 — the watchdog buzzes a phone**, 2026-08-13. A fifth notification
      kind (`watchdog`, migrations 0036/0037 — split for the enum reason
      0032/0033 were), sent to admins from inside `watchdogJob` immediately
      before it throws. Deduped on the **UTC date**, not the run: the watchdog
      fires 3–4× daily, so keying on the problem alone would nag until the job
      recovered. Swallows its own errors, so a push failure can never replace
      the fault it is reporting — asserted in a test, along with the admin
      audience and the no-admins/no-keys/switched-off paths. 8 tests.
      **Explicitly not a replacement for P1-9b**, and the code says so.
- [ ] **P1-8** Check the inbox: a watchdog failure email fired Aug 10 — did it
      arrive? **The single highest-value 2 minutes left on this list.** It is
      now the primary alerting channel, and an unverified failure channel is no
      failure channel. · human
- [x] **P0-4** Run 2026-08-12: `ratings` **138** rows, all week 0, all
      `2026.2.0` (expected ~136 ✓, and it confirms the four-versions-behind
      row above); `team_hfa` **138**; `line_snapshots` **808**. Also
      `preseason_components` 138, `system_ratings` 138, `poll_rankings` 25,
      `games` 888. The season is ingested and bootstrapped.

### 2.1b Found in the live database, 2026-08-12

- [x] **DB-1 — cleared.** Every one of the **99 week-1 games** carried **three
      frozen `predictions` rows** — 297 total, from three `load-preseason
      --bootstrap` runs on Aug 5 15:38, Aug 5 16:26 and Aug 7 04:44 at model
      versions `2026.1.0`/`2026.2.0`/`2026.3.0` (the duplication the changelog's
      Operations note warns about). `freezeJob` drops any game already carrying a
      frozen row (`jobs-core.ts:1004-1008`), so the Thursday freeze before the
      openers would have returned `{frozen: 0, already_frozen: 99}` **and gone
      green** — shipping Week 1 receipts computed on Aug 5 against Aug 5 lines,
      keeping 2026.5.0's tier recentre out of the openers entirely, triple-counting
      every game in the grader, and leaving `total: 57.0` (audit bug #4's constant)
      inside the receipts table.
      **Migration `0028_clear_bootstrap_predictions.sql`, applied 2026-08-12:**
      297 → 0, scoped to season 2026, unstarted games, the three superseded model
      versions, and ungraded rows only, with a guard that aborts above 3 rows per
      game. `predictions` is now empty and all 99 games are freezable. The
      append-only guarantee is restored rather than bent — every receipt in the
      table from here was written by a freeze.
- [x] **DB-2 — withdrawn. There was no defect.** An earlier pass called 400 of
      the 808 `line_snapshots` rows duplicates. **That was wrong:** the grouping
      key omitted `provider`, and the pairs are DraftKings and Bovada captured at
      the same instant with genuinely different numbers (−28.5 vs −25.5 on the
      first game checked). Grouped on the full column set there are **zero**
      duplicates. That is a two-book consensus working exactly as designed, and
      the table was left untouched by 0028. Recorded rather than deleted, because
      a wrong finding that reached a merged PR is worth more visible than tidy.
- [x] **DB-5 — Week 0 is a week again.** CFBD merged it into week 1: 99 games
      across Aug 29–Sep 7, two Saturdays and ten days in one bucket, which put
      the Sep 5 Georgia opener on the same slate as games played the weekend
      before and gave that slate seven day-tabs. Since every surface keys on
      `week`, the split belongs at ingest: `scripts/lib/weeks.ts` (pure, 9 tests)
      finds the largest gap inside an over-long week 1 and assigns the earlier
      cluster to week 0 — derived from the kickoffs, not dated to 2026, and a
      no-op in seasons CFBD labels correctly. Wired into `sync-games.ts`;
      backfilled onto the stored rows by
      `0029_backfill_week_zero.sql` (applied — seam at the 4.83-day hole before
      Sep 3, **8 games → week 0, 91 stay in week 1**).
      Also: the eight `week >= 1` route validators that would have 404'd the new
      slate are now one shared `src/lib/week-range.ts` (`UX-17` aligned their
      numbers; this removes the copies), and the week selector offers Week 0 only
      when the season has one (`minWeek` on the cached season pointer).
      **Follow-up:** the board moved with its games — see DB-6.
- [x] **DB-6 — the crew's board follows its games to Week 0.** The one
      `group_week_config` row sat at week 1 with four handpicked games —
      TCU/North Carolina, Virginia/NC State, Stanford/Hawai'i, UNLV/Memphis —
      **all of which kick Aug 29–30**, so 0029 moved every one of them to week 0.
      It was always a Week 0 board; there had been no Week 0 to file it under.
      Left alone it misfiles both ways: `group_week_games_for` resolves a
      handpicked board from `group_week_games` and never re-checks `games.week`
      (`0020:175-182`), so the board would render Aug 29 games under a "Week 1"
      heading beside a slate starting Sep 3. `0030_move_board_to_week_zero.sql`
      (applied) moves the config and its pins together — copy the parent, move
      the children, drop the old parent, because the composite FK forbids
      updating either table alone — keeping mode, markets, conference, min-picks
      and `updated_by` exactly as set. Verified: board at week 0, 4 pinned games,
      all `games.week = 0`, unlocked.
- [x] **DB-7 — Week 1 board created, full slate.** `group_week_config` for
      (2026, week 1, regular): `selection_mode = full_slate`, markets
      `[spread, total]`, min-picks 0 — matching the Week 0 board. Written as
      ordinary app data, not a migration: a migration inserting one group's
      config would be meaningless on a fresh project where that group UUID does
      not exist. Verified via `group_week_game_ids`: **resolves to all 91 games**,
      0 materialised, which is correct for `full_slate` while unlocked — the
      `freeze-groups` job materialises `group_week_games` and stamps `locked_at`
      at the first kickoff (`0020:175-190`).
      **Two consequences worth watching.** 91 games × 2 markets = 182 pickable
      legs per person; `min_picks_per_week` is 0, so nobody is *required* to
      pick, but the board page is now long. And this is the realistic load case
      for `09:P-10` (board picks-query collapse) and for the `09:P-16` rehearsal
      — seed week 1, not a 10-game week.
- [x] **DB-3 — `0017_rivalries_seed` recorded in the ledger**, 2026-08-12.
      The seed had reached the database by some other path (29 rivalries live)
      but had no row in `supabase_migrations`, so a `db push` against a fresh
      project or a restore would not reproduce this database from the repo.
      Repaired by recording version `20260806061800`; 32 files now match 32
      recorded rows. **Correction:** an intermediate version of this entry
      claimed re-running the seed would duplicate rows or hit a constraint. It
      would not — the insert carries a `where not exists` guard on the pair in
      both directions. That was a grep for `on conflict` finding nothing and
      concluding the worst.
- [ ] **DB-4 — no postseason rows** (`games` is 888, all `season_type =
      'regular'`). Expected — CFBD publishes bowls in December — but it means
      the postseason ingestion path shipped in `§23 #35` has never run against
      real rows. Re-check in November. · watch

### 2.1c Found in the scheduler, 2026-08-13

- [x] **SCHED-1 — the notification crons had never been able to fire.**
      `jobs.yml` declared six of them — `0 15 * * 6`, `0 18 * * 6`,
      `0 22 * * 4,5` for `notify-picks-due` and `45 15 * * 6`, `15 19 * * 6`,
      `15 23 * * 6` for `notify-log-bets` — and **none of the six appeared in
      the `Resolve task from schedule` case.** Each resolved to
      `task=unknown`, fell through the `Run job` case to
      `*) … exit 1`, and went red. `workflow_dispatch` was broken the same
      way: both tasks were offered in the dropdown but had no `Run job`
      branch, so a manual run failed too. Net: **six red runs a week and not
      one notification ever sent.**
      PUSH-3 and PUSH-9 are ticked above and both are honest — the delivery
      path really was verified end to end on a real iPhone, and
      `run-job.ts:39-40` really does register both jobs. What was missing was
      the wiring between the cron and the job, which is the one seam neither
      the iPhone test nor any unit test crossed. **Week 0's picks-due nudge
      would not have gone out.**
      Fixed by adding both mappings to the resolve case and both task names to
      the shared `run-job.ts` branch. **It was ~9 days from catching itself:**
      `watchdogJob` began covering these two jobs on 08-12 (PUSH-10), gated on
      a scheduled game inside the next week, so it would have gone red for the
      first time around Aug 22 — the gate working exactly as designed, just
      later than reading the file.
      Guarded by `scripts/lib/jobs-yml.test.ts`, which parses the workflow the
      way bash reads it and asserts every cron resolves to a task, every task
      has a command, and no two tasks claim one cron string. Verified against
      the pre-fix file: 6 orphan crons before, 0 after.

### 2.2 This week (Aug 14–18)

- [x] **P1-1** Shipped 2026-08-13. A **Game status** section on `/admin`
      postpones, cancels or restores a game, and voids its open picks and bets
      **inline** rather than waiting for Sunday's `ratings-update` — a game
      postponed at noon on a Saturday would otherwise show open picks on a game
      that will never be played for up to a week. Both callers share
      `voidWagersForGames` in the new `src/lib/void.ts` and both are idempotent,
      so the Sunday pass stays as the backstop.
      Service-role write, deliberately: `games` is SELECT-only under RLS with no
      update policy, so a cookie-client write would affect zero rows and report
      success (audit 06/SEC-11's exact shape). Opening an update policy on the
      one table every anonymous visitor reads was the worse trade.
      **`nextGameStatus` refuses more than it allows**, because voiding is
      destructive to other people's picks with no undo: a `final` game cannot be
      voided (grading has already written results, CLV and units), a live game
      cannot be *postponed* (the scoreboard loop overwrites it within a tick
      while the voids persist) though it can be canceled, and an unrecognised
      status is refused rather than defaulted. The two destructive buttons arm
      before they fire. 14 unit tests.
      **Two things found while building it, both fixed here:**
      **(a) "the member re-picks" did not work.** `jobs-core.ts` has carried
      that comment since 0013, but `make_pick`'s `on conflict do update` set
      only `side`, `line_at_pick` and `locked_at` — so a re-pick on a revived
      game kept `result='void'`, and the grader selects on `result is null`. It
      would never have been graded. Migration **0034** clears `result` and `clv`
      on replace, which also fixes the general case of any pick replaced after
      grading. Proved by DB assertion: the test fails without the change.
      **(b) a voided pick rendered as nothing** at five sites, so a member whose
      pick was voided watched the chip silently disappear. It now shows, through
      the same neutral styling as a push — except on the home hub, which labels
      its chips in words and would have said "Push" on a canceled game.
      0034 also makes `games.status` a real check constraint (`not valid`, so it
      cannot fail on a legacy row): the five states had lived only in a comment
      since 0001, which was survivable while only the sync jobs wrote the column
      and stops being once an admin can. 11 new DB assertions, 129 total.
      *(`05:N9` in `audit/CHECKLIST.md` is now genuinely done rather than the
      partial §7 records.)*
      **Not verified from here:** the end-to-end run needs the live database —
      void a scratch game from `/admin`, confirm the card reads POSTPONED,
      confirm `job_runs.detail` on the next `ratings-update`.
- [ ] **09:P-16** Load rehearsal — **owner-run**, needs a live server. Seed via
      `scripts/seed-fixtures.ts`, `autocannon -c 15 / -c 30` against
      `next start`, record against the bars: p95 < 1.5 s, tick < 300 KB. The
      only zero-evidence area left before a 60-game Saturday. · 3 h
- [x] **P1-3** `.env.example` committed, 2026-08-13, plus the `!.env.example`
      negation under `.gitignore`'s `.env*`. **20 keys, not 17** — the count in
      this row was low; every `process.env` read in `src/`, `scripts/` and
      `jobs.yml` is now in the file, verified name by name. Grouped by concern
      with the two things that have already cost time written down: the Actions
      secret is named `SUPABASE_URL` and is passed through as
      `NEXT_PUBLIC_SUPABASE_URL`, and `SUPABASE_DB_URL` must be the session
      pooler URI. `README.md` step 1 now refers to a file that exists.
- [x] **P1-5** `/ratings` empty state, 2026-08-13. With no rows the page used to
      render sortable column headers over an empty `<tbody>`, a scale explainer
      ending "…is where that team sits among all 0", and a footnote explaining
      why a column that isn't there is hidden. It now early-returns the same
      house empty state `/rankings`, `/standings` and `/edges` already use, and
      the subtitle no longer claims "preseason" when the real state is "nothing
      has loaded" — those were the same string before.
      **Not seen rendered:** the page needs a live Supabase to load. The markup
      is the shipped pattern from `rankings/page.tsx:41-53` reused verbatim
      rather than new markup, which is the basis for believing it looks right.
- [x] **P2-1** Fixed 2026-08-13 with a shared `scripts/lib/env-num.ts`, because
      the bug was never only `PRESEASON_TILT_CARRY`. `Number("")` is `0`, so
      **every** numeric env guard in the repo read a blank variable as a
      deliberate zero: the tilt carry disabled itself
      (`build-preseason.ts:82-86`, the case `04:DQ-13` claims was fixed and
      wasn't — it closed the NaN half only); `envDays` returned **0 instead of
      the fallback**, so `LINES_IDLE_DAYS=""` would have collapsed the idle
      horizon and made every lines run skip; `CFBD_MONTHLY_BUDGET=""` set the
      scoreboard budget to zero, which throttles at 80% of nothing; and
      `SCOREBOARD_INTERVAL_SECONDS=""` gave a zero-second poll interval. An
      empty variable is what `FOO=` in a shell and an unfilled GitHub secret
      both produce, so blank now means unset. Garbage still throws, except in
      `envDays`, which keeps its tested fall-back-on-garbage contract on
      purpose: taking a scheduled job down over a typo'd idle threshold is the
      worse failure. 11 new tests.
- [x] **P2-10** Added 2026-08-13, with one substitution: `0 10-14 * * 6` →
      `scoreboard-loop` as specified, but the lines cron is **`5 10 * * 6`, not
      `0 10 * * 6`**. This row asked for a string that is already the weather
      cron, and the resolve case is first-match-wins, so adding it to the
      refresh-lines pattern would not have given Saturday morning two jobs — it
      would have shadowed line 214 and **silently retired weather**. GitHub also
      dedupes identical `- cron:` entries, so the string cannot simply be listed
      twice. Five minutes later costs nothing and keeps the two independent.
      `jobs-yml.test.ts` now fails if any two tasks ever claim one cron string.
- [x] **P2-11** Narrowed 2026-08-13. Both `gameMedia` calls now go through a
      `media()` wrapper that rethrows anything that is not a `CfbdError` — a
      missing `CFBD_API_KEY` raises a plain `Error`, and a config mistake should
      go red rather than quietly ship a slate with no networks on it — and
      otherwise logs the status with the 401/403-vs-rest split from
      `probe.ts:66-72`, as an Actions `::warning::`. The outcome also lands in
      the job's return value, so a denial is visible in `job_runs.detail` and on
      `/admin` instead of only in a probe. `sync-games` now reports `tv` count
      too. The stale "swallows this silently" notes in `probe-cfbd.ts:55` and
      `probe.ts:13` were corrected in the same commit.
- [x] **P1-4** Spec amended 2026-08-13 rather than a cron added: the code is
      right and §8 was stale. `refresh-lines-burst` is deliberately
      dispatch-only per the owner decision recorded at `jobs.yml:8-12` — lines
      barely move intraday, nobody here bets the moves, and the only number that
      matters is the close. §8 now says so. While in there, two larger §8 lies
      were fixed: it claimed **all jobs run on Supabase pg_cron → Edge
      Functions**, which was never true in production and is now not even
      possible (Q7 deleted that code), and the Stack line said the same.

### 2.3 Docs that contradict the code (Aug 18)

One sitting, ~2 h. Each is a doc edit, not a code change.

- [x] **Q3** Amended 2026-08-13. §2.2 now states the fitted `kFactor` 0.3 and
      carries the reason nobody should re-open it: the joint K/HFA refit picked
      K=0.4 at the **edge of the grid**, bought no margin MAE, and moved the
      0.7–0.8 win-prob bucket from 1.6 points off to 6.2. §2.3 states
      `winProbSlope` 0.101 and, more usefully, that it is not independently
      fitted — it is 1.7/σ, so it moves whenever `marginSigma` does.
- [x] **Q4 / P1-2 — built, and it changes nothing.** Owner chose build over
      amend, 2026-08-13. The bucket is an FCS team's average margin vs FBS over
      **prior seasons only**, split at the median of the qualifying population
      (`src/model/fcs.ts`) — a data-defined split, so `--tune-fcs`'s grid stays
      two-dimensional instead of gaining a free threshold to overfit with.
      **Both params ship at −30.** Because they are *equal*, the bucket is not
      merely inert but **unobservable** — `fcsRatingOf` returns the same number
      either way, so a wrong classification cannot move a prediction. Asserted
      as bit-identity in `replay.test.ts`, with a negative control so the
      assertion cannot pass vacuously.
      **The lookahead trap this nearly walked into:** a bucket computed across
      2023–25 and used to price a 2023 game breaks the replay's one invariant,
      quietly and in the flattering direction. `before` is a required parameter
      and the season filter is inside the function, so a caller who forgets
      cannot compile. Residual, documented in the tuner: the fit window is 1–2
      prior seasons where production gets 3; closing it costs two CFBD calls.
      **Production could not see this signal and now can.** The database holds
      only the current season, so there is no margin history to read at
      runtime; `build-preseason` computes it from the replay corpus and writes
      `teams.fcs_avg_margin` (**migration 0035**, nullable — empty means
      everyone prices at −30, i.e. today). `freezeJob` and `ratingsUpdateJob`
      read it back through the same `fcsTopIds` the backtest fits with, so the
      served rule and the fitted rule cannot drift. Rejected shortcut, recorded
      because it looks right: week-0 `ratings` rows for FCS teams would land
      them in `priors` and the replay would Elo-update them into drifting
      entities.
      Also removed the four hardcoded copies of −30.
      **Identity confirmed by CI, not just locally**: PR #54's auto-triggered
      backtest report is character-identical to run `31563098426`, the Aug 12
      run that shipped 2026.5.0 — every slice row, every opener bucket, and
      `b1 0.035 (t 0.83)` / `b2 0.985 (t 22.87)` at n=2611. A second machine,
      live CFBD data.
      **The tuner run has not happened and must not happen before Week 0** —
      see the row in §2.4.
- [x] **Q5** Amended 2026-08-13. §4 R3 now describes the per-group
      `picks_hidden_until_kickoff` (default false) and the `picks_revealed()`
      gate, including that a TBD kickoff stays hidden rather than open forever.
      The §8 Accounts paragraph repeated the old crew-wide claim and was fixed
      in the same pass.
- [x] **P1-6** Amended 2026-08-13 — §7's nav list reads `Groups`, with a note
      that `/crew` survives as a redirect because the old URL is in people's
      history and in the ledger's footer copy.
- [x] **P2-7** Corrected 2026-08-13 in both files. Tier 1+ is required because
      scoreboard and weather are **entitlements**, not because of quota — a full
      cold 2023–25 backfill is 16 calls against the free tier's 1,000.
- [x] **Bug #9 evidence** Corrected 2026-08-13. Two stale spots, not one: the
      fix table said `.select("id")` + zero-row check, which is gone, and the
      finding's own line range predates the move into the RPC. Both now point at
      `remove_pick` (`0021:255-257`). The finding itself was always right.
- [x] **probe.ts:52** Comment corrected 2026-08-13; **the flag stays on, for
      now.** The sentence was false — the Aug 12 probe pulled 889 rows on a
      Wednesday — and it was the whole stated justification for
      `emptyIsHealthy`, which therefore masks the one symptom that would reveal
      a dead live layer on a Saturday. Two documents disagree on the remedy:
      this file said it should go, `audit/KICKOFF_READINESS.md:69` says it
      "costs nothing and stays". Tightening a health check sixteen days out, on
      an endpoint whose first real in-season call has not yet happened, is the
      wrong trade — so the comment now states the truth and the disagreement,
      and the decision moves to §4 for after Week 0.

### 2.4 Model work that is not accuracy work (Aug 18–20)

- [ ] **Q8** Re-run `--tune-churn`. The Aug 12 portal fix changed the input
      distribution that `returningProdWeight = 6` and `talentReloadStrength = 1`
      were fitted against, so both are now fitted on something that no longer
      exists. Its recorded gain was already inside the ~0.25 SE, so **the honest
      outcome may be `netPortalPoints = 0`** — every other unearned parameter
      here sits at an identity default. Either way it gets a decisions-table
      row. Caveat: `replaySeason` never calls `churnAdjustment`; read how
      `tuneChurn` builds its evaluation before trusting a number from it. · 1 h
- [ ] **`--tune-fcs` — registered, deliberately not run.** The flag, the bucket
      rule and the four pre-registered criteria landed 2026-08-13; both params
      sit at −30 so nothing depends on the answer. **Dispatch after Week 0**,
      not before: `backtest.yml` → experiment `tune-fcs`. Gate 0 is the one to
      read first — if the two buckets' vs-actual bias differs by |t| < 2 the
      split has nothing to correct, and the honest outcome is "one bucket, on
      evidence", which is Q4 finally answered rather than deferred again.
      Either way it gets a decisions-table row with the number. Caveat written
      into the tuner: the fit window is 1–2 prior seasons where production gets
      3, closable with two CFBD calls for 2021–22. · dispatch
- [ ] **Dispatch `observe-scoreboard` over the Aug 29 openers.** The probe
      proved `/scoreboard` **answers**; nothing yet proves it **moves**. A feed
      that renames a status string produces zero writes, `{live_or_final: 0}`
      and a *green* run — a dead live layer and a quiet Saturday are currently
      the same observation. Liveness is only measurable over a live game, once,
      unrepeatably. The instrument exists; the measurement does not. · dispatch
- [ ] **The backtest's headline numbers are computed at tilt 0; production ships
      0.4.** Found 2026-08-13 while correcting `02:M-12`'s comment, which
      asserted the opposite. `backtest.ts`'s `run()` replays with no preseason
      tilt on the stated grounds that this "matches production… unless
      `PRESEASON_TILT_CARRY` has been set" — but the default is in the code, not
      the environment: `build-preseason.ts:91` reads
      `envNum("PRESEASON_TILT_CARRY", 0.4, …)`, so an unset variable changes
      nothing and production carries 0.4.
      **Not changed, deliberately.** Raising the replay to 0.4 silently restates
      every number the calibration report has ever produced, and that report is
      the honesty gate for model changes — including the b₁/b₂ figures in §1 and
      the 2026.5.0 identity check in Q4. Re-decide with
      `--tune-preseason-tilts`, which is the flag that owns this parameter, and
      give it a decisions-table row either way. **Not before Week 0**: nothing
      depends on the answer and it is model work, which §1 says does not belong
      in the next 16 days. · 1 h, after launch

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
| ~~**Q4**~~ | ~~FCS: build the two buckets, or amend the spec to one?~~ | **Answered 2026-08-13: build them** — owner call, against the recommendation below, and delivered in a form that removes the objection: both buckets ship at −30, so the machinery exists and the output is unobservable until `--tune-fcs` earns a value. Original note: **Amend to one bucket at −30, delete the dead constants.** Changing the input distribution 17 days out with no tuner behind it is the bad trade. |
| ~~**Q7**~~ | ~~Delete the dead edge function?~~ | **Answered and done 2026-08-13: deleted.** `supabase/functions/jobs/` had inverted CLV in all four branches and was 4+ versions behind `jobs-core.ts`. `05:C5` called it a deliberate tombstone; a tombstone with a live landmine in it is worse than none, and git preserves it. The only two live references were comments (`jobs.yml:3`, `jobs-core.ts:4`), both rewritten to say what happened and why. Closes P2-3 / 05:C5 / 07:OPS-11 / SEC-12. It also removed the fourth copy of the hardcoded `FCS_RATING = -30`. |
| **Q6 / SEC-13** | TBD kickoffs (`start_ts` null) — policy before Aug 29 | **Keep as-is.** Un-pickable, un-removable, stays blind, no close and therefore no CLV, but still frozen. Every branch fails closed, which is right for a security boundary and a receipt. Cost: a TBD game is un-pickable until CFBD firms the time, which `sync-games` does daily. |
| ~~**Q9**~~ | ~~Duplicate frozen predictions~~ | **Answered and done 2026-08-12** — cleared via migration 0028. DB-2 turned out not to be a defect at all. See §2.1b. |
| ~~**BRAND-1**~~ | ~~Recolour before Aug 29 or after?~~ | **Answered 2026-08-12: now.** Owner call, against the recommendation below; shipped the same day. Original note: **After.** `docs/BRAND.md` §5 replaces every surface colour and §12 swaps the display face — that is every page, 17 days out, against DESIGN.md's "build one screen, get it approved, then propagate". Both near-blacks read as black on a phone, so nothing looks broken today; the visible tell is the two golds (`#E8B93D` vs `#f2b63c`) side by side. Queued as BRAND-2/BRAND-3. |
| **UX-33** | Does `/edges` keep a permanent bottom-nav slot now that edges are demoted to information? | Owner call. |
| **09:§3** | Re-verify current Supabase free-tier limits against the pricing page | Human, 0.25 h. |
| **OPS-1b** | Dispatch one deliberately-failing run and confirm who receives the email | Human, 0.25 h. Pairs with P1-8. |

---

## 4. Queued for after launch

Real work, deliberately not before Aug 29 — **except for the eleven rows pulled
forward on 2026-08-13** by owner decision, which are ticked in place below with
what they turned out to be. The intent of this section is unchanged: what is
still unchecked here is still not launch work.

**Brand rollout** — icon and install surfaces landed 2026-08-12, then the
traced vector, the palette and the display face the same day (`docs/CHANGELOG.md`).
Two items remain open; the closed ones are kept for the record.
- [x] **BRAND-2** Brand palette shipped as the opt-in **Field** theme, not as
      the default (§5, §6, §41.4). Dark and light are untouched. `--surface`
      Inside that theme, `--surface` and `--elev` sit below the brand's printed
      raised green on purpose — a value specified for one card turns a slate of
      them into a green wash. `--live` stays red, also deliberately.
- [x] **BRAND-3** Graduate as the display face (§12, §41.5) — inside the Field
      theme only. Barlow Condensed stays the default. Under Field, `.scorebug`
      is Plex Mono (numbers, §12) and `.cover-word` is Archivo (no italic in
      Graduate).
- [ ] **BRAND-4** Install the PWA on a real iPhone and a real Android and check
      the three things CI cannot: the home-screen tile beside DraftKings/ESPN
      (§22), the startup image matching on a device that is actually in the
      media-query table, and that no white band appears between tap and first
      paint (§41.15–17). The unit tests cover transparency, square corners and
      the maskable safe radius; they cannot cover any of these. **Done
      2026-08-12: iPhone passes** — tile, install and splash all confirmed by
      the owner. The iPad found a real bug (stretched splash: portrait-only
      queries plus three current iPads missing from the table entirely), fixed
      the same day. Original note: **Partly done
      2026-08-12:** the PWA was installed on an iPhone (iOS 18.7) for the push
      work, so the install path and the home-screen tile are confirmed to
      render. The row test against DraftKings/ESPN and the white-band check
      were not deliberately looked at. · 0.25 h, human
- [x] **BRAND-5** Game cards, pick'em and the edge display as descendants of
      the icon (§32–34) — carried by the token swap, and therefore only in the
      Field theme. Verified by screenshot at 420px in all three.
- [x] **BRAND-8 — answered 2026-08-12: no.** Field stays one of three. The
      owner wants the three options, so charcoal dark remains the default and
      the brand palette is a choice rather than a migration.
- [x] **BRAND-6** An S in the nav lockup, from the traced outline
      (`src/lib/brand-mark-outline.ts`). Letter takes `currentColor`, so it
      inverts for the light theme; only the seam is pinned to the accent.
- [x] **BRAND-7** Vector master, 2026-08-12:
      `public/brand/slate-icon-master.svg` — layered and named
      (Ground / S / Football-Seam) with the palette in a `<style>` block, so a
      recolour is one edit rather than one per path. Outlines traced from the
      supplied raster, so the letterform is exact at any size: print,
      embroidery, a large-format OG variant, a one-colour reversal.
      **It is flat, deliberately.** §20 also lists Bevel and Lighting layers;
      those live in the raster, and rebuilding them as vector would be guessing
      at the original's lighting — the exact mistake the traced outline exists
      to avoid. Anything that should look dimensional uses
      `slate-icon-source.png`. A layered *dimensional* vector, if ever genuinely
      needed, has to come from whatever produced the artwork.

**Correctness / security**
- [ ] **P1-1b — frozen `predictions` on a dead game are never settled.** Found
      while building P1-1 and deliberately left out of it. The model-CLV pass
      keys only on `finalIds` (`jobs-core.ts:934-942`), so a frozen row on a
      game that never played keeps `close_spread` null forever.
      **Mechanism corrected 2026-08-13** — an earlier version of this row said
      the row "is re-read as ungraded every Sunday forever" and cost "a few
      wasted rows per week". It is not re-read at all: the query filters
      `.in("game_id", finalIds)`, and `isDeadStatus` games are never in
      `finalIds` (`jobs-core.ts:809-812`), so the pass does not see the row and
      there is no recurring cost. `close_spread` is written and read in that one
      block and nowhere else in `src/`. That also kills one of the two options
      this row offered: "exclude dead games from the ungraded set" is already
      true, so the live decision is only whether to *settle* the row — which
      banks a "no close" reading indistinguishable from a genuinely missing
      snapshot, and a canceled game has no close to record either way.
      **The one user-visible half is fixed** (2026-08-13): `receipts` said
      "graded after kickoff" on a game with no kickoff left to come, and now
      says "never played — no closing line" via `isDeadStatus`
      (`receipts/page.tsx`). The settle-or-not decision stays open. · S
- [x] **P2-5** Fixed 2026-08-13, migration **0038**. `remove_pick` now opens
      with the same `is_group_member` guard `make_pick` has carried since
      `0021:162`, so being removed from a group stops your writes in both
      directions rather than one, and it returns the number of rows it deleted
      instead of `void`. **The `ok:true` was never the RPC's** — it is
      `actions/picks.ts:79`, which this row mis-attributed; corrected in place.
      Zero rows deliberately stays a success: removal is idempotent and the
      second tap of a double-tap asks for a state the pick is already in, so
      raising would put an error toast on a pick that is correctly gone. The
      audit's complaint was that the caller could not *tell*, and a count
      answers that without inventing a failure. 3 DB assertions.
- [x] **P2-2 / SEC-08** Closed for signed-out callers 2026-08-13, migration
      **0040**. Both SELECT policies on `profiles` are `using (true)`
      (`0001:307`, `0011:21`) and RLS restricts rows, not columns — so the fix
      is a column grant, the read-side twin of 0013's UPDATE narrowing. `anon`
      now reads `id, display_name` and nothing else; `/recap` and `/game` render
      names signed-out and need exactly those. `queries.ts`'s `fetchProfiles`
      was `select("*")` and is narrowed to match, so the migration cannot break
      it. **Scope, stated rather than implied:** this closes the signed-out half
      only. `is_admin` is still readable by any *signed-in* user, because
      hiding it needs a security-definer `is_current_user_admin()` and six call
      sites moved onto it (`AuthButton.tsx:30`, `admin/page.tsx:41`, four server
      actions) — worth doing, larger than this row, still queued below. 5 DB
      assertions.
- [x] **SEC-02** Fixed 2026-08-13, migration **0038**. `join_group`'s
      `on conflict … do update set removed_at = null` discarded the `'member'`
      in its VALUES list, so the role survived untouched and an admin removed by
      another admin walked back in through the join code still an admin. The
      0020 comment described it as a feature ("Rejoining restores the old row,
      and with it the role you left holding"), which is why it sat.
      **Always rejoining as `member` would have been wrong**, and the test suite
      says so: `leave_group` deliberately lets the last member out of a group
      with no successor (`0020:413`, "An empty group needs no admin"), so a sole
      owner who left their own group would come back a member of a group with no
      admin and the deferred `group_members_keep_admin` trigger would refuse the
      insert — the creator locked out of their own group. So the two exits stop
      being interchangeable: a new `group_members.removed_by` is null when you
      left and set when an admin removed you, and only the second demotes on
      rejoin. That is what "removal isn't durable" was actually about. 4 DB
      assertions, including the sole-owner case.
- [x] **SEC-01** Done 2026-08-13, migration **0039**. Codes were **six upper
      hex characters** — a 16-symbol alphabet, 16^6 ≈ 16.7M, not the 36^6 this
      row implied — minted by the same loop copy-pasted into three places
      (`0020:370`, `0020:536`, `0027:112`). Now one `new_join_code()` generator
      at ten Crockford base32 characters (32^10 ≈ 1.1e15, ~67M× the old space;
      no I/L/O/U, so nothing to misread off a phone), plus
      `normalize_join_code` folding case, spaces, hyphens and the dropped
      letters onto what a person actually typed. Randomness comes from
      `gen_random_uuid()`'s v4 payload, not `random()` and not pgcrypto — which
      lives in the `extensions` schema on Supabase and is absent from the bare
      Postgres `npm run db:test` uses.
      Throttle: ten failures per user per fifteen minutes, in a deny-all
      `group_join_attempts` table. **The failure path had to stop raising for
      the throttle to work at all** — `raise` aborts the transaction, which
      would roll back the very attempt row being counted, so a bad code returns
      null and `actions/groups.ts` words it. That is the whole reason for the
      shape, recorded because it looks like a downgrade.
      **Two adjacent holes fixed in the same migration.** `anon` could read
      `join_code` for any public group: `0020:302` grants every column and the
      app-side guard at `groups/[slug]/page.tsx:89` is a page component, not a
      boundary. Live exposure was zero — `visibility` defaults to private and
      the project has no public groups — so this is latent, not urgent. And
      `create_group` lost its `revoke … from public, anon` in the 0027 rename
      (`0020:685` had it; `0027:127` only re-granted), leaving Postgres's
      default EXECUTE-to-PUBLIC standing on a function that raises on a null
      `auth.uid()` anyway. 14 DB assertions.
      **Existing six-character codes were left alone**, deliberately:
      regenerating invalidates codes already sent to the crew, and any admin can
      mint a ten-character one from group settings. Worth doing before inviting
      anyone new.
      *(Both this row and §7 said "next free number is **0028**". 0028–0037 were
      taken then; 0038–0041 have since shipped, so **the next free number is
      0042**. This line has now been wrong twice — treat any hardcoded "next
      free" as stale on sight and count the directory.)*

**Ops / perf**
- [x] **P2-3 / 05:C5 / 07:OPS-11 / SEC-12** Dead edge function deleted
      2026-08-13 — see Q7 in §3.
- [x] **`emptyIsHealthy` — deleted 2026-08-13.** Only `/scoreboard` ever set
      it, and its stated justification was disproved on 08-12: the flag claimed
      the board "returns `[]` all week and only fills on a Saturday", but that
      probe pulled 889 rows on a Wednesday. What it actually did was print
      `ok` over zero rows — the one symptom that would say the live layer is
      dead on a Saturday.
      **The disagreement this row recorded turned out to be about nothing.**
      This file wanted the flag gone; `audit/KICKOFF_READINESS.md:69` said it
      "costs nothing and stays". Both were arguing a red/green trade that was
      never on the table: `probeFailures` has only ever counted DENIED and
      ERROR, so EMPTY never failed a run. Removing the flag changes what the
      table *says*, not what the job *does* — an empty offseason board still
      exits 0.
      Zero rows now reports EMPTY for every endpoint, and a **required**
      endpoint coming back empty raises an Actions `::warning::` naming it, so
      it is visible in the run summary without being a failure. Going red on
      empty still needs one observation of a live game — that is the
      `observe-scoreboard` dispatch in §2.4, unchanged. 4 tests.

- [x] **P2-6** Narrowed 2026-08-13 to the six columns the row mapper reads
      (`id, school, abbreviation, conference, color, logo_url`); `mascot`,
      `classification` and `alt_color` were ~138 rows of payload nothing
      rendered. Its two siblings in the same `Promise.all` were already narrow.
      **The provenance in this row was wrong:** `09:P-5` narrowed
      **`profiles`** on the game page, not `teams` — `game/[id]/page.tsx:121`
      is still `select("*")` and was never touched. Left that way on purpose:
      it fetches exactly two rows, so the win is nil and the audit of which team
      fields that page reads is real work. Seven other `teams.select("*")` sites
      remain (`teams/`, `team/[id]`, `rankings/`, `receipts/`, `ledger/`,
      `standings/`, `queries.ts:156`) and are not part of this row.
- [ ] **09:P-1b** Slim `/api/slate-live` heal endpoint — decide after P-16's
      numbers. · M
- [ ] **09:P-11** Cacheable weekly-static pages · M
- [ ] **09:P-6** `fetchTeamAtsSeason` re-fetches every snapshot per game view · M
- [ ] **09:P-9/P-10/P-12/P-13** Blind-count aggregate RPC; board picks-query
      collapse; ratings latest-in-Postgres; receipts pagination · S–M each
- [ ] **07:OPS-6** Backfill mode for null-CLV rows (post-kickoff `captured_at`
      is excluded forever) — only matters after a missed close · S–M
- [x] **07:OPS-14a — preseason metered 2026-08-13; backtest deliberately not.**
      **"CI" in this row was already stale**: `probe-cfbd.ts:158` has metered
      itself for some time. The real gap was `build-preseason.ts`, and it was
      the one that mattered — `preseason-refresh` runs daily through August
      (`jobs.yml:239`) and each firing is *two* invocations, a `--check` and
      then the build, so the monthly count on the admin freshness card was
      structurally low in exactly the weeks it is worth reading. Now metered as
      `preseason-check` / `build-preseason`, best-effort like the probe's, from
      a `finally` so the two early returns in `--check` and a thrown build are
      counted too.
      **`backtest.ts` and `diagnose-tiers-2026.ts` stay unmetered**, which is a
      decision rather than an omission: `backtest.yml` carries only
      `CFBD_API_KEY`, so metering it means putting Supabase service credentials
      into a workflow that fires on every model PR. That is a wider change than
      an accurate count is worth. ~10 calls per backtest run, and the number is
      knowable from the run log.
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
- [x] **02:M-10/M-11/M-12** Settled 2026-08-13, three different answers —
      which is why the four were wrong to be one row.
      **M-09 was already closed** and is struck: Q4 built the FCS buckets on
      08-13, so the params are live at `fcs.ts:147` with four call sites and two
      test files. Both ship at −30, which makes them *inert*, not dead — the
      code path runs and the outputs coincide.
      **M-11 `suggestedStake` deleted.** No caller in `src/` or `scripts/`, only
      its own test, and the product deliberately does not size bets — edges are
      information, not wagers — so SPEC §5.4's ¼-Kelly was a feature the spec had
      moved away from. Took the now-unused `round1` with it.
      **M-10 `updateFromResult` kept**, against the row. It has no production
      caller but it is not dead weight: both live paths are specified *against*
      it — `ratings.ts` requires the off+def halves to move by "the overall
      update's K·marginError/2" and `replay.ts:249` says the same from the other
      side — and two tests exercise it as that reference. Deleting it costs the
      stated form of an invariant two other pieces of code are checked against
      and saves seven lines. Relabelled a reference implementation instead.
      **M-12 comment corrected, and it was hiding something.** It claimed tilt 0
      "matches production… unless `PRESEASON_TILT_CARRY` has been set" — but the
      default lives in the code, not the environment: `build-preseason.ts:91`
      reads `envNum("PRESEASON_TILT_CARRY", 0.4, …)`. **Production ships 0.4 and
      the headline calibration is computed at 0.** Left at 0 rather than
      silently restating every number the honesty gate has ever produced;
      re-decide with `--tune-preseason-tilts`. Now a §2.4-style open question
      rather than a comment that read as settled.
- [ ] **G5** Prediction attribution ("why this number") — freeze the
      decomposition and design the column set before the first retune · M

**Data quality**
- [ ] **04:DQ-12** Portal scoring from the `rating` field (S, present on 65% of
      entries) then production/snaps (M) + a decisions-table row. Today the
      term measures **headcount, not talent**: 91% of entries are 2–3 star, so a
      team shedding 20 backups scores like one losing 20 starters.
- [x] **04:DQ-5** Renamed to `returning_prod_usage` 2026-08-13, migration
      **0041**. **Far cheaper than this row assumed** — "schema churn during
      launch isn't worth it" priced a migration nobody had costed. The column
      has *zero* readers: nothing in `src/` selects it, the model's churn term
      comes from `percentPPA` rather than these columns, and `retDef` was
      write-only in the builder. One rename, one line of TypeScript, no
      backfill, no data movement; the stored numbers were always correct and are
      untouched. Only the label was wrong.
      The modelling consequence was found and fixed long before this —
      `backtest.ts:1556` records that the "defense" input being a second offense
      metric put ~10 of effective weight on one correlated quantity instead of
      5+5 on two, saturating the ±6 clamp for four of the top 40. What was left
      was the name, which is what would have sent the next reader down the same
      path.
- [ ] **04:DQ-6** `qbReturns` from roster facts instead of the passing-PPA
      proxy · M
- [ ] **04:DQ-11** Real `turnoverMargin` for the luck rule · S/M
- [x] **04:DQ-15** Fixed 2026-08-13 — and **"local-dev only" was wrong**.
      `cached()` now declines to write an empty array. CFBD answers `200` with
      `[]` for a season it has not published yet and `cfbd.ts:69` only throws on
      `!res.ok`, so the old code cached the absence permanently: every later run
      read the file, skipped the fetch, and got `[]` again long after the real
      data landed — silent, and pointing the wrong way, because a build on an
      empty talent list reads as a modelling problem rather than a stale file.
      The scope was understated because roughly 25 call sites pass
      `useCache: true` as a literal rather than threading `--cached`, so
      `build-preseason` on a persistent working directory carries a poisoned
      entry between runs. Only on a fresh CI runner is the damage confined to
      one run. 4 tests, including that a non-array payload is still cached —
      the emptiness test is Array-shaped on purpose.

**Push notifications** — §23 #38, scoped and then built 2026-08-12. iOS
supports Web Push from 16.4, but **only for a web app installed to the Home
Screen**; a PWA in a Safari tab cannot even ask. Sending is standard VAPID Web
Push, the same code as Chrome and Firefox — no Apple Developer account, no APNs
certificate.

**Live and verified on a real iPhone.** The list below is kept with its original
scope text so the estimates can be judged against what it took; the two unticked
items are what is genuinely left.

- [x] **PUSH-1 — the delivery path.** Migration 0031: `push_subscriptions`
      (user, endpoint unique, keys, `last_seen_at`, failure count; RLS so a
      user reads and deletes only their own, service role reads all) and
      `notification_sends`, append-only, unique on (user, kind, subject) — the
      dedupe key *and* the receipt, same idiom as `predictions` and
      `cover_flips`. `public/sw.js` with `push`, `notificationclick` (deep-link
      into the game or the board) and `pushsubscriptionchange` handlers; iOS
      drops subscriptions on disuse, and without that last one delivery stops
      silently. A server action in `src/app/actions/` to store and revoke, and
      `web-push` in the job runner. Secrets, as actually read by the code:
      `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
      (there is no unprefixed `VAPID_PUBLIC_KEY` — the scope said so and it was
      wrong). `web-push` goes in **dependencies**, not
      dev: PUSH-2 wants a "send me a test" button, and that runs on Vercel. It
      is server-side only and never reaches the browser bundle. · 5 h
- [x] **PUSH-2 — the opt-in.** A row in `/me`. Permission has to be requested
      from a tap (iOS refuses on load), so it is a button, not an effect. When
      the app is not installed the row explains Share → Add to Home Screen
      instead of offering a switch — iOS has no `beforeinstallprompt`, so the
      instruction is the only lever. · 2 h
- [x] **PUSH-3 — picks due.** One nudge, ~90 min before the week's first
      kickoff, only to members with unsubmitted picks. New `notify-picks-due`
      task in `run-job.ts` and `jobs.yml`. Schedule it early: Actions cron lags
      5–30 min, which is already budgeted for in the close passes. · 2 h
- [x] **PUSH-4 — your bad beat.** `cover_flips` (0026) is written live by the
      scoreboard job, so the moment already exists and is already detected;
      this joins it to picks and bets and notifies only the people holding the
      side that moved. Send inside the scoreboard job, wrapped so a push
      failure can never fail a scoreboard poll. · 3 h
- [x] **PUSH-7 — the admin console.** A Notifications section on `/admin`,
      beside Invites and Jobs. Three parts, and the third is the one that
      matters: **compose and send** (title, body, link, audience — just me, one
      group, or everyone) so an ad-hoc push never needs a deploy; the **send
      log**, read straight off `notification_sends`, showing who was targeted,
      what was delivered and what bounced; and **a switch per trigger** —
      enabled, lead time, copy — stored in a `notification_settings` row rather
      than hardcoded. Without that last part every timing tweak is a code
      change, which is the difference between the owner running this and the
      owner filing a ticket for it. Ships with PUSH-2: together they are the
      point where the feature is self-serve. · 4 h
- [~] **PUSH-6 — guardrails. Declined by the owner 2026-08-12.** Kept rather
      than deleted because the exposure is real and someone will rediscover it:
      with no daily cap a chaotic Saturday sends one bad-beat push per late
      swing, and with no quiet hours a Pac-after-dark flip buzzes at 2am. The
      mitigating fact, and presumably why it was declined: bad beats now
      default OFF, so this reaches only someone who deliberately switched them
      on and can switch them back off. Revisit if anyone turns them on and
      regrets it. Original scope: two of the four shipped
      with PUSH-1: 404/410 pruning is in `sendToUser`, and per-kind preferences
      are the `notification_prefs` table. **What is left is the daily cap per
      user and quiet hours off `profiles.timezone`** — nothing limits how many
      bad-beat pushes one chaotic Saturday can fire, and a late Pac-after-dark
      flip will buzz at 2am. Less urgent since bad beats now default off, so it
      only reaches people who asked, but not gone. · 1 h

**Deliberately not notified:** line moves, edge alerts, "your game is starting".
BRAND §16 and §38 — this is an intelligence tool, and a product that pings you
about a two-point move is how people turn notifications off. What ships: one
picks-due nudge a week, three log-bets reminders on a Saturday for a betting
group, and bad beats only for someone who switched them on.

**PUSH-5, a Sunday results digest, was declined by the owner on 2026-08-12** and
the ID is left vacant rather than reused. It would have been one push after
grading with your record and the crew leader. The reasoning against: the recap
page already exists and Sunday is the one day nobody needs prompting to go look
at it — a digest would have been the first notification anyone muted, and
muting is per-app, so it would have taken the two that matter with it.

**How you know it is working**, without asking anyone: the test button in `/me`
proves your own device end to end, and the send log on `/admin` shows every push,
who it went to and what bounced.

There is **no absence check** on the notify jobs — see PUSH-10. An earlier
version of this section claimed the `watchdog` covered them; it does not. It
checks `refresh-lines`, `sync-games` and `scoreboard-loop` and nothing else.

**What still needs a code change after PUSH-7:** a genuinely new *kind* of
trigger — some event nothing currently watches. Timing, copy, audience, turning
a trigger off, and one-off sends are all table edits from `/admin`.

**Built and live 2026-08-12** — PUSH-1, 2, 3, 4, 7 and 8, plus a fourth kind
(`log_bets`, betting groups before each Saturday wave) and per-kind defaults
with bad beats shipping off. Migrations 0032/0033 applied.

**PUSH-6 is the only item left, and it stays declined** — owner call,
reaffirmed 2026-08-13. *(This paragraph used to end "Worth closing before Week
0", contradicting the `[~]` declined row above it. One or the other had to go,
and the owner's decision is the one that counts. The exposure is real and
recorded in that row; the mitigating fact is that bad beats default OFF, so it
only reaches someone who deliberately switched them on and can switch them back
off.)*

**What was wrong with this section, found 2026-08-13:** PUSH-3 and PUSH-9 were
ticked as shipped and were — but their crons were never routed, so neither job
had ever run. See SCHED-1 in §2.1c. The ticks were honest about the code and
silent about the wiring, which is the gap that let it sit for a day.

- [x] **PUSH-8** Migration 0031 applied and VAPID keys set in Vercel and
      Actions, 2026-08-12. **Verified end to end on a real iPhone (iOS 18.7):**
      installed to the Home Screen, subscription stored, test notification
      delivered, receipt logged `sent`.
- [x] **PUSH-9** `log_bets`, a fourth kind: one push per betting group per
      Saturday wave, three crons 15 min before the 11:00 / 14:30 / 18:30 CT
      waves. Plus per-kind defaults in `notification_settings.default_enabled`,
      with bad beats shipping **off**. Migrations 0032/0033, applied
      2026-08-12. Owner request.
- [x] **PUSH-10** Absence check on the notify jobs, 2026-08-12. `watchdogJob`
      now covers `notify-picks-due` and `notify-log-bets` on an 8-day horizon,
      **gated on there being a scheduled game inside the next week**. That gate
      is the whole design: both jobs are weekly and seasonal, so from December
      to August they are correctly silent, and an hours-since-last-ok check
      would go red every week for eight months until nobody read it. 8 days,
      not 7, so a run that slips a day is not a fault. Four tests, including
      the offseason case.

**Product / UX**
- [ ] **G10-v1** Copy-digest ShareButton: Thursday (frozen slate / edges / "N
      haven't picked") + Sunday (results / movers / CLV) — best paired with the
      group board's real first Saturday · S–M
- [ ] **UX-14** Groups first-run pointer on the slate — pairs with G10, needs a
      live active-group cookie flow to test · S
- [ ] **F10** "Biggest line move" slate sort — needs real movement data · S
- [ ] **F13** Returning-production % on team pages — lights up when data lands · S
- [ ] **UX-08 — four of seven done 2026-08-13; three need a layout decision.**
      The row listed five targets and there were **seven**: the two it missed
      are the bet-chip void `X` on a game card (`GameCard.tsx:922-937`, ~15px)
      and the BetSlip toast dismiss (`BetSlip.tsx:120-126`, ~21px).
      **Fixed:** the void link (`VoidBetButton`, a bare ~14px text line, now
      `min-h-11` with `-mx-2` so the target grows without widening its row), the
      BetSlip remove `X` and toast dismiss (both `min-h-11 min-w-11`), the units
      input (`h-7` → `h-11`), and the toast's Share button, which was `min-h-9`
      — 36px, short of the rule and not on anyone's list.
      **Still open, and not a class tweak:** the star, the pin and the bet-chip
      `X` all sit inside `.trow` rows about 30px tall, stacked two to a card. A
      44px target centred on a 13px glyph would overlap its sibling vertically,
      and overlapping targets mis-fire worse than small ones do. The fix is a
      taller row, which is a layout change that has to be seen on a device
      rather than reasoned about — pair it with the Aug 21 real-device pass.
      **Measured 2026-08-13** on a 375px viewport with the slip seeded: remove
      44×44, units input 48×44, and `error.tsx`'s "Try again" 44×44. · S
- [x] **UX-22** Fixed 2026-08-13. `PickerChip` tested only `win` and `loss`, so
      `push` **and `void`** fell through both branches and rendered exactly like
      an ungraded pick — a sighted member could not tell a push from a game
      nobody had graded yet, with only the `sr-only` string carrying it. Now a
      map covering all four results, per `chips.tsx:76`'s house rule ("icon +
      text, never color alone"): `Minus` + `text-push` for a push, and `Minus` +
      `text-dim` for a void, which is not the same event — a canceled game
      returns the stake and settles nothing. That is the distinction P1-1(b)
      already fixed in words on the home hub, where a void read "Push".
      No new tokens. **Not seen rendered** — the page needs a live Supabase.
- [x] **Error surfacing — fixed 2026-08-13, and my first measurement of it was
      wrong.** The claim was that a build pointed at a non-resolving database
      still served 200 on every route. **That experiment was invalid**: Next
      inlines `NEXT_PUBLIC_*` at build time, *including in server components*,
      so overriding the URL at `next start` did nothing and the server was
      talking to the live project the whole time. Verified by finding the real
      project ref baked into `.next/server` chunks.
      **The defect was real anyway, and is now measured properly** — rebuilt
      with the bad URL baked in, so the client genuinely could not resolve it:
      `/standings`, `/ratings`, `/receipts`, `/recap`, `/slate`, `/rankings`,
      `/teams`, `/ledger` **all rendered as an empty season, silently**, on
      `main`. After the fix, all eight render the error boundary.
      The cause was `const { data } = await supabase…` dropping `error` at
      every call site. New `src/lib/db-result.ts` — `required()` / `requiredOne()`
      — throws on a failed read and never on an empty one, because empty is a
      real state here (`/ratings` before the first preseason load). Applied to
      the rows each page **is**, not to enrichment: a missing dome flag or poll
      rank still degrades quietly rather than blanking a slate. 8 tests.
      Fixing this also corrected an unsound `as TeamRow[]` on `/recap`, where
      the query selects four columns and the cast claimed nine.

- [ ] **UX-06 (residue)** Sub-4.5 tokens: light `chalk/50–55` table headers,
      dark `/35–/45` decorative labels, edge-on-card — needs a rendered pass · S–M
- [ ] **UX-21** Ledger "today" keyed to CT for non-CT bettors · S
- [x] **UX-24** Fixed 2026-08-13, and it was **three call sites, not one** —
      the week page plus both render sites on `/game` (`game/[id]/page.tsx:81`,
      rendered at `:399` and `:453`). The bug is home-side only: `fmtSpread`
      tests `spread === 0` to print "PK", so a string `"0"` prints a bare `0`,
      while the away side survives by accident because `lineForSide` negates it
      and `-"0"` is numeric `-0`. Coerced inside `pickSideLabel` rather than at
      the three edges — it is the single point every label already funnels
      through, and the next caller gets it for free. 1 test, both sides plus a
      stringly-typed total. See 05:N12 for the same question settled for the
      arithmetic path.
- [ ] **UX-25** `profiles.timezone` surfaced on `/me` and used server-side · S–M
- [x] **UX-27** Fixed 2026-08-13. `error.tsx` now renders `<AppNav />` like
      `not-found.tsx` and `loading.tsx` do — nav is not in the root layout
      (`layout.tsx:74-104`), every page mounts its own, and a boundary that
      skipped it left the reader on a dead end with no way out but the back
      button. It also gained `id="main"`, because `AppNav` renders a skip link
      to `#main` and would otherwise have arrived pointing at nothing. Both
      recovery buttons (`error.tsx`, `not-found.tsx`) went to `min-h-11`; both
      were ~36px. **Rendered:** the boundary shows top lockup and bottom nav,
      and "Try again" measures 44×44.
      **Checked while in there and *not* a bug:** `error.tsx` destructures
      `retry`, and Next's older contract passed `reset`. `retry` is correct
      here — both props exist in 16.3.0, `retry()` re-fetches and re-renders
      while `reset()` only clears the error state, and `retry` became stable in
      exactly this version (`next/dist/docs/.../error.md`, Version History).
      Reading the installed docs rather than the remembered API is what
      `AGENTS.md` asks for, and it was the difference between a fix and a
      regression.
- [ ] **UX-28 — reopened 2026-08-13: the symptom does not reproduce.** The
      change shipped (`min-w-0` on the team cell's flex parent, plus a `title`)
      and it is correct defensively, but **it fixes nothing measurable today**,
      so the box goes back. Measured against the live database: no school name
      clips at 375px (`scrollWidth == clientWidth` on all 138), none at 320px,
      the document never scrolls sideways, and the column widths are identical
      with and without `min-w-0` — `[172, 43, 64, 66]` both ways — including a
      forced worst case of the longest FBS name ("Florida International")
      beside full end-of-season records.
      It was briefly ticked as done on 08-13. That was wrong: shipping a
      defensive change is not the same as fixing a defect, and this file's
      whole contract is that a checked box means the thing is fixed. Either the
      audit's 375px observation predates a layout change, or it was reasoned
      from the markup rather than measured — the same failure mode that
      produced the nine rows in §8.
      **What would settle it:** the Aug 21 real-device pass. If nobody can make
      a name truncate on a real phone, close it as "not a defect" rather than
      as done. · S
- [ ] **UX-31 / §23 #19** Week changes via `pushState` so Back traverses weeks
      (`SlateView.tsx:263` is `replaceState` — deliberate, revisit) · S
- [x] **05:N12** Pinned 2026-08-13. The module's types said `number` while its
      implementation defended against strings (`num()`, and a test asserting
      `numeric` columns "arrive as strings"), and `audit/05` §29 had already
      verified live that they **do not** — PostgREST answers `-3.0` unquoted.
      The real defect was that the callers never agreed: `ledger/page.tsx`
      passes `payout_units` straight off the row and `Number()`s `units` in the
      next expression, so one line assumed the premise and its neighbour
      assumed the opposite.
      Settled toward the version that cannot break: `records.ts` is the
      arithmetic boundary, it coerces once in `num()`, and a `Numeric =
      number | string` type now says so. The alternative — delete `num()` and
      trust the types — means auditing every call site to add a `Number()`, and
      missing one turns `units` into string concatenation silently. Test kept,
      with its false premise replaced by the actual reason.
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

**NFL** — owner request 2026-08-13 ("NFL scores and lines as bets people can
make"; BRAND.md §17 has required the identity carry both leagues since v1.0).
Built on `claude/nfl-scores-lines-l4bhio`; the design and its evidence are in
`docs/CHANGELOG.md` (Aug 13, "The NFL, as a second seasons row").
- [x] **NFL-1** The whole build: `src/lib/espn.ts` + fixture-pinned odds
      parsing, migration 0042 (sport columns, one-current-per-sport,
      `groups.leagues`), the three ingest CLIs + cron wiring, `?sport=` slate
      with the CFB | NFL toggle and NFL kick windows, cross-league ledger /
      bets / home, `gradeSeasonFinals` + `nfl-grade`, `applyScoreboard` +
      dual-league scoreboard loop, group league scope + per-league splits,
      ticker with league tag. Model, freeze pricing and ratings replay
      untouched. 683 tests, 163 DB assertions, dry-runs against the live feed.
- [ ] **NFL-2** Go live, in order: deploy the code, apply 0042, then dispatch
      `nfl-sync-reference` → `nfl-sync-games` → `nfl-refresh-lines`. **The
      order is load-bearing**: the sport-aware `fetchCurrentSeasonWeek` must be
      serving before the 102026 `is_current` row exists, or every page's season
      pointer errors. Owner-run (production write). · 0.5 h
- [ ] **NFL-3** The DESIGN.md one-screen gate: `/slate?sport=nfl` on a real
      phone before any further NFL surface work — card density with no ranks /
      systems row, "Kansas City Chiefs"-length names in `TeamRow`, division
      filter labels, Early/Late window/Primetime section titles. · owner + 0.5 h
- [ ] **NFL-4** First settlement watched, not assumed: TNF Sep 10 — close pass
      at 23:45 UTC Thu (`nfl-lines-close`), `nfl-grade` Fri 13:30 UTC; check a
      logged bet grades with CLV against the captured close. A finaled
      preseason game on a Supabase branch works sooner. · 0.5 h
- [ ] **NFL-5** The live-situation shape against a real in-progress game.
      **Partly done 2026-08-13, against GB@PIT live:** status/period/clock,
      `shortDownDistanceText` ("1st & 10"), `lastPlay.text` and both scores
      all parse as written. What was NOT observed is a non-null
      `situation.possession` — at the kickoff snapshot ESPN sent only
      `possessionText` ("GB 35", the spot, not the team), and the board was
      still serving that snapshot minutes in. The parser reads absence as
      null, so the card shows the situation without the possession football —
      degraded, not wrong. Still owed: one look mid-drive (any live game,
      `espn.scoreboard()`) to see whether the team-id `possession` field ever
      populates on this endpoint; if it never does, note it here and the
      football stays a CFB-only affordance. · 0.25 h
- [ ] **NFL-6** Deferred, recorded: playoff-round labels + postseason week
      browsing (January; stored weeks 1–4 exist now), NFL venues + weather
      (existing `weatherJob` machinery, needs offset venue rows + coords),
      watchdog rows for NFL job ages, NFL demo data.

---

## 5. Not built, by choice

Additive features, no defect behind any of them. Verified still open 2026-08-12.

| ID | Item | Why it's fine |
|---|---|---|
| §23 #40 / F7 | Futures tracker with weekly mark-to-market — `future` is a valid `bet_type` and BetForm accepts it; nothing marks it to market | · M, and nobody has logged one |
| §23 #44 | Generated db types — `src/lib/db-types.ts` is still hand-written | Drift risk is real but slow; `next typegen` in CI covers the route layer only |
| §23 #45 | ⌘K quick-switcher + keyboard navigation | Table stakes for a "command center", zero users blocked today |
| §23 #31 | BetForm game **search** — labels, validation and the −3d/+9d window shipped; the picker is a plain `<select>` | Fine at 60 games/week |
| §23 #42 | **Route smoke tests** — 41 test files, 585 tests, none exercise a route | The one partial that touches correctness; named, not rounded up |

**Explicit slip order** if time runs out (`SPEC.md` §10, Buffer — cited by
section rather than by line, because the 08-13 §8 amendments moved it from 253
to 255 and it will move again): team-page LLM verdicts
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
| `audit/CHECKLIST.md` `SEC-01` | "migration 0026" | Stale — 0026 and 0027 are taken; next free was **0028**. *(And that correction went stale in its turn, twice: SEC-01 shipped as **0039** on 08-13, and 0040/0041 followed the same day. Next free is **0042** — count the directory rather than trusting this cell.)* |
| `audit/AUDIT-2026-08.md` §23 | 46 raw `[ ]` boxes, all unchecked, below a table saying 38 are done | The boxes now carry their verified status. The table was right; the boxes were three months of drift. |
| `audit/AUDIT-2026-08.md` Bug #9 | cites `actions/picks.ts:54,58` | The fix moved into the `remove_pick` RPC (`0021:255-257`) and got *stronger*. Citation queued for correction in §2.3. |
| `docs/CHANGELOG.md` Aug 12 (portal) | — | Created a new open item (**Q8**, re-run `--tune-churn`) that no checklist carried. Now in §2.4. |
| `docs/CHANGELOG.md` Aug 12 (observe) | — | Same: the `observe-scoreboard` dispatch and the stale `probe.ts:52` comment existed only in prose. Now in §2.4 and §2.3. |
| `jobs.yml` | `07:OPS-9` backup job `[x]` | The job is right and inert-until-secret as designed, but it is **cron-only** — not dispatchable, so setting `SUPABASE_DB_URL` cannot be verified until a Sunday. New row in §2.1. |
| `audit/KICKOFF_READINESS.md` P0-1/P0-2/P0-5, P1-7, P1-10 | open | All closed on 2026-08-12 (early-kickoff scenario doesn't fire; Tier 2 confirmed; all 11 endpoints reachable; portal fix shipped in `5c58fb3`). |

**Verified open today by reading the code, not the docs:** P1-1
(`sync-games.ts:93`), P1-3 (no `.env.example`), P1-4 (`jobs.yml:163` maps no
cron to `refresh-lines-burst`), P1-6 (`crew/page.tsx` is a redirect), P2-1
(`build-preseason.ts:82-86`), P2-3 (`supabase/functions/jobs/index.ts` present),
P2-6 (`ratings/page.tsx:56`), P2-10 (`0 10 * * 6` is the weather cron), P2-11
(`sync-games.ts:63`), §23 #40/#44/#45, #31, #38, #42.

---

## 8. Corrections from the 2026-08-13 §4 pass

Nine rows described their own defect wrongly. Found by writing the fix, not by
re-reading the prose — which is why they had survived a reconciliation that was
looking for exactly this. In four cases the wrong detail changed the fix.

| Row | Claimed | Actually |
|---|---|---|
| §1 **Database** | 0034/0035 "not yet applied"; 32 migrations | **36/36, applied.** Both stale when written. P1-1's re-pick fix *is* 0034 and OPS-2's push needs 0036/0037 — and `notifyWatchdog` returns `{notified: 0}` rather than throwing when its settings row is absent, so it would have been silently dead. Confirmed live. |
| **P2-5** | `remove_pick` "returns `ok:true`" | The RPC returned `void`; the `ok:true` is `actions/picks.ts:79`. |
| **SEC-01** | codes are base32-ish; "next free number is **0028**" | **Upper hex, six chars** — 16^6, not 36^6. 0028–0037 were taken; SEC-01 shipped as 0039. |
| **SEC-02** | "a removed admin rejoins as admin" | True, but the obvious fix breaks a real case: always rejoining as `member` locks a sole owner out of their own group, because `leave_group` lets the last member out and the keep-admin trigger then refuses the insert. Needed `removed_by` to tell removal from departure. |
| **P1-1b** | the row "is re-read as ungraded every Sunday forever"; costs "a few wasted rows per week" | **Never read at all** — the query filters to `finalIds`, which excludes dead games by construction. No recurring cost. Also kills one of the two options the row offered, since "exclude dead games" is already the behaviour. |
| **P2-6** | "the game-page equivalent was narrowed by `09:P-5`" | 09:P-5 narrowed **`profiles`**. `game/[id]/page.tsx:121` is still `teams.select("*")`. |
| **07:OPS-14a** | unmetered: "CI, backtest, preseason" | The probe self-meters already. The real gap was `build-preseason` — daily through August, two invocations per firing. |
| **04:DQ-15** | "local-dev only" | ~25 call sites pass `useCache: true` as a literal, so `build-preseason` carries a poisoned cache between runs on a persistent working dir. |
| **04:DQ-5** | "schema churn during launch isn't worth it" | Zero readers anywhere. One rename, one line of TypeScript, no backfill. |
| **02:M-09/M-10/M-11/M-12** | one row, "dead code" | Three different answers. M-09 already closed by Q4; M-11 genuinely dead; **M-10 kept** — no caller, but two live paths are specified against it and two tests exercise it as that reference. |
| **UX-08** | five sub-44px targets | **Seven.** Plus the toast's Share button at `min-h-9`, which was on no list. |
| **UX-24** | "week page passes raw `line_at_pick`" | Three call sites — `/game` renders it twice as well. |

**Checked and *not* a defect**, recorded so it is not re-raised: `error.tsx`
destructures `retry` where older Next passed `reset`. Both props exist in
16.3.0, `retry` is the recommended one and became stable in exactly this
version. Reading `node_modules/next/dist/docs/` rather than trusting the
remembered API — which `AGENTS.md` asks for — was the difference between a fix
and a regression. Likewise `scripts/db-test.sh`: a suite that aborts mid-way
prints "0 failed", which reads like a silent pass, but `set -euo pipefail` is
set and the run does exit 1. Verified with a deliberately-aborting probe suite.

**A measurement of my own that was wrong, recorded because the method matters
more than the finding.** The error-surfacing row was first justified by "a build
pointed at a non-resolving database still served 200 on every route". That
experiment proved nothing: **Next inlines `NEXT_PUBLIC_*` at build time,
including in server components**, so overriding the URL at `next start` left the
server talking to the live project the whole time — confirmed by finding the
real project ref baked into `.next/server` chunks. The defect was real, but the
evidence for it was not, and it took a rebuild with the bad URL actually baked
in to measure honestly. Anything testing behaviour against a *substituted*
Supabase URL has to rebuild, not restart.

**Left deliberately undone, with the reason in the row:** the three remaining
UX-08 targets (star, pin, bet-chip `X` — they sit in ~30px stacked rows, so a
44px target would overlap its sibling and that needs a layout change seen on a
device), `backtest.ts` metering (needs Supabase secrets in a workflow that runs
on every model PR), the `game/[id]` teams query (two rows, no win), P2-2's
signed-in half (needs an `is_current_user_admin()` RPC and six call sites), and
the existing six-character join codes (regenerating invalidates codes already
sent to the crew).
