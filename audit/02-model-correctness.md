# Workstream 2 — Model correctness

**Auditor scope:** `src/model/ratings.ts`, `scripts/lib/replay.ts`, `scripts/backtest.ts`,
`scripts/build-preseason.ts`, `scripts/lib/jobs-core.ts`, the three test files, plus every
UI consumer of the edge/consensus sign conventions. All files read in full; all claims
re-derived from the code on `main` as of 2026-08-09. I could not run the backtest (no
CFBD key in this environment); everything here is static analysis, and §2c states what
that cannot prove.

**Summary.** The big early-August hypotheses are mostly **fixed and the fixes are real**:
the replay carries genuine off/def sub-ratings, push detection works on a half-point-snapped
consensus, the edge was re-measured and then demoted to information, signed-error and
per-bucket calibration are printed, and nine tuners exist with pre-registered rules. The
sign convention `edge = model_spread − vegas_spread` (negative → model likes HOME) is
implemented consistently in the model, the jobs, CLV, receipts, and the slate — **except
in two user-facing places found by this audit**: the Edges page prints an away-side lean
with the home-perspective sign (`edges/page.tsx:132`), and the game page's Systems table
negates `systemMargin` into home-positive convention while its own footnote and the Model
row in the same table use the market convention (`game/[id]/page.tsx:255,599,609,618-619`).
Both are silent, both ship wrong numbers on real Week 1 games, both are small fixes.
The largest *structural* items still open: the backtest's prior chain is not the
production prior process (so K/HFA/σ were fitted under a different preseason than the one
production runs), team-specific HFA has never been validated by any replay, and the
consensus flag compares neutral-field system margins against an HFA-inclusive market line —
a ~3-point asymmetric bias that suppresses home-side consensus and inflates away-side
consensus.

---

## Findings table

| ID | Severity | Type | Status | One-line | Evidence |
|----|----------|------|--------|----------|----------|
| M-01 | **P1** | Bug | **NEW** | Edges page "Model lean" prints away-side leans with the home-perspective sign (shows "AWAY −4.5" when the bettor holds +4.5) | `src/app/edges/page.tsx:130-133` |
| M-02 | **P1** | Bug | **NEW** | Game page Systems table renders SP+/FPI/Elo margins home-positive while the Model row and the table's own footnote use market convention — two conventions in one table | `src/app/game/[id]/page.tsx:255,598-599,608-609,615-620` |
| M-03 | P2 | Design weakness | **STILL OPEN** | Consensus flag compares neutral-field system margins to an HFA-inclusive line: home consensus needs systems to clear line+HFA (~3 pts harder), away consensus fires ~3 pts easier | `scripts/lib/jobs-core.ts:719-725`, `src/model/ratings.ts:584-589` |
| M-04 | P2 | Design weakness | **STILL OPEN** | Backtest prior chain (`chainPriors` = 0.7×finals, nothing else) ≠ production prior (SP+ blend + talent + churn + coaching + luck); K/HFA/σ/slope fitted under the simpler process; tuners use 3 different chains among themselves | `scripts/lib/replay.ts:396-400`, `scripts/backtest.ts:1585-1592,692-698`, `scripts/build-preseason.ts:103-131,258-303` |
| M-05 | P2 | Design weakness | **STILL OPEN** | Team-specific HFA (`team_hfa`, blended, used in production pricing *and* production rating updates) is validated nowhere — the replay uses flat `baseHfa` for both | `scripts/lib/replay.ts:270,329`, `scripts/lib/jobs-core.ts:410,753`, `scripts/build-preseason.ts:511-524` |
| M-06 | P2 | Bug (test gap) | **NEW** | No test pins the lookahead ordering in `replaySeason`; a reordering regression would pass the whole suite silently | `scripts/lib/replay.test.ts` (all), `scripts/lib/replay.ts:242-342` |
| M-07 | P2 | Spec divergence | **STILL OPEN** | §2.3 situational adjustments: only the manual admin path exists (applied at freeze, magnitudes asserted, never validated); weather/rest/travel never touch pricing; replay always passes 0 | `scripts/lib/jobs-core.ts:705-711,747`, `scripts/lib/replay.ts:272`, `docs/SPEC.md:82-86` |
| M-08 | P2 | Design weakness | **STILL OPEN** (documented) | Reported tuning numbers are in-sample (grid on 2023–25, report on 2023–25) except the ensemble holdout and the pre-registered edge gate; one in-sample number (49.2%) is user-facing, but as a claim *against* the model | `scripts/backtest.ts:57-61,1595-1600,1603-1635`, `src/app/edges/page.tsx:55-60`, `src/app/receipts/page.tsx:168-174` |
| M-09 | P3 | Bug (dead code) | **NEW** | `fcsTopRating −25` / `fcsOtherRating −35` are dead parameters — every live path (replay, jobs, preseason build) prices FCS at a flat −30; the declared two-bucket scheme never executes | `src/model/ratings.ts:171-172`, `scripts/lib/replay.ts:25,256`, `scripts/lib/jobs-core.ts:28,393,742-744`, `scripts/build-preseason.ts:610-612` |
| M-10 | P3 | Bug (dead code) | **MISREAD** (function dead) | `updateFromResult` double-caps as hypothesized (worked below) but is in no live update path — replay and jobs both use `updateSubRatings`, which behaves *differently* in exactly the >cap regime | `src/model/ratings.ts:381-387,421-438`; consumers: tests only |
| M-11 | P3 | Bug (dead code) | **FIXED-verified** (demotion) / **NEW** (residue) | Stake removed from all UI and messaged consistently; but `suggestedStake` + its test survive in the model file as dead code | `src/model/ratings.ts:616-622`, `src/model/ratings.test.ts:286-292`, `src/lib/slate.ts:469-488` |
| M-12 | P3 | Bug (stale doc) | **NEW** | `run()`'s comment says "no preseason tilt — matches production", but production's `TILT_CARRY` defaults to 0.4 since 2026.4.0; the headline report's totals numbers are computed without the tilt production ships | `scripts/backtest.ts:1579-1585`, `scripts/build-preseason.ts:75` |
| M-13 | — | — | **FIXED-verified** | Replay sub-ratings: real off/def carry the season (2026.3.0, PRs #9–11); tempo constant 70 in replay *and* production — consistent, spec's per-team tempo simply unbuilt (P3 spec-div) | `scripts/lib/replay.ts:230-237,313-342`, `scripts/lib/jobs-core.ts:384-441` |
| M-14 | — | — | **FIXED-verified** | Edge measurement + push detection: consensus snapped to half points, disjoint edge buckets, bet-line/grade-line separable via `gradeAts(lineOf)` | `scripts/lib/replay.ts:165-179`, `scripts/backtest.ts:184-259` |
| M-15 | — | — | **FIXED-verified** | Signed-error reporting exists (`bias ± SE`, flagged past 2 SE); K=0.3 and HFA=3.0 are interior on the current grids | `scripts/backtest.ts:93-103,1612-1613` |
| M-16 | — | — | **NEVER TRUE** | "winProbSlope imposed analytically with no empirical check" — the slope is imposed (1.7/σ) but per-bucket predicted-vs-actual win rate is printed on every run and `--tune-hfa` tracks worst-bucket miss | `scripts/backtest.ts:78-89,706-714` |
| M-17 | — | — | **HARMLESS** (argued) | `teamIdsByNameFrom` built from all seasons is not a leak: it maps names→stable numeric ids and carries no outcome information | `scripts/lib/replay.ts:431-440` |
| M-18 | — | — | **FIXED-verified** | Post-week Elo contamination: ensemble lags Elo one week; `warnIfTooGood` + negative-coefficient check exist — but note both are console warnings in one tuner, not CI failures (see §2c) | `scripts/backtest.ts:785-797,871-877,938-948` |

Context item owned by another workstream but load-bearing here: **production still serves
ratings 2026.2.0** — pre-HFA-3.0, pre-churn-fix, `team_hfa` derived from 2.3 (avg 3.607).
Everything in this report describes the code; none of the 2026.4.0 fixes reach a user until
the `preseason-refresh` gate goes green. If `--check` is still red ~Aug 26, that becomes
the P0 of the launch.

---

## 2a. Backtest ↔ production divergence

### 2a-1. Prior generation — STILL OPEN (M-04)

`chainPriors` is the entire prior process of the default replay and of `--tune`:

```ts
// scripts/lib/replay.ts:396-400
for (const [teamId, rating] of finals) priors.set(teamId, 0.7 * rating);
```

That is 0.7 × replay finals, regressed toward **zero**. Production
(`build-preseason.ts:103-131, 251-303`) builds:

```
base  = 0.5·replay_final + 0.5·final_SP+          (REPLAY_SHARE, line 120)
prior = 0.7·base + 0.3·talent + churn + coaching + luck   (preseasonRating, ratings.ts:222-229)
```

regressed toward **talent**, with churn (±6), luck (±3), coaching (currently 0), and a
0.4 tilt on the halves. Worked example, an Alabama-shaped team (replay final +20, final
SP+ +22, talent +16, churn −2, luck −1):

- production prior = 0.7·(0.5·20 + 0.5·22) + 0.3·16 − 2 − 1 = 14.7 + 4.8 − 3 = **16.5**
- backtest prior = 0.7·20 = **14.0**

Difference 2.5 pts on one team; a week-1 matchup pairing a high-talent/high-churn team
against a low-talent one can differ by **3–5 points of predicted margin**, decaying with
`priorWeight` (still ×0.5 at week 4). The parameters that ship in `DEFAULT_PARAMS` — K,
baseHfa, marginSigma, winProbSlope — were selected under the 14.0-style prior:
`--tune` (`backtest.ts:1585-1592`) and, critically, **`--tune-hfa`, which set
baseHfa 3.0** (`backtest.ts:692-698`), both chain via bare `chainPriors`. Meanwhile the
tuners that *did* model richer priors each use a different chain: `--tune-prior` uses
`w·rating + (1−w)·talent` (299-305), `--tune-churn`/`--tune-coaching` use
`0.5·replay + 0.5·SP+` plus talent (1071-1094, 613-621), and none includes coaching or
luck. So there is no single replayed configuration that is the production preseason.

**Recommendation (a): make the backtest match production.** Add a `--production-chain`
mode that builds each season's priors exactly as `build-preseason.ts` does (SP+ blend,
talent, churn from cached returning-production, luck from prior-season games) and re-print
the report — *not* to refit before Aug 29 (20 days is not enough to re-litigate K/HFA
responsibly), but to know how far the shipped σ and calibration drift under the real
prior. Fix-size M. Until then, treat weeks 1–4 win/cover probabilities as softer than the
report claims.

### 2a-2. Sub-ratings — FIXED-verified (M-13)

The hypothesis (`{offense: overall/2, defense: overall/2}`) is dead. `replaySeason` seeds
halves from priors (+ optional tilt) and updates them with `updateSubRatings`
(`replay.ts:232-237, 313-342`); production's `ratingsUpdateJob` does the same walk from
the stored week-0 halves (`jobs-core.ts:384-441`). The off+def ≡ overall invariant is
tested (`ratings.test.ts:332-337`) and the totals re-validation number (13.09 vs
constant-57's 13.72) matches the code comment at `jobs-core.ts:774-776`.

**Tempo:** still a hard constant — `tempo: 70` in the replay (`replay.ts:256,261`), the
jobs (`jobs-core.ts:393,398,437`), and the build (`build-preseason.ts:545`), so
`tempoFactor ≡ 1` in `priceGame` (`ratings.ts:564`). Backtest and production agree, so the
totals calibration is honest *for this model* — but spec §2.1's "tempo estimate
(plays/game) for each team" does not exist, and the `(home.tempo + away.tempo)/140`
machinery is decorative. Spec divergence, P3; fine for launch.

### 2a-3. HFA — STILL OPEN (M-05)

The replay prices **and updates** with flat `params.baseHfa`
(`replay.ts:270` pricing, `replay.ts:329` update). Production prices with
`team_hfa.blended_hfa` (`jobs-core.ts:753` freeze, `build-preseason.ts:627` week-1 batch)
**and also learns with it** (`jobs-core.ts:410` passes team HFA into `updateSubRatings`).
`team_hfa` is a 2015–24 home/away residual estimate, raw clamped 0..6, blended 50/50 with
baseHfa (`build-preseason.ts:511-524`), so blended values span **1.5–4.5** — up to ±1.5 pts
of pricing divergence per game from the validated flat-3.0 configuration, and a second,
smaller divergence in how ratings evolve. No tuner sweeps `teamHfaBlend`; the replay
cannot even represent per-team HFA. Two extra wrinkles:

- The production DB's current `team_hfa` rows average 3.607, consistent with 0.5·raw +
  0.5·**2.3** — the pre-fix baseHfa. Until the preseason refresh lands, production HFA is
  neither the validated flat 3.0 nor the intended blend.
- `--tune-hfa`'s zero-bias argument was made under flat HFA; a 50/50 blend with a clamped
  raw estimate does not necessarily preserve mean HFA = 3.0 across the slate.

**Recommendation (a), fix-size S/M:** teach the replay to take a `hfaOf(teamId)` and run
the report twice (flat vs the build's own team_hfa map, which `build-preseason` can emit
for past seasons from cached games). If team HFA does not beat flat 3.0 on bias/MAE/
calibration, drop to (c): ship flat baseHfa and stop writing team-specific rows. Given the
deadline, running the validation is cheaper than the migration to remove it.

### 2a-4. FCS — hypothesis mostly NEVER TRUE; dead params are the real finding (M-09)

The feared "backtest −30 vs production −25/−35" split does not exist: **every** live path
uses flat −30 — replay (`replay.ts:25,256`), jobs pricing and updates
(`jobs-core.ts:28,393,742-744`), preseason week-1 batch (`build-preseason.ts:610-612`).
So Week 0/1 FCS games are priced by exactly the branch the backtest exercises. The bug is
the opposite one: `fcsTopRating: -25` / `fcsOtherRating: -35`
(`ratings.ts:83-84,171-172`) are **parameters nothing reads** — the spec §2.1 two-bucket
scheme was never implemented, and the params table advertises knobs that don't execute.
FCS teams are correctly excluded from updates in both paths (`priors.has(...)` guards,
`replay.ts:334-341`, `jobs-core.ts:415-421`). Fix-size S: delete the two params (and the
spec row), or implement the buckets and validate; do not leave declared-but-dead
parameters in `DEFAULT_PARAMS`, which `AGENTS.md` presents as the fitted-or-identity set.

### 2a-5. Situational adjustments — STILL OPEN (M-07)

The replay passes `situationalPoints: 0` always (`replay.ts:272`). Production applies them
in exactly one place: `freezeJob` sums admin-**confirmed** `rating_adjustments`
(home − away, `jobs-core.ts:705-711,747`) into `priceGame`. The §2.3 magnitudes (QB out
−5..−7, rest ±1–2, travel −1) are conventions for the admin to type, not numbers any
backtest has seen; the frozen row stores `adjustments: {situational}` (`jobs-core.ts:791`)
so at least the receipt is auditable. Weather ("wind >15mph reduces total 3–6") is **not
implemented anywhere in pricing** — `weatherJob` stores forecasts, the UI shows a wind
badge, and no total is ever adjusted. Rest/travel likewise have no code path.

Verdict: cover probabilities on adjusted games use a σ that never saw adjustments —
asserted, not validated. Given (a) is impossible (no historical injury data) and (b) means
deleting a human-in-the-loop feature the spec wants, recommend **(c)-lite**: keep the
admin path, but surface the adjustment on the game page next to the model spread ("incl.
−5 QB adj") so an adjusted number is never mistaken for a pure model output, and log each
season's adjustments so next August someone can check whether they helped. Fix-size S.

---

## 2b. Estimation methodology

**In-sample tuning (M-08).** `--tune` grid-searches K × HFA on 2023–25 by NLL, refits σ
on the same predictions, and prints the report on the same three seasons
(`backtest.ts:1603-1635`). Every `--tune-*` scores in-sample too, with three mitigations
that are real but partial: the bootstrap season is excluded from tuner scoring
(`SCORED = SEASONS.slice(1)`, line 57-61), `--tune-churn` prints per-season NLL of the
winner to expose one-season carries (1104-1121), and `--tune-ensemble` fits on 2023–24
with 2025 as a true holdout (829-833) after the earlier fake-holdout was caught. The edge
gate ran with pre-registered rules and Bonferroni-corrected tiers (1469-1475). Nothing
walk-forward exists.

Are in-sample numbers surfaced to users as expectations? The only backtest numbers in the
UI are 49.2% ATS and the 52.4% break-even (`edges/page.tsx:55-60`,
`receipts/page.tsx:168-174`) — used *against* the model, so the in-sample optimism runs in
the safe direction. Cover prob and win prob are displayed per game; they inherit the
in-sample σ. Acceptable for launch; note it on the Receipts explainer eventually.

**Grid coverage (M-15).** K grid `[0.2, 0.25, 0.3, 0.35, 0.4]`, HFA grid to 4.0
(`backtest.ts:1612-1613`). Shipped K=0.3 and HFA=3.0 are **interior**. The changelog's
K=0.4 boundary belonged to the rejected joint refit; the boundary-warning habit is now in
the tuners themselves (`--tune-coaching` 639-645, `--tune-churn` 1122-1124).

**Objective (M-16 partly).** `--tune` selects on win-prob NLL alone, but the report every
run prints carries margin MAE, signed bias ± SE, totals MAE vs market vs constant-57,
per-week-segment σ, per-bucket win-prob calibration, and disjoint-bucket edge ATS
(`report()`, 74-225). The per-tuner decision rules do use the wider set — `--tune-hfa`
explicitly targets "zero bias without growing MAE or the worst bucket miss" (720-723).
The one gap: margin-vs-line (the product's stated concern) enters decisions only through
`--diagnose-edges`; the plain `--tune` could still pick an NLL winner that degrades edge
behavior — which is exactly what the changelog says the joint refit did, and why it was
caught by hand. The multi-metric print is the guard; there is no automated multi-metric
rule.

**winProbSlope (M-16).** `1.7/σ = 1.7/16.8 = 0.1012` ≈ the stored 0.101. The logistic is
checked against empirical win rate by margin-derived probability bucket on every run
(`backtest.ts:78-89`); the changelog's "within ~2 pts every bucket" is a claim about that
table. The hypothesis that no empirical check exists is **NEVER TRUE**. (The spec's
0.145 slope at §2.3 corresponds to σ≈11.7 and was rightly superseded by the fit.)

**Double-capping in `updateFromResult` (M-10).** The function does clamp both:

```ts
// ratings.ts:382-384
const capped = clamp(g.actualHomeMargin, -p.marginCap, p.marginCap);
const cappedPrediction = clamp(g.predictedMargin, -p.marginCap, p.marginCap);
const error = capped - cappedPrediction;
```

Worked: predicted +35, actual +28 → capped 28, cappedPrediction 28, error **0**, no
update. Single-capping would give error 28 − 35 = −7 → homeDelta = 0.3·(−7)/2 = −1.05.
So under double-capping, a >28-point favorite that wins by 28+ generates *zero*
information, and one that wins by 20 is penalized for −8, not −15 — top-team ratings decay
more slowly than a naive reading suggests, and can never *gain* from a capped-out game
(error = min(actual,28) − 28 ≤ 0 whenever prediction ≥ cap).

**But the function is dead in every pipeline.** Both the replay (`replay.ts:321-333`) and
production (`jobs-core.ts:402-414`) update through `updateSubRatings`, which caps each
side's *scoring error* at ±14 and does **not** cap the expectation
(`ratings.ts:426-437`). Re-run the example there: expHome 48, expAway 13 (margin +35),
actual 41–13 → errHome = clamp(−7) = −7, errAway = 0 → overall home delta = −1.05. The two
functions disagree exactly in the >cap regime; the documented invariant is careful to say
"whenever the caps don't bind" (`ratings.ts:412-419`), and the shipped/validated behavior
is `updateSubRatings`'s. Recommendation: delete `updateFromResult` (and its two tests) or
mark it test-fixture-only, so nobody re-introduces it believing it is *the* update.

---

## 2c. Lookahead leakage (adversarial)

**Ordering proof.** In `replaySeason`, for each week the prediction pass runs first
(`replay.ts:252-311`): `blended()` reads `offense`/`defense` maps at lines 259-260 and
predictions are pushed at 285-309. The **only** mutation of those maps in the entire
function is the second pass at lines 313-342 (`offense.set`/`defense.set` at 335-336 and
339-340), which begins only after `weekPredictions` for that week is complete. Weeks
iterate in ascending sorted order (line 241). Therefore week-N predictions are a function
of the priors plus results of weeks < N. `cfbd.games` defaults to
`seasonType: "regular"` (`src/lib/cfbd.ts:283-287`), so postseason week numbers cannot
collide into the walk. **Proven, for the code as written.**

**`homePoints !== null` filtering** (`replay.ts:244`): excludes never-completed games from
both prediction and update. Selection is on *completion*, not outcome, and matches
production (which updates from `status === "final"` rows, `jobs-core.ts:368-370`). The
excluded set is cancellations, which are voided bets in reality; over 2023–25 this is a
handful of games. No survivorship distortion of the calibration numbers.

**SP+ fetch.** `loadSeason` fetches `spRatings(season − 1)` only (`replay.ts:115`) —
legitimately available before the season. The tuners that touch same-season SP+
(`sp-${season}`) use it exclusively to build *season+1* priors
(`backtest.ts:346-347,401-402,613,1071`), which is point-in-time sound. No path feeds
current-season SP+/FPI into a past-week prediction. The Elo contamination guard exists as
documented: the ensemble joins Elo lagged one week with the week-1 fallback to the prior
season's last Elo (`backtest.ts:785-797`), the negative-own-coefficient check prints at
871-877, and `warnIfTooGood` (938-948) fires when any variant's MAE beats the market's
11.98. What the guard *actually is*: a `console.log` heuristic tripwire on the ensemble
tuner's outputs — it does not verify inputs, does not run on the main report, and cannot
fail CI (`backtest.yml` runs the plain report; the edge gate is explicitly informational).
A subtle leak that costs less than 1.3 MAE points would not trip it.

**`cfbd.lines(season)`** returns the stored (settled) per-book lines; `consensusLine`
averages `l.spread` and snaps to half (`replay.ts:171-174`). So the default edge and the
main ATS table measure against the **close** — the code says so in so many words
(`backtest.ts:184-191`), and `gradeAts(lineOf)` makes bet-line vs grade-line separable,
with `--diagnose-edges` re-running flags against `vegasOpen` (1424-1465). The ATS number
means "did the model beat the hardest benchmark", and the one real positive finding
(+0.27 CLV vs the opener) is correctly framed. **FIXED-verified** (M-14).

**`teamIdsByNameFrom` from all seasons** (`replay.ts:431-440`): builds name→id from every
loaded season's games. Argument for harmless: the map's values are CFBD's stable numeric
team ids; knowing in 2023 that a name string maps to an id is administrative, not
predictive — no score, rating, or line flows through it. The only conceivable effect is
*coverage*: a team whose name spelling only appears in a later season would get its SP+
prior matched where a point-in-time build might miss it. That changes which teams get a
bootstrap prior, not what any prior knows about the future. Harmless (M-17).

**What a leak would require here, and would the tests catch it?** Structurally, a leak
needs one of: (1) the update pass hoisted above the prediction pass (or `blended()` made
to read post-update state); (2) same-season future data blended into `priors` between
seasons of a tuner chain; (3) a same-week join of an external rating (the Elo shape).
(2) and (3) live in tuner code where the discipline is comments plus the two warnings.
For (1): **`replay.test.ts` would not catch it.** Its tests pin tilt invariance,
cap-binding drift, and chaining helpers — every one of them passes identically if week-N
results contaminate week-N predictions, because both arms of each comparison would be
equally contaminated. There is no test of the form "perturb week-N scores, assert week-N
predictions unchanged," and that test is ~15 lines against the existing fixture
(**M-06, P2, fix-size S**). I could not run a deliberately-leaking variant to demonstrate
end-to-end (no API key); the ordering proof above is static and the test gap is the honest
residual risk.

---

## 2d. Edge, consensus, sign conventions

**The convention, worked.** `priceGame`: margin = home − away + HFA + situational
(`ratings.ts:557-558`); `modelSpread = −margin`; `edge = modelSpread − vegasSpread`
(575-577). Model likes home by 9.3 → modelSpread −9.3; Vegas −4.5 →
edge = −9.3 − (−4.5) = **−4.8** → negative → model likes **HOME**.
homeCoverProb = 1 − Φ((−vegasSpread − margin)/σ) = 1 − Φ((4.5 − 9.3)/16.8) =
1 − Φ(−0.286) = **0.612 > 0.5** ✓. Test agrees (`ratings.test.ts:243-249`).

**Every consumer audited:**

| Consumer | Reads edge as | Verdict |
|---|---|---|
| `slate.ts:482-488` `modelSideOf` | `edge < 0 → "home"` | ✓ |
| `slate.ts:357-372` `modelPicks.atsSide` | `edge < 0 → home` (falls back to `spread − marketSpread`, same convention) | ✓ |
| `slate.ts:545-550` `MoveRead.vsModel` | `edge < 0 → home`; delta<0 = market toward home | ✓ |
| `chips.tsx:26-46` `EdgeChip` | displays `|edge|`; signed value only in `title` | ✓ (unsigned display) |
| `GameCard.tsx:908,960-967` | flag + `atsSide` label, no line attached | ✓ |
| `jobs-core.ts:788-790` freeze | stores `price.edge` raw | ✓ |
| `clv.ts:74-81` `modelClv` | `edge < 0 → "home"` side into `spreadClv` | ✓ (worked in tests) |
| `receipts/page.tsx:65-84` | `edge < 0 → home`; cover grade `(margin + vegas_spread) > 0 === home` | ✓ |
| `game/[id]/page.tsx:262-264,559-566` | `modelSideOf`; lean line negates spread for away side (line 563) | ✓ |
| **`edges/page.tsx:130-133`** | **"Model lean" prints `sideTeam.abbr fmtSpread(marketSpread)` with NO side flip** | ✗ **M-01** |

**M-01 worked:** market home −4.5, model margin +2 → edge = −2 − (−4.5) = +2.5 > 0 →
model likes **AWAY**; the away backer holds **+4.5**. The page renders
`AWAY −4.5` — the wrong side of the number, on the page whose entire job is the number.
The fix already exists as `lineForSide` (`slate.ts:80-84`) — this is the "sixth copy" the
Aug 9 changelog entry warned about, in the one file that didn't get the call. Note the
adjacent "Cover prob" cell (line 126) *does* flip (`1 − coverProb` for away), so the two
cells on one card can disagree about which side is being described. P1, fix-size S.

**M-02 worked:** `systemMargin` returns `to(away) − to(home)` — **market convention**,
tested as such (`rating-scales.test.ts:24`: home 10, away 3 → −7). `GameCard`'s
SystemsRow uses it raw, next to the model spread in the same convention — consistent
(`GameCard.tsx:986-1005`). But the game page negates it:
`const margin = -(systemMargin(system, h, a) ?? 0)` (`game/[id]/page.tsx:255`), then
renders `{home.abbr} {fmtSpread(r.margin)}` (line 599) → SP+ home 10 / away 3 displays
"**HOME +7.0**" — while the Model row two lines down (line 609) prints `prediction.spread`
→ "**HOME −9.3**", and the footnote (618-619) declares "margins are in the market's
convention (negative = HOME favored)". Same table, opposite conventions, footnote true for
one row. A reader applying the footnote concludes SP+ likes the away team when it likes
home by 7. P1, fix-size S (drop the negation; the `?? 0` is unreachable and can go too).

**Consensus flag (M-03).** `priceGame` demands every system present and strictly
same-signed vs `vegasMargin = −vegasSpread`, dirs ≠ 0 (`ratings.ts:584-589`): nulls
**suppress** the flag (`.every(s => s !== null && s !== undefined)` — a missing system
means no flag, never a silent pass) ✓; agreement is strict ✓. The build-preseason batch
passes no systems, so its `consensus_flag` is always false — suppression, not error ✓.
Call-site units: only `freezeJob` computes them — `sysMargin = h − a` in points, Elo
divided by 25 (`jobs-core.ts:719-725`), matching `priceGame`'s "positive = home better"
contract and the one conversion constant (`rating-scales.ts:38`, ensemble
`backtest.ts:808-811`) ✓.

**But HFA is not consistent.** The model's `margin` includes HFA + situational; the market
line includes the market's HFA; `sysMargin` is a **neutral-field** difference. Worked:
all four systems believe home is 6 better neutral, HFA 3 → fair line −9. Market hangs
−6.5 (vegasMargin 6.5). Model: 9 − 6.5 = +2.5 → home dir. SP+: 6 − 6.5 = **−0.5 → away
dir** → flag suppressed despite genuine four-system home lean. Mirror case: market −11,
fair −9: model dir −1.5 (away), SP+ 6 − 11 = −5 (away) → flag **fires**, and would have
fired even if SP+'s true HFA-inclusive lean were neutral. Home-side consensus requires
external systems to clear line + HFA (~3 pts harder); away-side consensus is ~3 pts
easier — the flag is asymmetrically biased by ~2·HFA between the two sides, ~6 pts of
spread between the thresholds. The game page Systems table has the same
apples-to-oranges display (neutral margins beside a market spread), compounded by M-02.
Fix: add the game's blended HFA (0 at neutral sites) to each `sysMargin` before the sign
comparison in `freezeJob` — one line per call site — and say "HFA-adjusted" in the
footnote. P2, fix-size S. (Also note: `spPlusMargin` doc comment in `PricingInputs`
(`ratings.ts:506`) says "model-spread convention (positive = home better)" and the
implementation compares against `vegasMargin` correctly — the *convention* is right, only
the missing HFA term is wrong.)

---

## 2e. Bet sizing — demotion FIXED-verified, one residue (M-11)

Grep across `src/` and `scripts/` for stake/Kelly: the only hits are
`src/model/ratings.ts:613-622` (`suggestedStake` itself), its test
(`ratings.test.ts:286-292`), and *comments* explaining the demotion. No page imports it;
`edges/page.tsx`, `game/[id]/page.tsx` and `slate.ts` all carry explicit
"information, not a recommendation" copy with the measured numbers (49.2%, b=0.035
t=0.84 vs 0.987 t=22.81) — the messaging is consistent everywhere I looked, including
Receipts ("CLV is the honest measure here", `receipts/page.tsx:168-174`). `modelSideOf`
(`slate.ts:482-488`) is the replacement and is what both pages render.

Historical context, briefly: for the worked 4.8-pt edge (coverProb 0.612 at −110),
`suggestedStake` would have produced kelly = (0.612·1.909 − 1)/0.909 = 0.185 → quarter
4.6u → **capped 2.0 units** — i.e. the old UI put the max stake on a signal the gate later
measured at 49.2% ATS. Good riddance. Residue: the function and its test still live in
the *model* file, one import away from resurrection by someone who finds it before the
changelog. Delete both, or move behind a `@deprecated — measured dead, see
docs/CHANGELOG.md --diagnose-edges` doc block. P3, fix-size S.

One adjacent note: `cover_prob` is still stored and displayed (game page, edges page).
It is the same σ-based number that used to drive the stake; as displayed information with
the disclaimers it is defensible, but it inherits every caveat in §2a-1/§2a-5.

---

## For 00-SUMMARY.md

- **P1 · M-01 (S):** Edges page "Model lean" shows away-side leans with the home-perspective
  sign (`edges/page.tsx:132`) — route through `lineForSide`; wrong number on the flagship
  edges surface from Week 1.
- **P1 · M-02 (S):** Game page Systems table renders SP+/FPI/Elo home-positive while its
  own footnote and Model row use market convention (`game/[id]/page.tsx:255,599`) — drop
  the negation.
- **P2 · M-03 (S):** Consensus flag compares neutral-field system margins to an
  HFA-inclusive line — ~3 pts asymmetric bias; add blended HFA to `sysMargin` in
  `freezeJob` before the sign test.
- **P2 · M-06 (S):** Add the lookahead regression test (perturb week-N scores ⇒ week-N
  predictions unchanged); currently no test would catch a replay reordering.
- **P2 · M-04 (M):** Backtest prior chain ≠ production preseason process (K/HFA/σ fitted
  under 0.7×finals with no talent/churn/SP+); add a production-chain replay mode to
  measure the drift — document, don't refit, before Aug 29.
- **P2 · M-05 (S/M):** Team-specific HFA is used in production pricing *and* learning but
  validated nowhere; replay it or ship flat baseHfa.
- **P2 · M-07 (S):** Situational adjustments are asserted, not validated, and invisible in
  the UI once applied — display "incl. adj" beside adjusted spreads.
- Context / watch: **production still serves 2026.2.0 ratings with 2.3-derived team_hfa**;
  every model fix above is dark until `preseason-refresh` goes green — if `--check` is
  still red ~Aug 26, that is the launch P0.
- P3 backlog: dead `fcsTopRating/fcsOtherRating` params (M-09, S), dead `updateFromResult`
  double-cap function diverging from the live update in the >cap regime (M-10, S), dead
  `suggestedStake` + test (M-11, S), stale "matches production" comment in `run()` — report
  totals computed without the 0.4 tilt production ships (M-12, S).
