# 01 — Findings

**Severity:** `S0` ship-blocker or data-corrupting · `S1` wrong numbers shown to
users · `S2` degraded experience · `S3` polish/tech debt.

Every claim cites `file:line`. Where I inferred rather than executed, the line
starts with **ASSUMPTION**.

---

## S0

### F-01 · A losing bet can be voided after the game ends
**`supabase/migrations/0013_integrity_lockdown.sql:59-79`, `src/app/actions/bets.ts:132-148`, `src/lib/records.ts:102-124`**

`enforce_bet_void_only` permits an ungraded → voided transition and nothing
else. Its only gate is `if old.result is not null then raise` — i.e. "has the
grader already touched this row?" There is no reference to the game's kickoff,
its status, or its score.

The grader runs Sunday 13:00 UTC (`jobs.yml:72`). Saturday games finish between
roughly 20:00 Saturday and 04:00 Sunday UTC. That leaves a **9–17 hour window in
which every bet's outcome is publicly known and every bet is still voidable.**

`tally()` (`records.ts:112`) skips anything that isn't win/loss/push, so a void
does not appear in record, units, staked, ROI, or CLV. It is not "marked void
and counted" — it is erased from every number on `/ledger`, `/crew`, `/recap`
and the leaderboard.

**Exploit path, no tooling required beyond the browser:**
1. Saturday 11am — log 5u on Michigan −3.5, reason tag `model_edge`.
2. Saturday 6pm — Michigan loses by 10.
3. Saturday 6:05pm — open `/ledger`, click `void`. `VoidBetButton.tsx:12` asks
   "Void this bet? It stays on the ledger, marked void." and submits.
4. Sunday 8am — the grader's query is
   `.is("result", null).is("voided_at", null)` (`jobs-core.ts:547-548`). The row
   is skipped forever.

Net result: a bettor who voids every loser and keeps every winner shows a
perfect record with positive ROI, and the group's shared scoreboard — the thing
the whole product is built to make trustworthy — is fiction. This is not an
abuse-of-a-friend-group hypothetical; it is also the *accident* case, because
"void" is presented as an ordinary undo with no warning that it is only legal
before kickoff.

**Fix.** Void is only meaningful before the bettor knows anything, so bind it to
the game clock in the trigger, where it cannot be bypassed:

```sql
create or replace function public.enforce_bet_void_only()
returns trigger language plpgsql set search_path = public as $$
declare
  v_voided_at timestamptz;
  v_start     timestamptz;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if old.result is not null then
    raise exception 'settled or voided bets cannot be changed';
  end if;
  if new.result is distinct from 'void' or new.voided_at is null then
    raise exception 'bets are append-only — the only permitted edit is voiding';
  end if;
  -- A bet may only be withdrawn before its game starts. A futures bet
  -- (game_id null) has no kickoff and is never user-voidable.
  select start_ts into v_start from games where id = old.game_id;
  if old.game_id is null or v_start is null or v_start <= now() then
    raise exception 'kickoff has passed — this bet stands';
  end if;
  v_voided_at := new.voided_at;
  new := old;
  new.result := 'void';
  new.voided_at := v_voided_at;
  return new;
end; $$;
```

`VoidBetButton` should then only render pre-kickoff, and a postponement void
becomes a service-role job (F-04), which is correct anyway: "the game didn't
happen" is a fact about the world, not a user's opinion.

**Effort:** 1 migration + a render condition + a DB test. **2 hours.**

---

### F-02 · `team_hfa` is ~2 points hot, and the pending rebuild makes it worse
**`scripts/build-preseason.ts:402-523`, `scripts/lib/replay.ts:270`, `src/model/ratings.ts:157`**

`--tune-hfa` established that `baseHfa = 3.0` is the value at which the model's
mean signed margin error is `+0.03` instead of `+0.74 ± 0.33`
(`docs/CHANGELOG.md:75`). That tuning ran inside `replaySeason`, which prices
**every** game with `homeTeamHfa: params.baseHfa` (`replay.ts:270`) — a flat
league HFA. Production does not do that. `freezeJob` uses
`hfa.get(team) ?? baseHfa` from the `team_hfa` table (`jobs-core.ts:753`).

That table is built here (`build-preseason.ts:511-523`):

```ts
const raw = h !== null && a !== null ? clamp((h - a) / 2, 0, 6) : null;
const blended = 0.5 * raw + 0.5 * DEFAULT_PARAMS.baseHfa;
```

where `h` is the team's average margin in home games and `a` in away games,
over 2015–2024 from `cfbd.games(year)`.

Two defects compound:

1. **The estimator is schedule-confounded.** `cfbd.games` returns the full FBS
   schedule (`cfbd.ts:283-289`), and FBS teams play essentially all of their
   cupcake non-conference games at home. `h` is therefore inflated by 40-point
   home blowouts that `a` has no counterpart for. `(h − a)/2` measures "home
   advantage **plus** home-schedule softness", not home advantage.
2. **The clamp is asymmetric.** `clamp(…, 0, 6)` truncates the left tail only,
   pushing the mean up further.

The size is not speculative — the changelog records it: production `team_hfa`
averages **3.607**, "consistent with `0.5·raw + 0.5·2.3`"
(`docs/CHANGELOG.md:568`). Solve for raw:

```
0.5·raw + 0.5·2.3 = 3.607  →  raw = 4.914
```

A raw team HFA averaging **4.91** against a fitted league HFA of **3.0**. The
estimator is ~1.9 points hot.

**And the fix that is already scheduled makes it worse.** `blended_hfa` is
derived from `baseHfa` at build time. When the `preseason-refresh` cron
(`jobs.yml:90`, daily 11:00 UTC through Aug 27) finally fires with
`baseHfa = 3.0`:

```
blended = 0.5 × 4.914 + 0.5 × 3.0 = 3.96      (today: 3.607)
```

The average home team gets **+0.96 points stronger than the value the tuner
proved was unbiased**, up from +0.61 today. The gated, evidence-backed HFA fix
is not just diluted — the rebuild moves production *away* from it, unattended,
on a cron, in the two weeks before Week 0.

**This also breaks the project's own model gate.** `AGENTS.md` states every
parameter is either fitted by a `--tune-*` flag or sits at an identity default.
`teamHfaBlend = 0.5` is neither: it is a spec number that the backtest has never
once exercised, and it multiplies a biased estimator into every spread on the
site.

**Fix, in order of increasing ambition:**

- **Now (safe, ~1 hour):** make the backtest honest about production by giving
  `replaySeason` an optional per-team HFA map and feeding it `team_hfa`. That
  turns an invisible skew into a number.
- **Now (safe, ~1 hour):** centre the estimator so it cannot move the league
  mean. `blendedHfa` should be a deviation, not a level:
  ```ts
  const rawMean = mean(all raw values);
  const centred = clamp(raw - rawMean, -1.5, 1.5);   // team-specific part only
  const blended = p.baseHfa + p.teamHfaBlend * centred;
  ```
  This preserves "Boise is a tougher trip than Vanderbilt" while keeping the
  league average pinned at the fitted 3.0. It is a strict improvement even
  before the estimator is fixed properly.
- **Better (~half a day):** estimate HFA from *residuals against the model's own
  prediction* rather than raw margins, which is what §2.3 actually specifies
  ("2015–2024 home/away margin **residuals**"). The current code does not
  compute residuals at all.
- **Then:** re-run `--tune-hfa` with team HFA live and record the result in the
  changelog, per the gate.

**Until one of those lands, disable the rebuild** — the daily cron is currently
pointed at making the bias larger.

**Effort:** 1–2 hours for the centring fix + backtest wiring; half a day to do
it properly. **Do the centring fix before Aug 27.**

---

## S1

### F-03 · One postponed game freezes all line capture for the rest of the season
**`scripts/refresh-lines.ts:39-50`**

```ts
const { data } = await db.from("games").select("week")
  .eq("season_id", SEASON).eq("status", "scheduled")
  .order("week").limit(1).maybeSingle();
week = data?.week;
```

"The earliest week with an unplayed game." There is no time filter.

`sync-games.ts:69` writes `status: g.completed ? "final" : "scheduled"` and
nothing else — **`postponed` and `canceled` exist in the schema
(`0001_core_schema.sql:75`) but no code path ever writes them.** A game that is
cancelled, or that CFBD simply never marks complete (a data glitch, an FCS
opponent dropped from the feed, a weather no-contest), stays `scheduled` with a
past `start_ts` forever.

From that moment `refresh-lines` is pinned to that week and calls
`cfbd.lines(SEASON, { week: 3 })` every run until January. Consequences:

- No new `line_snapshots` for weeks 4+ — ever.
- Every subsequent week's **closing line does not exist**, so `closing()`
  (`jobs-core.ts:467-470`) returns null and CLV on picks, bets and predictions
  is silently left ungraded. The product's only in-season scoreboard goes dark.
- `--burst` breaks the same way but worse: `kickWindow` (`refresh-lines.ts:59`)
  is queried across all weeks, so it selects tonight's games while the
  `cfbd.lines` payload holds week 3 — the `.filter()` at line 71 matches
  nothing and the burst writes **zero rows** while exiting 0.
- Line movement, openers and the sparkline all stop.

`src/lib/season.ts:34` already solved exactly this shape (audit bug #8) with a
6-hour grace cutoff. `refresh-lines` never got it.

**Fix:**
```ts
const cutoff = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
const { data } = await db.from("games").select("week")
  .eq("season_id", SEASON).eq("status", "scheduled")
  .gte("start_ts", cutoff)                      // ← the missing guard
  .order("start_ts", { ascending: true }).limit(1).maybeSingle();
```
`generate-questions.ts:50-56` has the identical bug and the identical fix.
Better still: in burst mode, derive the week set *from* `kickWindow` rather than
computing it independently, so the two can never disagree.

**Effort:** 20 minutes, plus a unit test on the pointer. **Do it this week.**

---

### F-04 · Postponed and cancelled games never void anything
**`scripts/lib/jobs-core.ts:368-370`, `scripts/sync-games.ts:69`, `src/lib/grade.ts`**

League Rules #4 (`SPEC.md:151`): "Postponed/canceled = void."

Nothing implements it. `ratingsUpdateJob` grades against
`finals = games.filter(g => g.status === "final" && points not null)`. A
cancelled game is never in that set, so:

- every pick on it stays `result = null` forever — it is not void, it is
  *pending*, permanently;
- `min_picks_per_week` counts it as a pick that was made, so a member who
  picked three games and had one cancelled shows "3 of 3" but has two live;
- the bet sits in the ledger un-graded, silently excluded from record and ROI by
  `isDecided()` — which happens to be the right *number* for the wrong reason,
  and it never renders as "void" so the bettor cannot tell it settled;
- `/rules` tells everyone the opposite is true.

Compounded by F-03: the same stuck row also pins line capture.

**Fix:** two halves.
1. `sync-games.ts` must be able to write `postponed`/`canceled`. CFBD exposes
   this through the game's status/notes; failing that, an admin toggle on
   `/admin` is a 30-minute fallback and enough for a 5–15 person league.
2. A void sweep in `ratingsUpdateJob`: for games with status
   `postponed`/`canceled`, or `scheduled` with `start_ts` more than 48h past,
   set `picks.result = 'void'` and `bets.result = 'void', voided_at = now()`
   (service role, so the F-01 trigger does not apply). Report the count in the
   job's JSON so it is visible.

**Effort:** half a day including the admin toggle.

---

### F-05 · The "closing line" is stale for every non-Saturday game, and never says so
**`.github/workflows/jobs.yml:52-57`, `scripts/lib/jobs-core.ts:467-470`, `src/lib/consensus.ts:38-44`**

The closing proxy is "last snapshot before kickoff, per provider"
(`consensusFromSnapshots(snaps, start_ts)`). Its honesty depends entirely on a
snapshot existing *near* kickoff. The burst poll is scheduled:

```
*/10 15-23 * * 6      Saturday 15:00–23:59 UTC
*/10  0-3  * * 0      Sunday  00:00–03:59 UTC
```

That is Saturday only. **Thursday, Friday, Tuesday and Wednesday games get no
burst poll at all.** Their nearest capture is the 4×/day refresh at
`0 3,12,17,22 UTC`. A Thursday 7:30pm ET kickoff (23:30 UTC) closes against a
snapshot taken at 22:00 UTC — 90 minutes early on a good day, and GitHub Actions
cron routinely lags 10–30 minutes.

Weeknight MACtion is listed in `SPEC.md:161` as one of the two structurally soft
markets the whole site exists to exploit. Those are precisely the games whose
CLV is least trustworthy.

Worse, **nothing marks it.** `closing()` returns a number with no age attached.
A line captured six hours before kickoff and one captured four minutes before it
are rendered identically on `/ledger`, `/receipts` and `/recap`, both labelled
"closing". CLV — the arbiter the model was demoted in favour of — is quietly
part measurement, part guess.

**Fix, cheap and high-value:**
1. Add weeknight burst crons. Thursday/Friday evening ET is
   `*/10 22-23 * * 4,5` and `*/10 0-4 * * 5,6`. Cost is trivial: the burst
   already filters to games kicking inside 100 minutes and the idle guard
   (`idle.ts:91`) no-ops the rest of the year.
2. Store the age. `picks`, `bets` and `predictions` should carry
   `close_captured_at` beside the closing number, and any CLV whose closing
   snapshot is older than ~30 minutes should render with a "stale close" marker
   rather than passing as a measurement. A CLV you cannot trust is worse than a
   blank, because it still moves the leaderboard tiebreak (League Rules #5).

**Effort:** crons 15 minutes; the age column + rendering, half a day.

---

### F-06 · Thursday games never receive a frozen prediction
**`.github/workflows/jobs.yml:74`, `scripts/lib/jobs-core.ts:619-625`**

The freeze cron is `0 3 * * 5` — Friday 03:00 UTC, i.e. **Thursday 10pm ET**.
`freezeJob` then selects `.eq("status", "scheduled")`.

A Thursday 7:30pm ET game kicked off two and a half hours earlier. By 10pm ET
the scoreboard loop (`0 0-3 * * 5,6`) has flipped it to `in_progress` or
`final` — so it is filtered out and **no frozen prediction is ever written for
it.** It never appears on `/receipts`, it is never CLV-graded, and the model
silently has no record of having had an opinion.

If the scoreboard loop happened to miss it, the opposite failure occurs: the row
is still `scheduled` and gets "frozen" *after kickoff*, priced against a line
that already reflects two hours of play. That is a receipt that lies.

Week 1 2026 has Thursday games. So does most of the season.

**Fix:** move the freeze earlier — Wednesday 03:00 UTC (`0 3 * * 3`) covers the
whole week including Thursday nights, and "Thursday night receipt" was always
about being *before the market's final word*, not about the specific weekday.
Alternatively run two freezes (Wed for Thu/Fri games, Thu for the rest) keyed on
each game's own kickoff. Either way, add an assertion to the job: if any game in
the week has `start_ts < now()` and no frozen row, log it loudly.

**Effort:** 1 hour for the cron move; 3 hours for the per-kickoff version.

---

### F-07 · Postgres and JavaScript snap the consensus line differently
**`supabase/migrations/0015_consensus_views.sql:29-33`, `supabase/migrations/0021_pick_markets.sql` (`make_pick`), `src/lib/consensus.ts:29-31`**

Both implementations claim to be the same function. They are not.

```
Postgres: round(avg * 2) / 2     — numeric round() breaks ties AWAY FROM ZERO
JS:       Math.round(v * 2) / 2  — Math.round breaks ties TOWARD +∞
```

Verified on PostgreSQL 16.13 and Node 22:

| consensus mean | `line_consensus` / `make_pick` | `consensusFromSnapshots` |
|---|---|---|
| **−3.25** | **−3.5** | **−3.0** |
| +3.25 | +3.5 | +3.5 |

A two-book average of −3.0 and −3.5 hits this exactly. It is not a rare input.

Consequences, all silent:

- **The card and the receipt disagree.** `/slate` reads `line_consensus`
  (`queries.ts:151`, Postgres) and shows the market at −3.5. `freezeJob` writes
  `vegas_spread` from the JS path (`jobs-core.ts:748`) as −3.0. `/receipts`
  then prints a different "market" number than the card did for the same game,
  and `edge = model − vegas` is off by half a point — which straddles the
  `edgeThreshold = 2` boundary and can flip an EDGE flag on or off.
- **Phantom CLV.** `make_pick` snapshots −3.5 (Postgres). The grader's closing
  consensus uses the JS path (`jobs-core.ts:469`). If the line never moved at
  all, `spreadClv("home", −3.5, −3.0) = −0.5`. The bettor is charged half a
  point of negative CLV for a market that did not budge. Averaged over a season
  this is a real, systematic drag on the leaderboard's tiebreak.
- The mismatch is *sign-dependent* — it bites home favourites (negative
  spreads) and not home dogs — so it does not average out.

`consensus.ts:6` says "this is the only one now". It is one function written
twice in two languages that round differently.

**Fix:** pick one convention and pin it in both places with a test. Half-up in
JS is one line:
```ts
export function snapToHalf(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v) * 2) / 2;   // away from zero, matches PG
}
```
Then add a test that walks −5.00 to +5.00 in 0.25 steps and asserts JS agrees
with a Postgres fixture. The db-test harness already exists for exactly this.

**Effort:** 1 hour including the cross-language test.

---

### F-08 · Nobody finds out when a job dies
**`.github/workflows/jobs.yml` (whole file), `scripts/run-job.ts:39-42`**

Every job's failure handling is `process.exit(1)` into a GitHub Actions run
nobody is subscribed to. There is no alert, no status surface in the app, no
dead-man's switch, and no record of job outcomes anywhere in the database
(`api_call_log` records *calls*, not *runs*).

Concrete silent-corruption scenarios, all of which look identical to "the site
is fine":
- The Sunday `ratings-update` fails once → ratings never advance, picks and
  bets stay ungraded, CLV stays null, and the next Sunday's run *does* recover
  (it is a stateless full replay — genuinely good design) but the week in
  between showed stale ratings as current.
- `refresh-lines` fails Saturday morning → the slate shows Tuesday's lines all
  day, and every pick snapshots a stale number as `line_at_pick`.
- The `&&` chain at `jobs.yml:137-138` means a lines failure also skips
  `freeze-groups`, with no separate signal.
- **ASSUMPTION** (not verified against the repo's Actions settings): GitHub
  disables scheduled workflows on repositories with 60 days of no commit
  activity. This repo's crons run year-round; a quiet offseason would silently
  stop every job. Worth confirming before February.

**Fix, cheapest thing that works:** a `job_runs` table (`job`, `started_at`,
`finished_at`, `ok`, `detail jsonb`), written by `run-job.ts` in a `finally`,
plus a strip on `/admin` reading "ratings-update: 6 hours ago ✅ · refresh-lines:
14 minutes ago ✅ · freeze: **3 days ago** ⚠". That converts the whole class of
failure from invisible to glanceable, and it is the single highest
value-per-hour item in this report after F-01.

**Effort:** 3 hours.

---

## S2

### F-09 · Weather is fetched, displayed, and never priced
**`scripts/lib/jobs-core.ts:252-317`, `src/model/ratings.ts:501`**

`weatherJob` writes `wind_mph`, `precip_prob` etc. and the card renders them.
`priceGame`'s only situational input is `situationalPoints`, which
`freezeJob:747` sources exclusively from `rating_adjustments`. §2.3's "wind
>15mph reduces total 3–6 pts" is not implemented; the number is decoration.

For a site whose stated edge includes small-conference totals, this is a real
miss — and it is a rare case where the data is already in the table.

**Fix:** a `weatherAdjustment(wind, precip, dome)` in `src/model/`, applied to
the projected total only (not the margin), gated behind a `--tune-weather` run
per the model gate. **Effort:** half a day including the tuner.

### F-10 · The injury/news scan does not exist
**`SPEC.md:137,223`; no corresponding script**

`rating_adjustments`, the admin confirm UI (`AdjustmentsPanel.tsx`), the RLS
policies and the freeze-job wiring all exist. The thing that *proposes*
adjustments does not. The whole apparatus can only ever be driven by hand.

Given `SPEC.md:161` ("Backup QB situations" as a soft market) and §2.3's −5 to
−7 QB-out adjustment, this is the largest unbuilt piece of model value in the
repo. **Effort:** 1 day (the Anthropic + Zod pattern in `generate-questions.ts`
is directly reusable).

### F-11 · LLM output publishes without the review step the spec requires
**`scripts/generate-verdicts.ts:171-190`, `SPEC.md:128`**

§3 specifies "Generated with web search, reviewed by admin before publish."
`team_verdicts` rows are written directly and rendered. Output *is* Zod-schema
validated and there is no `dangerouslySetInnerHTML` anywhere in `src/` (checked)
— so this is not an injection hole, it is a factual-accuracy one. An
hallucinated "Team X's starting QB transferred" on a public team page is a trust
event exactly like a wrong score.

**Fix:** a `published_at` column, null on generation, set from an `/admin` queue.
**Effort:** 3 hours.

### F-12 · Bet `odds` and `units` are unbounded
**`src/app/actions/bets.ts:23,34,101`**

`logBet` validates `units > 0` and nothing else; `logSlipBets` checks
`Number.isFinite(odds)`. A user can log 500 units at +50000. The grader
computes `win = units * (odds/100)` (`jobs-core.ts:588`) faithfully, and the
shared leaderboard is sorted on units first (`records.ts:164`).

For a friend group this is mostly a fat-finger risk rather than an attack, but
the ledger is explicitly *shared and unhideable*, so one typo distorts everyone's
view of the season. Bound to something like ±10000 odds and 100 units, at the
database with a check constraint so it holds for direct PostgREST calls too.
**Effort:** 30 minutes.

### F-13 · The slate ships ~7,000 raw snapshot rows per render to draw 24 points
**`src/lib/queries.ts:144,152-157`, `src/components/slate/SlateView.tsx:189`**

`historyRes` pulls every `line_snapshots` row for the week's games over 7 days.
With 4 daily refreshes + Saturday hourly + the 10-minute burst, across ~3 CFBD
providers, that is on the order of 100+ rows per game — roughly 7,000 rows for a
60-game Saturday. `consensusHistory` reduces them to `.slice(-24)` per game and
throws the rest away.

`/api/slate` re-runs the identical query every 30s while anything is live
(`SlateView.tsx:189`) and the route is `no-store`, unauthenticated, and
unthrottled.

Migration 0015 already pushed the *consensus* reduction into Postgres for
exactly this reason and the comment above `historyStart` claims the row count is
"bounded" — it isn't. Finish the job: a `line_history` view doing the
distinct-on-and-collapse in SQL, or simply cap the window to 48h and one
provider for the sparkline.

**Effort:** 3 hours. Not a Week-1 blocker at 15 users; is one at 15 users
refreshing through a full Saturday on cell service.

### F-14 · `/api/slate`, `/api/ticker`, `/api/game/[id]` are public and unthrottled
**`src/app/api/*/route.ts`**

All three are `force-dynamic`, `no-store`, and reachable without auth by
design (migration 0011 made the site public to browse). `/api/slate` in
particular runs 15 Supabase queries per call including the 7,000-row history
read. There is no rate limiting anywhere in the repo.

The realistic risk is not malice — it is a crawler or a stuck client loop
burning the Supabase free-tier egress on a Saturday. **Fix:** a small in-memory
or Upstash token bucket keyed on IP, or move the ticker to a 10-second
`s-maxage` (it is the same payload for everyone). **Effort:** 2 hours.

### F-15 · `sync-games` can overwrite live and final state
**`scripts/sync-games.ts:63-73`**

The upsert writes `home_points`, `away_points` and
`status: completed ? "final" : "scheduled"` unconditionally. If it runs while a
game is `in_progress`, it writes the score back to null and the status back to
`scheduled` — undoing the scoreboard loop and blanking a live card.

Today the cron is `0 9 * * *` (04:00 ET), so it never collides in practice.
That is a schedule accident, not a guarantee; a manual `workflow_dispatch`
during a Saturday is the obvious way to trigger it.

**Fix:** never downgrade — omit `status`/points from the upsert when the stored
row is `in_progress` or `final` and the incoming row is not completed.
**Effort:** 1 hour.

### F-16 · The edge threshold treats all points as equal
**`src/model/ratings.ts:169-170,579`**

`edgeFlag` is a flat `|edge| ≥ 2` / `≥ 4` on a market where 3 and 7 carry most
of the probability mass. Crossing 3 (−2.5 → −3.5) is worth far more than
crossing 8 (−7.5 → −8.5), and the flag cannot tell them apart.

The mitigating context is real and should be stated: `--diagnose-edges` already
demoted edges from bets to information (b₁ = 0.035, t = 0.84,
`docs/CHANGELOG.md:82`), so a mis-set threshold costs attention, not money.
That is exactly why this is S2 and not S1. But `/edges` is still a page people
will open on Saturday morning, and "we disagree by 2 across the 3" is a
materially different statement from "we disagree by 2 across the 9".

**Fix:** flag on key-number crossings rather than raw magnitude — did the model
and the market land on opposite sides of 3, 7, or 10? That is both more
informative and cheaper to compute. Gate it with `--diagnose-edges` before
shipping, per `AGENTS.md`. **Effort:** half a day with the gate run.

### F-17 · CFBD client has no retries, no timeout, no 429 handling
**`src/lib/cfbd.ts:40-61`**

A single non-2xx throws `CfbdError` and kills the whole job. There is no
backoff, no `Retry-After` handling, and no `AbortSignal.timeout` — a hung
connection stalls the runner until the 75-minute workflow timeout.

`SPEC.md` §8 asks for retries and rate-limit handling explicitly. The
`scoreboard-loop` is the one job that survives this, because its try/catch
(`scoreboard-loop.ts:128`) treats a bad tick as recoverable. Every other job
dies — silently, per F-08.

**Fix:** wrap `get()` in 3 attempts with exponential backoff, honour
`Retry-After` on 429, and add a 20s timeout. **Effort:** 1 hour.

### F-18 · Receipts is missing the calibration table §2.5 promises
**`src/app/receipts/page.tsx:97-113`, `SPEC.md:102`**

The spec's stated question is "do 70% favorites win ~70%?" The page computes SU%,
ATS%, flagged-edge% and the CLV strip — but no win-probability buckets. The
bucket table is the one output that would let a reader judge whether
`winProbSlope` and `marginSigma` are still right mid-season, and `backtest.ts`
already has the exact code (`backtest.ts:78-93`) to lift.

**Effort:** 2 hours.

### F-19 · Tempo is a hardcoded constant, so projected totals carry no pace
**`src/model/ratings.ts:564`; `tempo: 70` at `jobs-core.ts:437,745`, `replay.ts:256,261`, `build-preseason.ts:544,618`, `team/[id]/page.tsx:155`**

§2.1 specifies "a tempo estimate (plays/game) for each team" feeding projected
scores and totals. Every call site passes 70, so `tempoFactor` is always exactly
1.0 and the `ratings.tempo` column is a constant.

Two consequences. First, a genuine miss: Air Force vs Army and Tennessee vs Ole
Miss get the same pace treatment, on a product that lists small-conference
totals as a soft market. Second, a **latent inconsistency**: `priceGame`
multiplies the score terms by `tempoFactor` but adds `hfa/2` outside it
(`ratings.ts:566-568`), while `margin` (line 557) adds the full `hfa` un-scaled.
The moment tempo stops being 70 for both teams, the projected-score margin and
the published spread will disagree — the card will say −7 while its own
projected score says −6.3. Fix the algebra when you fix the tempo, not after.

**Effort:** 1 day (needs a plays/game ingest + a tuner run).

### F-20 · The Mon/Wed/Sat homepage does not exist
**`src/app/page.tsx:3`, `SPEC.md:208`**

`redirect("/slate")`. The spec's daily modes — Monday results+receipts,
Wednesday lines+edges, Saturday chronological slate — are the direct expression
of the prime directive ("answer *what matters right now* every time it's
opened"). Every ingredient already exists on other pages.

**Effort:** half a day. High value-per-hour; see `03-suggestions.md`.

### F-21 · No route smoke tests
**`vitest.config.ts`, `src/**/*.test.*`**

301 unit tests, all on pure functions and three components. Zero tests render a
route. `npm run build` catches type errors and nothing else — a page that throws
at request time on an empty database (the August state) ships green.

Given that the entire app is `force-dynamic` and the database is currently
almost empty, "does `/receipts` render with zero predictions" is a question
nobody has answered mechanically.

**Effort:** 3 hours for a smoke pass over the 12 main routes against the
seeded fixture database (`scripts/seed-fixtures.ts` already exists).

---

## S3

- **F-22 · Migration `0004` is missing.** `0001,0002,0003,0005,…` — a numbering
  gap with no note. Harmless today; confusing at 2am in November.
  `supabase/migrations/`.
- **F-23 · `updateFromResult` caps the prediction as well as the actual.**
  `ratings.ts:382-384` clamps both to ±28; §2.2 specifies
  `error = actual_margin_capped − predicted_margin`. Only bites on predicted
  margins beyond 28 (rare), and the current behaviour is arguably better, but
  it is an undocumented divergence from the contract.
- **F-24 · Production uses one FCS rating, the spec specifies two buckets.**
  `FCS_RATING = -30` at `jobs-core.ts:28` and `replay.ts:25`, against
  `fcsTopRating = −25` / `fcsOtherRating = −35` in `DEFAULT_PARAMS`
  (`ratings.ts:171-172`). Those two params are **dead code**: nothing reads
  them. Week 0/1 is thick with FCS games, so this is worth 20 minutes.
- **F-25 · `blendedHfa()` and `coachingAdjustment()` are exported and never
  called.** `ratings.ts:294-303,607-610`. `build-preseason.ts:517-520` inlines
  the HFA formula instead — which is how F-02's estimator drifted from the
  model module unnoticed.
- **F-26 · `suggestedStake` is dead** (`ratings.ts:616`, referenced only by
  `ratings.test.ts`) and **`SPEC.md` §5.4 still promises ¼-Kelly on every
  flagged game**, which the evidence in `docs/CHANGELOG.md:82` explicitly
  retired. Update the spec; it is the contract this audit measures against.
- **F-27 · Sessions never expire.** `middleware.ts:14` sets a 400-day cookie and
  refreshes it on every request. Deliberate and documented; worth restating that
  a stolen phone is a permanent account compromise with no server-side
  revocation path short of Supabase's admin API.
- **F-28 · Design palette diverges from `SPEC.md` §7.** Spec says deep field
  green `#08251C` / Graduate; `globals.css:10-27` ships warm charcoal `#12100d`
  with Barlow Condensed. This is a deliberate evolution recorded in
  `docs/DESIGN.md` — but §7 was never amended, so the spec now describes a site
  that does not exist.
- **F-29 · `#5b6472` hardcoded as a colour fallback in six places** —
  `TeamMark.tsx:20`, `GameCard.tsx:118-119,449,615-616,649-650`,
  `WinProbBar.tsx:19-20`. It is the light-mode value of `--push`, so it is wrong
  in dark mode. Already logged in `docs/CHANGELOG.md:701`; still open.
- **F-30 · `build-preseason.ts` hardcodes `SEASON = 2026`** (line 60) while
  every other script reads `CFB_SEASON`. Carried over from the previous audit as
  item #36, still open.
- **F-31 · No offline story.** `manifest.ts` is installable but there is no
  service worker and no cached shell. "A stadium with no signal" currently means
  a blank page. Spec only promises install, so this is a gap against the
  *use case*, not the contract.
- **F-32 · Icons are SVG-only** (`manifest.ts:15-16`). iOS home-screen install
  wants a PNG `apple-touch-icon`; today it renders a screenshot.
- **F-33 · Every page is `force-dynamic`** (23 files). Correct for the
  auth-dependent ones; unnecessary for `/rules`, `/rankings`, `/standings`,
  `/teams`. Not a problem at this scale — noted because the prompt asked and
  because the blanket application means nobody chose it per page.

---

## What I could not break

Stated explicitly, because a negative result is worth as much as a finding here.

- **`picks` are genuinely locked at the database.** `0021` revokes
  `insert, update, delete` on the table from `authenticated` and `anon`
  outright. Every write goes through `make_pick` / `remove_pick`, which check
  `auth.uid()`, group membership, market legality, board membership, and
  `start_ts <= now()` — with a null `start_ts` treated as locked. I tried to
  construct a direct PostgREST write and there is no grant to use.
  `supabase/tests/picks.sql` asserts exactly this from three roles and passes.
- **`line_at_pick` cannot be forged.** The number is computed inside the
  security-definer function from `line_snapshots`; the client never supplies it.
  Editing re-snapshots via `on conflict … do update set line_at_pick =
  excluded.line_at_pick`, which is League Rule #2, correctly.
- **The pick blind is a real read boundary, not a client filter.** `0023`'s
  three policies gate other users' rows on `picks_revealed()`, and
  `group_game_pick_count` is a security-definer counter guarded on
  `is_group_member` so a non-member of a public group cannot poll for who has
  committed. This is the failure mode the prompt asked me to hunt for and it is
  not present.
- **`predictions` is append-only for users.** Table-level `update, delete`
  revoked in `0001:353`; adding columns in `0014`/`0019` does not re-grant, so
  the append-only property survived both migrations.
- **No self-service privilege escalation.** `0013` replaced the table UPDATE
  grant on `profiles` with column grants on `display_name`,
  `favorite_team_ids`, `timezone`. `is_admin` is unreachable.
- **The service-role key is not reachable from the browser.**
  `createServiceClient` is imported by exactly two files (`admin/page.tsx`, a
  server component, and `actions/invites.ts`, `"use server"`), and no
  `"use client"` file references it. `SUPABASE_SERVICE_ROLE_KEY` is not
  `NEXT_PUBLIC_`-prefixed.
- **No injection surface.** No raw SQL is built from user input anywhere;
  everything goes through PostgREST or parameterised plpgsql. LLM output is
  Zod-validated and there is no `dangerouslySetInnerHTML` outside the
  theme-init script, which is a static string literal.
- **The backtest has no lookahead leak.** Traced every input; see
  `02-model-and-clv.md`.
- **`season_id` is on every domain table and used in every query I checked.**
  The one omission (`groups`) is deliberate and correct.
