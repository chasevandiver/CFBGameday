# The CFB Slate — Status

**The one file that answers "what's left."** Reconciled 2026-08-13 against the
code on `claude/status-md-tasks-ivmbtb`. Week 0 is **Sat Aug 29** — 16 days.

**That was true on 2026-08-13 and stopped being true on 08-14**, when reading
the live database against `jobs.yml` turned up six things in the NFL lane — §2.1d.
Two of them are launch-relevant and neither is NFL-specific in its consequence:
the scheduled push **cannot send at all** (`PUSH-11`, which takes OPS-2 down
with it), and the watchdog's liveness gate is CFB-only (`NFL-22`), so it is
switched off during exactly the weeks the NFL is the only football being played.
Everything else still unchecked in §2 is owner-run (09:P-16), a dispatch
(`--tune-fcs`, `observe-scoreboard`, Q8), or a dated watch.
*(The original sentence here read "**As of 2026-08-13, §2 has no code or docs
work left in it**" and is kept as what was believed, not deleted — it was
accurate against the code and wrong about the scheduler, which is the third time
that seam has produced a finding: SCHED-1, P1-9b, and now PUSH-11.)*

**§4 was opened early, 2026-08-13, by owner decision** — the post-launch queue
is marked "deliberately not before Aug 29" and eleven rows were pulled forward
anyway because §2 had nothing buildable left. Landed: the four security rows
(P2-5, SEC-01, SEC-02, P2-2/SEC-08) as migrations 0038–0040, five UX rows, and
five ops/data-quality rows including migration 0041. **Migrations 0038–0041 were
applied to the live project on 2026-08-13**, in order and after the build
carrying their dependent code deployed — see the Database row in §1 for what was
verified afterwards and why the ordering was load-bearing. *(This paragraph said
they had "NOT been applied" until 2026-08-14; it was written before the apply and
never updated. The Database row was right the whole time — when a §-header
paragraph and a §1 row disagree, the row is reconciled and the paragraph is
prose.)*
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
| **Build** | **861 tests across 63 files**, all green in-session 2026-08-14 after the NFL and betting batches (the "659 across 47" here was 08-13's number and is superseded). Previously: **659 tests across 47 files**, `tsc`, lint and `next build` clean — all run in-session 2026-08-13 after the §4 pull-forward below, and green on CI for PRs #58/#59/#60. **155 DB assertions** (was 129), run in-session against a real Postgres 16 cluster rather than carried from CI; the 26 new ones were each checked to fail against the pre-fix schema. *(Run `npm ci` first: a stale `node_modules` fails two suites on missing deps and looks like a regression.)* |
| **Scheduler** | 111 completed runs. Reds to date: one watchdog firing correctly on a cold `job_runs` table, and runs #107–109 — the backup verification sequence, each a real defect, all closed. |
| **Regressions** | 0. Nothing correct was later undone (`KICKOFF_READINESS` §5). |
| **CFBD** | Tier 2, 30,000 calls/month, confirmed against ~10k of use. All 11 endpoints probed live and reachable, including `/scoreboard`. |
| **Model in code** | `2026.5.0` — tilt carry, `baseHfa` 3.0, centered team-HFA, portal fix, market-anchored tier recentre |
| **Database** | **47 migration files, 47 recorded rows, in sync** — verified live 2026-08-14 after 0046/0047/0048 were applied to `mjijyutmbtnwcjspozsx` in that order, which was load-bearing: **0047 had to land before the code that stops sending `reason_tag` deployed**, or every bet insert would have failed the NOT NULL. Verified after applying: `deleted_wagers` and `scoring_plays` exist, `admin_remove_pick` is present, `bets.reason_tag` is nullable, `deleted_wagers` has no grant to either API role, and `scoring_plays` grants SELECT only. *(File count is 47 against numbers running to 0048 because **0004 does not exist** — a pre-existing gap, confirmed by counting the directory rather than trusting a number in this file.)* One thing that verification turned up and did not fix: **TRUNCATE is granted to `anon` and `authenticated` on every public table**, project-wide and pre-existing — see §6. Previously: **40 migration files, 40 recorded rows, in sync** — verified live 2026-08-13 after PR #58 merged and deployed. 0038–0041 were applied in order once the production build carried the code they depend on, which was the whole reason they waited: 0039 makes `join_group` return null on a bad code (the old action read that as success), 0040 revokes `is_admin` from anon while the old `fetchProfiles` still did `select("*")`, and 0041 renames a column the old `build-preseason` still wrote — which would have failed `preseason-refresh`, the job the Aug 26 checkpoint waits on. Verified after applying: join codes mint at 10 Crockford characters, `normalize_join_code('il o-1')` → `1101`, `group_join_attempts` exists deny-all, and anon can read neither `groups.join_code` nor `profiles.is_admin`. Before this pass it was 36/36, and 0034–0037 **are applied** — an earlier version of this row said 0034 and 0035 were "not yet applied to the live project" and gave the count as 32/32, and both were stale by the time they were written. It matters because two ticked rows depend on them: P1-1's re-pick fix *is* 0034 (`make_pick` confirmed carrying it live), and OPS-2's watchdog push needs 0036's enum value and 0037's `notification_settings` row — `notifyWatchdog` returns `{notified: 0, errors: 0}` when that row is missing (`notify-jobs.ts:375`), so it would have been a silent no-op. Both confirmed live, along with 2 admin push subscriptions for it to reach. The `0017` ledger gap (DB-3) was repaired 08-12. 0031–0033 add the push tables. `ratings` 138 @ wk0, `team_hfa` 138, `games` 888 (**wk0 = 8 Aug 29–30, wk1 = 91 Sep 3–7**), `rivalries` 29, `predictions` 0 and every week-0/1 game freezable, jobs running today. Advisors clean — the four findings are the intentional deny-all tables and the by-design definer functions. |
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
- [x] **P1-8 — the original row, superseded by the answer above.** This is the
      question; the ticked row three above it is the answer, recorded 2026-08-13
      (the Aug 10 email arrived, and eight others did too, all unread). The box
      should have been checked in that commit and was not — ticked 2026-08-14 on
      re-reading, with the duplicate left in place rather than deleted so the
      question it asked stays legible. · human, done
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

### 2.1d Found in the NFL lane, 2026-08-14

The NFL preseason has been running for a week, which makes it the first real
traffic any of this machinery has carried. Everything below was found by reading
the live database and `jobs.yml` together, not by reading either alone — which
is the same seam `SCHED-1` sat in.

- [x] **PUSH-11 — the scheduled push cannot send, and never could.** Wired
      2026-08-14: the three keys now sit in `jobs.yml`'s `env:` block.
      **Guarded so it cannot come back**, and the guard is the interesting part —
      `jobs-yml.test.ts` now reads the required key names *out of
      `pushConfigured()` itself* rather than hardcoding them, so adding a third
      required key to `push.ts` fails the workflow test instead of silently
      disabling scheduled push a second time. Checked failing against the
      pre-fix file: both keys reported missing.
      **Not verified end to end from here**, deliberately. The proof is a
      dispatch of `jobs · notify-picks-due` returning something other than
      `{"skipped": "no vapid keys"}` — but that job sends real pushes to real
      crew members with open picks, and firing it to satisfy a checkbox is not
      mine to do. Dispatch it against this branch, or let the first scheduled
      run be the proof, and read `job_runs.detail`.
      *(Secret names are `.env.example`'s. If repo settings use different ones,
      only the `${{ secrets.… }}` side changes — the left-hand names are what
      `push.ts` reads. A wrong name degrades to today's skip, not a red run.)*
      `jobs.yml`'s `env:` block passes five secrets and **none of them is a VAPID
      key**, so `pushConfigured()` (`src/lib/push.ts:58`) is false in every
      Actions run. Live proof, not inference: `notify-picks-due` on 08-13 22:36
      returned `{"skipped":"no vapid keys"}`.
      **This takes OPS-2 down with it.** `notifyWatchdog` opens with
      `if (problems.length === 0 || !pushConfigured()) return {notified: 0,
      errors: 0}` (`notify-jobs.ts:370`) — so the watchdog's phone buzz, the
      thing built *because* nine failure emails went unread, silently sends
      nothing and reports success. OPS-2 has never had a chance to fire (the one
      red watchdog run is 08-10, three days before it shipped) and could not have
      if it had.
      **PUSH-3/PUSH-9 are not wrong.** The iPhone test went through the Vercel
      app, where the keys *are* set; nothing ever exercised the Actions
      environment. Exactly SCHED-1's shape — a path verified end to end on both
      sides of a seam nobody crossed.
      **The secrets already exist** — owner confirmed 2026-08-14, and push does
      send from `/admin` and the `/me` test button. That is not a contradiction,
      it is the reason this was invisible: an Actions secret is not an
      environment variable until the YAML maps it, and `/admin` runs on Vercel,
      which has its own env. So the two verified paths and the broken one never
      touched.
      Fix is therefore **three lines of `env:` in `jobs.yml`** and nothing else —
      `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, each
      `${{ secrets.… }}`. Cheapest item on this list by some distance.
      **Do it before Week 0**: it is the alerting channel P1-8 concluded was
      needed. · XS
- [x] **NFL-22 — the watchdog is blind to the NFL, including to NFL liveness.**
      Fixed 2026-08-14. Both gates now read `seasonIdsForYear(SEASON)` — the
      helper that already existed for exactly this — and four NFL jobs joined
      the verdict: `nfl-sync-games` (30 h), `nfl-refresh-lines` (26 h),
      `nfl-lines-close` and `nfl-grade` (80 h).
      **Why those two get 80 h and the notify jobs could not get a horizon at
      all**: the NFL ingest jobs are *chained onto their CFB counterparts* in
      the `Run job` case, so they fire daily year-round with no offseason
      silence to tolerate, and the two with their own crons have a widest real
      gap of 72 h (Fri→Mon for grading, Mon→Thu for the close pass). 80 leaves
      Actions' 5–30 min lag room without blunting the check. All four record an
      `ok` run when they no-op, which is what makes an absence check mean
      anything for them.
      The new fields are **optional**, so the change cannot make a caller that
      never read the NFL start going red — asserted. `detail` now also reports
      `leagues`, because before this the CFB-only gate and a correct one looked
      identical from outside. 6 new tests, 43 in the file.
      *(Still not watched: the `scoreboard-loop-nfl` idle marker. It is an
      `idleSkip` bookkeeping row rather than a job, and `scoreboard-loop` itself
      is already checked.)*
      `watchdogVerdict` checks `refresh-lines`, `sync-games`, `scoreboard-loop`,
      `notify-picks-due`, `notify-log-bets` and nothing else; the live
      `detail.checked` confirms it. None of `nfl-sync-games`,
      `nfl-refresh-lines`, `nfl-lines-close` or `nfl-grade` is watched, so any
      of them can go silent without a red run.
      **The worse half is not the missing rows.** Both gates inside
      `watchdogJob` are `.eq("season_id", SEASON)` — CFB only
      (`jobs-core.ts:247-260`). The scoreboard check only fires when a **CFB**
      game is live, so through the whole NFL preseason — the only football being
      played right now — the freshness check that exists to catch a dead live
      layer is switched off. It will be switched off again for every NFL-only
      Sunday of the regular season.
      `NFL-6` records "watchdog rows for NFL job ages" as deferred, which is the
      cheap half; this gate is the half that matters and was not written down
      anywhere. · S–M
- [x] **NFL-23 — the close-pass crons missed the slot the preseason kicks in.**
      Fixed 2026-08-14. Seven cron entries added and `45 23 * * 0,1,4,6` widened
      to `* * *`; every addition closes a named slot that exists in `games`, and
      the set was verified by query rather than by reading it — coverage goes
      from 29 of 49 preseason and 39 of 272 regular-season games *uncovered* to
      **zero**, excluding 24 rows stamped Sun 05:00 UTC that are week-18 and
      flex placeholders rather than real times.
      The tell: preseason kicks at 23:00 and 23:30 UTC, i.e. **before** the
      23:45 pass, and `--burst` filters `start_ts > now()`, so a game that has
      already kicked can never be picked up afterwards.
      **Two corrections to how this row was first written, both mine.**
      *(a) The counts were 30 and 40.* My coverage query did day-of-week
      arithmetic without wrapping the week, so a Saturday-night cron was scored
      as not covering a Sunday-morning kick. Redone with minutes-mod-10080: 29
      and 39. The shape of the finding survived; two of its numbers did not,
      which is why they are restated here rather than quietly edited.
      *(b) "Four games never got a line at all" was true and misleading.* Those
      four have zero snapshots, but the daily non-burst chain
      (`refresh-lines → nfl-refresh-lines`) had run exactly once at that point
      and skipped, so the absence is mostly a one-day-old-wiring artifact. The
      chain snapshots the whole earliest unplayed week twice a day — the 08-14
      12:41 run wrote 10 rows covering tonight's kicks — so upcoming games do
      get a line. **What these crons actually buy is a capture near kickoff**,
      i.e. a real close and therefore real CLV, not the difference between a
      line and no line. Recorded because the stronger claim reached a commit
      message. · S
- [x] **OPS-19 — every idle skip reached `job_runs` as the same flat "idle".**
      Found and fixed 2026-08-14 while trying to explain why `nfl-refresh-lines`
      reported `idle` 35 minutes before a kickoff. `idleSkip` returned a bare
      boolean and both callers turned it into `{"skipped": "idle"}`, so the row
      a human reads could not tell **`next_game_gt_7d`** — a correct offseason
      no-op — from **`no_scheduled_games`**, which during a bootstrap is a real
      fault wearing a green run. The console log had always distinguished them;
      nothing that survives the run did.
      Now returns the reason string, still truthy, so every call site is
      unchanged (`scoreboard-loop`'s `cfbIdle && nflIdle` included). 1 new test
      asserting the two reasons differ, and the two existing `toBe(true)`
      assertions tightened to name their reason.
      *(This did not explain the 23:25 run — that window has manual runs
      interleaved with scheduled ones and I could not attribute it honestly.
      The observability gap is real and fixed on its own merits; the anomaly is
      left unexplained rather than given a story.)* · S
- [x] **NFL-24 — withdrawn 2026-08-14. There was no mismatch, and the error was
      mine.** This row claimed `NFL-4`'s "TNF Sep 10 — close pass at 23:45 UTC
      Thu" contradicted the stored kickoff. Checked against ESPN directly
      (`scoreboard?dates=2026&seasontype=2&week=1`): the feed returns event
      `401872656` at `2026-09-10T00:20Z`, **character-identical to the stored
      row**, so the ingest is right.
      What I got wrong was assuming one game. Week 1 opens with **two**
      standalone night games, and they are not the same fixture:
      New England at Seattle kicks Wed Sep 9 8:20 pm ET (Thu 00:20 UTC), and
      San Francisco at the Rams kicks **Thu Sep 10** 8:35 pm ET (Fri 00:35
      UTC). `NFL-4` names the second one, and a Thursday 23:45 UTC pass lands 50
      minutes before it — exactly as that row intended. I read "the opener" into
      a row that never said it.
      **One real thing came out of the wrong finding**: the Wednesday opener
      genuinely had no close pass, because nothing in the old cron set ran on a
      Wednesday. `NFL-23`'s widening of `45 23 * * 0,1,4,6` to `* * *` covers it
      (Wed 23:45 → Thu 01:25). Recorded rather than deleted, because a wrong
      finding that reached a commit message is worth more visible than tidy —
      the same reason `DB-2` is still in this file. · withdrawn
- [ ] **SCORE-1 (residue) — the scoring timeline has never seen a live game.**
      `scoring_plays` is empty for **both** leagues. Not a defect: SCORE-1
      merged 08-14 16:17 and the only NFL live window so far closed 08-14 04:00,
      so the 78-tick loop that ran through it was running the previous code. It
      means the job, its ESPN summary parsing and its `gamesNeedingScoring` gate
      are unobserved against real rows — the same status `observe-scoreboard`
      has for CFB, and with the same remedy: watch one, once. · watch
- [x] **NFL-25 — no NFL venues, so no venue line on the card.** Fixed
      2026-08-14 in `nfl-sync-games`, and the fix was smaller than the finding:
      **`parseEvent` has always extracted the venue** — `espnId`, `name`,
      `city`, `state`, `indoor` — and the job simply never wrote it. Venues are
      upserted *before* games, because `games.venue_id` is a foreign key and a
      game carrying an id with no row behind it fails the insert.
      Ids go through `nflVenueId`, the same offset scheme team ids use, so an
      ESPN stadium cannot land on a CFBD one. Logic lives in a pure
      `nflVenueRow` in `scripts/lib/nfl.ts` rather than inline in the script,
      with 6 tests.
      **This does not unlock weather, and that is a feed limit, not an
      oversight.** ESPN's scoreboard venue carries a name, a city, a state and
      `indoor`, and **no coordinates**. `weatherJob` needs
      `latitude`/`longitude`, so NFL weather stays exactly where `NFL-6` has it,
      blocked on a source of coordinates. `dome` takes `indoor` because the
      column is NOT NULL and that is the honest answer; everything else stays
      null rather than invented — there is a test asserting the coordinates are
      *absent*, so a later change cannot quietly fill them with something
      plausible.
      **Verified against real ESPN JSON, not a fixture**: week 1 gives 16 games,
      16 distinct venues, every id ≥ 100000, Ford Field `dome: true`, Lumen
      Field `dome: false`, and the Melbourne Cricket Ground row that the
      international game needs. **Not run against production** — the sandbox
      proxy 403s the API from `node` (curl works, Actions works), so the next
      scheduled `sync-games` is what actually writes these rows. · S

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

**The NFL preseason is a live rehearsal for Week 0, and it is free.** Noted
2026-08-14. Every launch-critical path except the model is shared between the
two leagues — ingest, line snapshots, the close pass, the live scoreboard,
`GRADE-1`'s grade-on-final-tick, CLV, the ledger, the slate cards, the scoring
timeline — and the NFL is playing real games *now* while CFB has none until the
29th. Three slates remain before Week 0: **tonight through Aug 16** (10 games),
**Aug 20–24** (16), and **Aug 27–29** (16, the last of which overlaps Week 0
itself). This is strictly better evidence than the scratch-week dispatch below,
for the reason the `observe-scoreboard` row already gives: liveness is only
measurable over a live game, once, unrepeatably. The never-observed paths to
watch are `SCORE-1`'s timeline, `GRADE-1` settling on the tick that sees a
final, the NFL close pass (NFL-23), and 0044's 10-second pull.

- [ ] **Tonight, Aug 14–16** — 🏈 First rehearsal, and the cheapest one: 10
      preseason games, first kick 23:00 UTC. Watch `scoring_plays` go non-zero,
      a bet grade inside a tick of the final, and whether the 23:00 kicks get a
      snapshot (they will not — that is NFL-23, and this is the confirmation).
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
- [x] **SEC-08b — `profiles.is_admin` is still readable by any signed-in user.**
      Closed 2026-08-14, migration **0050**. `is_current_user_admin()` is
      SECURITY DEFINER, STABLE, `search_path = ''`, returns
      `coalesce(…, false)`; `authenticated` loses the column and keeps
      `id, display_name, favorite_team_ids, timezone, created_at`. EXECUTE is
      granted to `authenticated` and revoked from `anon`.
      **It was nine call sites, not six.** This row and §8 both said six; two
      more were single-line reads on `/ledger` and `/game/[id]` that a
      multi-line grep missed, and a ninth was `actions/push.ts`. All nine now go
      through one `src/lib/admin.ts` — `isCurrentUserAdmin` plus a `requireAdmin`
      for the five server actions that had the same three-step check
      copy-pasted with only the refusal wording different. Nine copies of an
      authorization check is nine chances to get one backwards, which is the
      same argument `records.ts` won.
      **Fails closed at two layers, deliberately.** `lib/admin.ts` turns any RPC
      error into `false`, and the function's own `coalesce` would return false
      if it were reachable — a signed-out caller is *denied outright* rather
      than answered, because EXECUTE is revoked from `anon`. Every call site
      guards on a user first so nothing takes that path; it is asserted anyway,
      because "fails closed" should be a property of the database rather than an
      emergent one.
      **The old test caught it, which is the point.** `profiles.sql` carried an
      assertion that a signed-in member *can* read `is_admin` — correct and
      deliberate under 0040, and the first thing to go red here. Replaced by its
      inverse, with the reason recorded in place rather than deleted. 11 new DB
      assertions, 225 total. The `admin-wagers` mock needed its `rpc` stub
      taught to answer, or four "an admin can do X" tests would have gone green
      by denying everyone.
      *(Not applied to the live project. **Apply order matters**: 0050 revokes a
      column the currently-deployed code still SELECTs, so applying it before
      this branch deploys would 403 every admin gate. Same trap 0039/0040/0041
      had, recorded in §1.)* · done
      The half of P2-2/SEC-08 that migration 0040 deliberately did not close.
      **Given a box 2026-08-14: it was described as "still queued below" in the
      P2-5… P2-2 row and in §8, and it was not below.** By this file's own rule —
      if it isn't here it isn't queued — it was untracked for a day, which is the
      failure mode the rule exists to prevent. The work is unchanged from the
      scope stated in P2-2: a security-definer `is_current_user_admin()` plus six
      call sites moved onto it (`AuthButton.tsx:30`, `admin/page.tsx:41`, four
      server actions), then drop `is_admin` from the `authenticated` column grant.
      Not launch work — knowing who the admins are is not a capability, and the
      signed-out half (the one an anonymous scraper could reach) is closed. · S–M
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
      actions) — worth doing, larger than this row, **tracked as `SEC-08b`
      above** (it said "still queued below" for a day while being queued
      nowhere). 5 DB assertions.
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
- [x] **STATS-1 — `/ledger/stats`, the breakdowns behind the Record tile.**
      Owner request 2026-08-14 ("click on your betting record and it'd show a
      whole bunch of stats"). Ten cuts across three groups: market, side,
      favourite-or-dog and price; teams backed and teams faded; kickoff window,
      day, stake and confidence — plus streaks and, once both leagues have
      graded bets, a CFB/NFL split.
      **The page renders and does not calculate.** Every table is
      `tallyBy(bets, cut)`: the cuts are a new pure `src/lib/bet-cuts.ts`, the
      arithmetic stays in `records.ts`. That module exists because six surfaces
      once disagreed about what a record is, and a stats page with its own
      private tally would have been a seventh. 34 new tests on the cuts alone.
      **Deliberately no CLV cut** — the owner picked the three descriptive cuts,
      and closing-line value already has a home on `/ledger` (the tile and the
      tail/fade audit). A second place for the same number is a second place for
      it to be wrong.
      **`favouriteOrDog` refuses to answer rather than guess**: spreads read the
      stored home-perspective line through the same conversion `lineForSide`
      does, moneylines read the price because they have no spread, and a total
      returns null because a total has no favourite. Every cut returns null for
      rows it cannot classify and the page drops them, with a line under each
      table saying how many of the settled bets it actually covered — so a cut
      that skips half your ledger says so instead of quietly rebasing.
      `BET_TYPES`/`TEAM_SIDED`/`TOTAL_SIDED` moved from `BetForm`'s privates
      into `db-types.ts` beside `CONFIDENCE_TIERS`, so the form and the stats
      page read one vocabulary.
      **Seen rendered at 375 px** (signed-out state) — and it needed it: the
      first shell nested `AppNav` inside `<main>` and omitted `w-full`, which
      made the page 768 px wide and scroll sideways. Measured, not eyeballed:
      `scrollWidth` 768 against a 375 viewport, now 375, matching `/ledger` and
      `/`. **Not seen with data** — that needs a signed-in user with graded
      bets, and the database holds two bets total. The populated tables are
      unrendered and say so here rather than being claimed. · done
- [ ] **G10-v1** Copy-digest ShareButton: Thursday (frozen slate / edges / "N
      haven't picked") + Sunday (results / movers / CLV) — best paired with the
      group board's real first Saturday · S–M
- [ ] **UX-14** Groups first-run pointer on the slate — pairs with G10, needs a
      live active-group cookie flow to test · S

- [x] **SHARE-9** The card title is possessive — `<display_name>’s Bets`, owner
      request 2026-08-14. Typographic apostrophe, not the ASCII one; all four
      committed fonts carry U+2019, which was already established when
      `sanitizeForCard` was written. A name ending in "s" still takes `’s`.
      The signed-out fallback stays "My Bets" rather than "My’s Bets".
      Rendering it turned up the part that was not obvious: the longer title
      **wrapped to two lines**, and the header is not a fixed-height block, so
      `HEAD_H` — which the whole row budget is computed from — quietly became
      wrong and a full slip could have pushed the footer off. `titleFontSize`
      scales the title to stay on one line. Its width budget is **860px, not the
      968px content width**, because the S stamp sits in the same row and a
      `nowrap` title runs *under* it rather than shrinking; the first advance
      estimate (0.62em) was also low and was corrected to 0.66 off the render.

**SHARE-8 — fixed 2026-08-14, from the first real card the owner shared.**
Four defects, none of which any test or synthetic render had caught, because
every one of them needed production data or a real bet count:
- [x] **Logos never drew.** The SSRF allowlist was `.espncdn.com` only, so all
      **264 CFB teams** fell to the monogram — the failure is invisible by
      design, so it read as deliberate. `teams.logo_url` is
      `cdn.collegefootballdata.com` for college and `a.espncdn.com` for the 32
      NFL teams; both https, both counted in production rather than inferred.
      The mistake was reading `demo-data.ts` — the one file that builds an
      espncdn URL — and assuming the ingest matched. Pinned by
      `share-card-assets.test.ts`, including domain-boundary impostors.
- [x] **Two bets rendered at twelve-bet sizes**, leaving two thin lines above
      900px of nothing. Row height, crest, and every type size now scale with
      the row count (`cardMetrics`), and a slip of three or fewer draws its rows
      as **panels** — the hero's own material language, so nothing new is
      invented. A full twelve-row card still reproduces the original numbers
      exactly, and that is pinned by a test.
- [x] **Paired crests overlapped into the text.** The overlap suited artwork
      with transparent padding; CFBD's logos fill their square, so UNC sat half
      behind TCU. Side by side with a gap now, and the slot is `2.14 ×` the
      crest — the hero carried the old width too, which put Georgia's mark on
      the matchup line.
- [x] **Twelve bets with a hero did not fit at all** — found by a test written
      during the fix, not by the card. 325px of hero plus tier headings leaves
      665px for eleven rows. The model now trims to what fits at a legible
      minimum and reports the rest through the existing `+N more`, rather than
      shrinking until it technically fits. An exhaustive test walks 1–12 bets ×
      3 tier spreads and asserts both that the rows fit **and** that nothing is
      silently lost.

**Share image** — owner request 2026-08-14, pulled forward. A second share
option beside the existing text share: a 1080×1350 card of a user's bets,
sorted by confidence tier then kickoff, titled `<display_name> Bets`, shareable
from the bet slip, the ledger and groups. This is the product's marketing
piece, so it colours from `BRAND` (§31, and `src/lib/brand.ts`'s docblock) and
not from the app's charcoal tokens. **No audit raised this** — there is no
prior ID, and nothing image-related appears in the rejected-experiments table.
The nearest neighbour is `G10-v1` above, which stays text.
Decisions taken with the owner, recorded so they are not relitigated: the tier
is stored on the bet, not chosen at share time; a *lean* is the bottom rung of
one ladder, not a separate unstaked object; the tier is editable until kickoff
and frozen after; pick'em picks get no tier; the group variant shares the
viewer's own bets, not the whole sheet.
- [x] **SHARE-1** Design directions at 1080×1350 in `public/design/`
      (`share-card-a|b|c.html`), per DESIGN.md exploration mode. Built
      flexbox-only with no grid and no `gap`, because the winner has to survive
      being ported into a `next/og` ImageResponse and satori renders a narrower
      CSS subset than a browser. Rendered and checked at full size, including
      the two hard cases — Miami (OH) at Western Michigan, and a futures bet
      with no game, no logos and no kickoff. **Done 2026-08-14. Owner chose a
      hybrid, `share-card-d.html` "The Sheet"** — B's row engine and its aligned
      Plex Mono column, A's tier headings printed in full but only on a tier
      *change*, and C's hero made conditional: the panel appears iff exactly one
      bet sits alone at the highest tier, so it can never promote an arbitrary
      row. All four hero states are rendered in that file, and rendering them is
      what earned its keep — three separate layout bugs were only visible at
      full size: A overflowed the frame by ~275px and clipped two bets and its
      footer, B's stub stretched and left a 200px hole, and D's single-bet hero
      ballooned into an empty green slab. The last two are one problem — a fixed
      1350px canvas holding a variable-length list — and are fixed by one
      self-scaling `filler` that collapses to nothing on a dense card and
      carries the S at 6% opacity on a sparse one.
      **One correction to the approved plan, on the record:** the plan had a
      single-bet card return no hero. That contradicted the rule it sat beside
      (a lone bet *is* alone at the highest tier) and rendered as one thin row
      on an empty card. The special case is gone; the rule is now one sentence
      with no exceptions. · S
- [x] **SHARE-2** Done 2026-08-14, `0045_bet_confidence.sql`, **applied
      2026-08-14 ~05:03 UTC**. 13 existing bets backfilled to `'bet'`.
      **Verified against production, not just against the test cluster.** Two
      probes, each inside a block that raises at the end so the whole thing
      rolls back — checked afterwards, and the table was untouched: 13 rows, no
      probe rows, no tier changed, max units still 1.00.
      The freeze: bet 12, whose game kicked at 00:00 UTC, refused the retag with
      the trigger's own message and still refused a units edit. The allow path
      needed a temporary row, because every one of the 13 live bets is either
      voided or already kicked off — an explicit tier survived the insert
      sanitizer (`lean`), a pre-kickoff retag landed (`century`), a retag
      carrying `units = 999` moved the tier to `year` and **left units at
      1.00**, and a tier outside the ladder was refused.
      `get_advisors` reports nothing new; every lint on the project predates
      this change.
      `bets.confidence text not null default 'bet'` with a six-value check, so
      existing rows land on the neutral rung and nothing downstream branches on
      a null tier. `enforce_bet_void_only()` gains exactly one transition,
      written in the same shape as the one already there — decide what may
      change, rebuild the row from `OLD`, re-apply only that — so a retag
      carrying a stake edit drops the stake edit, exactly as a void carrying one
      already does.
      **Kickoff, not grading, is the boundary**, and that is the whole design:
      a tier frozen at insert makes a typo permanent, while a tier that moves
      after kickoff destroys the only reason to store it — "how do my Bet of the
      Day picks actually do?" is answerable only if the tier was set before
      anyone knew. Futures have no kickoff and freeze at grading instead, which
      the existing `old.result is not null` guard already covers; a game whose
      `start_ts` is still null has not kicked off either, so TBD stays editable.
      The `"void own bets"` policy was **not** renamed despite now carrying the
      retag — that would break the trail back to `06:SEC-03`, so the drift is
      recorded in a `comment on policy` instead.
      Types in `db-types.ts`: `CONFIDENCE_TIERS` (ordered, and the order is
      load-bearing — the card sorts on the index, so append but never rearrange)
      and `CONFIDENCE_TIER_LABELS`, mirroring `REASON_TAGS`.
      **Verified: 174 SQL assertions pass, 0 fail**, including 11 new ones —
      default rung, explicit tier surviving the insert sanitizer, a tier outside
      the ladder refused, retag pre-kickoff, retag discarding a smuggled stake
      edit, retag post-kickoff refused, TBD kickoff allowed, futures allowed,
      another user's bet refused, a graded bet refused, and the original void
      path still working. `lint`, `tsc --noEmit` and 726 vitest tests clean.
      **Caveat on how it was run:** `npm run db:test` cannot complete in this
      container — migrations 0043/0044 `create extension pg_cron`, which is not
      installed here, and it fails before reaching any suite. That is
      pre-existing and unrelated to bets. The suites were run against the same
      throwaway Postgres 16 cluster with those two migrations excluded. **0043
      and 0044 have therefore never been exercised by `db:test` in this
      environment** — worth knowing before trusting a green run. · M
- [x] **SHARE-3** Done 2026-08-14. `src/lib/share-card.ts` — pure, no React, no
      I/O, pinned by 27 tests in `share-card.test.ts`, exactly as
      `share-text.ts` is. `sortForCard` (tier desc, then kickoff asc, unscheduled
      to the bottom **of its own tier** rather than of the card, ties keeping
      input order), `heroBet`, `groupByTier`, `tierHeadline`, `capForCard`,
      `formatUnits`/`formatOdds`.
      Three decisions worth not rediscovering later. **`capForCard` sorts before
      it cuts** — the other order would drop by placement time and could bin the
      Bet of the Year to keep a lean. **The `slate` tier groups by broadcast
      window, not just by tier** — two slate bets in different windows are
      genuinely different sections ("Bet of the Afternoon Slate" vs "…Primetime
      Slate"), and kickoff order already clusters them so nothing fragments.
      **The superlatives stay singular over several rows** because they are
      titles, not categories; only `bet` and `lean` pluralise.
      `formatUnits` always prints one decimal — `2u` over `1.5u` puts the
      decimal points out of register and undoes the only reason this is an
      image rather than text. `formatOdds` uses U+2212; **satori draws tofu
      rather than falling back**, so SHARE-5 has to confirm that glyph on the
      subset that actually ships, not on the family. · M
- [x] **SHARE-4** Done 2026-08-14. `SlipSelection` now carries `away`/`home`
      (abbr, logo, colour) and `tier`, filled at the two construction sites that
      already hold the `GameView` — `GameCard`'s `sel()` and `SheetLine`'s
      `selectionFor()`. `logSlipBets` validates the tier against
      `CONFIDENCE_TIERS` before the insert rather than letting the check
      constraint reject the batch, so one bad tier names itself instead of
      failing the whole slip. A `setTier` action on the store; retagging on the
      slip is a plain edit because 0045's freeze only governs a logged bet.
      **A tail inherits the number, not the conviction** — how strongly someone
      else liked it is their read, so a tailed selection starts at the neutral
      rung.
      **`league` deliberately not added to `SlipSelection`.** `GameView` carries
      no `sport`, and `slate.ts` says league is "derived from the season id,
      never guessed" — so the card builder derives it once via the existing
      `sportOfSeasonId()`. That is exactly as correct as the existing logging,
      which already writes a whole slip under one season. · S
- [x] **SHARE-5** Done 2026-08-14. `POST /api/share-card` — `ImageResponse`,
      node runtime, session-gated, zod-validated with bounded string lengths
      (the layout is fixed, so a 400-character "pick" does not scroll, it wraps
      until the card is unreadable). POST because the bet slip shares selections
      that do not exist in the database yet.
      `npm run brand` now also writes the four TTFs to `public/fonts/` and they
      are committed, so no request fetches a font. `card.tsx` is presentation
      only; `buildCardModel()` in `share-card.ts` makes every decision, which is
      what lets the hero states be tested without rendering a PNG.
      **Three things only rendering could have caught**, all fixed: a bet with
      no teams drew an **empty coloured circle** (the monogram has no abbr to
      set — it takes the S now); the lint rule against JSX in a try/catch was
      right and load-bearing, because `ImageResponse` renders lazily as its
      stream is consumed, so the guard caught nothing and only looked like it
      did; and the four fonts do **not** carry the ʻokina, so Hawaiʻi would have
      set a tofu box — `sanitizeForCard` swaps it. U+2212 *is* covered, which
      retires the flag SHARE-3 raised.
      **SSRF, worth naming:** the payload is client-supplied and satori will
      fetch whatever URL it is handed, from inside the deployment — and because
      the response is an image, a probe of an internal address fails silently
      and looks like a broken logo. Logos are therefore resolved ahead of render
      against an ESPN-CDN allowlist, with a timeout and a size cap. A test
      asserts `169.254.169.254` is never reached. · M–L
- [x] **SHARE-6** Done 2026-08-14. `shareImage()` (Web Share Level 2, download
      fallback), `ShareImageButton`, `ConfidencePicker`, `RetagBetButton`, and
      the payload builders in `share-card-build.ts`.
      Image share sits **beside** the text share — the slip footer, the
      post-log toast, the ledger header and the betting-group home. The text
      share is untouched. The tier is set in the slip (one row each), in
      `BetForm`, and retagged from the ledger's new Confidence column.
      Notes. `shareImage` passes **only `files`** — `share-sheet.ts` documents
      that adding `url` makes iOS append a link that pushes the content off the
      message preview, and a caption does the same thing to an image. It feature-
      tests with `canShare({files})` rather than `"share" in navigator`, because
      plenty of browsers have Web Share and refuse files. There is **no
      clipboard fallback**: image-to-clipboard is patchy and, where it works,
      hands the user something they then have to find a place to paste. A
      download is the honest second choice.
      The slip's Log button moved to its own full-width row beneath the two
      share buttons — lowest and widest is the thumb-zone rule, and it was
      sharing a row with three other controls.
      `RetagBetButton` deliberately does **not** decide whether an edit is
      allowed. It renders the picker when the row looks live and surfaces the
      trigger's own refusal when the browser's clock and Postgres's disagree,
      so the UI cannot drift out of step with 0045. · M
- [x] **SHARE-7** Done 2026-08-14, landed with SHARE-5. **The first test in the
      repo to exercise a route** (§23 #42 is now partially closed — one route,
      not the gap in general). 12 assertions: 401 unauthenticated, 400 on an
      empty bet list / a tier outside the ladder / a body that is not JSON, and
      then real PNG bytes for all four hero states, a card at the 12-bet cap,
      the longest matchup the product can build, a logo-less future, a name
      carrying the ʻokina, and the SSRF allowlist.
      It checks the PNG magic number and a floor on byte length rather than just
      the status, because a zero-byte or HTML response sails past a 200 check —
      and an empty canvas is exactly what satori produces when it renders but
      finds nothing to draw. · S

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

**Where the NFL stands against CFB, minus the model** — audited against the live
database 2026-08-14, because "we added the NFL" and "the NFL works" are different
claims and only the first had evidence. League isolation is the part that came
out cleanest: `fetchCurrentSeasonWeek` takes a `sport` and filters on it, so the
two `is_current` season rows never collide; NFL teams carry
`classification = 'nfl'`, so `/standings`' `classification = 'fbs'` filter
excludes them without needing to know the NFL exists. Neither was luck — both
are `src/lib/league.ts`'s offset scheme doing its job.

| Capability | CFB | NFL | |
|---|---|---|---|
| Schedule ingest | `sync-games`, CFBD, 09:00 daily | `nfl-sync-games`, ESPN, chained onto the same cron | ✅ 321 games |
| Team reference | `sync-reference` | `nfl-sync-reference` (dispatch-only) | ✅ 32/32 complete |
| Venues + weather | ✅ | ❌ zero rows | NFL-25 / NFL-6 |
| Lines, display refresh | `refresh-lines` 12:00/22:00 | chained onto it | ✅ |
| Lines, close pass | 5 crons | 3 crons, with holes | ⚠️ NFL-23 |
| True opening line | first-snapshot proxy | the book's own `open.line` | 🟢 NFL is better |
| Live scores | CFBD via the Actions loop | 0044 edge function, 10s from Postgres | 🟢 NFL is better |
| Down/distance + last play | ❌ | ✅ | NFL only |
| Scoring timeline | `cfb-scoring` | `nfl-scoring` | ⚠️ neither observed |
| Grading + CLV | Sunday + `GRADE-1` live | Mon/Tue/Fri + `GRADE-1` live | ✅ `nfl-grade` graded 2 bets |
| Bets / ledger / slate / home | ✅ | ✅ sport-aware | ✅ |
| Pick'em boards | ✅ | regular season only | deliberate |
| Model, receipts, edges, ratings, rankings | ✅ | ❌ | by design |
| Recap, standings | ✅ | ❌ | see below |
| Watchdog | 5 jobs | none | ⚠️ NFL-22 |
| Push | league-agnostic | league-agnostic | ⚠️ inert everywhere, PUSH-11 |
| Demo data | ✅ | ❌ | NFL-6 |

- [ ] **NFL-26 — decision owed: do `/recap` and `/standings` ever carry the
      NFL?** Both are CFB-only today and neither was a decision — `/recap` reads
      the CFB season pointer and `/standings` filters `classification = 'fbs'`,
      so the NFL falls out of both without anyone choosing it. The division data
      to do standings properly is already there (`teams.conference` holds
      "AFC West" and friends, which is what makes the slate's conference filter
      and the groups' conference mode work). Recording it as a question rather
      than queueing a build: "the NFL is scores, lines and bets, not a second
      league to follow" is a perfectly good answer and costs nothing. · owner
- [x] **NFL-1** The whole build: `src/lib/espn.ts` + fixture-pinned odds
      parsing, migration 0042 (sport columns, one-current-per-sport,
      `groups.leagues`), the three ingest CLIs + cron wiring, `?sport=` slate
      with the CFB | NFL toggle and NFL kick windows, cross-league ledger /
      bets / home, `gradeSeasonFinals` + `nfl-grade`, `applyScoreboard` +
      dual-league scoreboard loop, group league scope + per-league splits,
      ticker with league tag. Model, freeze pricing and ratings replay
      untouched. 683 tests, 163 DB assertions, dry-runs against the live feed.
- [x] **NFL-2** Go live, in order: deploy the code, apply 0042, then bootstrap.
      **Done 2026-08-13, in the load-bearing order.** PR #62 squash-merged
      (CI green) → production READY on `0ca8f49` (Vercel
      `dpl_E1zhnFhzt2tQq1bdx6rNTF6a3CEz`) → migration `nfl` applied (41st;
      verified: 3 sport columns, `seasons_one_current_per_sport`, `groups.leagues`
      default `{cfb}`, RPC present) → data loaded. One deviation from the plan:
      the GitHub App could not dispatch workflows (403 on
      `workflow_dispatch`), so the three bootstrap jobs ran as direct writes
      through the Supabase integration using rows generated by the repo's own
      ingest modules (`espn.ts` + `scripts/lib/nfl.ts`) against the live feed —
      collision check first (0 event ids stored as CFB), then the 102026
      seasons row + 32 teams, 272 regular-season games across 18 weeks
      (TBD-time week 17/18 games carried `start_time_tbd`), 16 week-1
      DraftKings snapshots with true openers, `source='espn'`. Not metered
      into `api_call_log` (no service key in-session); the daily 09:00 UTC
      sync-games chain takes over from here and meters normally. Verified
      live: `/slate?sport=nfl` 200 with week 1, lines (SEA −3.5 checked
      against the book), divisions, NFL kick windows; `/api/slate?sport=nfl`
      returns sport nfl / season 102026 / 16 games / `prediction: null`; CFB
      slate, home, ledger, ticker unchanged (888 CFB games untouched);
      advisors show nothing new beyond `set_group_leagues` joining the
      designed 0020 definer-RPC list.
- [ ] **NFL-3** The DESIGN.md one-screen gate: `/slate?sport=nfl` on a real
      phone before any further NFL surface work — card density with no ranks /
      systems row, "Kansas City Chiefs"-length names in `TeamRow`, division
      filter labels, Early/Late window/Primetime section titles. · owner + 0.5 h
- [ ] **NFL-4** First settlement watched, not assumed: TNF Sep 10 — close pass
      at 23:45 UTC Thu (`nfl-lines-close`), `nfl-grade` Fri 13:30 UTC; check a
      logged bet grades with CLV against the captured close. A finaled
      preseason game on a Supabase branch works sooner. · 0.5 h
- [x] **NFL-5** The live-situation shape against a real in-progress game.
      **Done 2026-08-13, against GB@PIT live (preseason week 2):**
      status/period/clock, `shortDownDistanceText` ("1st & 10"),
      `lastPlay.text` and both scores all parse as `parseEvent` reads them.
      `situation.possession` is null at the kickoff snapshot (only
      `possessionText` — the spot, not the team) and populates mid-drive as
      the team id string: observed `possession='9'` with GB (away, id 9) on
      the ball at 2nd & 5, which is exactly the synthesized fixture's mapping
      to `"away"`. The kickoff gap renders as situation-without-football —
      degraded, not wrong — and needs nothing.
- [ ] **NFL-6** Deferred, recorded: playoff-round labels + postseason week
      browsing (January; stored weeks 1–4 exist now), NFL venues + weather
      (existing `weatherJob` machinery, needs offset venue rows + coords),
      watchdog rows for NFL job ages, NFL demo data.
- [x] **NFL-8** The 30-second live pull, owner decision 2026-08-14 ("the
      site should be pulling from espn on a 30 second refresh"). **Done and
      verified live 2026-08-14 ~00:40 UTC, owner-approved execution.** Edge
      function `supabase/functions/nfl-scoreboard/index.ts` (deployed v2,
      no-op-diffed writes, idle gate, verify_jwt off by design) invoked by
      pg_cron job 1 (`nfl-scoreboard-30s`, '30 seconds') via pg_net —
      migration 0043, applied. Evidence: 3/3 cron runs succeeded in the first
      90 seconds, all five live preseason games advanced past the last
      manually-bridged values with no session or Actions writer running
      (Actions had been stalled since 23:47), and two consecutive production
      API reads showed independent movement (ARI@LV Q2 11:20 → 10:00). The
      live path no longer depends on GitHub Actions or any session; the
      Actions loop remains a coexisting second writer. Context worth keeping:
      the same night surfaced the two Actions window gaps (fixed, #65) and an
      Actions outage — the reason this lane exists.
- [x] **NFL-9** The scoreboard left open, owner report 2026-08-14 ("it doesn't
      look like the nfl scoreboard is refreshing on its own — I have to leave
      the page and go to a different tab on the site to get it to refresh…
      also the place they're on the field with the football isn't showing on
      the game card like the cfb demo. Also the last play is getting cut off").
      Three defects on one screen, all client-side — the database was current
      each time, which is what navigating away and back proved.
      **(a) The poll could not survive a tab going away.** `setInterval` gated
      on `visibilityState`, with nothing that refreshes on the way back in, so
      a throttled or frozen timer resumed armed for a full fresh period; and
      the slate slowed to 180s whenever the realtime channel said
      `SUBSCRIBED`, which is what a socket that died on sleep also says. New
      `src/lib/use-live-refresh.ts` decides on the wall clock and refreshes on
      `visibilitychange` / `focus` / `pageshow` / `online`; both `SlateView`
      and `ScoreTicker` ride it. Cadence no longer reads the channel status:
      live 30s (matching 0043's ESPN pull), imminent 60s, else 120s.
      **(b) The field strip never rendered for the NFL** because `parseEvent`
      stored `shortDownDistanceText` ("2nd & 10"), which carries no spot —
      NFL-5 checked that field and recorded the consequence without connecting
      it to the feature. Now `downDistanceText` first in both writers, with
      the short form as the kickoff fallback; `parseSituation` also takes
      ESPN's token-less midfield form ("at 50") and `fieldPosition` accepts it
      only at the 50.
      **(c) The last play was one truncated line**, cutting ~half of a real
      play description; now a two-line clamp in a fixed two-line box, so no
      card changes height between snaps.
      15 new tests (698 total), lint/tsc/build clean, rendered and checked at
      1024×768 and 390×844. **`supabase/functions/**` moved to eslint's
      globalIgnores** — it is Deno, and it had been failing `npm run lint`,
      and therefore CI, since #66.
- [x] **NFL-9b** Redeploy the edge function so the live pull writes the long
      situation string — `supabase/functions/nfl-scoreboard/index.ts` is source
      of truth in the repo but ships to Supabase separately (NFL-8).
      **Done 2026-08-14 ~01:24 UTC, owner-approved.** `nfl-scoreboard` v3,
      `verify_jwt` still off, no other change to the function. Verified
      against live preseason: before the deploy all five in-progress games
      stored `"1st & 10"`; one cron tick after it, all five stored the spot —
      `1st & 10 at CIN 46`, `3rd & 2 at IND 35`, `3rd & 9 at LAC 47`,
      `1st & 10 at GB 42`, `2nd & 11 at LV 34` — with clocks advancing
      normally (GB@PIT 2:19 → 1:48), so the 30-second pull is intact on v3.
      Every side token matches one of the two stored `teams.abbreviation`
      values for its game, which is the condition `fieldPosition` resolves on;
      the ARI@LV row is at `possession: null` (end-of-half kneel) and renders
      as situation-without-football, the degraded state NFL-5 already
      recorded. The deployed v2 had drifted from the repo copy in two comment
      lines only; v3 is the repo file verbatim.
- [x] **NFL-16** A TV timeout erased the play it interrupted. Owner report
      2026-08-14 ("any tv timeout it says Official Timeout with the time
      remaining… also I don't think made Field Goals or extra points are
      working"). ESPN's `situation.lastPlay` is whatever happened most
      recently, and a lot of that is not football — `Official Timeout at
      11:36.`, `Timeout #2 by DET at 01:21.`, `Two-Minute Warning`. Each
      overwrote the stored play, and since a TV timeout follows almost every
      score, **the plays it replaced were the field goal, the extra point and
      the touchdown** — the only ones anyone reads. Cannot be filtered in the
      UI: by render time the real play is gone from the database.
      `src/lib/live-play.ts` (`isRealPlay`/`keepLastPlay`) is used by the
      shared `scoreboardPatch`, so CFB gets it too, and mirrored into the edge
      function (standalone Deno, cannot import from `src/`). Two signals:
      ESPN's `lastPlay.type.text` when present, else an anchored text pattern
      for CFBD, which supplies no type. **Deny-list, so it fails open** — an
      unrecognised type is a play and shows up rather than vanishing.
      Penalties count as plays; they explain a flag. Keeping the stored value
      also means the diff sees no change, so nothing fans out over realtime
      for a play that did not happen. 10 tests, every string captured from the
      live feed rather than invented. **Verified in production** (function
      v4): two distinct non-play moments observed with cache-busted reads —
      `Timeout #1 by SF` and `Official Timeout at 09:56` — and in both the
      database held the real play instead. 0 copied.
- [x] **NFL-17** Made field goals reach the card — **confirmed live
      2026-08-14 ~02:33 UTC**, which is what the owner could not tell ("can't
      see for sure though"). Two made kicks caught in the same window, both
      ESPN type `Field Goal Good`, both stored verbatim:
      `J.Slye 55 yard field goal is GOOD, Center-M.Cox, Holder-T.Townsend.`
      (TEN@SF) and `S.Shrader 61 yard field goal is GOOD, Center-L.Rhodes,
      Holder-R.Sanchez.` (IND@NE). The type is not in the deny-list, so
      NFL-16's fail-open rule keeps it, and NFL-11 means the block renders
      even once the score clears the down and distance. An extra point was not
      separately observed, but it is the same code path and the same scoring
      type family. What was never a bug: the kickoff after a score is itself a
      real play and legitimately replaces the scoring play after ~20–40s, so a
      made kick is visible for a few ticks rather than indefinitely. If
      scoring plays should *persist* instead of scrolling past, that is a
      separate feature (a remembered last-score line) needing a column —
      NFL-18.
- [ ] **NFL-18** Deferred, not started: a remembered "last score" line, so a
      touchdown or field goal stays on the card until the next one instead of
      being replaced by the kickoff ~30s later. Needs a column
      (`last_score_play`) and a writer rule. Only worth building if the owner
      wants scoring to persist; the current behaviour is correct, just
      transient. · owner decision
- [x] **NFL-19** The home hub's refresh tier read the wrong league, so it
      never fired. Owner report 2026-08-14, after NFL-14 shipped: "the Home
      Screen isn't refreshing at all, I have a live Titans 49ers game I'm
      tailing a bet on and it only updates if I click on another page."
      NFL-14 wired the cadence to `data.liveCount > 0` and `data.firstKick`,
      and **both describe the CFB week on purpose** — `fetchHomeData` says so
      in the code: "the hero stays CFB, Saturday is the product's spine". On
      Aug 14 CFB week 0 was fifteen days out with nothing live, so a hub
      showing a live NFL game the viewer had money on evaluated to
      `live: false, imminent: false` and sat on the **five-minute idle tier**.
      Five minutes reads as never. New `homeRefreshTier` decides from the
      positions actually on the page — which span both leagues — OR'd with the
      CFB week for a signed-out visitor who has none, using the slate's own
      −3h/+6h kickoff window so a game stuck at `scheduled` can't hold the
      fast tier forever. 9 new tests; the three covering the reported case were
      checked failing against the shipped derivation first. Also
      `HomeAutoRefresh.test.tsx`, because `router.refresh()` is the hub's only
      way to update and a no-op there would look identical to this bug.
- [x] **NFL-14** The home hub, owner report 2026-08-14 ("the home page is
      having the same refresh problem and doesn't show the down and distance
      or last play like it does on the slate"). Two defects, both worse than
      the slate's were. **(a) `/` never refreshed at all** — it is a server
      component top to bottom with no poll and no realtime, so it rendered
      once and sat there until you navigated; the ticker in the nav was the
      only live thing on the page. `HomeAutoRefresh` (client, renders nothing)
      drives `router.refresh()` off the same `useLiveRefresh` the slate and
      ticker use, which re-runs the server render in place — scroll and client
      state kept, and no `/api/home` duplicating `fetchHomeData`'s queries.
      Live 30s, imminent 60s, otherwise 300s, plus the wake handler, which is
      the tier that actually matters on an idle hub. **(b) The situation was
      never rendered** even though the data was already on the `GameView`:
      `fetchHomeData` goes through `fetchSlateView`, so `situation`,
      `lastPlay` and `possession` were all present and only the slate drew
      them. `LiveSituation` extracted from `GameCard.tsx` to its own module
      and used by both, with `compact` dropping the field strip — a 12px
      playing field in every row of a list reads as decoration. Also adds
      `HomeData.fetchedAt` so the imminent check has a deterministic "now"
      (`Date.now()` during render trips `react-hooks/purity`, and the slate
      already carries the same field for the same reason). Checked rendered at
      1024 and 390.
- [x] **NFL-13** The live pull at 10s, gated — owner request 2026-08-14 after
      being shown the invocation arithmetic. Migration 0044, **applied
      2026-08-14 ~02:04 UTC**. 0043 fired every 30s year-round and let the
      function decide; that decision was correct but too late, because an
      "idle" tick still costs a metered Edge Function Invocation (~87,700/mo,
      ~18% of the Free plan's 500,000). The gate moves into the cron command:
      pg_cron still ticks every 10s (free — it is a local query) but
      `net.http_post` sits behind a `where exists (...)` copy of the idle
      predicate, so the function is invoked only while a game is live or
      imminent. **~31,300/mo, ~6% of quota — three times fresher at a third
      of the cost.** The short-circuit was proved before applying, with a
      volatile function rather than a constant: `nextval()` behind a false
      `where exists` was not called (`is_called` false), and was called when
      the predicate held. *(The obvious `select 1/0 where exists (select 1
      where false)` test is worthless here — constant folding raises at plan
      time, which says nothing about a VOLATILE function.)* Verified live:
      6.1 ticks/min, 0 failures, clocks advancing. Also adds
      `games_sport_status_start` (the gate runs every 10s forever) and a
      `cron-log-purge` job — pg_cron writes a `job_run_details` row per tick
      regardless of the gate, ~712 bytes each, which at 10s is ~187 MB/month
      against a 500 MB Free-plan database and nothing purges it by default.
      Two days' retention is ~12 MB.
- [ ] **NFL-15** CFB has no database-side live pull. **The answer to "are you
      including nfl and cfb games" is no, and it was no in 0043 too.** The
      edge function is `.eq("sport","nfl")` against ESPN's NFL board; CFB live
      scores come only from `scoreboardJob` → CFBD → the GitHub Actions loop,
      i.e. the scheduler that stalled on 2026-08-13 and is the entire reason
      this lane exists. Week 0 is Aug 29. Two blockers, both real: `games.id`
      for CFB rows is a **CFBD** id and there is no ESPN id column
      (confirmed — no `espn`/`source`/`external` column on `games`), so an
      ESPN college board cannot be joined without building a mapping; and the
      CFBD route is metered (Tier 2, 30,000/month), where a 10s pull over a
      14-hour Saturday is ~5,000 calls a Saturday and would eat the budget the
      rest of the ingest chain runs on. · owner decision + build
- [x] **NFL-11** The touchdown was the one play guaranteed not to render.
      Owner report 2026-08-14 ("on the last play on the slate cards, it
      doesn't show what the touchdown play was"). `LiveSituation` opened with
      `if (!game.situation && !pos) return null`, and ESPN publishes a down
      and distance only while a snap is pending — so the whole dead-ball
      stretch after a score (the PAT, the kickoff), end of quarter, and
      timeouts between possessions all arrive as `situation: null` with
      `possession: null`, which made `pos` null too and dropped the entire
      block, last play included. Observed in the stored rows: game 401874392
      at 01:31 UTC held `current_situation: null` with a real `last_play`.
      The last play is now a situation in its own right; the down-and-distance
      row is skipped rather than left empty above it. New
      `GameCard.situation.test.tsx`, 4 tests — the touchdown case was checked
      failing against the old guard before the fix went in.
      **Not fixable from this feed, recorded:** the down and distance a play
      was *snapped* on. ESPN's scoreboard `lastPlay.start.down`/`.distance`/
      `.downDistanceText` are all null and `lastPlay.drive` carries only a
      text summary — verified across six live games. The card's own
      down-and-distance is the *next* one (post-play), which is why a sack
      shows "4th & 27" above "sacked for -12". Getting the pre-snap down
      needs `/summary?event=<id>`, one extra ESPN call per live game per
      tick; see NFL-12.
- [ ] **NFL-12** Decision owed: whether to pull `/summary?event=<id>` per live
      game for pre-snap down-and-distance and richer play typing. Cost is
      linear in live games (one call per game per tick, so ~16× the current
      single scoreboard call on an NFL Sunday) against a feed with no
      published rate limit. Not started — worth it only if the owner wants the
      play line to read "3rd & 7 · <play>". · owner decision
- [x] **NFL-10** `/api/slate` served week 0 to every parameterless request.
      Found 2026-08-14 while verifying NFL-9 against production, not by
      looking for it: `/api/slate?sport=nfl` returned `week 0`,
      `seasonType regular`, **0 games** with five preseason games live. The
      route read `Number(searchParams.get("week"))` — `get` returns `null`
      when the param is absent, `Number(null)` is `0`, and week 0 is a real
      addressable week (`MIN_WEEK`), so `isValidWeek` said yes and `hasWeek`
      also forced `st` to `regular`. `parseWeekParam` was written for exactly
      this (it separates absent from zero) and **had no callers**; the route
      now uses it. Why it hid for so long: `SlateView.refresh` always sends an
      explicit `week=`, so the slate itself was never affected, and on the CFB
      side week 0 is populated (the eight Aug 29 games), which made a bare
      call look plausible. New `src/lib/week-range.test.ts`, 5 tests, with the
      absent-vs-zero case as a named regression. The seven page routes that
      call `isValidWeek` take their param from `searchParams` destructuring,
      where absent is `undefined` → `NaN` → correctly rejected, so none of
      them carried this. **Residual, recorded not queued:** those seven still
      read `Number(raw)`, so a literal empty `?week=` would parse as 0 there.
      No known link produces one; `parseWeekParam` would close it if a reason
      appears.
- [x] **NFL-7** Preseason, owner request 2026-08-13 ("Can we add preseason
      too?"). `preseason` is a third season_type on the NFL side only: stored
      1:1 from ESPN (weeks 1–4, week 1 the Hall of Fame game), no schema
      change needed (season_type carries no check constraint anywhere —
      verified against the live catalog). `nflStoredWeek` passes it through,
      sync fetches the four boards (dry-run: 321 games = 272 + 49),
      refresh-lines picks its week by earliest scheduled kickoff instead of a
      season-type sort (pre → regular → post has no lexical order), the
      pointer's `toPointer` passes it through, and the NFL week select gains
      Pre 1–4 (`?st=pre&week=N`). Real games — scores, lines, bets, live
      states — but pick'em boards still reject the season type
      (`set_group_week_config`, deliberate) and the model never sees the NFL
      at all. CFB untouched: no CFB row carries the type.

**Betting / game-card batch** — ten items reported by the owner 2026-08-14 while
running test bets against live NFL preseason games. Built on
`claude/betting-game-card-updates-iticrj`. Three scope calls were made by the
owner before any code: **hard delete** for admin bet cancellation, **auto
tail/fade only** replacing the Why field, and the **full scoring timeline**
rather than a quarter linescore.
- [x] **GRADE-1 — a game now grades on the tick that sees it finish.** Owner
      question 2026-08-14 ("when a game goes final does it grade as soon as its
      final?"). **The answer was no**, and it was the cause of a second reported
      item: grading ran only from `ratings-update` (Sunday 13:00 UTC) and
      `nfl-grade` (Mon/Tue/Fri 13:30), while `applyScoreboard` wrote scores and
      touched no `picks` or `bets` row at all. A bet on a Saturday-night final
      stayed open on the ledger for up to a week, and the slate card had no
      result to render — which is most of why NFL-21 below looked broken.
      `gradeGames(db, gameIds)` is `gradeSeasonFinals` narrowed to a named set;
      both share `settleGames`, the same shared-function-plus-backstop shape
      P1-1 used for `voidWagersForGames`. The scheduled pass still runs and
      still catches the two things a live tick cannot: a game that finaled
      outside a scoreboard window, and the dead-game Rule #4 voids.
      **Deliberately not gated on a status transition**, though `stored` makes
      one cheap to detect. The NFL's 10-second edge function (0044) writes
      finals straight to Postgres, so by the next Actions tick the stored row
      already says `final` and there is no transition left — a transition-only
      trigger would have missed the league this was reported on. Every completed
      game on the board is offered instead; `gradeGames` filters `result is
      null` throughout, so later ticks settle nothing.
      **One ordering change that is not cosmetic:** the ungraded reads now come
      *before* the closing-line read, so `line_snapshots` is fetched only for
      games that actually have something to settle. Under the old order a live
      tick would have re-read snapshots for every final on the board every 30
      seconds all afternoon. Asserted directly — the test counts the reads.
      Grading errors are swallowed and logged: the scoreboard's job is scores,
      and a grading failure must not cost the slate its live layer. Asserted.
      10 new tests (**801 total**) on a new in-memory PostgREST stand-in
      (`scripts/lib/fake-supabase.ts`), because every interesting property here
      is at the database seam and no pure-function test can reach it. *(The
      test count in §1 and in NFL-9 had drifted — 659 and 698 — against 791
      before this change. 801 is measured, not carried.)*
      **Residual, recorded not queued:** the scoreboard loop only runs inside
      its cron windows (`jobs.yml:164-187`), so a game finaling outside one
      still waits for the scheduled backstop. The windows cover every kickoff
      slot, so this buys nothing today; closing it would need a standalone
      frequent `grade-finals` task.
      **Not verified from here:** no live game to watch it against. The honest
      proof is `NFL-4` — the first settlement watched, TNF Sep 10.
- [x] **ADM-1 — a site admin can delete a bet outright**, 2026-08-14, migration
      **0046**. Voiding was the wrong tool and the owner said so: a voided bet
      is still a row, rendered at 40% opacity in the ledger forever
      (`ledger/page.tsx:445`). Voiding is right for a bet really placed and
      taken back; it is wrong for a test row that should never have existed.
      **This is a deliberate exception to a stated invariant.** `0001:210` opens
      the table with "Append-only ledger: no deletes; voided_at instead (Honest
      Note #5)" and `docs/SPEC.md` §5.3 agrees. Rather than waive it, it is
      narrowed: every deletion copies the whole row into a deny-all
      `deleted_wagers` archive **first**, so the guarantee moves from "nothing
      is ever removed" to "nothing is removed without a record", and any row can
      be reconstructed by hand. The ordering is the entire basis for the
      exception, so it is asserted directly — with the archive write forced to
      fail, the bet must still be there.
      Service-role write behind `requireAdmin`, for the reason `setGameStatus`
      uses one (`games.ts:55-58`): DELETE is revoked from both API roles
      (`0001:360`) and opening a delete policy on the ledger would hand every
      signed-in user a power only an admin should have. **No status or kickoff
      gate** — deleting a *graded* bet is the central case, and it is the one
      `voidBet` provably cannot reach (the 0045 trigger raises on any update
      where `old.result is not null`). Surfaced on the ledger, the game page,
      and a new **Wagers** panel on `/admin`, which is the only one that reaches
      another user's rows. The panel is capped at 20 and says so rather than
      truncating silently.
      Also corrected: the ledger's own footer said bets "can be voided, never
      deleted", which this makes false. It now says an admin can, and that the
      removal is itself recorded.
- [x] **ADM-2 — group admins can cancel a member's pick**, 2026-08-14,
      migration **0046**. `remove_pick` could not be reused, in two independent
      ways: it deletes `user_id = auth.uid()`, so an admin calling it removes
      their **own** pick and reports one row happily; and it raises at kickoff
      (`0038:62-64`), which is the case an admin most needs. New
      `admin_remove_pick`, shaped after `remove_group_member` (`0038:114`), the
      repo's existing admin-acts-on-another-member RPC. Archives into
      `deleted_wagers` too. Zero rows stays a success, matching `remove_pick`
      and for the reason `0038:24-30` gives.
      Gated on `is_group_admin(p_group_id)`, **not** on `is_admin`: a site admin
      has no standing inside a group they are not in, and reaching into a pool's
      picks with a platform role would make every group's board editable by an
      outsider. A site admin who needs that uses ADM-1's `/admin` panel.
      Control lives on the week page's **By person** view, the only surface that
      renders other people's picks itemised and attributable.
      **Deliberate boundary:** betting-group admins get no power over a member's
      *bet*. A bet is one row in that person's own ledger and units record; a
      group is a lens on it rather than its owner (`tailing.ts:4-5`,
      `0027:1-36`). ADM-1 covers test cleanup there.
      **24 DB assertions, 174 → 198**, each checked failing against the pre-fix
      schema. That check found a real defect in the assertions themselves: the
      refusal helper passed on *any* error, so with 0046 removed all four
      "cannot cancel" assertions reported PASS on *"function admin_remove_pick
      does not exist"* — proving nothing about authorization. Each refusal now
      names the message it expects, and a missing-object error is reported as
      vacuous rather than absorbed. 9 unit tests, 801 → 810.
      **`npm run db:test` had been dead since 0043** and this is how it was
      found. 0043/0044 open with `create extension if not exists pg_cron`, which
      is Supabase-provisioned and not installable locally, so the runner aborted
      on migration 43 of 45 and **not one assertion ran** — it looked like a
      broken environment rather than a broken tool, which is why it sat. The
      runner now installs inert `pg_cron`/`pg_net` stubs when the real ones are
      absent, and refuses loudly rather than skipping migrations, if it cannot.
      §1's "163 DB assertions" was honest when written and has been
      unverifiable since 0043; 198 is measured today.
      **Not verified from here:** the delete against a real test bet in the live
      database, which needs production.
- [x] **NFL-20 — the game page no longer cuts NFL names in half**, 2026-08-14.
      `GameHeader.tsx:368` was `truncate` on `{team.school}`, in a `1fr` column
      beside a 48px mark inside an `overflow-hidden` card. `school` means
      different things in the two feeds: CFBD gives "Georgia", ESPN gives the
      full display name, "Jacksonville Jaguars", which is nearly three times as
      wide in the same slot.
      **No migration, in the end.** The plan called for a `teams.short_display`
      column; checking rather than assuming found the short form already stored
      — `nfl-sync-reference.ts:64` writes ESPN's `name` ("Chiefs") to
      `teams.mascot`, and `mascot` is already on `TeamView`. New
      `teamHeadline(team, sport)` uses it for the NFL and keeps `school` for
      CFB, where the mascot is a *different* word ("Bulldogs" for Georgia)
      rather than a shorter form of the same one.
      `truncate` also becomes a two-line clamp in a fixed-height box — same fix
      and same reason as NFL-9(c) for the last play. `min-height` in `lh` units
      so it is exactly two lines at both breakpoints the header uses; browsers
      without `lh` size to content, which can vary between games but never
      within one, so nothing shifts while a score updates.
      Found beside it and fixed in the same pass: the Systems section
      (`game/[id]/page.tsx:700`) is `card overflow-hidden` with **no** inner
      `overflow-x-auto`, where the Market section above it has had one all
      along — so a table wider than the phone was clipped rather than
      scrollable.
- [x] **NFL-21 — a final card says what happened to your money**, 2026-08-14.
      **Two independent causes, both confirmed by reading the routing rather
      than inferred.** (a) A final renders `FinalFooter`, which builds chips
      from `myPicks`, ATS, O/U and the model and **never reads `myBets`**.
      `PregameFooter` does have settled-bet chips, behind `settled = live ||
      final` — but a final never renders that footer, so the `final` half of
      that condition was **unreachable** and the comment beside it described
      behaviour the routing prevented. That comment is corrected in place; it is
      why nobody looked. (b) The big strip across the top was gated on
      `live && a pick`, so a bet could not trigger it in any state.
      The strip now runs on finals and reads a **bet** first, matching
      `tintFor`'s ordering — money is the louder fact. Word is Won / Lost /
      Push through the existing `.cover-covering / -losing / -push` tiers, so
      **no new colour, size or radius** enters the system; `.cover-word` is
      already the broadcast score-bug idiom the request asked for.
      The grader-first precedence rule had been written out by hand in three
      places with the same comment; it is now one `settledResult()` in
      `live-status.ts`. It matters in both directions — the grader settles types
      a score cannot (`team_total`, `first_half`, `future` are entered by hand),
      and until it runs, recomputing from the final score is the only thing that
      can answer. **That second half is what the NFL exposed:** `nfl-grade` runs
      Mon/Tue/Fri, so a Sunday final has `result: null` all afternoon. A voided
      bet returns no verdict at all — it never happened.
      12 tests, **9 of which were checked failing against the shipped code**;
      the other 3 are negative controls that must pass either way. One of them
      caught a vacuous assertion of my own: "names the bet" passed pre-fix
      because the ATS chip renders the same string, so it is now scoped to the
      strip element.
- [x] **UX-34a — three defects the design review caught in the marquee**,
      2026-08-14, same day. Each was real and each would have shipped.
      **(a) A mouse drag-off froze it permanently.** `onPointerUp` was on the
      track; touch captures the pointer implicitly and a mouse does not, so
      pressing a chip, dragging off the strip and releasing sent the `pointerup`
      elsewhere, `held` never cleared and the ticker stayed paused for the rest
      of the session. Now `setPointerCapture` on down plus `onLostPointerCapture`.
      **(b) It measured on the game COUNT, so live chips outgrew the frame and
      became unreachable.** Chip width moves a long way without the count
      changing — "7:00 PM" becomes "1st 12:43", and each score adds glyphs to
      both sides. A five-game strip that fitted before kickoff stayed `still`
      once the clocks appeared, and since the track is then `width:100%` with
      `shrink-0` children in a clipped viewport, the overflow had no animation
      AND no swipe. A `ResizeObserver` on the measured copy replaces the count
      dependency; it also fixes measuring before webfonts settle.
      **(c) `overflow: hidden` made the viewport a scroll container**, so tabbing
      to a chip past the frame set `scrollLeft` on it, and that offset stacked
      with the animation's own transform — one Tab pass and the strip was
      misaligned with its leading chips out of reach. `overflow: clip` is not a
      scroll container and `mask-image` applies to it identically.
- [x] **UX-34 — the ticker scrolls**, 2026-08-14. It was a static
      `overflow-x-auto` strip you had to swipe, so on a phone every game past
      the fourth was invisible unless you went looking. CSS marquee: the track
      holds the chip list twice and travels exactly −50%, so the wrap is
      seamless. Duration is set from the **measured** content width, not from
      `games.length` — chips are variable width — which keeps the speed constant
      at ~55 px/sec whether it is five games on a Tuesday or sixty on a
      Saturday. Paused on hover, on focus-within and while a finger is down,
      because every chip is a 44px link and a moving target is not a target.
      The duplicate copy is `aria-hidden` and untabbable, so a screen reader and
      the Tab key each walk the games once. Content narrower than the frame does
      not animate at all. Under `prefers-reduced-motion` the global clamp stops
      it and the viewport keeps `overflow-x: auto`, degrading to exactly the
      strip it replaced — with the second copy hidden, since without motion it
      would just be every score printed twice. `--ticker-h` is unchanged: the
      duplicate adds width, not height.
- [x] **UX-35 — zoom is off**, 2026-08-14, owner request. Three changes, because
      no single one covers every surface: `maximumScale`/`userScalable` in the
      viewport (honoured by the **installed PWA**, which is where this was
      reported, and by Android Chrome); `touch-action: pan-x pan-y` on
      `html, body`; and a `gesturestart`/`gesturechange`/`gestureend`
      preventDefault for **Safari in a browser tab**, which has ignored
      `user-scalable=no` since iOS 10. The handler is guarded on
      `"ongesturestart" in window`, so it is inert everywhere else rather than
      throwing.
      `globals.css` carried the sentence *"Zoom itself is untouched — pinch
      still works, and nothing here disables it."* That is now false and is
      corrected in place.
      **This fails WCAG 2.1 SC 1.4.4 and is recorded in §6 as a residual** so it
      is not rediscovered as a bug and reverted. What makes it defensible: the
      layout is fluid and reflows to the OS text size — nothing here is a
      fixed-width image of text — so a reader who needs larger type gets it from
      Settings. If that stops being true, this comes out. **Owner-verifiable
      only on a device**: the installed PWA and Safari-in-a-tab behave
      differently and only one honours the meta tag.
- [x] **UX-36b — the league toggle did not work, and I broke it**, 2026-08-14,
      owner report ("It's not letting me click on live cfb or nfl on the slate
      page"). **Reproduced in a real browser, which is how it should have been
      checked the first time:** tapping NFL went to `/slate?sport=nfl` and was
      immediately rewritten to `/slate?week=0`, snapping back to CFB. Tapping
      Live was worse — `sport=live` was stripped every time.
      **Cause, and it was mine.** UX-38a swapped the toggle from `<a>` to
      `next/link` to remove a full-reload seam a design review flagged. That
      turned a hard navigation into a soft one, and two latent defects that a
      page reload had always hidden became live:
      **(a) The URL-mirroring effect rebuilt the entire query string** from
      client state and `replaceState`d it, destroying every param it did not
      personally manage. `sport` belongs to the SERVER. Under a hard load the
      effect only ever ran after the server had resolved the league, so it
      re-derived the right value; under a soft nav it raced the router and won.
      **(b) `SlateView` seeds state with `useState(initial)`,** which reads its
      argument only on first mount — and a soft navigation reuses the component,
      so even with the URL correct the slate kept rendering the old league.
      Keying the component to force a remount was tried and did not resolve it.
      **Fixed by reverting the toggle to `<a>`** and keeping two real repairs the
      investigation produced: the mirroring effect now *preserves* the URL and
      edits only its own keys (which also stops it eating `?g=<group>` on a
      shared sheet link, and is what makes `sport=live` survive at all), and it
      no longer writes when nothing changed. The segments also went from 32px to
      a 44px hit area — DESIGN.md's rule, and on a phone a three-segment control
      at 32px is genuinely hard to hit, which is likely part of what "not letting
      me click" felt like.
      **The seam is the accepted cost** until `SlateView` derives its data from
      props instead of owning a copy — a rewrite of its state machine (poll
      merge, realtime merge, stale-week guard), not a one-line swap. The
      `<a>` carries a DO-NOT-CHANGE comment saying so.
      **Verified by driving Chromium at the real app**: tap NFL → 16 games, Pre
      2; tap Live → the empty state across both leagues; tap CFB → 8 games, Week
      0; 44px targets; no JS errors. **No test guards this**, deliberately
      stated: the failure only exists in a browser, which is exactly why 861
      passing tests, a clean build and a design review all missed it.
      **Found while looking, not yet fixed:** the *slate cards* still truncate
      long NFL names ("Tampa Bay Buc…"). NFL-20 fixed the game-page header only.
      `teamHeadline` would fix it, but `TeamView` carries no sport, so it needs
      that field threaded through the mapper. · S
- [x] **UX-36 — Live · CFB · NFL**, 2026-08-14. There was no live filter of any
      kind before this: only a count pill in the control bar and a "Live"
      section that appears solely when the sort is by kickoff. `?sport=live` is
      a third view rather than a third league — it spans both leagues and every
      week — so the week selector and day tabs are hidden on it (a week number
      describes one league's calendar; a day filter on a list that is by
      definition happening now has one value) and the conference filter says
      "All leagues".
      **Built out of `fetchSlateView`, not beside it.** The obvious
      implementation is one cross-league query on `status = 'in_progress'`, and
      it is wrong: half of `fetchSlateView` is enrichment keyed to a single
      season — ratings, poll ranks, SP+/FPI/Elo, season ATS records — so a
      cross-league query would have to fork every one of them, and the same card
      would drift between this tab and its league's. Instead the live ids are
      found first (one indexed read; 0044 added `games_sport_status_start` for
      almost this predicate), their distinct (season, week, season_type) buckets
      resolved, and each loaded through the ordinary path. Usually one bucket,
      two when an NFL Sunday overlaps a CFB Saturday night.
      **Buckets, not "the current week"**, and the difference is a real defect
      avoided: the NFL pointer rolls forward while Monday Night Football is
      still being played, so asking each league's pointer would empty the Live
      tab at exactly the moment somebody with money on MNF opens it.
      The refresh poller's week guard is skipped on this view — it has no week
      to compare, so the guard would reject every poll and the one view that
      must stay current would be the only one that never updated.
- [x] **UX-37 — the home hub says who has the ball**, 2026-08-14. A rendering
      gap, not a data gap: `fetchHomeData` goes through `fetchSlateView`, so
      `possession` was on the hub's `GameView` the whole time. The football
      lived in two places the hub cannot reach — inside `GameCard`'s own `right`
      override, and inside `FieldStrip`, which `compact` mode drops — so a live
      row gave the down, the distance and the last play and never said who had
      the ball. It is a `hasBall` prop on the shared `TeamScoreLine` now,
      rendered once for both callers. The two comments claiming the football is
      deliberately card-only (`GameCard.tsx:466`, `TeamLine.tsx:79-82`) are
      corrected. 3 tests.
- [x] **UX-38a — what the design review found on the same screen**, 2026-08-14.
      **The confirmation toast still carried the exact bug UX-38 fixed**: the
      slip moved to `.panel` and the toast that replaces it in the same fixed
      slot was left on `.card`, so the game cards still scrolled visibly through
      it. Also, raising the panel's opacity is what exposed the remove-selection
      icon at `text-chalk/30` — 2.5:1 dark, 1.9:1 light, under 1.4.11's 3:1 for
      a non-text control — now `/55`. Two 36px targets (Clear, Text) were missed
      when the rest of the row went to 44px. The text-share button was named
      "Share this slip" while reading "Text", which is a 2.5.3 failure for voice
      control. Errors on the slip and on both new destructive controls are now
      `role="alert"`; a delete that silently fails is the worst case of that.
      Both destructive controls were `text-chalk/40` — 3.4:1 dark, 2.5:1 light —
      and a delete affordance has no business being the dimmest text in its row.
      Both now carry the row's own text in their accessible name, so a screen
      reader's button list is not twenty identical "Cancel this pick" entries.
      **The one place UX-35 did collateral damage**, found here rather than
      assumed: the new audit's five-column table needs horizontal scroll on a
      phone, and pinch-to-zoom-out was the escape hatch that is now gone — a
      scroll region with nothing focusable in it is unreachable from a keyboard
      (2.1.1). Both tables are now `tabIndex={0}` labelled regions with
      `scope="col"` headers.
      Also: `.panel`'s blur dropped from 14px to the 12px the nav, header and
      ticker already use (a second radius is a new value for nothing), and is
      switched off entirely under the light theme, where `--glass-panel`
      resolves to opaque white and the filter composites a backdrop nothing can
      see on every scroll frame.
      And the `SportToggle` was three raw `<a>` tags citing "the LedgerTabs
      pattern" — which uses `next/link`. Every league switch was a full document
      reload: white flash, ticker remounted, scroll position gone. On a page
      whose governing rule is "never steal scroll position" that was the most
      visible seam on the branch.
- [x] **UX-38 — the bet slip is readable**, 2026-08-14. **Cause located:** the
      slip has no `backdrop-filter` at all. `globals.css:444-447` reserves blur
      for "the bars that genuinely have content scrolling underneath (nav,
      header, ticker)" and the slip — a panel fixed over the scrolling slate —
      was never counted. It also used `.card`, whose face is `--glass-surface`
      at **80%**, a value the comment at `:52-57` says was tuned for a game
      card, which has a controlled blurred aura behind it. The slip has neither,
      so 20% of the cards scrolling underneath came through unblurred.
      New `--glass-panel` token (96% of the same `--surface`; fully opaque in
      light mode, where the 4% would be the page's own grey) and a `.panel`
      class carrying the card's border, radius and shadow plus a blur. Derived
      from an existing colour, so this is a named step rather than a new value —
      the rule `docs/DESIGN.md:54` asks for. No sheen: it exists to make a large
      pane read as curved glass, and on a panel whose job is legibility it is
      one more thing between the reader and an 11px number.
      Small text lifted with it: the price and matchup off `--text-dim` and onto
      `--text` at reduced alpha, the stake input and confidence picker up one
      step on the existing scale, and the input borders from `chalk/12` to
      `chalk/20`. **No new sizes** — every value is one already on the scale.
- [x] **LEDGER-1 — the Why field is gone; tail and fade are derived**,
      2026-08-14, migration **0047**. Owner: *"Do we need the Why question on
      bets? I think it's only useful for tails or fades, but that should be
      automatic if betting with or against people in your betting groups."*
      That read was right and the automatic half already existed:
      `src/lib/tailing.ts` has derived origin/tail/fade from arrival order since
      betting groups shipped, and its docblock argues the case better than any
      of this — a stored pointer "would only be set on the ones who used the
      Tail button, which would make the stats a measure of button usage rather
      than of who is worth following."
      The required picker is out of both the slip and the bet form, and
      `logBet`/`logSlipBets` no longer take or validate a tag. **The column
      stays, nullable**: existing rows carry values that were true when entered,
      and `ledger/export/route.ts` ships `reason_tag` in the CSV — dropping it
      would silently change an export people may already hold copies of. The
      CHECK needs no change, since a CHECK passes on NULL by definition.
      The ledger's marquee section keeps its heading and changes its question:
      what you **opened**, what you **tailed**, what you **faded**, plus
      `pairStatsFor`'s "am I better off just copying Jeff?" — which
      `tailing.ts:210-217` notes is not answerable from anyone's own record.
      **Per betting group, never pooled**, because origination means "first in
      *this* group" and merging two crowds would invent tails that never
      happened. Viewers in no betting group see the section not render, rather
      than an empty table. The ledger's per-row Tag column is dropped rather
      than replaced: a relation is per group, so a single column could not say
      which group it meant.
      8 component tests, 2 DB assertions (198 → 200), both checked failing
      without 0047. `docs/SPEC.md` §4 and §5.3 amended.
- [x] **SCORE-1 — the scoring timeline, both leagues**, 2026-08-14, migration
      **0048**. Net-new everywhere, and the starting position is worth keeping:
      no plays, drives or linescore data existed, neither API client parsed any,
      and `current_situation` / `last_play` are **nulled the moment a game goes
      final** (`0007` header, `jobs-core.ts:365,373`) — so postgame there was no
      play text in the database at all. `scoring_plays` is the first table here
      that records what happened *during* a game rather than what is true now.
      Ordered by the feed's own array index, not by the clock: a game clock
      counts down, resets each quarter and stops, and a touchdown and its extra
      point are routinely stamped at the same second. The running score is
      **stored per row** rather than accumulated in the browser — a feed
      occasionally reports a score whose play we never captured, and a computed
      total would then be wrong for every row below it instead of for the one
      that is missing.
      **NFL** — ESPN `/summary?event=`, which is the call `NFL-12` left as a
      decision owed on the grounds that one per live game per tick is ~16× the
      scoreboard call on a Sunday. It is affordable because it is not per tick:
      each row carries the score after it, so the timeline says how many points
      are accounted for, and the call only happens when the scoreboard has moved
      past that. **~1 call per score** — a 47-point game costs about a dozen
      across three hours instead of ~360.
      **CFB** — CFBD `/plays`, filtered to `scoring: true`. Shape forced by the
      feed: there is no per-game plays route, so one call returns every play of
      every FBS game in the week. That is one call **per week**, not per game,
      so a fifteen-game afternoon costs one — but it is a multi-MB response, and
      it is why this rides a 3-minute tick inside the scoreboard loop rather
      than the 30-second one. CFBD publishes no play *type* and names the
      scoring team as a school string, both handled; a name matching neither
      team leaves the crest off rather than dropping the play.
      **Recorded, not hidden:** if the CFBD payload or its live lag proves
      unworkable on the first real Saturday, the fallback is `/drives` — far
      lighter, gives the scoring drive and its result, and gives up the player
      names that were the point of the request. That trade gets a
      decisions-table row either way. **First measurable Aug 29**; there is no
      live CFB game before then.
      Rendered on `/game/[id]` only, with quarter headings — the request was
      "when you click into it", and a timeline on a slate card would break the
      glanceable rule. 19 parser tests + 6 gate tests (836 → 861), 5 DB
      assertions (200 → 205).

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
- ~~**`TRUNCATE` is granted to `anon` and `authenticated` on every public
  table.**~~ **Fixed 2026-08-14, migration 0049** — moved out of this section
  because it stopped being a residual. It affected **32 tables**, which is more
  than the six this row originally listed; the count comes from the failing
  assertion, which names them.
  Two statements, and the second is the one that lasts: the revoke fixes the
  tables that exist, and `alter default privileges` stops the next `create
  table` re-inheriting it — without that half, the migration would read as done
  while the hole reopened on the next table anyone added. Scoped to `postgres`,
  the role that creates every table in this repo. `supabase_admin` carries an
  identical default ACL for tables *it* creates, and altering that needs
  membership in that role; **not attempted rather than attempted and swallowed**,
  because a `DO` block catching `insufficient_privilege` would make a migration
  that did half its job look exactly like one that did all of it.
  New `supabase/tests/truncate.sql`, 10 assertions, **7 of them checked failing
  against the pre-fix schema** — the local harness reproduces Supabase's
  `grant all` default (`00_shim.sql:24`), so the proof is real rather than
  vacuous. The 3 that pass either way are deliberate controls: anon keeps
  SELECT, authenticated keeps INSERT, `service_role` keeps TRUNCATE, because
  the revoke has to be surgical and a suite that only checks the removal would
  not notice it took the app's reads with it. 215 DB assertions total.
  *(Not applied to the live project — same rule as every migration here.)*
- **The light theme's `--accent` on `--accent-ink` is 3.83:1**, under 1.4.3's
  4.5:1 for the 12px labels that use it. Pre-existing — it carries the slip's
  primary action and the pick buttons — and UX-36's active segment is a new
  instance of it. **Not changed here on purpose:** `--accent` is the product's
  value language and lives in `docs/BRAND.md`; darkening it to ~`#8f6800`, or
  setting light `--accent-ink` to `--text`, is a palette decision and DESIGN.md
  §"no new colors" says to ask rather than pick silently. Owner call. · S
- **`touch-action: pan-x pan-y` is app-wide, so nothing can opt back in.**
  A consequence of UX-35 rather than a defect: effective touch-action is the
  intersection down the ancestor chain, so a future surface that genuinely wants
  to be zoomable — a full-size crest, a share-card preview, a chart — cannot
  enable it per-route. It would have to come out of the `html, body` rule.
  Recorded so that is a decision rather than a surprise.
- **Zoom is disabled, and that fails WCAG 2.1 SC 1.4.4** (UX-35, owner request
  2026-08-14). Recorded here rather than left to be rediscovered as a bug and
  "fixed" back. What makes it defensible is that the layout is fluid and reflows
  to the OS text size — nothing in the app is a fixed-width image of text — so a
  reader who needs larger type gets it from Settings rather than by pinching. If
  that stops being true, or if anyone using the app reports needing pinch,
  remove the three changes together: the viewport scale limits in `layout.tsx`,
  the `touch-action` on `html, body` in `globals.css`, and the `gesture*`
  handler. The `web-design-guidelines` review will flag this every time it runs;
  that is correct and is not a reason to stop running it.
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
signed-in half (needs an `is_current_user_admin()` RPC and six call sites — now
tracked as `SEC-08b` in §4, which is where it should have been from the start), and
the existing six-character join codes (regenerating invalidates codes already
sent to the crew).
