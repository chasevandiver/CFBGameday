# 05 — CLV & Grading

**Verdict in one paragraph.** The core of this workstream is healthy: grading exists, is scheduled, and is correct; the CLV sign convention was re-derived from first principles here and `src/lib/clv.ts` passes all four cases, the tests assert the *right* signs, and one implementation genuinely serves picks, bets, and the model's own predictions. The Aug 7 inversion fix and the Aug 9 moneyline fix are both verified against current code, and a live read-only query against production confirms the "zero rows graded before the fix" claim (0 picks, 1 ungraded bet, 0 CLV values anywhere). The real problems found are around the *closing line itself*, not the sign: (N1) the SQL and JS half-point snappers round negative quarter-point ties in opposite directions, so a pick taken at the SQL consensus (−3.5) can be scored against a JS close (−3.0) computed from the *identical snapshots*, banking a phantom ±0.5 CLV on an unmoved line — verified against the live Postgres; (N2) Thursday/Friday games have no closing-line burst at all, so their "close" is a snapshot from ~2.5–5 h before kickoff, used silently; (N3) postseason games are never graded because the grader shares the ratings replay's `season_type = 'regular'` filter; and (N4) every Supabase error in the grading path is discarded, so a failed snapshot fetch silently grades a whole week without CLV while the Action stays green.

Production state at audit time (live query, 2026-08-09): `picks` 0 rows, `bets` 1 row (ungraded, no CLV), `predictions` 297 frozen / 0 with CLV, `line_snapshots` 808 rows, last captured 2026-08-07T12:39Z. The entire grading path is still unexercised against real rows — consistent with `docs/CHANGELOG.md:675` ("CLV has no data yet").

---

## Findings table

| ID | Severity | Type | Status | One-line | Evidence |
|---|---|---|---|---|---|
| C1 | — | bug (historical) | **FIXED-verified** | CLV sign inverted in all four branches of the old grader; fixed Aug 7 by extracting `src/lib/clv.ts`; zero rows were graded pre-fix (verified live) | `src/lib/clv.ts:46-60`, `docs/CHANGELOG.md:508-525`, live DB query |
| C2 | — | bug (historical) | **FIXED-verified** | Moneyline bets skipped by null-line guard; guard is now `!b.side` only and the ML branch grades winner + real-odds payout | `scripts/lib/jobs-core.ts:550-582` |
| C3 | — | bug (historical) | **FIXED-verified** | `open_spread ?? spread` fallback trap: shared `SNAPSHOT_COLS` constant + pinning test both exist | `scripts/lib/jobs-core.ts:55`, `scripts/lib/jobs-core.test.ts:5-41` |
| C4 | — | spec-div (historical) | **FIXED-verified** | Leaderboard sorts units → ROI → CLV, nulls last; `/rules` #5 states the same order | `src/lib/records.ts:163-169`, `src/app/groups/[slug]/page.tsx:137`, `src/app/rules/page.tsx:38-41` |
| C5 | P3 | design | **STILL OPEN** (deliberate) | Dead, undeployed `supabase/functions/jobs/index.ts` still carries the inverted CLV formula in all four branches *and* the ML-skipping guard | `supabase/functions/jobs/index.ts:530-537,550,561-568` |
| N1 | **P1** | **bug** | **NEW** | SQL snaps −3.25 → **−3.5** (round half away from zero), JS snaps −3.25 → **−3.0** (`Math.round` half toward +∞): pick lines/slate display (SQL) vs closing consensus (JS) disagree on identical snapshots → phantom ±0.5 CLV on unmoved lines; two pages show two different "current" lines | `supabase/migrations/0021_pick_markets.sql:207`, `supabase/migrations/0015_consensus_views.sql:23`, `src/lib/consensus.ts:29-31`; verified live: `round((-3.25)::numeric*2)/2 = -3.5` |
| N2 | **P1** | design | **NEW** | No lines burst on Thursday/Friday (burst crons are Sat/Sun-UTC only): weeknight games' "close" is the 22:00 UTC daily snapshot, 2.5–5 h stale, used silently; very late Sat kicks (≥ 05:30 UTC, Hawaii) also fall outside the last burst's 100-min window | `.github/workflows/jobs.yml:56-57,117-118`, `scripts/refresh-lines.ts:20`, spec §5.3 `docs/SPEC.md:170` |
| N3 | P2 | bug | **NEW** | Postseason picks/bets/predictions never grade: the grading pass reuses the ratings replay's `season_type = 'regular'` game query; groups explicitly support postseason weeks | `scripts/lib/jobs-core.ts:349-356,455`, `supabase/migrations/0020_groups.sql` (`group_week_config.season_type`) |
| N4 | P2 | bug | **NEW** | Every `{ data } = await db…` in the grading path discards `error`: a failed `line_snapshots` fetch (transient, or the unbounded `.in(finalIds)` URL late-season) silently grades results with `clv = null`, or grades nothing, and the job reports success | `scripts/lib/jobs-core.ts:456-460, 481-486, 511-515, 543-548` |
| N5 | P2 | design | **NEW** | A stale close is indistinguishable from a real one: no staleness check, no nulling with reason, no "CLV measured vs a T-minus-Nh line" surfaced anywhere; the only UI hint is a tooltip for the fully-null case | `src/lib/consensus.ts:38-44`, `src/app/receipts/page.tsx:264` |
| N6 | P3 | bug | **NEW** | TBD kickoff (`start_ts` null): `closing()` gets `before = undefined` and will select the **latest** snapshot, including one captured after the game went final | `scripts/lib/jobs-core.ts:467-470`, `src/lib/consensus.ts:41` |
| N7 | P3 | spec-div | **NEW** | ML CLV null-by-design is justified by "a closing price we do not capture" — but `ml_home`/`ml_away` **are** captured every snapshot and consensus computes them; spec §5.3 still promises cents; nothing user-visible explains the permanent "–" | `scripts/lib/jobs-core.ts:578-580`, `scripts/refresh-lines.ts:81-82`, `src/lib/consensus.ts:63-64`, `docs/SPEC.md:170` |
| N8 | P3 | design | **NEW** | `team_total` / `first_half` / `future` bets never grade and show "open" forever; the ledger comment still names *moneyline* as the ungraded type (stale since Aug 9) | `scripts/lib/jobs-core.ts:563-582`, `src/app/ledger/page.tsx:113-118` |
| N9 | P3 | spec-div | **NEW** | Rule #4 "postponed or canceled = void" has no mechanism for picks — nothing anywhere writes `picks.result = 'void'`; a postponed-then-played game grades against a weeks-old `line_at_pick` instead of voiding | `src/app/rules/page.tsx:35-37`; grep: only `bets` void path exists (`src/app/actions/bets.ts:141`) |
| N10 | P3 | bug | **NEW** | Recap renders a 0.00 average CLV as "CLV PK" (`fmtSpread` reuse) | `src/app/recap/[week]/page.tsx:269`, `src/lib/slate.ts:300-304` |
| N11 | P3 | design | **NEW** | Predictions with `edge` null/0 or no `vegas_spread` never get `close_spread` written (the `continue` skips the whole update) and stay in the `predictions_ungraded` partial index forever, re-fetched every Sunday | `scripts/lib/jobs-core.ts:493-508`, `supabase/migrations/0019_prediction_clv.sql:42-44` |
| N12 | P3 | design | **NEW** | `records.test.ts` premise "numeric columns arrive as strings" is false for PostgREST (verified live: `"spread":-3.0` unquoted); the ledger curve's raw `+` on `payout_units` is safe only because that premise is false — two contradictory conventions coexist | `src/lib/records.test.ts:94-96`, `src/app/ledger/page.tsx:133-138`; live REST probe |
| N13 | P3 | spec-div | **NEW** | Group standings show Record/Units/CLV but no ROI column, though `/rules` #5 says the leaderboard shows ROI; ROI denominator (risk, pushes excluded) stated nowhere user-visible; SPEC §4.5 never amended to name units as the primary sort | `src/app/groups/[slug]/page.tsx:203-246`, `src/app/rules/page.tsx:38-41`, `docs/SPEC.md:153` |

---

## 5a. Does grading exist and is it scheduled?

**Yes — verified end to end.** The Sunday job `ratingsUpdateJob` (`scripts/lib/jobs-core.ts:324`) does ratings replay *then* grading. Scheduling chain, all confirmed in current files:

- `.github/workflows/jobs.yml:72` — cron `0 13 * * 0` (Sunday 13:00 UTC / 8am ET)
- `jobs.yml:122` maps that schedule string to `task=ratings-update`
- `jobs.yml:142` runs `npx tsx scripts/run-job.ts ratings-update`
- `scripts/run-job.ts:26` maps `"ratings-update"` → `ratingsUpdateJob`

**Writers, each traced:**

| Column | Writer | Evidence |
|---|---|---|
| `picks.result`, `picks.clv` | Sunday grader, only rows `result is null` on final games | `jobs-core.ts:511-540` |
| `bets.result`, `bets.clv`, `bets.closing_line`, `bets.payout_units` | Sunday grader, only `result is null and voided_at is null` | `jobs-core.ts:543-599` |
| `predictions.close_spread`, `predictions.clv` | Sunday grader, only `frozen and clv is null` | `jobs-core.ts:481-508` |
| `predictions.open_spread`, `predictions.vegas_spread` | Thursday freeze (`freezeJob`), cron `0 3 * * 5` | `jobs-core.ts:783-788`, `jobs.yml:74,123` |
| `bets.result='void'` + `voided_at` | The one user-permitted edit, trigger-enforced ungraded→void with all other columns frozen | `supabase/migrations/0013_integrity_lockdown.sql:34-63`, `src/app/actions/bets.ts:141` |

**Prediction-row CLV (migration 0019):** the freeze stores `vegas_spread` (line at freeze) and `open_spread` (consensus opener — context only, per the comment at `jobs-core.ts:783-786`); the grader writes `close_spread` and `clv` and nothing else, preserving append-only receipts (`0019_prediction_clv.sql:26`). CLV measures **freeze-line vs close**, not opener vs close — matches the migration's declared design. Two wrinkles: a game with no closing consensus is *left null for a later backfill* (good — `jobs-core.ts:494-497`), but a prediction whose `edge` is null/0 also skips the whole update, so its `close_spread` is never recorded and the row sits in the `predictions_ungraded` partial index forever (N11).

**Idempotency / re-entry:** grading filters on `result is null` / `clv is null`, so re-runs are safe; a mid-run failure resumes next Sunday. But note N4: all read errors are swallowed, so "resumed next Sunday" is also the *only* signal a run half-failed.

---

## 5b. CLV sign — re-derived, not trusted

Convention: spreads are stored home-perspective (negative = home favored) everywhere; `lineTaken` and `close` are both home-perspective; `side` is an **explicit argument** (`src/lib/clv.ts:46,57`).

**The four cases, from first principles:**

1. **Home −3.5 → close −6.5.** You laid 3.5; kickoff bettors must lay 6.5. Your ticket is 3 points better: **+3.0**. Code: `lineTaken − close = −3.5 − (−6.5) = +3.0` ✓ (`clv.ts:47-48`).
2. **Away on the same stored numbers.** Taken home −3.5 ⇒ away **+3.5**; close home −6.5 ⇒ away **+6.5**. You took 3.5 of the 6.5 available points: **−3.0**. Code: `flip(+3.0) = −3.0` ✓ (`clv.ts:48`).
3. **Over 52.5 → close 55.5.** You bought the over 3 points cheaper: **+3.0**. Code: `close − lineTaken = 55.5 − 52.5 = +3.0` ✓ (`clv.ts:58-59`).
4. **Under 52.5 → close 49.5.** You sold at 52.5; the close sells at 49.5 — you got the better price by 3: **+3.0**. Code: `flip(49.5 − 52.5) = flip(−3.0) = +3.0` ✓ (`clv.ts:59`).

**The tests assert the right signs** — checked case by case, not taken on faith: `clv.test.ts:11` (+3 for home laying less), `:21` (−3 for away taking fewer points), `:53/:58` (over up = +, under up = −), plus the antisymmetry property test (`:29-39`, the two sides of one move must be exact negatives — the property the old bug violated) and a zero-sum/`−0` test (`:41-47`).

- **Push/no-move case:** `flip` is `−0`-safe (`clv.ts:38`), tested with `Object.is(…, -0)` assertions. Inputs are ≥0.1-granular numerics, so `roundClv` cannot manufacture a fresh `−0`.
- **Moneyline:** CLV deliberately stays null (`jobs-core.ts:578-582`) rather than cents per spec §5.3 — see N7: the stated justification ("a closing price we do not capture") is factually wrong, since `ml_home`/`ml_away` are in every snapshot (`refresh-lines.ts:81-82`) and `consensusFromSnapshots` already computes closing ML consensus (`consensus.ts:63-64`). The decision may still be right (thin CFB ML consensus, cents ≠ points in one column — though `bets.clv` is commented "cents for ML" at `0001_core_schema.sql:226`), but it is undocumented to users: an ML bet shows "–" in the ledger CLV column forever with no explanation, and `/rules` never mentions it.
- **One implementation:** grepped the tree for any other subtraction of a taken line from a close. Picks (`jobs-core.ts:534,536`), bets (`:567,576`), and model (`:498`, via `modelClv` → `spreadClv`) all route through `src/lib/clv.ts`. `modelClv` maps `edge < 0` → home side, consistent with `modelSideOf`; worked check: edge −3 (home lean), frozen −7, close −9 ⇒ `spreadClv("home", −7, −9) = +2` — market moved toward the model ✓. The only other CLV arithmetic in the repo is `scripts/backtest.ts:1446-1453` (open-vs-close, inline): `likesHome ? open − close : close − open`, which is `spreadClv(side, open, close)` exactly — algebra consistent, though it is a second copy a future edit could skew (backtest-only, offline).
- **Positive renders green with an explicit `+`** in: ledger history (`ledger/page.tsx:318-324`), ledger tag audit (`:253-267`), ledger Avg-CLV tile (`:204-207`, gold when positive; negative is neutral, not red — arguably deliberate), receipts column (`receipts/page.tsx:268-271`) and calibration tile (`:157-165`), recap crew list (`recap/[week]/page.tsx:267-270` — but see N10: a 0.00 average prints "CLV PK"), pick buttons (`PickButtons.tsx:97-104`), game page (`game/[id]/page.tsx:392-398`). Group standings print avg CLV signed but **uncolored** (`groups/[slug]/page.tsx:235-239`) — neutral, not wrong.

**C1 verdict: FIXED-verified.** The Aug 7 history checks out: the fix is real, correct, and the no-corruption claim is confirmed against production, not just the changelog — 0 picks exist, the 1 bet is ungraded, and 0 CLV values exist in any table (live query, 2026-08-09). The dead edge function still holds the inverted formula, e.g. `index.ts:530`: `clv = p.side === "home" ? close.spread - line : …` — that is `−spreadClv`, wrong in all four branches, plus the pre-Aug-9 ML-skipping guard at `:550`. Deliberate (`CHANGELOG.md:555-557`), but it is a loaded gun for anyone who revives the pg_cron path; reviving it would also *re-introduce the freeze-horizon bug and unsnapped totals* it predates (C5).

---

## 5c. The closing line

### consensusFromSnapshots (`src/lib/consensus.ts`)

- **Averages across providers:** latest snapshot per provider (optionally before a cutoff), mean, then `snapToHalf` (`consensus.ts:38-66`). Moneylines average to a whole number.
- **Half-point snapping exists** (`consensus.ts:29-31`, shipped in PR #2 per `CHANGELOG.md:668`), and it is what makes pushes *reachable*: a raw mean of −3.17 would make a home-by-exactly-3 final grade as a 0.17-point loss; snapped, the worked example is: providers {−3.5, −3, −3} → mean −3.1667 → ×2 = −6.333 → `Math.round` → −6 → **−3.0**; `gradePick("spread","home",−3, 24, 21)`: coverMargin = 3 + (−3) = 0 → **push** ✓ (`src/lib/grade.ts:47-48`). Note result grading actually uses `line_at_pick`, which was itself snapped at pick time by `make_pick`, so pushes are detectable on the graded line too; the closing consensus feeds *only* CLV.
- **N1 — the snappers disagree on negative quarter-point ties.** Postgres `round()` on numeric rounds half **away from zero**; JS `Math.round` rounds half **toward +∞**. Verified live on this exact database: `round((-3.25)::numeric * 2)/2 = −3.5`, while `Math.round(−3.25 × 2)/2 = Math.round(−6.5)/2 = −6/2 = **−3.0**`. There are three snappers: `make_pick` (`0021:207`) and the `line_consensus` view (`0015:23`) in SQL; `snapToHalf` (`consensus.ts:29`) in JS, used by the grader's close, the freeze's `vegas_spread`, and the game page. Concrete failure, needing nothing exotic — two books split −3 / −3.5, line never moves:
  - Slate shows −3.5 (view, SQL); pick locks `line_at_pick = −3.5` (RPC, SQL).
  - Sunday close from the *same* snapshots computes −3.0 (JS).
  - `spreadClv("home", −3.5, −3.0) = −0.5`; the away picker gets +0.5. **The line never moved; CLV should be 0 for both.**
  Every negative mean ending in .25/.75 hits this — with books routinely split a half point, that is a substantial slice of home-favorite spreads. Totals are unaffected (positive ties round the same way in both), ML consensus display can differ by 1 cent (`round(−110.5)`: SQL −111 / JS −110). Secondary symptom: `/game/[id]` (JS, `game/[id]/page.tsx:171`) and the slate (SQL view, `queries.ts:151`) can show different current lines for the same game right now. Model CLV is internally consistent (freeze and close both JS). Fix is one line in either direction — e.g. `snapToHalf = v => Math.sign(v) * Math.round(Math.abs(v) * 2) / 2` — plus a test at −3.25; the untested tie is exactly the gap in `queries.test.ts:26-33`, which probes −3.3 and −2.5 but never a negative quarter.
- **Canonical book (spec §5.3):** the spec's own text declares "a **declared canonical book** *(consensus; user's actual book stored as metadata)*" — i.e. the spec designates the consensus as the canonical number, and `bets.book` exists as metadata (`0001:222`). `/rules` #9 declares it in-app ("measured against our own captured closing consensus — the last snapshots before kickoff"). **Compliant**; no per-book close exists, consistent with the spec's parenthetical.

### Closing selection

- **Definition:** latest snapshot per provider with `captured_at < start_ts` — the `>=` skip at `consensus.ts:41` makes the cutoff strict, so a **post-kickoff snapshot cannot be selected**… except when `start_ts` is null (N6): `jobs-core.ts:469` passes `g?.start_ts ?? undefined`, and with `before === undefined` the filter is bypassed entirely, so a TBD-kickoff game that somehow reached `final` would take its *latest* snapshot, possibly post-game, as "the close". Narrow (sync-games normally fills `start_ts`), but it is the one hole in the cutoff. Timestamp comparison is lexicographic on ISO strings; both sides come back from Postgres in the same format, so that is sound.
- **Stale close (N2/N5):** there is no staleness check anywhere. If the last pre-kickoff snapshot is from Tuesday, that *is* the close — CLV is computed against it, not nulled, and no UI distinguishes it. The only "CLV unavailable" surface in the product is the receipts tooltip `title="no closing line"` (`receipts/page.tsx:264`) for the fully-null case; ledger and group pages just print "–".
- **Burst window vs schedule:** `--burst` selects games with `start_ts` in `(now, now+100min]` (`refresh-lines.ts:20,56-66` — the file header says 100, the workflow header still says "final 90 min"). Burst crons: `*/10 15-23 * * 6` and `*/10 0-3 * * 0` (UTC) — **Saturday 15:00–23:50 and Sunday 00:00–03:50 only** (`jobs.yml:56-57`). Coverage arithmetic:
  - *Sat noon ET (16:00 UTC) through Pac-after-dark 10:30pm ET (02:30 UTC Sun):* covered.
  - *Very late Sat:* last burst fires 03:50 UTC; its window reaches 05:30 UTC. A **06:00 UTC kick (8pm HT Hawaii / 11pm PT)** is never inside any burst; its close is the Sunday 03:00 UTC daily refresh — 3 h stale.
  - *Weekday MACtion (Tue/Wed) and **Thursday/Friday night games**:* no burst exists on those days at all — `*/10 0-3 * * 0` is Sunday, and `0 0-3 * * 5,6` (`jobs.yml:68`) is the *scoreboard* loop, not lines. Last lines snapshot before a 7:30pm ET (23:30 UTC) kick is the daily 22:00 UTC run — 1.5 h stale; for a 10:30pm ET Friday kick (02:30 UTC Sat) it is **4.5 h stale**. Friday is a real CFB night from Week 1 (Sep 4), so this bites in week one, silently, on exactly the games §5.1 calls the soft markets. The `jobs.yml:1-6` header documents Saturday cron *lag* as an accepted stale-close proxy; the weekday *absence* is not documented anywhere.
  - *TBD kickoff:* `start_ts` null fails `gt("start_ts", now)` (`refresh-lines.ts:63`), so TBD games are excluded from every burst — they still get weekly/daily snapshots. Combined with N6 they are the worst-served class.
- **`open_spread ?? spread` trap (C3): FIXED-verified.** `SNAPSHOT_COLS` is the exported shared column list (`jobs-core.ts:55`), used by both the grader (`:459`) and the freeze (`:682`); `jobs-core.test.ts:5-14` pins `spread_open` into it and `:17-41` demonstrates the silent fallback it prevents (open === spread when the column is dropped). Exactly as the changelog describes.

---

## 5d. Ledger accounting

### payout_units math (`jobs-core.ts:584-589`)

`win = odds > 0 ? units × odds/100 : units × 100/(−odds)`; `payout = win | −units | 0`, stored rounded to 2dp.

- **−110 favorite, 1u win:** 1 × 100/110 = 0.90909… → stored **+0.91** ✓ (the requested +0.909, at 2dp storage).
- **+150 dog, 1u win:** 1 × 150/100 = **+1.5** ✓.
- **+2500 ML, 1u win:** 1 × 25 = **+25.0** ✓ (the case the Aug 9 comment cites).
- **Push:** payout 0; stake implicitly returned (never subtracted) ✓; push also excluded from `staked` (`records.ts:118`) so it cannot dilute ROI.
- **Loss:** −units (full stake) ✓.
- **Void:** the grader never reaches a voided bet (`.is("voided_at", null)`, `jobs-core.ts:547`); a user can only void an *ungraded* bet, trigger-enforced with every other column frozen (`0013:46-56`), so a graded result can never be voided out of the record. `tally` skips `void` and `null` (`records.ts:82-84,111-112`), the ledger filters them (`ledger/page.tsx:120`), voided bets have `clv` null so CLV averages are clean. **Voids are consistently excluded everywhere checked.**

### Two accounting systems — intentional and (mostly) documented

Picks pay flat `PICKEM_WIN_PAYOUT = 0.909` (`records.ts:69`, with an explicit do-not-silently-restate rationale); bets pass through real `payout_units` (`ledger/page.tsx:119-121`). `/rules` #5 documents the pick'em −110 convention verbatim ("a win pays 0.909u per unit"). The ledger's real-odds basis is implied rather than stated, and the two systems differ by 0.001/unit on the same −110 wager (0.909 vs 0.91) — cosmetic, documented in-code. **Intentional: yes. Documented in /rules: the pick'em half is; the ledger half is implicit.**

One stale comment: `ledger/page.tsx:113-118` still says the grader never touches "moneyline, futures" — moneyline has graded since Aug 9 (N8). The *actual* never-graded types are `team_total`, `first_half`, `future` (allowed by `0001:216`), which sit as "open" forever with no UI acknowledgment.

### Leaderboard ordering vs League Rule #5

`byLeagueRules` = units desc → ROI desc → avgCLV desc, nulls last (`records.ts:163-169`), used by the group board (`groups/[slug]/page.tsx:131-137`). `/rules` #5 states exactly that order (`rules/page.tsx:38-41`). **Rule-vs-code reconciled** (changelog item 18 confirmed; the audit doc's `crew/page.tsx:155` citation is stale — `/crew` is now a redirect, `crew/page.tsx:13-24`). Residue (N13): `docs/SPEC.md:153` was never amended and still reads "record, units, ROI, CLV… Tiebreaker: ROI, then average CLV" without naming the primary key; the recap deliberately ranks the *week* by wins with a CLV tiebreak (`recap/[week]/page.tsx:155-157`, commented as intentional); and the group standings table shows no ROI column despite /rules promising it.

### ROI denominator

Risk-based: `roi = units / staked`, `staked` = sum of stakes on decided non-push wagers (`records.ts:117-118,133`) — i.e. profit per unit *risked*, not per unit to-win. Correct and consistent, tested (`records.test.ts:68-77`), but **stated nowhere user-visible** (N13): `/rules` #5 names ROI without defining it, and the ledger tile renders a bare percentage.

### Pushes, voids, groups

- **Pushes:** excluded from units (payout 0) and from the ROI denominator; shown as the third figure in "12-7-1" (`records.ts:171-176`). Rule #4 says pushes "don't count in the record or units" — displaying the `-1` suffix is standard sports convention and the push never sways win%, units, or ROI; consistent in substance.
- **Rule #4's other half — "postponed or canceled = void" — has no mechanism for picks** (N9): nothing in the repo writes `picks.result = 'void'` (only the bets void path exists). Arithmetically harmless today — an ungraded pick is excluded from every tally exactly as a void would be — but the pick renders as pending forever, and a postponed game *replayed weeks later* will grade against the original `line_at_pick` instead of voiding, which is precisely the argument Rule #4 exists to prevent.
- **Group-scoped picks (0021) grade correctly:** the grader selects by `game_id` + `result is null` with no group filter (`jobs-core.ts:511-515`) — right, because the line is per-row and the same user can hold opposite sides in two groups (unique key `(group_id, user_id, game_id, market)`, `0021:110-111`); each row grades against its own `line_at_pick`. **Hidden picks (0023):** the grader runs as service role (`scripts/run-job.ts` via `createServiceClient`), so RLS blinds don't apply to it, and hidden picks reveal at kickoff — before any grading happens. Group pages scope every tally by `group_id` (`groups/[slug]/page.tsx:67-80`). Picks orphaned by an admin dropping a game still grade and count in *season* standings while the week grid excludes them from week tallies and lists them as orphans (`groups/[slug]/week/[week]/page.tsx:82-92`) — coherent.
- **Straight-up:** no line, no CLV, grades winner-only with a 0-0 push guard; the null-line refusal in `gradePick` (`grade.ts:42`) plus the 0021 check constraint keep a priced market from ever settling at an invented zero — tested (`grade.test.ts:71-77`).

---

## Notes on N4 (silent grader errors), for whoever fixes it

Every read in the grading pass destructures `{ data }` only: snapshots (`jobs-core.ts:457-460`), predictions (`:481-486`), picks (`:511-515`), bets (`:543-548`). Failure modes: (a) transient fetch failure → `data` null → that entity's pass no-ops → Action green, nothing graded, no signal; (b) `line_snapshots` fetch failure specifically → `snapsByGame` empty → every close is null → results *are* written with `clv = null`, and since the pick/bet rows now have `result` set they are **permanently excluded** from re-grading — unlike predictions, there is no later CLV backfill path for picks/bets; (c) `.in("game_id", finalIds)` grows with every final of the season (~800 by December) inside a GET URL, a size-dependent failure that will first appear late-season and be swallowed by (a)/(b). Cheapest fix: `if (error) throw` on all four reads; the job already reports failures loudly.

---

## For 00-SUMMARY.md

- **P1 — N1 (bug, silent):** SQL vs JS half-point snapping disagree on negative quarter-point means (−3.25 → −3.5 vs −3.0): phantom ±0.5 CLV on unmoved lines and inconsistent line display between slate and game page. One-line rounding fix + test in `src/lib/consensus.ts` (or the SQL sites). **Fix: S.** (`0021:207`, `0015:23`, `consensus.ts:29`)
- **P1 — N2 (design, silent):** no closing-line burst Thu/Fri (or ≥ 05:30 UTC Sat): weeknight closes are 1.5–5 h stale and used silently, starting Week 1 (Sep 4 Friday games). Fix: add burst crons for Thu/Fri evening UTC windows (+ optionally extend Sat). **Fix: S.** (`jobs.yml:56-57`)
- **P2 — N4 (bug, silent):** grading path swallows all Supabase read errors; a failed snapshot fetch permanently grades a week without CLV while the Action stays green. Fix: throw on error in four places. **Fix: S.** (`jobs-core.ts:457,481,511,543`)
- **P2 — N3 (bug, silent):** postseason picks/bets/predictions never grade (`season_type='regular'` filter shared with the ratings replay). Deadline-relevant only in December, but a one-query fix now. **Fix: S–M.** (`jobs-core.ts:349-356`)
- **P2 — N5 (design):** stale/absent close is never surfaced; only a receipts tooltip exists for the null case. Fold into N2's fix or add a staleness cutoff (e.g. null CLV when the close predates kickoff by > N hours, with a reason). **Fix: M.**
- Historical items all verified fixed: CLV sign inversion (Aug 7, zero rows graded pre-fix — confirmed against production), moneyline grading (Aug 9), `SNAPSHOT_COLS` pinning, units→ROI→CLV ordering. The dead edge function retains the inverted formula deliberately (`supabase/functions/jobs/index.ts:530-537`) — fine as long as nobody revives it without reading `CHANGELOG.md:555-557`.
