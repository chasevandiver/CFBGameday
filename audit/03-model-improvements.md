# Workstream 03 — Model Improvements

**Scope:** what model work is worth doing, ranked by expected accuracy gain per hour, against a
20-day clock (today 2026-08-09, Week 0 Aug 29). Sources read in full: `docs/CHANGELOG.md`
(decisions table), `scripts/backtest.ts` (all twelve `--tune-*` flags plus `--diagnose-edges`),
`scripts/lib/replay.ts`, `src/model/ratings.ts`, `scripts/build-preseason.ts`,
`scripts/lib/jobs-core.ts`, `docs/SPEC.md`, `audit/AUDIT-2026-08.md`. I could not run the
backtest here (no `CFBD_API_KEY`); every number quoted below is from the changelog/code
comments, and every proposal names the tuner command and a pre-registered decision rule per
the `AGENTS.md` gate.

**Summary.** The headline of this workstream is a number that already exists: the encompassing
regression (`--diagnose-edges`) measured **b₁ = 0.035 (t=0.84) for the model vs 0.987 (t=22.81)
for the market, n=2611** — the honest weight on this model, once the closing line is known, is
about **3.4%**. That is the requester's seed idea #1 (edge shrinkage / β₂), already run, and its
answer is "β₂ ≈ 0". Half the remaining seed ideas were also already run and rejected with
numbers (ensemble, EPA, early-σ widening, coaching); they are reported below, not re-proposed.
Of what is genuinely open, almost none of it is accuracy work worth doing before Aug 29 —
**with β₂ ≈ 0.034, a point of model MAE is worth ~0.03 points of priced spread**, so the next
20 days should protect correctness, not chase accuracy. Three items qualify, and the first is a
real new finding: the per-team HFA table production prices with is inflated ~+1.9 points at the
mean by an opponent-mix confound (FCS buy games are home games), which will reintroduce a
**≈ −0.9 signed home bias** the moment the preseason refresh loads — larger than the +0.74 bias
the `--tune-hfa` fix just removed, and invisible to the backtest because the replay never
exercises `team_hfa` at all.

---

## Findings table

| ID | Severity | Type | Status | One-line | Evidence |
|---|---|---|---|---|---|
| M-1 | **P1** | Spec divergence (spec says residuals; code uses raw margins) | **NEW** | `team_hfa` raw estimate is confounded by home-slate strength (FCS buy games); mean raw ≈ 4.91 vs fitted true HFA 3.0 → post-refresh production will over-predict home sides by ≈ 0.9 pts; backtest never tests this path | `scripts/build-preseason.ts:514-523`, `scripts/lib/replay.ts:270,329`, `docs/SPEC.md:81`, `docs/CHANGELOG.md:567` |
| M-2 | **P1** | Design weakness | **NEW** | Cover prob is still the raw normal-CDF number (62% on a 5-pt edge) on the same page that states measured reality is 49.2% — the one surviving surface that prices the model at weight 1.0 instead of 0.034 | `src/model/ratings.ts:581`, `src/app/edges/page.tsx:58,123-128`, `src/app/game/[id]/page.tsx:539-543` |
| M-3 | P2 | Design weakness | **STILL OPEN** (partially built) | Residual-diagnostics table (seed #4): signed error exists only as one pooled number + week segments; no fav/dog, spread-bucket, neutral, conf/non-conf, FCS-opponent, or rest splits — the +0.74 class of bug is only catchable by exactly this print | `scripts/backtest.ts:97-102,152-178`, `scripts/lib/replay.ts:152-157` |
| M-4 | P2 | Design weakness | **STILL OPEN** | Tempo is a hardcoded 70 everywhere, so `tempoFactor ≡ 1` — the one totals term that is fully plumbed but dead, while totals trail the market by ~0.5 MAE | `scripts/lib/replay.ts:256,261`, `scripts/lib/jobs-core.ts:745`, `scripts/build-preseason.ts:544`, `src/model/ratings.ts:564` |
| M-5 | P3 | — | **STILL OPEN** | Opener-CLV (+0.27, positive in every bucket vs the OPENER) is the one real residual signal from the edge investigation; `open_spread` is stored per prediction but no surface aggregates CLV against it | `docs/CHANGELOG.md:93-96`, `scripts/lib/jobs-core.ts:783-787` |
| M-6 | P3 | — | **STILL OPEN** | `priorDecayKnots` are spec-asserted, never tuned (no `--tune-decay` exists); `priorRatingWeight`/`talentWeight` ARE fitted (0.70/0.30, `--tune-prior`) | `docs/CHANGELOG.md:49-50`, `src/model/ratings.ts:161-166`, `scripts/backtest.ts:268-317` |
| M-7 | P3 | — | **STILL OPEN** | Heteroscedastic σ vs spread magnitude / projected total (seed #3) is distinct from the rejected week-based widening and untested — but its only consumers are cover_prob and win-prob tails | `scripts/backtest.ts:418-456`, `src/model/ratings.ts:176` |
| M-8 | P3 | — | **STILL OPEN** (likely reject) | Margin-cap alternatives (seed #8): untested; note the double-capping function (`updateFromResult`) is dead in every production path — the live cap is the per-side ±14 clamp in `updateSubRatings` | `src/model/ratings.ts:381-387,429-430`; usage grep: only tests import `updateFromResult` |
| M-9 | P3 | Spec divergence (magnitudes asserted, never fit) | **STILL OPEN** | Situational adjustments (seed #7) ARE applied in production (admin-confirmed `rating_adjustments`), but the spec's rest/travel/QB magnitudes are asserted, the replay hardcodes 0, and no tuner exists | `scripts/lib/jobs-core.ts:675-679,747,791`, `scripts/lib/replay.ts:272`, `docs/SPEC.md:82-86` |
| M-10 | — | — | **FIXED-verified** | Off/def sub-ratings are real since 2026.3.0 (seed #5): per-side opponent-adjusted scoring-error updates, exact off+def ≡ overall invariant, tilt-carried preseason shape; remaining crudeness is tempo (M-4) and no garbage-time handling | `src/model/ratings.ts:421-438`, `scripts/lib/replay.ts:226-237,313-342` |
| M-11 | — | — | **ANSWERED — do not re-run** | Seeds #1 (edge shrinkage), ensemble, EPA, σ-widening, coaching, tilt-carry, HFA, churn, market baseline: all nine gated experiments already carry their numbers | `docs/CHANGELOG.md:67-97` |

---

## 1. The already-answered ledger (seed ideas that were experiments, not ideas)

The requester's prompt was written before PR #12. Nine gated experiments ran, each with a
pre-registered rule (`docs/CHANGELOG.md:67-97`). Report the number; do not re-propose:

| Seed idea | Already run as | The number | Verdict |
|---|---|---|---|
| #1 Edge shrinkage / β₂ | `--diagnose-edges` | **b₁ = 0.035 (t=0.84) vs market b₂ = 0.987 (t=22.81), n=2611**; honest blend weight w ≈ 0.034; flagged edges 49.2% ATS vs close (n=1801); all five pre-registered tier tests (totals, thin/thick, conf/non-conf) failed at the Bonferroni bar | **β₂ ≈ 0. Edges demoted to information**; ¼-Kelly removed (`3380392`). A 10-pt "edge" is worth ~⅓ pt of fair line. |
| #10 Market-blend baseline | Same run | Market margin MAE **11.98** vs model **13.27** | Already the product's stated frame — `/edges` and `/game/[id]` print the 49.2% and t=0.84 verbatim (`src/app/edges/page.tsx:55-67`, `src/app/game/[id]/page.tsx:555-558`). The one inconsistency left is cover_prob (M-2). |
| Blend SP+/Elo | `--tune-ensemble` | True holdout 0.138 vs pre-registered bar 0.15; 50/50 with weekly Elo **−0.069** vs ours alone; prior-SP+ t=0.43 | Rejected. The apparent gain was an intercept (the HFA bias), not information. |
| Per-play efficiency | `--tune-epa` | Best case **0.010 MAE**; NLL degraded monotonically 0.5005 → 0.5095 | Rejected. Full reasoning at `src/model/ratings.ts:110-130`. |
| Widen early σ | `--tune-sigma` | Weeks 1–4 NLL **0.3972 → 0.3992** (worse) | Rejected. Early residuals are cupcake blowouts, not directional uncertainty. |
| Coaching penalty | `--tune-coaching` | Optimum pinned at grid edge (−2.5, then −5); slope inert | Unconverged; identity-shipped (`newHcIntercept`/`Slope` = 0). |
| Preseason tilt carry | `--tune-preseason-tilts` | λ=0.4: wks 1–2 totals MAE **13.34 vs 13.72** | Shipped (`PRESEASON_TILT_CARRY=0.4`). |
| HFA | `--tune-hfa` | Bias **+0.74 ± 0.33 → +0.03** at 3.0; NLL 0.5005 → 0.4994 | Shipped — and this fitted zero-bias point is exactly what M-1 threatens. |
| Churn | `--tune-churn` | Old setting 0.3968 — worse than no churn (0.3964); shipped 6/1.0 interior point | Shipped as a bug fix. |
| #9 prior weights | `--tune-prior` | Carryover **0.70/0.30** fitted | Fitted. The decay *knots* are not (M-6). |

**For 00-SUMMARY, the one sentence:** *the model's honest weight against the closing line is
0.034 (t=0.84 vs the market's 22.81, n=2611) — so the product's value is disagreement-selection,
CLV, and presentation honesty, and further margin-accuracy work is worth ~3% of its face value.*

---

## 2. M-1 — the team-HFA table will silently undo the HFA fix (NEW, P1, pre-Aug-29)

**What the code does.** `build-preseason.ts:513-523` estimates each team's raw HFA as

```
raw = clamp( (avg home margin − avg away margin) / 2 , 0, 6 )     // 2015–2024, non-neutral
blended = 0.5·raw + 0.5·baseHfa
```

**What the spec says.** SPEC §2.3 (`docs/SPEC.md:81`): "each team's historical HFA … computed by
a one-time backfill job over 2015–2024 home/away margin **residuals**." Residuals are
opponent-adjusted; raw margins are not. That divergence is not cosmetic:

**The confound, with arithmetic.** For team *i*,
`(h − a)/2 = (HFA_i + avg host HFA)/2 + (avg away-opponent rating − avg home-opponent rating)/2`.
The second term is zero only if home and away slates are equally strong. They are not: FBS teams
host their buy games. One FCS opponent (≈ −30 rating) among seven home games drags the mean
home-opponent rating down by ≈ 30/7 ≈ 4.3 points → inflates `raw` by ≈ **+2.1** — for every
FBS team, every year, in one direction.

**The observed number agrees.** Production `team_hfa` (built at baseHfa 2.3) averages **3.607**
(`docs/CHANGELOG.md:567`). Invert the blend: mean raw = (3.607 − 0.5·2.3)/0.5 = **4.914**. The
fitted true FBS-average HFA is **3.0** (`--tune-hfa`). So the raw estimator carries ≈ +1.9 of
schedule composition dressed as venue advantage — matching the FCS mechanism above.

**What happens at the preseason refresh.** The daily `preseason-refresh` job re-emits `team_hfa`
from baseHfa 3.0 the day CFBD publishes 2026 talent (any day through Aug 27). Mean blended
becomes 0.5·4.914 + 0.5·3.0 = **3.96** — a full point above the fitted zero-bias 3.0. From the
`--tune-hfa` table, bias moves ≈ −1.0 per +1 HFA (2.3 → +0.74; 3.0 → +0.03). Extrapolated:
mean signed error ≈ +0.03 − 0.96 ≈ **−0.93** — home teams over-predicted by ~0.9 points on
every priced game, *larger than the +0.74 bias the fix removed, in the opposite direction*.

**Why no report will catch it.** The backtest replay uses flat `params.baseHfa` in both pricing
(`scripts/lib/replay.ts:270`) and learning (`replay.ts:329`); production uses the blended
`team_hfa` in both (`scripts/lib/jobs-core.ts:753` pricing, `jobs-core.ts:410` rating updates).
Every published calibration number describes a model production does not run. MAE barely moves
(a 0.9 shift on σ=16.8 is ~0.03 MAE), so only a signed-error print on *production* predictions
would ever show it. Silent failure, on the brand-is-calibration product.

**Fix (S, must land before the refresh goes green — effectively now):** center the raw estimate
so the blend's mean is the fitted parameter by construction:

```
blended = baseHfa + teamHfaBlend · (raw − mean(raw over FBS))
```

one line plus a unit test asserting `mean(blended) ≈ baseHfa`. Optionally also drop games vs
non-FBS opponents from the margin lists (removes the dominant confound at the source, ~5 lines —
this is the spec-compliant direction). Either preserves cross-team variation while pinning the
mean to the only value that was ever validated.

**Test that proves it / seed #6 answered.** The cross-team component itself (`teamHfaBlend=0.5`,
provenance "Spec §2.3" — ad hoc, not empirical-Bayes, no shrinkage by sample size, asymmetric
clamp `[0,6]` that forbids a negative HFA) has **never been tested**: extend `replaySeason` to
accept an optional `hfaByTeam` map built point-in-time (years < season), then judge it exactly
as `--tune-hfa` judges (bias ± SE, MAE, worst calibration bucket — `scripts/backtest.ts:687-724`).
Pre-registered rule: per-team HFA ships only if bias stays within ±0.15 of zero AND NLL is not
worse than flat 3.0 AND the worst bucket doesn't grow. **Abandon** (set `teamHfaBlend = 0`, an
identity to flat baseHfa) if centered per-team HFA cannot beat the flat value it is blended
with — a real possibility, since (h−a)/2 over ≤10 years is ~35 home games of noise per team, and
the whole cross-team spread of true HFA is believed to be ±1–2 points.

---

## 3. M-2 — cover_prob is the last surface priced at weight 1.0 (NEW, P1/P2, pre-Aug-29, S)

Seed #2 asked for an empirical edge→cover mapping. The regression already answers what that
mapping would return: with w = 0.034, essentially 50% everywhere. The open problem is that the
UI still shows the weight-1.0 number.

**Worked example.** Model margin +10, market home −5. Edge = −10 − (−5) = −5 → BIG_EDGE.
`homeCoverProb = 1 − Φ(5; μ=10, σ=16.8) = 1 − Φ(−0.298) = 0.617` (`src/model/ratings.ts:581`).
The `/edges` row prints "**62%** HOME" (`edges/page.tsx:123-128`) — three lines under a header
that says these flags went **49.2%** against the close (`edges/page.tsx:58`). Same number on
`/game/[id]` ("Cover prob", `game/[id]/page.tsx:539-543`). One page, two contradictory
probabilities; a reader must decide which one the site believes.

**Fix options (either is S):**
- **Reprice off the shrunk fair line** the gate itself prescribes (`backtest.ts:1330-1335`):
  fair = 0.034·model + 0.966·market → fair margin 5.17 → cover prob = Φ(0.17/16.8) = **50.4%**.
  Honest, and visibly consistent with the 49.2% sentence next to it.
- **Drop the stat** from `/edges` rows and the game page, as the stake was dropped.

I recommend dropping it: a column that reads 50.1–50.9% for every game is honest but is also a
column of noise, and the page already states the base rate in words. **Test:** none needed
beyond unit tests — the shrinkage constant is the already-measured w; do NOT fit a fresh
empirical curve (that is a new gated experiment with no consumer to justify it).
**Abandon-condition for ever re-promoting cover_prob:** a future `--diagnose-edges` run where b₁
clears t > 2 — the same gate that demoted it.

---

## 4. M-3 — the residual-diagnostics table (seed #4), P2, pre-Aug-29 preferred, S–M

**What `report()` already prints** (`scripts/backtest.ts:74-225`): pooled mean signed error ± SE
flagged past 2 SE (`:97-102`); MAE/σ/NLL by week segment (`:152-178`); win-prob calibration
buckets; totals MAE split wks 1–4 / 5+; disjoint edge-bucket ATS. Conference/non-conference and
thin/thick-market splits exist only inside `--diagnose-edges` (`:1386-1417`), as gate tests, not
signed-error prints.

**What's missing vs the seed list:** signed error by favorite/underdog, by spread-magnitude
bucket, by neutral site, by conference game, by FCS-opponent games, by rest differential;
P4/G5 needs a conference join (`CfbdGame` carries no conference names, `src/lib/cfbd.ts:93-112` —
either join `cfbd.teams` or skip that one split). Everything else is already on
`ReplayPrediction` (`neutralSite`, `conferenceGame`, `startDate`, `homeId/awayId` —
`scripts/lib/replay.ts:152-157`); FCS-opponent needs one boolean added at `replay.ts:255`
(`!priors.has(...)` is already computed there); rest days derive from each team's previous
`startDate` within the season.

**Why this ranks above every accuracy idea:** the changelog's own methodology section
(`docs/CHANGELOG.md:112-117`) says the +0.74 home bias survived a full calibration pass because
MAE and σ are symmetric, and surfaced only by accident. A signed-error-by-slice table is the
generic detector for that entire bug class, it runs automatically on every model-touching PR
(`backtest.yml`), and it is the instrument M-1's fix would be verified with. ~2–4 hours, pure
reporting, no gate needed (no parameter moves). **Abandon:** n/a — this is instrumentation; the
only failure mode is slices too small to read, so print n and SE per row and suppress rows with
n < 100.

---

## 5. M-4 — real tempo, the one plumbed-but-dead totals term (P2, in-season OK, M)

Seed #5's "what's still crude" answer: the sub-ratings are real (M-10) but **tempo is a constant
70 in every path** — `replay.ts:256,261`, `jobs-core.ts:745` (freeze), `jobs-core.ts` rating rows,
`build-preseason.ts:544` — so `tempoFactor = (70+70)/140 ≡ 1` in `priceGame`
(`src/model/ratings.ts:564`) and the `TeamRating.tempo` field does nothing. Totals model MAE
13.09 trails the market by ~0.5 (`audit/AUDIT-2026-08.md:36`); pace is the most obvious missing
term, and the per-game plays data is *already cached* by the backtest
(`advanced-{season}` via `offense.plays`, `replay.ts:85-90,119`).

**Sketch:** per-team plays/game estimated from prior weeks (shrunk toward 70 by the same
prior-weight schedule), carried alongside off/def in the replay and the ratings job; preseason
seeds from prior-season pace × a carry factor (the tilt-carry pattern). Margin is provably
untouched: `price.margin` comes from overall ratings (`ratings.ts:557-558`), not from the
projected scores, so this is a totals-only experiment by construction — same clean separation
that made the tilt sweep decidable.

**Test:** a new `--tune-tempo` flag replaying with pace active. Pre-registered rule (mirror the
tilt rule, `backtest.ts:546-550`): adopt only if all-weeks totals MAE improves by ≥ 0.10 AND
weeks 1–2 is not worse by > 0.05 AND margin MAE moves < 0.01 (assert it, like
`MARGIN_DRIFT_TOLERANCE`). **Abandon** if the gain is < 0.10 — that is the EPA lesson's size
threshold — or if the fitted shrinkage wants the boundary (unidentified). Not before Aug 29:
it needs a `MODEL_VERSION` bump, a preseason re-emit, and there is no slack to re-run the
freeze-path verification this month for ~0.1 totals MAE the market already prices.

---

## 6. M-5 — the opener question, answered in-season with data, not a strategy (P3, S)

The one real residual from the edge post-mortem: vs the **opening** line the 4+ bucket went
51.8% with **avg CLV +0.27, positive in every bucket** (`docs/CHANGELOG.md:93-96`) — the market
drifts toward the model after the opener, just not by the ~1 point −110 needs. Can an
opener-timing read be tested in-season? Yes, and cheaply, because the plumbing exists:
`freezeJob` stores `open_spread` on every prediction (`jobs-core.ts:783-787`) and the Sunday
grader writes `close_spread`/`clv` (migration `0019`).

**Sketch:** add an opener-relative CLV aggregate to Receipts (model-side CLV measured
open → close, bucketed by |edge vs opener|), alongside the existing freeze-relative CLV. Pure
read-side; no model change, no gate. **Pre-registered rule, fixed now before any 2026 data
exists:** this becomes a strategy conversation only if avg CLV vs the opener ≥ **+1.0** points
(the changelog's own break-even estimate) sustained over n ≥ 200 model leans — i.e. roughly
mid-October at the earliest. **Abandon** if 2026 in-season CLV vs the opener is ≤ +0.3 by
n=200 — that replicates the backtest and confirms the close absorbs it. Caveat worth printing on
the surface: CFBD's `spread_open` is when-the-book-posted, not a bettable timestamped price, so
even a pass is evidence, not a wager.

---

## 7. The rest of the seed list, briefly (all P3; none before Aug 29)

- **M-6, decay knots (seed #9):** `priorDecayKnots [0,1.0][4,0.5][8,0.15][12,0.05]` provenance
  is "Spec §2.2" (`docs/CHANGELOG.md:50`) — asserted, never tuned; no `--tune-decay` exists.
  Cheap to grid (same cost as `--tune-hfa`), but K=0.3 was fitted *conditional on* these knots,
  so a knot change re-opens K — the "change one thing; judge on everything" trap
  (`docs/CHANGELOG.md:124-127`). Rule if run: ΔNLL ≥ 0.003 (the anchors bar) with MAE and the
  worst calibration bucket not worse. Expected gain: small; five parameters in this
  neighborhood already ran to boundaries or flat surfaces.
- **M-7, heteroscedastic σ (seed #3):** distinct from the rejected week-based widening —
  σ as a function of |predicted margin| or projected total is untested. It is a rescoring-only
  test (the `tuneSigma` pattern, `backtest.ts:418-456`: no re-replay needed, ~1 hour). But its
  only consumers are cover_prob (being demoted/repriced in M-2) and the 0.9+ win-prob bucket,
  which the calibration table already shows within ~2 pts. Run it, if ever, as part of M-2's
  follow-up; rule: NLL improves overall AND in the 0.9–1.0 bucket. **Abandon** if the fitted
  slope of σ on |margin| is indistinguishable from 0 at 2 SE.
- **M-8, margin-cap shape (seed #8):** a smooth shrink (e.g. `cap·tanh(m/cap)`) vs the hard
  clamp is untested and cheap to grid. Two facts lower its priority: (a) the double-capping
  question from workstream 2 targets `updateFromResult` (`ratings.ts:381-387`, clamps prediction
  AND actual) — that function is **dead in production**; every live path (replay, ratings job,
  edge function) uses `updateSubRatings`, whose live cap is the per-side ±`marginCap/2` error
  clamp (`ratings.ts:429-430`) and which does not clamp the expectation. (b) `marginCap` sits in
  a parameter neighborhood where every fitted surface came back flat. Rule if run: NLL −0.003;
  **abandon** on a flat surface, per the churn lesson (`docs/CHANGELOG.md:129-132`).
- **M-9, situational adjustments (seed #7):** answered — they ARE applied in production
  (`adjFor` sums admin-confirmed `rating_adjustments` into `situationalPoints`,
  `jobs-core.ts:705-711,747`; stored in the prediction's `adjustments` jsonb, `:791`), but every
  magnitude is spec-asserted (`docs/SPEC.md:82-86`: QB −5..−7, rest ±1–2, travel −1) and the
  replay hardcodes 0 (`replay.ts:272`), so nothing has ever validated them. Rest differential
  and travel distance ARE derivable from repo data (per-team previous `startDate`; `venues`
  lat/long/timezone are ingested, `build-preseason.ts:454-467`), so a `--tune-rest` is feasible.
  Expected value: low — rest/travel are the most efficiently priced situational factors in the
  market, and the coaching experiment showed how confounded schedule-adjacent terms fit
  (unconverged, boundary-pinned). Rule if run: coefficient |t| > 2.5 (Bonferroni, matching
  `TIER_T`) on 2023–25 AND holdout NLL not worse. **Abandon** at boundary-pinning or a
  sign that flips between seasons. The near-term risk is different and small: an admin entering
  a spec-magnitude QB adjustment (−6) this season injects a never-validated number into frozen
  predictions — worth one sentence in the admin UI, not a model change.
- **Changelog's own untested list** (pass/rush splits, special teams, QB modeling from player
  PPA — `docs/CHANGELOG.md:713-714`): these are "build a different rating system" items, as the
  EPA post-mortem itself concludes (`ratings.ts:121-129`). Each is weeks, not hours, and the
  payoff is capped by the same 0.034: even closing the full 1.3-pt gap to the market would move
  the honest fair line by ~0.04 points per point of edge. Offseason work, if ever.

---

## 8. Recommendation and ranking (expected accuracy gain per hour, deadline-weighted)

**Default recommendation: agree with the brief's prior.** With 20 days to Week 0 and β₂ ≈ 0.034,
model-accuracy work is **not** where the next hour goes. The exceptions are the three items that
protect correctness rather than chase accuracy:

| Rank | Item | When | Size | Why it clears the bar |
|---|---|---|---|---|
| 1 | **M-1** center/de-confound `team_hfa` | **pre-Aug-29 — before `preseason-refresh` goes green (~Aug 26 at the latest)** | **S** (fix) + M (optional validation) | Prevents reintroducing a ≈ −0.9 signed bias the moment the refresh loads; the fix window closes when CFBD publishes talent |
| 2 | **M-2** drop or reprice cover_prob | pre-Aug-29 | **S** | Removes the last weight-1.0 surface; makes `/edges` internally consistent |
| 3 | **M-3** signed-error slice table in `report()` | pre-Aug-29 preferred (it verifies M-1) | **S–M** | Generic detector for the bug class that produced +0.74; runs free in CI forever |
| 4 | M-5 opener-CLV aggregate on Receipts | in-season (data exists after Week 1 grading) | S | Answers the one live open question with a pre-registered threshold |
| 5 | M-4 `--tune-tempo` | in-season (Sep) | M | Only genuinely promising accuracy idea; totals-only by construction |
| 6 | M-7 σ vs magnitude | in-season, only alongside M-2 follow-up | S | Cheap; low ceiling |
| 7 | M-6 decay knots; M-9 rest/travel; M-8 cap shape | in-season / never | S each | Cheap but expected ≈ 0; each carries its abandonment rule above |

Everything above respects the `AGENTS.md` gate: no `DEFAULT_PARAMS` value moves without its
tuner run and a changelog row — including the "no" results.

---

## For 00-SUMMARY.md

- **P1 (S fix + M validation): `team_hfa` is inflated ~+1.9 at the mean by FCS-buy-game
  scheduling** (`build-preseason.ts:514-523` uses raw margins where SPEC §2.3 says residuals;
  prod mean 3.607 at base 2.3 ⇒ raw mean 4.91). The imminent preseason refresh rebuilds it at
  base 3.0 ⇒ mean ≈ 3.96 vs the fitted zero-bias 3.0 ⇒ **≈ −0.9 home-side bias on every priced
  game**, invisible to the backtest because the replay never uses `team_hfa`
  (`replay.ts:270,329`). Center the blend (`baseHfa + 0.5·(raw − mean raw)`) **before the
  refresh loads (~Aug 26 deadline)**.
- **P1 (S): cover_prob still prices the model at weight 1.0** — `/edges` shows "62%" cover prob
  (normal CDF, `ratings.ts:581`) beside its own "49.2% vs the close" disclaimer
  (`edges/page.tsx:58,123-128`). Drop the stat or reprice off the shrunk fair line (w=0.034).
- **Context line for the exec summary:** `--diagnose-edges` measured the model's honest weight
  against the closing line at **0.034 (t=0.84 vs market t=22.81, n=2611)** — seed idea #1 was
  already run and the answer is β₂ ≈ 0; accordingly this workstream recommends **no
  accuracy-chasing model work before Aug 29**, only the two correctness items above plus a
  signed-error diagnostics table (P2, S–M) that would have caught both this bias class and the
  original +0.74.
