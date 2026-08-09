# 02 — Model & CLV, with worked numbers

## 1. Lookahead: traced, and clean

This was the highest-stakes thing to check, so here is the trace rather than a
verdict.

`replaySeason` (`scripts/lib/replay.ts:213-354`) is the only thing that produces
backtest predictions. Its inputs, each with the timestamp at which it became
knowable:

| Input | Source | Knowable before week N? |
|---|---|---|
| `priors` (season 1) | `priorsFromSp(data.prevSp)` where `prevSp = cfbd.spRatings(season − 1)` (`replay.ts:115`) | ✅ prior-season final SP+ |
| `priors` (seasons 2–3) | `chainPriors(finalRatings)` from the previous replay | ✅ our own chain |
| `tilts` | `subTiltsFromSp(prevSp)` / `chainTilts` | ✅ prior season only |
| `offense`/`defense` running state | mutated in the update loop | ✅ **see below** |
| `vegasSpread` | `consensusLine(lines)` from `cfbd.lines(season)` | ⚠️ **see §2** |
| `effMargin` | `advancedGameStats(season)` per game | ✅ applied only in that game's own post-hoc update |

The structural guarantee is the two-pass loop at `replay.ts:242-342`. Every
game in week N is priced into `weekPredictions` first (lines 252–311); only then
does a second loop apply `updateSubRatings` (lines 313–342). So no week-N result
— not even from an earlier Saturday kickoff in the same week — can reach a
week-N prediction. `blendWithPrior` at line 259 reads the `offense`/`defense`
maps as they stood after week N−1.

**The one revised-rating exposure is bounded and correct.** `cfbd.spRatings(y)`
returns SP+ *as it stands today*, not as it stood in August of year y+1. SP+ is
revised. But it is used only for the 2023 bootstrap prior and for preseason
off/def *shape* — never for an in-season update, and the tuners score on
`SCORED = SEASONS.slice(1)` (`backtest.ts:60`), which deliberately excludes the
bootstrap year for this reason. The residual bias is a slightly-too-good 2023
prior, which cannot flatter 2024–25 results.

**The team already found and fixed the sharpest version of this bug.**
`docs/CHANGELOG.md:102-112` documents that `eloRatings(year, week)` is POST-week-N
and that joining on the same week produced "MAE 9.44 against a market at 11.98
— beats Vegas by 2.5 points." `warnIfTooGood` and a negative-coefficient check
now fire on both signatures. That is the correct institutional response and it
is the reason I believe the rest of the trace.

**Verdict: no lookahead leakage.**

## 2. The one place the backtest measures something harder than reality

`consensusLine()` reads CFBD `/lines[].spread`, which for a completed season is
the **settled** number. So the backtest's edge is detected against, and graded
against, the closing line — the hardest possible benchmark, and not a price
anyone could have bet.

This is not a defect: `backtest.ts:194-199` states it in the report header
verbatim, and `--diagnose-edges` prices the same flags against `spreadOpen`,
which *is* bettable. It is called out here only because it is the thing an
auditor is supposed to flag, and the honest answer is "already handled, in
writing."

## 3. The model gate has one hole, and it is `team_hfa`

`AGENTS.md`: *"Every parameter in `DEFAULT_PARAMS` is either fitted by a
`backtest.ts --tune-*` flag or sits at an identity default that reproduces the
previous version exactly."*

`teamHfaBlend: 0.5` (`ratings.ts:158`) is neither.

`replaySeason` prices every game with `homeTeamHfa: params.baseHfa`
(`replay.ts:270`) and updates with `hfa: params.baseHfa` (line 329). The
backtest has **never once** evaluated a per-team HFA. Meanwhile production
prices with `hfa.get(team_id)` from `team_hfa` (`jobs-core.ts:410,753`).

The arithmetic, from the repo's own recorded numbers:

```
docs/CHANGELOG.md:568  →  team_hfa averages 3.607 = 0.5·raw + 0.5·2.3
                       →  mean raw_hfa = 4.914

--tune-hfa (CHANGELOG.md:75):
   baseHfa 2.3  →  mean signed error +0.74 ± 0.33 SE   (2.2 SE from zero)
   baseHfa 3.0  →  mean signed error +0.03             ← the fitted, unbiased value

Production today:            0.5 × 4.914 + 0.5 × 2.3 = 3.607   (+0.61 vs fitted)
Production after the rebuild: 0.5 × 4.914 + 0.5 × 3.0 = 3.96   (+0.96 vs fitted)
```

Read the last two lines together. The `preseason-refresh` cron
(`jobs.yml:90`) runs every morning through Aug 27 and will apply `baseHfa = 3.0`
the first day CFBD publishes 2026 talent. **When the gated HFA fix finally
reaches production, it will move the average home team from 0.61 points too
strong to 0.96 points too strong.** The fix makes the bias worse, because the
parameter it corrects is one of two terms and the other term is broken.

Why the estimator is hot — `build-preseason.ts:405-419`:

```ts
for (let year = 2015; year <= 2024; year++) {
  const games = await cached(`games-${year}`, () => cfbd.games(year), true);
  //                                                 ^ classification defaults to "fbs"
  ...
  homeMargins.get(g.homeId).push(margin);      // team's margin at home
  awayMargins.get(g.awayId).push(-margin);     // team's margin away
}
const raw = clamp((h - a) / 2, 0, 6);
```

`(h − a)/2` is the right estimator **only if home and away schedules are
comparable in strength.** In college football they emphatically are not: FBS
teams play nearly all of their guarantee games at home. `h` therefore carries a
pile of +38s that `a` has no counterpart for, and the statistic measures
*home advantage + home-schedule softness*. The `clamp(…, 0, 6)` then truncates
the left tail only, nudging the mean up again. A true FBS HFA is ~2.5–3.0; this
returns 4.91.

§2.3 actually specifies "2015–2024 home/away margin **residuals**" — residuals
against a rating, which is exactly the correction that removes the schedule
term. The code computes raw margins.

**Smallest safe change** (does not require re-running any tuner, because it
provably cannot move the league mean):

```ts
// build-preseason.ts, replacing lines 511-524
const raws = fbs.map(t => rawFor(t)).filter((v): v is number => v !== null);
const rawMean = raws.reduce((a, b) => a + b, 0) / raws.length;
for (const team of fbs) {
  const raw = rawFor(team);
  // Team HFA is a DEVIATION from the league value, never a level: baseHfa is
  // the fitted number and nothing here is allowed to shift it.
  const centred = raw === null ? 0 : clamp(raw - rawMean, -1.5, 1.5);
  const blended = DEFAULT_PARAMS.baseHfa + DEFAULT_PARAMS.teamHfaBlend * centred;
  hfaRows.push({ team_id: team.id, raw_hfa: raw && r2(raw), blended_hfa: r2(blended) });
}
```

Mean `blended_hfa` becomes exactly `baseHfa` by construction, so the tuned bias
of +0.03 is preserved, and Boise/Laramie still price differently from
Nashville. Then teach `replaySeason` to accept an HFA map so the next
`--tune-hfa` measures what production actually runs, and record it in the
changelog per the gate.

## 4. Other model checks against §2

| Spec rule | Code | Verdict |
|---|---|---|
| `error = actual_capped − predicted` | `ratings.ts:382-384` caps **both** | Divergence, undocumented. Only bites past ±28. |
| Margin cap ±28 | `marginCap: 28` | ✅ |
| K 0.15–0.20, tune | `kFactor: 0.3`, fitted | ✅ fitted above the spec's guess, recorded |
| Prior decay 100/50/15/5 at wk 0/4/8/12 | `priorDecayKnots` | ✅ exact |
| Luck: ±1–3 pts | `luckCorrection` clamps ±3 | ✅ |
| Churn ±6 | `churnAdjustment` clamps ±6 | ✅, and honest that the "defence" input never existed |
| FCS two buckets −25/−35 | `fcsTopRating`/`fcsOtherRating` **never read**; jobs use a flat `-30` | ❌ F-24 |
| Neutral site HFA = 0 | `priceGame:556`, `updateSubRatings:425` | ✅ |
| New FBS entrants from talent alone | `preseasonRating:224-227` | ✅ |
| Win prob `1/(1+e^(−0.145·spread))`, validate | slope fitted to `1.7/σ` = 0.101 | ✅ fitted, better than the spec's guess |
| σ fit in backtest | `marginSigma: 16.8` | ✅ |
| Team HFA blended 50/50 | present but unvalidated and biased | ❌ **F-02** |
| Per-team tempo | hardcoded `70` at 8 sites | ❌ F-19 |
| Weather in pricing | not implemented | ❌ F-09 |
| Consensus flag (model+SP+FPI+Elo) | `priceGame:583-589`, fed real values since `system_ratings` | ✅ |
| Every prediction carries `model_version` | `predictions.model_version not null`, written at `jobs-core.ts:768` | ✅ |

### Edge cases, checked

- **Week 1 with no results.** `priorWeight(1) = 0.875`, `offense`/`defense`
  maps empty → `blendWithPrior(pOff, pOff, 1)` = `pOff`. Clean, no NaN.
- **FCS opponent.** `priors.get()` undefined → `{overall: -30, off: -15,
  def: -15}` and the `priors.has()` guards at `jobs-core.ts:415,419` stop FCS
  ratings from ever being written back. Correct — but see F-24 on the bucket.
- **Blowout.** Overall capped at ±28; each side's scoring error capped at
  `marginCap/2 = 14` (`ratings.ts:428`) so the summed cap matches. The invariant
  `homeOff + homeDef delta ≡ overall delta` holds. Verified by reading; also
  covered by `ratings.test.ts`.
- **Missing data.** `qbReturns: null → 0` (no signal, not a penalty);
  `talentBaseline: null` disables the reload interaction. Both correct.
- **0–0 final.** `gradePick` returns `push` for straight-up (`grade.ts:38`) —
  good defensive choice against a bad feed.

### Test coverage, ranked by blast radius

| Untested path | Blast radius |
|---|---|
| `freezeJob` end-to-end | **Highest.** Writes the append-only receipts. No test constructs a week and asserts the rows. F-06 is exactly the kind of bug a test would have caught. |
| `ratingsUpdateJob` grading + CLV | **Highest.** Writes `result`, `payout_units`, `clv` for every wager. No test. `clv.test.ts` covers the pure sign math (well — four worked cases in bettor's terms) but nothing covers the job that calls it. |
| `bets` RLS / void trigger | **High.** 90 db assertions exist; **zero touch `bets`**, `profiles` column grants, or `predictions` immutability. F-01 lives in exactly that gap. |
| `refresh-lines` week pointer | High — F-03. |
| `build-preseason` HFA block | High — F-02. |
| Route rendering | Medium — F-21. |

`ratings.test.ts` (461 lines) and `slate.test.ts` (499) are genuinely good. The
gap is uniform: **pure functions are well tested, the jobs that call them are
not tested at all.** Every S0/S1 in this report is in the untested half.

---

## 5. CLV — sign convention, worked four ways

`src/lib/clv.ts` is the single implementation. Spreads are home-perspective
everywhere (negative = home favoured). Worked examples, each stated in bettor's
terms first:

**Favourite, spread.** You lay Michigan (home) −3. It closes −6. You laid three
where the close lays six — you got the better number, so CLV must be positive.
```
spreadClv("home", −3, −6) = lineTaken − close = (−3) − (−6) = +3   ✓
```

**Dog, spread — the classic sign trap.** You take the away side of a home −3, so
you hold **+3**. It closes home −6, i.e. the close offers **+6**. You took three
where the close gives six — you got the worse number, so CLV must be negative.
```
spreadClv("away", −3, −6) = flip((−3) − (−6)) = flip(+3) = −3     ✓
```
This is the one the prompt flagged as the classic poisoner, and it is right.

**Over, total.** You buy the over at 50. It closes 54. You bought four points
cheaper than the close.
```
totalClv("over", 50, 54) = close − lineTaken = 54 − 50 = +4        ✓
```

**Under, total.**
```
totalClv("under", 50, 54) = flip(54 − 50) = −4                     ✓
```

**Moneyline.** Not computed. `jobs-core.ts:577-582` grades the result and leaves
`clv` null, with the reason stated in the code: no closing price is captured.
`ml_home`/`ml_away` **are** captured on every snapshot
(`refresh-lines.ts:80-81`) and `consensusFromSnapshots` already returns
`mlHome`/`mlAway`, so the cents CLV §5.3 promises is roughly a 2-hour change —
`(closeCents − takenCents)` in the direction of the side, using the standard
`-110 → +100` conversion for crossing zero. Leaving it null is the honest
current state; it is also low-hanging.

**Model CLV.** The model does not bet, so its side is the direction of its
disagreement: `edge = model_spread − market_spread`, and negative edge means the
model likes home more than the market did.
```
Model spread −7, market at freeze −4  →  edge = −7 − (−4) = −3  →  "home" side
Closes at −6
modelClv(−3, −4, −6) = spreadClv("home", −4, −6) = (−4) − (−6) = +2
```
+2 = the market moved two points toward the model after it committed. Correct.
`modelClv` returns null for `edge === 0` — a model that agreed took no side, and
banking a 0 would read as "dead even" (`clv.ts:79`). Right call.

**`-0` handling.** `flip()` maps 0 → 0 rather than −0 (`clv.ts:38`), because −0
reaches `numeric(5,2)` and renders as "−0.00". Small, correct, and the kind of
detail that says someone actually looked at the output.

**Overall: the CLV sign convention is right in all six cases.** Given the repo's
own history here — `docs/CHANGELOG.md:518` records the sign being inverted in
all four branches of `jobs-core.ts` with no test on any of them — this is
now the best-defended piece of arithmetic in the codebase.

## 6. Where CLV is *not* safe

The formula is right. Its input is not.

1. **The closing line has no freshness contract (F-05).** `closing()` returns
   the last snapshot before kickoff with no age attached. For Thursday and
   Friday games there is no burst poll at all, so "the close" is whatever the
   22:00 UTC refresh caught — up to 6 hours early. It renders identically to a
   4-minute-old capture.
2. **A pinned week pointer stops capture entirely (F-03),** at which point every
   subsequent game's CLV is silently null.
3. **The half-point rounding mismatch injects phantom CLV (F-07).** Worked:
   two books at −3.0 and −3.5, mean −3.25.
   ```
   make_pick (Postgres round, half away from zero)  → line_at_pick = −3.5
   grader   (JS Math.round, half toward +∞)         → close        = −3.0
   spreadClv("home", −3.5, −3.0) = −0.5
   ```
   The market never moved. The bettor is charged half a point of negative CLV.
   Because the mismatch is sign-dependent it hits home favourites only and does
   not average out — it is a systematic drag on exactly the side most bets are
   on, and it feeds League Rule #5's tiebreak.

Fix all three before the first Sunday grading run, because CLV is the metric the
edge investigation elevated to *the* scoreboard. A wrong CLV is worse than no
CLV: it looks like evidence.

## 7. Half-points, pushes, voids

- **Snapping.** Both consensus implementations snap to the half point, so a
  push on 3 or 7 is reachable. This was a real backtest bug once — an unsnapped
  multi-book mean made `coverMargin === 0` unreachable and genuine pushes were
  scored W or L at random (`docs/CHANGELOG.md:615`). Fixed, and `replay.ts:171`
  carries the explanation. Good.
- **Pushes.** `gradePick` (`grade.ts:48,53`) returns `push` on exact zero;
  `tally()` counts pushes in the record, excludes them from `staked`, and
  contributes 0 units. That is League Rule #4 implemented correctly, in one
  place, which is more than was true a week ago.
- **Voids.** `tally()` skips them entirely. Correct as a rule — and the exact
  mechanism F-01 exploits, because nothing constrains *when* a void may be
  created.
- **Postponed/cancelled.** Not handled at all (F-04). The rule is in `/rules`
  and in the spec; there is no code.
