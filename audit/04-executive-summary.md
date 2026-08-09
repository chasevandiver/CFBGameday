# 04 — Executive summary

**Audited 2026-08-09 against `claude/cfb-slate-audit-6746c6` at `327e74c`.
Read-only: no code was changed.**

`npm run build` ✅ · `npm run lint` ✅ · `npm test` **301/301** ·
`npm run db:test` **90/90**. The tree is green. Everything below is behaviour.

---

## What's solid

Short, because you asked for it — but these are load-bearing and I want to be
clear I checked them rather than assumed them.

- **The picks security boundary is real.** All direct writes to `picks` are
  revoked; everything goes through `make_pick`/`remove_pick`, which compute
  `line_at_pick` server-side and enforce the kickoff lock with a null
  `start_ts` treated as locked. The per-group blind is enforced by RLS
  (`picks_revealed`), not by a client filter — I went looking for the
  client-side-filter failure specifically and it is not there. 90 db assertions
  across three roles back it.
- **The backtest has no lookahead leak.** I traced every input to the timestamp
  it became knowable; the two-pass week loop makes intra-week leakage
  structurally impossible. The team already found and fixed the sharpest
  version of this bug (`eloRatings(year, week)` is post-week-N) and added
  regression guards.
- **CLV's sign convention is correct in all six cases** — favourite, dog, over,
  under, model, and the `-0` edge — with the dog case, the classic poisoner,
  right.
- **`predictions` is genuinely append-only**, and survived two later migrations
  that added columns.
- **The service-role key is not reachable from anything a browser touches.**
- **`docs/CHANGELOG.md` is the best artifact in this repo.** A decisions table
  that records the *rejections with their numbers* is rarer than it should be,
  and it is the reason this audit could go deep quickly instead of re-deriving
  what was already settled.

---

## The five things that most threaten Week 1

### 1. A losing bet can be voided after the game ends — F-01 · S0
The void trigger's only gate is "has the grader touched this row yet?" The
grader runs Sunday 8am ET. Games finish Saturday night. **For 9–17 hours every
bet's result is known and every bet is still voidable**, and `tally()` erases
voids from record, units and ROI completely. Two clicks in the existing UI.
The ledger is "unhideable by design" — it isn't. *Fix: bind void to
`start_ts > now()` in the trigger. 2 hours.*

### 2. The pending preseason rebuild will make the model *worse* — F-02 · S0
`--tune-hfa` fitted `baseHfa = 3.0` as the value that zeroes a `+0.74 ± 0.33`
home bias. But the backtest prices every game with a flat league HFA, while
production prices with `team_hfa` — built by a schedule-confounded estimator
whose mean raw value is **4.91**. Production runs +0.61 hot today; when the
daily `preseason-refresh` cron applies `baseHfa = 3.0`, it goes to **+0.96
hot**. The gated fix, applied unattended, moves production further from the
number the gate proved correct. `teamHfaBlend` is also the one parameter in
`DEFAULT_PARAMS` that `AGENTS.md`'s gate doesn't actually cover — no tuner has
ever exercised it. *Fix: centre the estimator so it can't move the league mean.
1–2 hours, and it needs no tuner re-run because it provably preserves the mean.*

### 3. One stuck game silently ends all line capture for the season — F-03 · S1
`refresh-lines` picks "the earliest week with a `scheduled` game" with no time
filter, and nothing in the codebase ever writes `postponed` or `canceled`. A
single game that CFBD never completes pins the job to that week permanently: no
new snapshots, no openers, no movement, and **no closing line — so CLV goes
null for every remaining game of the season.** `src/lib/season.ts` already
solved this exact shape with a 6-hour grace cutoff; `refresh-lines` never got
it. *Fix: add the cutoff. 20 minutes.*

### 4. CLV is part measurement, part guess — F-05 / F-07 · S1
Two independent problems feeding the metric the edge investigation elevated to
*the* scoreboard:
- The burst poll runs **Saturdays only**. Thursday and Friday games — including
  the weeknight MACtion §5.1 names as a soft market — close against a snapshot
  up to 6 hours old, rendered identically to a 4-minute-old one.
- **Postgres and JavaScript snap the consensus differently.** Verified: mean
  −3.25 becomes **−3.5** in `make_pick` and the slate view, **−3.0** in the
  grader and the freeze job. A market that never moved books −0.5 CLV, only
  for home favourites, so it doesn't average out. It can also flip an EDGE flag
  and make `/receipts` print a different market number than the card did.
*Fix: weeknight burst crons (15 min), one rounding convention with a
cross-language test (1 hour), `close_captured_at` + a stale marker (half a day).*

### 5. Nobody finds out when any of this breaks — F-08 · S2, but it multiplies everything above
Every job's failure handling is `exit 1` into a GitHub Actions tab. No alerting,
no dead-man's switch, no record of job outcomes in the database. A missed Sunday
`ratings-update` shows stale ratings as current for a week. A missed Saturday
lines refresh means every pick that day snapshots a stale number. The `&&` chain
in `jobs.yml` means a lines failure also silently skips the group freeze.
*Fix: a `job_runs` table and a strip on `/admin`. 3 hours — the best
value-per-hour in this report after F-01.*

**Honourable mention:** Thursday games never get a frozen prediction (F-06) —
the freeze cron fires at Thursday 10pm ET and filters `status = 'scheduled'`, by
which time Thursday kickoffs are already in progress. Week 1 has Thursday games.

---

## The shape of the problem

Every S0 and S1 in this report sits in the same place: **the pure functions are
well tested and correct; the jobs that call them are untested and wrong.**

`clv.ts` is right in all six cases and has four worked examples in its tests —
but nothing tests the grader that calls it. `ratings.ts` has 461 lines of tests
— but nothing tests `freezeJob` or `ratingsUpdateJob`, which are what actually
write to the database. There are 90 database assertions and **not one of them
touches `bets`**, which is exactly where F-01 lives.

That is a specific, fixable gap, and it is more useful than any individual
finding here: the next bug of this class will also be in a job, and the way to
stop finding them one audit at a time is to test the seams between the pure
layer and Postgres.

---

## Prioritised fix order — Aug 10 → Aug 29 (Week 0)

Twenty days. Assumes one person, part-time. Ordered so that anything cut from
the end costs polish, not correctness.

### Mon Aug 10 — stop the bleeding *(the two that are actively dangerous)*
- **F-01** void-after-final: kickoff guard in the trigger, hide the button
  post-kickoff, and a db test — the first assertion in `supabase/tests/` that
  touches `bets`. *(2h)*
- **F-02** disable or fix the HFA rebuild **before the next 11:00 UTC cron
  fires.** Cheapest correct move is the centring fix; if you'd rather not touch
  the model on a Monday, comment out the `0 11 1-27 8 *` cron today and fix it
  properly on the 12th. *(2h)*

### Tue Aug 11 — the silent-failure class
- **F-03** `refresh-lines` week pointer + the same bug in
  `generate-questions.ts`, with a unit test. *(1h)*
- **F-08** `job_runs` table + `/admin` health strip. *(3h)*
- **F-17** CFBD retries, backoff, 20s timeout. *(1h)*

### Wed Aug 12 — CLV integrity
- **F-07** one rounding convention, cross-language test. *(1h)*
- **F-05** weeknight burst crons. *(15m)*
- **F-05** `close_captured_at` + stale marker on `/ledger`, `/receipts`,
  `/recap`. *(4h)*

### Thu Aug 13 — receipts integrity
- **F-06** move the freeze to Wed 03:00 UTC; add the "kicked off with no frozen
  row" assertion. *(2h)*
- **F-04** void sweep for postponed/cancelled + an admin status toggle. *(4h)*

### Fri Aug 14 — close the test seam
- Job-level tests for `freezeJob` and `ratingsUpdateJob` against the fixture
  database. *(4h)*
- Db assertions for `bets` void, `profiles` column grants, `predictions`
  immutability. *(2h)*

### Weekend Aug 15–16 — model, properly
- **F-02** the real fix: residual-based HFA, `replaySeason` takes an HFA map,
  re-run `--tune-hfa` with team HFA live, record it in the changelog per the
  gate. *(1 day)*
- **F-24** wire up the two FCS buckets — Week 0/1 is thick with FCS games.
  *(20m)*

### Mon Aug 17 – Wed Aug 19 — the product gaps that make Week 1 land
- **F-20 / suggestion 1** the daily homepage. *(half day)*
- **Suggestion 2** "2 of 3 picks in — 4h to lock". *(2h)*
- **Suggestion 6** August-aware empty states. *(3h)*
- **Suggestion 7** pick receipt on save. *(2h)*
- **F-12** bound `odds`/`units` with a check constraint. *(30m)*
- **F-18** win-prob calibration buckets on `/receipts`. *(2h)*

### Thu Aug 20 – Fri Aug 21 — dress rehearsal
- **F-21** route smoke tests over the 12 main routes. *(3h)*
- **Suggestion 5** the "how to read this" page. *(half day)*
- **Full dry run:** force-run every job by hand in order, confirm the health
  strip lights up, and check `/receipts` and `/ledger` render with real Week 1
  rows. This is the step most likely to find something this audit didn't.

### Sat Aug 22 — live-fire on somebody else's slate
Week 0 is the 29th, but CFBD carries games before then. Point the jobs at
whatever is live, watch the burst poll, and confirm a closing line lands within
minutes of a real kickoff. *The first time the burst poll runs against a real
kickoff should not be Week 0.*

### Mon Aug 24 – Wed Aug 26 — buffer, then invites
- **F-13** slate history payload, if the dry run showed it hurting. *(3h)*
- **F-15** `sync-games` state downgrade guard. *(1h)*
- Send the invites. Watch someone who has never seen it try to make a pick, and
  fix whatever they get stuck on. That is worth more than any remaining item on
  this list.

### Thu Aug 27 – Fri Aug 28 — freeze the code
Ratings rebuild verified, freeze job verified against the real Week 0 slate,
health strip green. **Ship nothing on the 28th.**

### Deliberately not before Week 1
F-09 (weather in the model), F-10 (news scan), F-11 (LLM review queue), F-16
(key numbers), F-19 (tempo), and everything in `03-suggestions.md` §In-season.
Each needs a tuner run or a data ingest, and `SPEC.md:253` already names the
team-page LLM backlog as the designated slip item. Slip it.

---

## One structural recommendation

`SPEC.md` is the contract this audit measured against, and it has drifted in
four places where the *code* is right and the *spec* is stale: ¼-Kelly sizing
(§5.4, removed on evidence), the pg_cron infrastructure (§8, actually GitHub
Actions), the design palette (§7, deliberately changed), and the pre-kickoff
pick blind (§4, now a per-group setting). Each divergence is deliberate and
documented in `docs/CHANGELOG.md` — but a contract that disagrees with reality
in four places is one an auditor, or a future you, has to relitigate every time.

Amend the spec. It costs an hour and it is the only reason several of these
findings needed a paragraph to explain rather than a sentence.
