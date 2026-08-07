# The CFB Slate — Change & Decision Log

Running record of what shipped, what was tested and rejected, and why. Companion
to `docs/SPEC.md` (what we're building) and `docs/AUDIT-2026-08.md` (a
point-in-time review).

**The rejections are the point.** Git already records what changed. What git
does not make browsable is that per-play efficiency bought 0.010 points of MAE,
or that blending SP+ and Elo into the rating is *worse* than not doing it. Those
ideas all sound obviously correct and will be proposed again. Each one below
carries the number that killed it.

---

## How to update this

1. **Every shipped change** gets an entry under the dated log, with its commit.
2. **Every gated experiment** gets a row in the decisions table — *especially*
   the ones that failed. A rejection with a number is more valuable than a
   sentence saying it didn't work.
3. **Record the number, not the conclusion.** "NLL 0.3972 → 0.3992" survives
   re-examination; "didn't help" doesn't.
4. **Say what you didn't verify.** Sections reconstructed from git rather than
   done first-hand are marked as such below; keep that habit.

---

## Current state

**`MODEL_VERSION` 2026.4.0** (`src/model/ratings.ts`). Not yet merged to `main` —
lives on `claude/statistical-prediction-model-el0efe` / PR #12.

| Parameter | Value | Provenance |
|---|---|---|
| `kFactor` | 0.3 | Fitted, 2023–25 grid |
| `marginCap` | 28 | Spec §2.2 |
| `baseHfa` | **3.0** | Fitted `--tune-hfa` (was 2.3; see decisions) |
| `teamHfaBlend` | 0.5 | Spec §2.3 |
| `priorRatingWeight` / `talentWeight` | 0.70 / 0.30 | Fitted `--tune-prior` |
| `priorDecayKnots` | `[0,1.0] [4,0.5] [8,0.15] [12,0.05]` | Spec §2.2 |
| `marginSigma` | 16.8 | Fitted σ |
| `winProbSlope` | 0.101 | 1.7/σ |
| `edgeThreshold` / `bigEdgeThreshold` | 2 / 4 | Spec §2.4 — **information only**, not bets |
| `fcsTopRating` / `fcsOtherRating` | −25 / −35 | Spec §2.1 |
| `returningProdWeight` | **6** | Fitted `--tune-churn`, interior point not argmin |
| `talentReloadStrength` | **1** | Fitted `--tune-churn` |
| `priorSigmaExtra` | 0 | **Identity** — tested, rejected |
| `newHcIntercept` / `newHcSlope` | 0 / 0 | **Identity** — unconverged, not shipped |
| `epaWeight` | 0 | **Identity** — tested, rejected |
| `PRESEASON_TILT_CARRY` | 0.4 | Fitted (env var in `build-preseason.ts`) |

"Identity" means the machinery exists and is tested, but reproduces the previous
model exactly. Each is documented in place so it isn't rediscovered.

---

## Decisions log

Nine experiments, each with a decision rule fixed **before** the run. Three
shipped.

| Experiment | Result | Verdict |
|---|---|---|
| `--tune-preseason-tilts` | λ=0.4: wks 1–2 totals MAE **13.34 vs 13.72**; wks 1–4 12.93 vs 13.16. Every SP+-shape variant lost badly (to 16.87). | **Shipped.** Week 0/1 totals became real numbers instead of nulls. |
| `--tune-hfa` | Bias **+0.74 ±0.33 → +0.03** at HFA 3.0; NLL 0.5005 → 0.4994; MAE flat (13.254 → 13.249). | **Shipped.** Model was systematically under-predicting home teams. |
| `--tune-churn` | Old setting scored **0.3968 — worse than no churn at all (0.3964)**. Shipped weight 6 / reload 1.0. | **Shipped as a bug fix.** The gain itself (~0.002 NLL, 0.19 MAE) is inside the ~0.25 SE. The defensible claim is that a harmful setting was removed. |
| `--tune-sigma` | Flat sigma won. Widening made wks 1–4 NLL **worse**, 0.3972 → 0.3992. | Rejected. Early σ is inflated by cupcake blowouts — huge residuals, near-certain winners. That is not directional uncertainty. |
| `--tune-anchors` | ΔNLL **0.0026** vs a pre-registered bar of 0.003. | Rejected, by 0.0004. (Also ran on contaminated week-1 Elo — see below — so it failed *with* an unfair advantage.) |
| `--tune-coaching` | Optimum pinned at the grid edge (−2.5, then −5 after widening). Slope inert: NLL flat across 0/0.15/0.30/0.45. | Rejected — unconverged. A new HC almost always follows a bad season, which the prior already encodes, so the penalty double-counts. |
| `--tune-epa` | Best case **0.010** MAE; NLL degraded monotonically (0.5005 → 0.5095) and early MAE got worse. PPA coverage was fine (1492/1606/1658 games). | Rejected. Swapping the scoreboard margin for a PPA margin still feeds one noisy per-game number into an Elo that already averages a dozen games. |
| `--tune-ensemble` | Pure 50/50 with weekly Elo is **worse than our model alone (−0.069)**. Fitted weights: true holdout 0.138 vs bar 0.15. Prior-season SP+ t=0.43. | Rejected. The apparent gain was an intercept, not information — which is how the home bias was found. |
| `--diagnose-edges` | b₁ = **0.035 (t=0.84)** for our model vs **0.987 (t=22.81)** for the market, n=2611. All five pre-registered tier tests failed (totals, thin/thick market, conference/non-). | Rejected → **edges demoted to information.** `stakeForPrediction` replaced by `modelSideOf`; ¼-Kelly stake removed from the UI. |

### Why edges are not bets

Flagged edges went **49.2%** against the closing line (n=1801, break-even 52.4%).
The market's margin MAE is **11.98** against our 13.27 — when a less accurate
estimator disagrees with a more accurate one, the disagreement is mostly our own
error, so selecting the biggest disagreements selects the games we're most wrong
about. The honest blend weight is 0.034, turning a 10-point "edge" into a third
of a point.

One real but insufficient finding: against the **opening** line the 4+ bucket
went 51.8% with **average CLV +0.27**, positive in every bucket. The market does
drift toward our side after the opener — just not by the ~1 point needed to beat
−110, and the close absorbs it entirely.

---

## Methodology findings

More transferable than any parameter.

**CFBD's `eloRatings(year, week)` is POST-week-N.** Joining on the same week
hands the regression the result of the game it's predicting. It produced t=45 on
Elo, a *negative* coefficient on our own model, and MAE 9.44 against a market at
11.98 — "beats Vegas by 2.5 points". Production was never wrong (at freeze time
`system_ratings` holds last week's Elo), but shipping those fitted weights would
have pushed production toward a relationship that doesn't exist at prediction
time. `warnIfTooGood` and a negative-coefficient check now fire on both
signatures.

**MAE and σ are symmetric and cannot see a systematic lean.** A model
consistently a point light on home teams looks identical to one randomly a point
off either way. A +0.74 bias survived a full calibration pass and surfaced only
because an unrelated ensemble regression kept demanding a +2 intercept. The
backtest now prints mean signed error with its SE, flagged past 2 SE.

**Five parameters ran to a grid boundary** — coaching (−2.5, then −5), reload
(1.0, then 2.0), K (0.4), and nearly HFA. A boundary optimum usually means the
parameter is absorbing a misspecification rather than measuring an effect. This
was the single most reliable diagnostic of the whole effort.

**A single scalar objective is not the model.** The joint K/HFA refit won on NLL
while producing no MAE gain, moving the 0.7–0.8 win-prob bucket from 1.6 to 6.2
points off, worsening totals MAE 13.09 → 13.19, and dropping O/U leans below
50%. Change one thing; judge it on everything.

**Watch for a flat likelihood surface.** Churn scored 0.3940–0.3944 across
weight 6–10 × reload 1–2 — the argmin slid to whichever edge it was given. When
a parameter isn't identified, prefer a defensible interior point over the
minimum.

**Beware the bucket that clears.** With disjoint edge buckets, the 6–10 band came
back 53.5% (n=428) — above break-even. It's noise: one of five buckets,
non-monotonic (48.1 → 53.5 → 48.6), ~1 SE over, and contradicted by a regression
finding no signal. Running the gate *before* the filter hunt is what prevented
shipping it.

---

## Log

### Aug 7 — model correctness and the edge verdict (PR #12, unmerged)

Branch `claude/statistical-prediction-model-el0efe`. First-hand.

**Bugs fixed:**
- `build-preseason.ts` wrote `total`/`home_score`/`away_score` unconditionally,
  but with even off/def halves `priceGame`'s total collapses algebraically to
  **exactly 57.0 for every game**. `hasCalibratedTotals("2026.3.0")` is true, so
  every Week 1 card would have rendered a constant as a prediction. The freeze
  job's `splitInformative` gate is now shared in `src/model/ratings.ts`.
- Prediction rows omitted `season_id`, which Receipts filters on — the batch
  would have silently vanished from the page.
- `freezeJob` had no date horizon, so the Friday 03:00 UTC cron would append a
  full Week 1 batch every August Thursday into append-only `predictions`.
- Churn fed `usage` — an *offense* metric — as "defensive returning production".
  CFBD publishes no defensive counterpart, so offense was double-counted at
  ×5+×5, defense was never modeled, and the ±6 clamp saturated for **28 of 138
  teams**. Alabama carried the second-highest talent in the file and ranked 26th.
- Backtest detected the edge from and graded against the *same* line, and its
  unsnapped multi-book consensus made push detection unreachable (a true push on
  3 or 7 was scored W or L at random).

**Shipped:** offseason idle guard (`scripts/lib/idle.ts`); preseason tilt carry
0.4; churn restructure; `baseHfa` 3.0; edges demoted to information; `/coaches`
client + `scripts/lib/coaching.ts`; `--check` readiness gate; per-week-segment
and signed-error reporting; nine backtest tuners.

| | |
|---|---|
| `8501f86` | Preseason bug fixes, coaching/sigma/tilt machinery, idle-mode polling |
| `ffe5073` | Preseason ranking table + CI preview task |
| `c8e0475` | Fix the edge measurement, then test whether an edge exists |
| `3380392` | Demote edges to information |
| `65f9fce` | Run the gate where it was never run; verify the preseason build |
| `62c5bf9` `60b5cde` `1b83f50` | Churn: double-count found, grid widened, interior point set |
| `1fe9b72` `635c7b4` | EPA blending built, then rejected |
| `f6a6b72` `e4c299d` `f9eab75` `ffcf5ae` `76cadec` | Ensemble: built, lookahead found, holdout corrected, rejected |
| `b7e305e` `379ae0d` | Joint refit rejected; `baseHfa` → 3.0 |

### Aug 6 — audit and remediation (PRs #9–#11)

*Reconstructed from git; not done first-hand.*

- `3ce9253` — full product audit (`docs/AUDIT-2026-08.md`, 739 lines, 18 numbered
  bugs, 46-item master checklist).
- `19c9d83` — trust & correctness: RLS lockdown, week clock, anon access.
- `87df5a3` `bfe36a8` — quick wins (a11y, metadata, error boundaries, PWA shell);
  performance (consensus reduced in Postgres).
- `22549b7` `65213f3` `aa40447` `dd5d996` `d293b4a` — live game page, Pick'em v2,
  rankings/standings/recap, slate upgrades, ledger analytics.
- `0bd92af` `53dabbd` `b5a397e` `1b51893` — postseason support, season
  de-hardcoding, `system_ratings`, CI, 30-second live scores, movement chart.
- `8bb6433` `7e6ba1a` `55fbbe8` — backtest off/def replay + totals calibration
  gate; runs on model-touching PRs; totals re-enabled, O/U leans stay unflagged.
- `a3e1ed6` `c69e23c` `39c2c2b` — model 2026.3.0 (version-gated totals), tilt
  sweep, SP+ tilt reverted. **Note:** that sweep only ever tested SP+ *shape* and
  chained tilts in every arm, so the configuration production actually ran was
  never an arm. Carryover — untested then — later won on Aug 7.
- Merged as `aad1fdb` (#9), `910c916` (#10), `f9d5032` (#11).

### Aug 5 — bootstrap through card redesign (PRs #1–#8)

*Reconstructed from git; not done first-hand.*

- `6114507` `795878f` `58cc300` — spec, schema, model, backtest harness; auth,
  slate, pick'em, ledger, crew, ingestion; model tuned on 2023–25 and the 2026
  preseason pipeline built.
- `b5a8978` `80908fe` `50c54a6` `62f9713` `5374832` `e5b8534` — schema sync, JSON
  loader, magic-link fixes, commissioner invite flow, Ratings page.
- `fc9ace3` `ebf1836` — `--tune-prior`; **model 2026.2.0** (talent field mapping
  fix — it had been silently defaulting for every team — and the 50/50 SP+ blend
  in the prior-year baseline).
- `8fcd1ce` (#1), `d1a225b` (#2, half-point snapping), `e9f25ae` (#3),
  `e19a8c0` (#4, public browsing), `f785f8f`–`acf21a0` (#5–#8, card redesign).

---

## Open items

- **CLV tracking on Receipts** — never built. The honest in-season scoreboard:
  positive CLV with a losing ATS record is a coherent story, and it's what the
  backtest actually found. Needs `predictions.open_spread` + `clv`.
- **2026 talent is unpublished.** `build-preseason` silently falls back to 2025,
  so current ratings contain **no incoming recruiting class**. Re-run
  `--check` before the Aug 26 load.
- **`team_hfa` rows must be rebuilt** for `baseHfa` 3.0 to reach production —
  they're derived from it. The parameter alone is not enough.
- **`supabase/functions/jobs/index.ts` is dead and drifted** — never deployed,
  and behind `scripts/lib/jobs-core.ts`. Left untouched deliberately.
- **Audit statuses unreconciled** — all 46 checklist items in
  `docs/AUDIT-2026-08.md` are still `[ ]` though most shipped Aug 6.
- **Local `main` is stale** at the initial commit; the real default branch is
  `origin/main`. `git branch --merged main` is misleading.
- Untested model ideas that remain plausible: pass/rush splits, special teams and
  field position, QB modeling from player PPA (currently one boolean).

---

## Operations reference

```bash
# Backtest — calibration report + edge gate
npx tsx scripts/backtest.ts [--cached]

# Fitting (each prints its own pre-registered decision rule)
--tune              # K / HFA grid, fit σ + slope
--tune-hfa          # HFA alone, judged on bias + MAE + calibration
--tune-sigma        # priorSigmaExtra (early-week uncertainty)
--tune-churn        # returning-production weight + talent reload
--tune-coaching     # newHcIntercept / newHcSlope
--tune-preseason-tilts
--tune-anchors      # week-1 Elo / preseason poll
--tune-epa          # per-play efficiency vs the scoreboard
--tune-ensemble     # weekly Elo + prior SP+ blended into our margin
--tune-prior        # preseason carryover weight
--tune-sp-blend     # prior-year SP+ blend
--diagnose-edges    # market MAE + encompassing regression (the edge gate)

# Preseason
npx tsx scripts/build-preseason.ts --check          # readiness; non-zero exit when inputs incomplete
npx tsx scripts/build-preseason.ts --out DIR --top 40
```

**CI** — `backtest.yml` runs the calibration report and `--diagnose-edges` on
every PR touching `src/model/**`, `scripts/backtest.ts`, `scripts/lib/replay.ts`
or `scripts/lib/coaching.ts`. `ci.yml` runs lint/typecheck/test/build on every
PR. `jobs.yml` carries the scheduled data jobs plus `preseason-preview` and
`preseason-check` dispatch tasks.

**Note on workflow runs:** PRs opened by an app token do not trigger Actions.
Closing and reopening the PR as a human does.
