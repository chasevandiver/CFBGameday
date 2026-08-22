# The Slate — Change & Decision Log

Running record of what shipped, what was tested and rejected, and why. Companion
to `docs/SPEC.md` (what we're building) and `audit/AUDIT-2026-08.md` (a
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

**`MODEL_VERSION` 2026.5.0** (`src/model/ratings.ts`) — 2026.4.1 plus the
market-anchored tier recentre in the preseason build (Aug 12, below), which
removes a measured +9.8-point cross-classification lean from the 2026 openers.

✅ **In production since 2026-08-19**, on the recruiting-class substitute rather
than the stale-talent build the Aug 22 escalation authorised. Dispatched
`preseason-refresh` (run `32301198359`) loaded 138 week-0 ratings and
`verify-preseason` read them back: `model_version 2026.5.0`, `team_hfa` at **1**
distinct `blended_hfa` where production had carried **70** that morning,
`preseason_components` at **0** `talent_stale`. See `docs/STATUS.md` §1.
*(Previously, and kept as what was true for twelve days: "⚠️ In the code, not yet
in production. As of 2026-08-07 the database serves `ratings` at 2026.2.0 — the
site is running a model four versions behind this table." `team_hfa` rows are
derived from `baseHfa` at build time, which is why the `2.3 → 3.0` fix did
nothing until `build-preseason.ts` was re-run and reloaded, and the tier
recentre likewise only reached production through that rebuild.)*

That reload is now automatic: the `preseason-refresh` job (below) retries every
morning in August and loads on the first day `--check` reports READY. Nothing to
run by hand. See Open items for what it is waiting on.

| Parameter | Value | Provenance |
|---|---|---|
| `kFactor` | 0.3 | Fitted, 2023–25 grid |
| `marginCap` | 28 | Spec §2.2 |
| `baseHfa` | **3.0** | Fitted `--tune-hfa` (was 2.3; see decisions) |
| `teamHfaBlend` | **0** | **Identity — tested, rejected.** Was 0.5 from Spec §2.3, never validated by any replay until `--tune-team-hfa` ran 2026-08-18. Gate 0 (split-half r = **−0.196**, n = 134) says there is no per-team signal; the grid degrades monotonically with the blend. 02:M-05 / 03:M-1v closed on evidence |
| `priorRatingWeight` / `talentWeight` | 0.70 / 0.30 | Fitted `--tune-prior` |
| `priorDecayKnots` | `[0,1.0] [4,0.5] [8,0.15] [12,0.05]` | Spec §2.2 |
| `marginSigma` | 16.8 | Fitted σ |
| `winProbSlope` | 0.101 | 1.7/σ |
| `edgeThreshold` / `bigEdgeThreshold` | 2 / 4 | Spec §2.4 — **information only**, not bets |
| `fcsTopRating` / `fcsOtherRating` | **−30 / −30** | **Identity** — but no longer for want of evidence. `--tune-fcs` ran 2026-08-18: Gate 0 clears at **t = 7.06** and **−24 / −32** clears three of four criteria. Held at −30 pending one judgement call on criterion 1 — see the decisions table. Were −25/−35 from Spec §2.1 and read by nothing. |
| `returningProdWeight` | **6** | Fitted `--tune-churn`, interior point not argmin |
| `talentReloadStrength` | **1** | Fitted `--tune-churn` |
| `priorSigmaExtra` | 0 | **Identity** — tested, rejected |
| `newHcIntercept` / `newHcSlope` | 0 / 0 | **Identity** — unconverged, not shipped |
| `epaWeight` | 0 | **Identity** — tested, rejected |
| `PRESEASON_TILT_CARRY` | 0.4 | Fitted (env var in `build-preseason.ts`) |
| `TALENT_SOURCE` | **recruiting** (fallback only) | Fitted **rule** `--tune-talent-source` `2015-2025/warmup1/covid-chain` — env var in `build-preseason.ts`, set by `jobs.yml`. Governs only what stands in while `/talent` is unpublished: classes first, stale composite last. Code default stays `composite` (identity) |
| tier recentre | market-anchored | Fitted **rule** `--tune-tier-recenter` (build-time step in `build-preseason.ts`, not a constant — the shift is re-fit to each August's week-1 lines) |

"Identity" means the machinery exists and is tested, but reproduces the previous
model exactly. Each is documented in place so it isn't rediscovered.

**Every value above was fitted on 2023–25**, which was the only window that
existed until 2026-08-18. The default is now 2015–2025 and nothing has been
re-fitted against it yet — a fitted number and the window it was fitted on are
one fact, not two, so any refit gets a new decisions-table row rather than an
edit to this table.

---

## Decisions log

Seventeen experiments (two of them wide-window re-fits of already-shipped
parameters), each with a decision rule fixed **before** the run. Five shipped;
three have their rules registered and are not yet decided — `--tune-fcs`,
`--tune-team-hfa` (both now runnable at the wide window) and the opener test
(decided by in-season data, ~mid-October at the earliest).

**Every row from here on carries its window label.** Rows without one were
computed on `2023-2025/warmup1`, which was the only window that existed when
they were written; a number from a different window is not comparable to them
and must say so. See "The window changed" below.

| Experiment | Result | Verdict |
|---|---|---|
| **BT-3 FBS membership** `2023-2025/warmup1/covid-chain` | Same code, same window, same scored set, the only difference being the fix (`--no-admit` is its control). Scored **MAE 13.22 → 12.93**, **NLL 0.5051 → 0.4861**, bias +0.54 ± 0.40 → +0.60 ± 0.39 (unmoved). Every season improves by the same ~0.29: 2024 13.59 → 13.30, 2025 12.87 → 12.57, 2023 (unscored) 13.30 → 13.01. Cross-tier vs actual −7.20 → −7.85 on n 194 → 204 — **0.57 SE, not significant**, and the sample legitimately changes because an admitted team's games move from the FBS-vs-FCS slice into cross-tier. | **Shipped as a bug fix**, and the justification is correctness rather than the number: a pool frozen at one season's membership is simply wrong. But the number is not small — for scale, `--tune-hfa` shipped on MAE −0.005 / NLL −0.0011 and the tier recentre on MAE −0.08 / NLL −0.0038. This is **5× the tier recentre's NLL gain**. Now also live in `build-preseason.ts`, so it reaches the ratings production serves. |
| `--tune-team-hfa` `2015-2025/warmup1/covid-chain` | **Gate 0: r = −0.196 over n = 134 teams.** Split-half correlation of raw per-team HFA across disjoint prior seasons (odd vs even, 2020 excluded from both). Not merely under the 0.30 bar — **negative**: a team's home edge over one set of years is slightly anti-correlated with its own edge over the other set. The accuracy grid agrees monotonically — MAE 13.374 / 13.376 / 13.386 / 13.405 / 13.429 and NLL 0.4957 → 0.4978 across blend 0 → 1, with the worst win-prob bucket widening 2.5 → 3.0 points. Flat wins on every axis. | **Rejected — `teamHfaBlend` 0.5 → 0**, which is the standing rule in 02:M-05 / 03:M-1v firing on evidence after months open. There is no per-team quantity here to blend; it is noise with a team's name on it. Also retires audit 03:M-1's threat outright: `centeredBlendedHfa` was a mitigation for an inflated per-team table, and at blend 0 it returns `baseHfa` for everyone, so the component is inert rather than merely centred. |
| `--tune-fcs` (Q4) `2015-2025/warmup1/covid-chain` | **Gate 0 clears at t = 7.06.** At the flat −30, vs actual: top bucket +7.06 ± 0.84 (t=8.40, n=430), other −0.85 ± 0.74 (t=−1.15, n=627), difference **+7.91 ± 1.12**. There really are two kinds of FCS opponent and the good ones are priced ~7 points too weak. The widening is what made it visible — the bucket rule sees 57 rated FCS teams from nine prior seasons where it used to see 1–2. Exactly one grid cell, **top −24 / other −32**, clears criteria 2–4: buy-game MAE **15.015 → 14.529** (−0.486, bar 0.25), pooled MAE 13.374 → **13.305** and NLL 0.4957 → **0.4952** (both improve, where the criterion only asked for no spillover), mean FCS rating **−28.7** (within ±1.5 of −30, so a split not a level shift), and **interior on both axes**. | **Decision owed, deliberately not taken here.** Criterion 1 says *both* per-bucket biases move toward zero. The top bucket does, decisively (+7.06 → +1.20, t 8.40 → 1.4). The other crosses zero and grows slightly, −0.85 → +1.22, statistically indistinguishable from zero on both sides (t −1.15 → 1.6). **No cell in the 25-cell grid satisfies the strict reading while clearing the other three.** The rule as written is not met; the rule as intended — fix the top bucket without breaking the other — is. Both params stay at −30 until that is called, so nothing depends on the delay. |
| `--tune-preseason-tilts` | λ=0.4: wks 1–2 totals MAE **13.34 vs 13.72**; wks 1–4 12.93 vs 13.16. Every SP+-shape variant lost badly (to 16.87). | **Shipped.** Week 0/1 totals became real numbers instead of nulls. |
| `--tune-hfa` | Bias **+0.74 ±0.33 → +0.03** at HFA 3.0; NLL 0.5005 → 0.4994; MAE flat (13.254 → 13.249). | **Shipped.** Model was systematically under-predicting home teams. |
| `--tune-churn` | Old setting scored **0.3968 — worse than no churn at all (0.3964)**. Shipped weight 6 / reload 1.0. | **Shipped as a bug fix.** The gain itself (~0.002 NLL, 0.19 MAE) is inside the ~0.25 SE. The defensible claim is that a harmful setting was removed. |
| `--tune-sigma` | Flat sigma won. Widening made wks 1–4 NLL **worse**, 0.3972 → 0.3992. | Rejected. Early σ is inflated by cupcake blowouts — huge residuals, near-certain winners. That is not directional uncertainty. |
| `--tune-anchors` | ΔNLL **0.0026** vs a pre-registered bar of 0.003. | Rejected, by 0.0004. (Also ran on contaminated week-1 Elo — see below — so it failed *with* an unfair advantage.) |
| `--tune-coaching` | Optimum pinned at the grid edge (−2.5, then −5 after widening). Slope inert: NLL flat across 0/0.15/0.30/0.45. | Rejected — unconverged. A new HC almost always follows a bad season, which the prior already encodes, so the penalty double-counts. |
| `--tune-epa` | Best case **0.010** MAE; NLL degraded monotonically (0.5005 → 0.5095) and early MAE got worse. PPA coverage was fine (1492/1606/1658 games). | Rejected. Swapping the scoreboard margin for a PPA margin still feeds one noisy per-game number into an Elo that already averages a dozen games. |
| `--tune-ensemble` | Pure 50/50 with weekly Elo is **worse than our model alone (−0.069)**. Fitted weights: true holdout 0.138 vs bar 0.15. Prior-season SP+ t=0.43. | Rejected. The apparent gain was an intercept, not information — which is how the home bias was found. |
| `--diagnose-edges` | b₁ = **0.035 (t=0.84)** for our model vs **0.987 (t=22.81)** for the market, n=2611. All five pre-registered tier tests failed (totals, thin/thick market, conference/non-). | Rejected → **edges demoted to information.** `stakeForPrediction` replaced by `modelSideOf`; ¼-Kelly stake removed from the UI. |
| `--diagnose-tiers` (chain grid) | Cross-tier G5-signed edge, wks 1–4: bare chain **+7.08 (t=14.8)**; best variant (0.7·finals+0.3·talent) still **+4.81 (t=10.6)**. On the 2026 wk-1 market all six constructions land **+9.7…+10.4** — incl. α=0 (pure SP+ baseline) and FCS −25/−35. | Rejected as fixes: **no prior-chain construction moves the 2026 number.** `REPLAY_SHARE` stays 0.5 (re-tested, not re-litigated). Root cause isolated to pool-LEVEL regression, not the blend. |
| `--tune-fcs` | **Not yet run** — the flag, the bucket rule and the pre-registered criteria landed 2026-08-13; the run is queued for after Week 0. Closest existing number: `--diagnose-tiers` scored FCS −25/−35 as two of its six constructions and **none of the six moved the 2026 cross-tier figure** (all landed +9.7…+10.4). That was a different question — pool level, not FBS-vs-FCS accuracy — so it does not settle this one, but it is the reason not to assume the spec's values are right. | Pending. Both params ship at −30 (identity), so nothing depends on the answer. Gate 0 is a two-sample \|t\| ≥ 2 between the buckets' vs-actual bias at the flat anchor; failing it ships nothing and answers Q4 **on evidence** rather than by deferral. |
| `--tune-tier-recenter` | Market-anchored: wks 2–4 cross-tier edge (out-of-fit) **+5.41 → +0.78 (t=1.5)**; wks 1–4 bias vs actual **−6.31 (t −4.7) → −1.57 (t −1.2)**; P4vP4 +0.51 unmoved; pooled MAE **13.22 → 13.14**, NLL **0.4994 → 0.4956**; worst bucket 2.7. Static δ=4 matches on 2023–25 but under-corrects 2026 by ~6 (fits: +4.4 '24, +4.7 '25, **+10.4 '26**). | **Shipped (2026.5.0).** All four pre-registered criteria passed; market-anchored chosen over a constant because the offseason P4/G5 divergence is accelerating. |
| `--tune-talent-source` `2015-2025/warmup1/covid-chain` | **All three pre-registered gates pass** (run 32278795011, 2026-08-19). Gate 0: full FBS coverage every scored season (128–136 of pool) and **median r(recruiting, same-season composite) = 0.942** vs a bar of 0.85 (per-season 0.899–0.979). Arms on the production-shaped chain, pooled over 9 scored seasons: fresh composite MAE 13.221 / NLL 0.4905, **stale composite 13.229 / 0.4907** (today's Aug 22 fallback), **recruiting classes 13.162 / 0.4891**, no-talent 13.292 / 0.4931. Gate 1 vs stale: ΔNLL **−0.0017**, ΔMAE **−0.067**, wks 1–4 ΔMAE **−0.175** (bars were ≤ +0.001/+0.03/+0.05 — it cleared them by improving, not by staying close). Gate 2 (E4 era alone): ΔNLL −0.0013, ΔMAE −0.037. | **Shipped as the fallback.** `TALENT_SOURCE=recruiting` on every preseason build task in `jobs.yml`; the fresh composite stays first choice, the stale file drops to last resort, and the mechanism is inert the day CFBD publishes. **One observation deliberately not acted on:** the recruiting arm also beat the FRESH composite (MAE −0.059, NLL −0.0014 — comparable to shipped changes for scale). That is a different question with a different rule, and this experiment's rule only governs the fallback; replacing the composite outright would need its own pre-registered row. |
| `--tune-prior` re-fit `2015-2025/warmup1/covid-chain` + `2023-2025/warmup1/covid-chain` (E4) | Owner hypothesis, 2026-08-19: 0.70 scoreboard carryover is too high in the portal era — raised after the SP+ comparison (our board deviates from SP+ 2026 along prior-year rating, corr +0.18, not talent, +0.04; all three stored week-1 market lines sided with SP+'s direction). Grid widened to 0.30 **before** the run so a low optimum could not pin at the old 0.5 floor. Wide window (n=2794 early games): NLL **monotone worse as carryover falls** — 0.30 → 0.4306/14.78, 0.50 → 0.4179/14.35, **0.70 → 0.4117/14.10**, argmin 0.80 → 0.4110 (grid EDGE, Δ vs 0.70 only 0.0007 against a 0.003 bar). E4-only (n=616): interior argmin 0.65 at 0.3798 with 0.70 at 0.3801 — Δ 0.0003, noise. Era-flip: wide argmin 0.80 vs E4 argmin 0.65, three grid steps apart. | **Rejected — 0.70 stands, and the hypothesis is refuted in the direction it was posed.** Lower carryover is worse everywhere, at every step, in both windows; the pooled data mildly wants MORE (but at an edge, under the bar, and era-flipped, so nothing ships). The board's lean toward proven 2025 results over talent is the model earning early-week points, not a bug. The deviations from SP+ remain honest disagreements — graded from week 1 by the frozen receipts and CLV. |
| `--tune-sp-blend` re-fit `2015-2025/warmup1/covid-chain` + `2023-2025/warmup1/covid-chain` (E4) | α = 0.5 is the argmin at BOTH windows: wide 0.4095 (vs 0.4106 pure SP+, 0.4121 pure replay), E4 0.3793. Interior, eras agree exactly. | **Confirmed — `REPLAY_SHARE` stays 0.5**, now re-earned on eleven seasons instead of carried from three. Notably α=0 (leaning fully on SP+'s opponent-adjusted final) is worse than the 50/50, which is more independent evidence against regressing harder toward SP+-style inputs. |
| Fun Mode exemptions (owner decision 2026-08-20, not an experiment) | Owner request: "make this feel like Football Season… optional toggles… we can disregard any safeguards from the repo… not corny or cheesy or AI slop." Two standing rules are **exempted for the opt-in Fun Mode surfaces only** (FUN-1…FUN-12): the "motion means money" scope decision — fun-mode pieces may animate games the viewer holds nothing on — and, in exactly one place, the no-new-fonts rule (`Permanent_Marker` for crowd-sign posterboard, used by `.fun-sign-body` and nothing else). | **Granted, scoped, recorded.** The exemption travels with the toggles: everything defaults off, so the default app still obeys both rules verbatim. NOT exempted, and checked in review: the CSS-only reduced-motion clamp (every fun-mode animation is plain CSS), league rules (The Panel flips only RLS-visible picks), brand voice (§16 — collegiate pageantry, no casino), and no-layout-shift for content. Kill switch is the master toggle; the taste verdicts land here under FUN-12. |
| Opener test (03:M-5) | **Registered, not yet decided.** Surface shipped 2026-08-17: Receipts grades every frozen lean opener → close (`openerClv`), 4+ bucket broken out. Backtest residual it tests: 4+ bucket **51.8%, avg CLV +0.27**, every bucket positive — real drift, all absorbed by the close. | Pending, rule fixed before any 2026 data: strategy conversation only at avg CLV vs opener ≥ **+1.0** over n ≥ 200 leans (~mid-Oct earliest); **abandon** at ≤ +0.3 by n = 200 — that replicates the backtest. Read-side only; no parameter moves on either outcome. CFBD's opener is when-posted, not a bettable price, so even a pass is evidence, not a wager. |

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

**A default that is correct on a narrow window is not thereby correct.** The
replay decided "is this team FBS?" by `priors.has(teamId)`, and `priors` was
seeded once from the first season's SP+ and chained forward by a function that
carries exactly the key set it was given. So the FBS pool was frozen at one
year's membership for the whole window, and any team promoted to FBS later was
priced at the flat FCS anchor (−30) for every game it played, in every season,
with no error anywhere. Over 2023–25 that was Jacksonville State, Sam Houston
and Kennesaw State — small enough to go unnoticed for the whole life of the
backtest. Over 2015–2025 it is also Charlotte, Coastal Carolina, Liberty, UAB
and James Madison, and it corrupts the FBS-vs-FCS slice, which is the exact
population `--tune-fcs` fits its two numbers on: the tuner would have answered
the question it exists to settle, confidently, using games that are not buy
games at all.

This is the same shape as `emptyIsHealthy` and as caching `[]` (04:DQ-15): a
default whose wrongness scales with a dimension nobody was varying, and which
therefore has no symptom until somebody varies it. **When widening the range of
an input, the thing to audit is not the code that reads the input — it is every
constant that was silently correct because the range was narrow.**

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

**A pooled signed error cannot see a lean on a minority slice, either.** The
sequel to the finding above: after the HFA fix, pooled bias read +0.03 — while
cross-classification games (11% of the sample) carried a +9.8-point lean that
put a BIG EDGE flag on essentially every P4-vs-G5 opener. It survived because
`03:M-3` (signed error by slice) was deferred and nothing printed a per-slice
number. The slice tables now run on every report, and the market is the sharper
instrument for them: books disagree with us with ~7-point SD where actual
margins carry σ≈17, so a lean shows at |t|>2 on a tenth of the games. Slice
before you average, and test against the line before the scoreboard.

**A margin-Elo cannot re-level POOLS from inside a season.** Intra-pool games
are zero-sum within the pool; the ~1.5 cross-tier games per team per season
correct a pool-level offset at K/2·error a game, so a week-1 mis-level decays
to ~0 only around week 8–9 (measured in the by-week slice table). Every
between-season regression — 0.7× toward zero, or toward talent (P4−G5
separation ~8) — therefore compresses the pool gap the replay finals carry
(~15–16) and nothing restores it before the openers are priced. Mean-reversion
belongs WITHIN a pool; applied across pools it manufactures a lean.

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

### Aug 21 — WEEK0-1: two jobs disagreed about Week 0, and the later one won every morning

Owner report: Week 0 still shows as Week 1 on the slate and in the groups. It
does, and the cause is not the code that was written to prevent it — that code
works. It is that a second writer undid it, daily, with both jobs green.

`scripts/lib/weeks.ts` splits Week 0 out of CFBD's merged 2026 week 1 (99 games,
Aug 29 → Sep 7, one bucket). `sync-games` applies it. `backfill-games` applies
it. **`build-preseason.ts` did not** — it emitted `week: g.week` straight from
the feed — and `load-preseason` writes that file over `games` on every
`preseason-refresh`. So:

| time (UTC) | job | week 0 |
|---|---|---|
| 09:35 | `sync-games` — logs `week 0 split out of CFBD's week 1: 8 games` | 8 games |
| 09:35:32 | `sync-systems` reads the pointer → `{"week":0}` | 8 games |
| 11:15 | `preseason-refresh` reloads the schedule | **0 games** |

Both green, every day. Confirmed in `job_runs`: `freeze` on **Aug 14** reported
`{"week":0,"scheduled":8}`; the same job on **Aug 21** reported
`{"week":1,"scheduled":99}`. Nothing changed in between except that
CFBD-4/5 cleared the talent gate on the 19th and `preseason-refresh` **started
actually loading on the 20th instead of declining**. The bug was latent for as
long as the job was refusing to run, and shipped itself the day it got healthy.

What it was about to cost: the freeze carries a per-game 8-day horizon
(`FREEZE_HORIZON_DAYS`), so the **Aug 28** run against a merged week would have
frozen 8 openers **plus 19 Sep 3–4 games** — receipts stamped six days early on
preseason ratings and stale lines, graded for CLV against them. That is the
exact failure `weeks.ts` was written to prevent, arriving through the one door
it had left open.

**Fixed** by applying the same two functions in `build-preseason.ts`. One rule,
three writers, no third derivation of "what week is this".

**The test is the point, and it is not a unit test.** `weekZeroIds` had seven
passing tests and was right the whole time; nothing about the function could
have caught a caller that never called it. `weeks.test.ts` now scans `scripts/`
for anything that writes rows into `games` and asserts it routes through
`resolvedWeek` — with two exemptions carrying their reason (`nfl-sync-games`,
whose weeks come from ESPN's calendar and which has no week 0; `seed-fixtures`,
invented games) and a guard test that fails if the scan stops finding the three
writers it exists to police, since a source scan that matches nothing is green
for the worst possible reason. Verified by mutation: reverting the
`build-preseason` change turns it red on that file by name.

1,862 tests across 126 files green, plus `npm run typecheck` and lint.

**Recorded, not fixed:** `build-preseason` §9 prices every game CFBD calls week
1 — all 99 — into frozen `predictions`. It is unreachable today (`predictions`
is `APPEND_ONLY`, so a refresh skips it; only `--bootstrap` loads it, and the
table has 0 rows), but a bootstrap against 2026 would pre-empt the Thursday
freeze for the whole opening slate.

**Verified end to end, 2026-08-22 00:41–00:42 UTC**, by running the two jobs in
the order that made the bug rather than just the one that fixes it:

| run | job | result |
|---|---|---|
| 32541114222 | `sync-games` | week 0 = 8, week 1 = 91 |
| 32541165986 | `preseason-refresh` — **the job that was undoing it** | week 0 still 8 |

The second run's log carries the new line from `build-preseason` itself —
`week 0 split out of CFBD's week 1: 8 games` — then four games files loaded,
`Done: 2421 rows loaded`, and `verify-preseason` reading back 138 week-0 ratings
at 2026.5.0, `team_hfa` at 1 distinct `blended_hfa`, 0 `talent_stale`, 0 halves
mismatched, 0 games already final.

Running `sync-games` alone would have proved nothing: it had been splitting
correctly and silently every morning since Aug 17. The test is whether the split
survives the load that came after it, and it does.

The residual above is confirmed by the same log and stays unreachable:
`Week 1 games priced: 99 (of 99 on the slate)`, then
`skip 16-predictions-0.json → predictions (99 rows) — append-only, use --bootstrap`.

**Two things the same pass turned up, both logged in `docs/STATUS.md` §2.1j and
neither fixed** — sized after Week 0 on purpose, since both change surfaces that
are about to be watched:

- **FREEZE-1.** One freeze cron, Fridays 03:00 UTC = 10 pm CT Thursday, and the
  job only takes games still `scheduled`. A midweek game has already kicked, so
  it is filtered out, and the next run is seven days later. 58 games this
  season (34 Thu, 17 Tue, 7 Wed, excluding TBD placeholders). This fix changes
  week 1's version of it rather than removing it: the Sep 3–4 games go from
  "frozen six days early on preseason numbers" to "no receipt at all".
- **SLATE-2.** CFBD's placeholder kickoff for an unscheduled game is 04:00 UTC —
  midnight Eastern, which is 11 pm the previous day Central — so 391 of 888 rows
  render on the Friday tab. `SlateView` groups on `startTs` and only says
  "Kickoff TBD" for a *null* one; the card already renders TBD correctly, so the
  row and its own heading disagree. Week 1 has zero TBD kickoffs, so launch
  weekend is unaffected.

### Aug 21 — SPLASH-1 un-ticked: iPadOS ignores landscape startup images

The 08-20 fix does not work, and the box it checked has been un-checked. A
checked box in `docs/STATUS.md` means the thing is fixed; this one meant "a
plausible fix shipped", which is the failure mode that file exists to prevent.

Every link measured on an iPad Air 10.9", not reasoned about:

- the landscape rule **matches** on the device (`splash-check.html`: MATCH on
  `820×1180, dpr 2, orientation: landscape`)
- both dimension orders are served
- `ipad-109-landscape.png` is reachable, 2360×1640, artwork undistorted
  (tagline 41.4% of width; ink box identical to the portrait file's)
- the device shows the **portrait** file stretched: tagline ≈60% of width, ink
  ≈1.7× too wide
- reinstalled twice, the second time in landscape, in case iOS binds one image
  at install

Query matches, file exists, file is correct, iOS uses a different one. The
conclusion is that iPadOS does not honour `orientation: landscape` on
`apple-touch-startup-image` — which is also why every asset generator emits
landscape entries that quietly do nothing.

Three hypotheses were wrong before this one was right: the files, then the
dimension order, then the install-time cache. Each was killed by a
measurement, which is the only reason the conclusion is worth anything.

Dead weight recorded, not yet deleted: 9 files, 960 KB, 18 of 36 media rules.
Deleting them is only correct if the behaviour holds on every iPad, and one
device is not every.

### Aug 21 — POOL-3d: the card was dropping a mate's second pick

Owner question straight after POOL-3c: "is it going to have all of the picks
listed so it would say Dave USC & Over and Ann SJSU & Under?" No — and the
reason was worse than a display gap.

`fetchSlateView` kept one pick per mate per game and discarded the rest, on a
comment that was correct when written: "a crew line reading 'Dave home, Dave
over, Dave home' is three renderings of one opinion." True for a one-line
summary, false the moment the card listed picks. A member who took the spread
and the total showed as their spread alone, so the card disagreed with the
board about what they had picked.

`CrewPickView.picks` now carries every market, grouped one entry per person —
The Panel still seats one person in one chair, and the card says "Dave USC &
Over". Market and side only, not the line: the crew query never reads
`line_at_pick`, and printing a number there would claim a price nobody fetched.

"With you" now means sharing any side, since a member can hold two.

### Aug 21 — POOL-3c/1d: the pool layer reads like the sheet, the hub leads with standings

**The card.** It was telling one shape of fact two ways — chips in the tag row
for your pick'em picks, a count for everyone else's. A tag row is for facts
about the game; "you took USC −37" is a fact about you. Both are gone, replaced
by one POOL block built like SHEET: group name, a `You` row with your picks
joined by `&` (one decision about one game, not two rows), then the room with
their records. Threading the pool's name from the page down to the card was the
only real plumbing — the pool layer had never known which pool it was showing,
the way the sheet always has.

**The hub.** The Groups card was a single link row: it named the destination
and said nothing about it, which is a worse version of the tab already in the
bar. The groups section is hoisted instead — the same standings rows, place,
field and record — moved rather than copied, with a test pinning that it
appears once. The picks-due count rides above it as its own row.

### Aug 21 — three owner corrections: the hub, the badge, and where the pool line lives

**The swap meant the hub, not the nav.** POOL-1 moved the bottom-bar tabs. The
ask was the home hub, which led with the arcade while the pool — the thing with
a deadline on it — was a section most of a screen down. Groups takes that slot
now; Games moves beside the standings. The nav swap stays, so the two agree.

**The badge was on the wrong surface and said the wrong thing.** "9+" over a
Users glyph could be nine of anything; a number floating on an icon cannot say
what it is counting. The count moved to the hub's Groups card where it has room
for a sentence — "3 picks still to make." — and the nav badge is gone, along
with the `badge` field on `NavItem`. `fetchOpenPickCount` is now one
server-side implementation shared by the hub and `/api/picks-due`.

**The named pool line only rendered while a game was live.** Pregame the card
fell back to a count chip in the tag row (`1 SJSU · 1 USC`) — exactly the state
a reader is in when they care who is on what. It now sits at the bottom in
every state, above the money layer and in the same shape: POOL then SHEET, one
labelled header each. The count chip is deleted rather than left beside it.

### Aug 21 — POOL-3/4/5: names on the card, a share menu that opens, a toggle that answers

**POOL-3.** The crew line counted people; now it names them. The tail/fade
shape already existed — initials, names, records — but only once the viewer had
a pick of their own; the branch you see *before* picking said `Crew: 3 HOU`,
which is the least interesting true thing the card knows. No new reveal: RLS
hands the card another member's pick only through `picks_revealed` (0023), so a
group that hides until kickoff passes an empty list until kickoff.

**POOL-4.** The share menu was reported as "clipped by another card". It was
neither clipping nor one bug. It opened DOWNWARD from a button in the fixed
bottom bar, where there is no below; and it sat at `z-30` inside that bar's
`z-20` stacking context, which cannot beat the bottom nav at `z-40` — so
positioned correctly it would still have opened underneath the nav. Portalled
to `document.body`, measured from the button, flipped when there is no room
below.

**POOL-5.** A "Send a test" button already existed on `/me`. What got clicked
were the per-kind checkboxes, which saved silently **and discarded their
result** — a failed save left the box ticked while the database had refused it.
They now confirm, and on failure put the switch back and say why.

The push plumbing itself is healthy, and the evidence was already in the
database: 3 subscriptions, 6 settings enabled, `notify-picks-due` running green
with `{"notified": 0, "group_weeks": 0}`. Nothing is due until a board exists.

### Aug 21 — POOL-6: a pool is counted in points

Owner call, with both edges settled the same night: a push scores 0, survivor
stays alive/eliminated. Units carry the −110 convention, so a 10-5 week read
`+4.1u` — a book's arithmetic wearing a pool's clothes.

`Tally.points` is one per win, nothing for a loss or a push, added **beside**
`units` rather than replacing it: `tally` is shared with `bets`, where units are
the whole point.

The projection and the odds column moved with the board — the Pool Machine
raced in units and `weekWinOdds` simulated in units, and leaving either would
have put a book's answer beside a pool's standings. Ties are now common (points
are integers; −110 units almost never tie), which is what the sim's
leader-splitting was always for and had almost never exercised.

Two behaviour changes worth stating: **a loss costs nothing**, so a pool cannot
go negative; and **straight-up weeks gained a score they never had**, because
the old unit line was gated on a priced market.

The pool-machine tests moved with the contract rather than being deleted —
every expectation in them used to be a −110 unit figure, and the comments now
say so.

### Aug 21 — POOL-1/POOL-2: Groups takes the thumb zone, the builder starts empty

Owner report from a night of using the app. Groups and Games swap slots in
`NAV_ITEMS` — one list drives both navs — and Groups carries a count of picks
still owed.

`openPickCount` is one rule shared by the badge and mirroring the push job, so
the tab and the notification cannot disagree: any pick on a game counts it
handled, locked games are not owed. Writing that comment caught a bug in the
first cut — TBD kickoffs were fetched exactly backwards, and an un-pickable
game would have kept the badge lit forever.

The week builder: Spreads was pre-ticked and is not any more (the games list
already started empty), and each row now shows the consensus spread and total
beside the kick time, so an admin can see which games are competitive without
leaving the page.

### Aug 21 — SLATE-1: the clock stops losing its own row

Owner, from the 375px pass: "the game of the week tag smushes the time left in
the game and I'm good getting rid of that tag entirely." Chip removed; the
accent ring is the whole Game of the Week treatment now.

The chip was the trigger, not the cause. The header row is a flex fight between
the live clock and the network list, and the clock was losing — the TV span was
`shrink-0` while the left group was `min-w-0`, so a four-network game
(`ESPN/KTRK (ABC)/Fox 5 Vegas`) took what it wanted and `Q1 · 1:13` wrapped onto
two lines. Deleting the chip buys room today and loses the same fight next time
to a rivalry chip, an upset alert, or a longer broadcast string.

The priority is now in the markup instead of implied by ordering: the clock is
`shrink-0 whitespace-nowrap`, because the time left in a live game is what
DESIGN.md's first rule is about; the network list truncates, because it is the
least glanceable thing in the row and its full text is already in the `title`
and on the game page.

Verified by mutation: restore either class and the matching test goes red.
1,824 tests green.

### Aug 21 — the 375px pass found two things no stylesheet could show

The app passed on device: no sideways scroll, no clipping, tap targets fine, the
live card held still through score changes. **UX-28 closed as not a defect** —
nobody could make a team name truncate, which is what the measurements had said
and what that row explicitly asked for.

Both findings were in the iOS launch surface instead.

**SPLASH-1 — the iPad landscape splash was a portrait image stretched to fit.**
The files were never wrong: `ipad-pro-129-landscape.png` really is 2732×2048.
The media query was. Landscape rules are emitted everywhere as portrait
`device-width`/`device-height` plus `orientation: landscape`, on the assumption
that those features describe the physical screen and never rotate — true on
iPhone, evidently not on iPad. No rule matched, iOS fell back to a portrait
image and scaled it. Each landscape target now emits **both** dimension orders
at the same file: 27 images, 36 rules. `/brand/splash-check.html` on the device
says which rule matches.

**SPLASH-2 — the wordmark and tagline were six pixels apart.** Measured on the
rendered PNGs, not reasoned about: **6px on an iPhone 14 Pro, 9px on the 12.9"
iPad in landscape** — 0.51% and 0.44% of the short side.

The cause was a gap that was never a gap. `tagY = wordY + short * 0.09` measured
from the wordmark's cap TOP to the tagline's BASELINE, with two rendered heights
hiding inside the span — the wordmark's caps (~6.2% of the short side) and the
tagline's (~1.5%). The visible remainder was ~1.3% in theory, 0.5% in practice,
and it shrank on any device where the wordmark set wider. The layout now says
what it means: baseline, a deliberate 5.5% gap, cap top, both heights read off
the outlined glyphs. Re-measured after the rebuild: **66px and 114px, 5.6% on
both** — which is the point of deriving it rather than picking it.

Worth stating plainly: neither of these was reachable from the source. The
markup is correct, the files are correct, and every automated check passes. It
took a tap on a real iPad — the argument for the Aug 21 row existing at all.

`npm run brand` is byte-stable (an unmodified run produces no diff), which is
how the 27 changed PNGs are known to carry this change and nothing else.

### Aug 21 — LIVE-7: the score line gives the card back

Owner: "scoring plays are still getting stuck on the slate cards and not the
most recent plays." That is NFL-18 working as written — the bottom line shows
the last SCORE instead of the last play, permanently, from the first score
onward.

**A correction to the earlier diagnosis in this log.** When that line was first
reported, hours before, it was attributed to the poller gap holding a stale
`last_play`. The screenshot's label was `HOU`, which renders only for
`lastScore`: the line was the score line the whole time. The poller gap was
real and separately confirmed — the stored clock was frozen at Q1 11:13 — but
it was not what that line was showing.

What NFL-18 defends is real and is kept: ESPN swaps in the extra point about
thirty seconds after a touchdown and the kickoff a few seconds later, so the
touchdown vanished from the line within a minute. Permanent was the overreach.
A card could sit on a field goal from ten minutes earlier while its own down,
distance, spot and field strip updated every snap.

`showsScore` gives the score a **two-minute hold**, then hands the line back,
after which the newer of the two wins. Two minutes clears the PAT and the
kickoff. It reads `scoring_plays.created_at`, now carried through the query
beside LIVE-4's `last_play_at`, and stays conservative when either timestamp is
missing — every row written before 0078, and every demo fixture.

Two existing tests caught a real defect in the first cut: the guard read
`lastScore !== null`, and a caller that omits the field passes `undefined`,
which put the card into score mode with nothing to render. `Boolean()` now.

Verified by mutation: stubbing the hand-back turns four tests red across the
pure rule and the rendered card. 1,820 tests across 124 files green.

### Aug 21 — LIVE-6: the card never said "halftime"

Owner question an hour after the rehearsal, and the answer was no. ESPN sends
`STATUS_HALFTIME`; the parser keeps only `type.state` (`"in"`), so halftime
arrived as an ordinary live tick and the card read `Q2 · 0:00`.

Two things compounded it. `underTwo` counts a Q2/Q4 clock under 2:00 as the
two-minute warning and `0:00` qualifies, so the card wore its tensest treatment
through the quietest twelve minutes of the game. And LIVE-4's age badge —
shipped an hour earlier — would have climbed past `12m` during halftime, which
is precisely the "this card is stale" signal, at the one moment being old is
correct.

`breakLabel(period, clock)` derives it: period 2 with an expired clock is
`HALFTIME`, everything else is `END Q1` / `END Q3` / `END OT`. Derived rather
than captured on purpose — ESPN's status string would cost a column and both
writers and still leave CFB uncovered, where CFBD sends no equivalent, while
period-plus-expired-clock means halftime in both leagues.

Wired at all seven live surfaces, including both screen-reader lines: a game
that reads HALFTIME on the slate and `Q2 · 0:00` in the ticker is the same
defect `LiveSituation` was extracted to end. `underTwo` now excludes an expired
clock and the age badge hides during a break.

Verified by mutation: stubbing `breakLabel` to null turns three card tests red,
and the `0:00`/`0:01` pair pins the warning treatment from both sides. 1,810
tests across 124 files green.

### Aug 20 — closing the night's open items: LIVE-3, LIVE-4, and one the fix found

Owner asked for the rest the same night, and wiring the first one turned up a
third bug that would have been much worse in November.

**LIVE-3 — the two live paths now watch each other.** Neither can watch itself,
so each stamps `live_heartbeat` (0078, deny-all) on every successful pull, and
the Actions loop pages via `notifyWatchdog` when an NFL game is live and the
10-second path has gone quiet for 3 minutes. That is exactly tonight's LIVE-1 —
an outage that ran a whole game with every dashboard green.

Doing it exposed a bug **LIVE-2 had shipped hours earlier**. The watchdog's rule
was "no `scoreboard-loop` launch succeeded in 1.5h", read off `status = 'ok'`.
Four-hour runs cancel each other, so a healthy game day writes `canceled` rows
for hours and no `ok` at all: the rule would have paged every Saturday
afternoon with nothing wrong. It now asks whether anything actually **polled**,
which is what it always meant; the launch check survives at 5h reading *any*
launch, because "the scheduler stopped firing" is a real and different fault.

**LIVE-4 — the card can say how old the play is.** `games.last_play_at`,
stamped by both writers after the diff decides and only when the play is new —
inside the diff it would make every tick a write, and stamping a kept play
would date a field goal to the timeout that followed it. Shown only past 90
seconds (below that the play simply *is* the current play), minutes only,
`60m+` past an hour, nothing at all for a null stamp or a backwards clock. It
ticks on its own clock client-side, because an age computed at render freezes
at the moment it becomes worth reading.

**LIVE-5 — the CFBD budget was counting free ESPN calls.** Found by reading
`api_call_log` before adding to it. `callsThisMonth` counted every row against
CFBD's 30,000, and ESPN lands in the same table by design: **1,719 ESPN against
714 CFBD** this month, so the gate ran on a number three times real usage. The
loop halves CFB polling at 80% and switches it **off** at 95% — on a CFB
Saturday, with ESPN calls by the thousand, that could have killed live college
scores with tens of thousands of CFBD calls unspent. One `.eq("source",
"cfbd")`.

Verified live: `edge-10s` beating every 10 seconds, `live_heartbeat` RLS on with
0 policies and 0 API grants, 1,798 tests across 124 files green.

### Aug 20 — the 10-second refresh had never worked, and the loop's margin was 3 minutes

The NFL preseason rehearsal did in one night what four audits could not: it put
a live game in front of the two live paths and both failed, in different ways,
neither visibly.

**LIVE-1 — `espn 403`, 408 times out of 408.** The pg_cron → pg_net → edge
function path fires every 10 seconds and is gated correctly; the function is
deployed; ESPN refused every call. It had never once succeeded — this was its
first live game. It reported that failure as **HTTP 200** with the text in the
body, so `cron.job_run_details` said `succeeded` and `net._http_response` said
`200`. Third time this shape has bitten the project (OPS-4, OPS-19).

The cause was the **User-Agent**, and the first fix was wrong, which is the
part worth keeping: `Accept: application/json` alone — copied from
`src/lib/espn.ts:53`, the client that has never been refused — **still 403'd**.
Replacing Deno's default `Deno/x.y.z` with an identifiable client string
answered on the next tick. The cutover is in the response log: 502 at
01:00:04, 200 at 01:00:14, body `updated 0/1` (zero because the Actions loop
had already written the same values and the function diffs before writing).
Failures now answer 502 for an upstream refusal and 500 for our own read
failing; the two healthy no-ops stay 200.

**LIVE-2 — 27 minutes of live football, unpolled.** The 23:00 launch landed at
23:13, ran its 63 minutes, exited at 00:16:50, and the 00:00 launch never came.
63-minute runs on an hourly cron is three minutes of slack against a scheduler
that drifted 13–15 minutes all evening. Now `--minutes 240` with a matching
245-minute timeout for those eight crons: a missed launch costs nothing,
because the loop already running keeps polling until the next replaces it.

That required unifying the concurrency group first. It was keyed on the cron
*string*, so eight schedules were eight groups and two loops from different
windows ran side by side rather than handing off — ~3 minutes of double-polling
at 63 minutes, but *hours* of doubled CFBD calls at four. One group now.

And the run exits after 20 idle minutes rather than holding a runner to a
four-hour deadline with no football left, which keeps runner cost where it was.
Leaving early is free: the next launch re-enters within the hour and the
end-of-run grading sweep still runs on the way out.

Three places name the same eight crons — resolve case, group expression,
timeout expression — and `jobs-yml.test.ts` fails if any two disagree. Both
guards verified by mutation rather than by assertion: drop a cron from either
list and the matching test goes red. (One of the two tests passed for the wrong
reason when first written — it re-parsed the group's list instead of the
timeout's — and the comment in it now says so.)

**What tonight also proved:** OPS-4b works. `job_runs` 265, the loop cancelled
at 23:13, settled itself as `canceled` with an observed `finished_at` and the
Actions run id. The two rows still reading `running` launched before that fix
reached `main`.

**Left open, deliberately:** LIVE-3 (nothing alerts on a dark loop in real
time — the watchdog runs three times a day) and LIVE-4 (a kept `last_play`
carries no age, so a correct decision renders as a frozen card; needs a column,
two writer changes and a UI change, which is not a 1am job).

### Aug 20 — MIG-1/MIG-2 closed: the ledger and the repo agree again

`0077_consensus_excludes_aggregates_per_market.sql` files DQ-15's per-market
correction, which had been live since 08-19 (`20260819034059`) with no file in
the repo. The body is copied from `schema_migrations.statements` and **checked
by hash, not by eye** — 2,609 characters, md5 `046e5473313ea39b694310b99c6e8b24`
on both sides. Not re-applied: it is already the live definition.

Filed as its own migration rather than folded into 0074, because 0074 ran as
written and the ledger should keep saying so — and a correction is only legible
as one if the thing it corrects is still there to read. The number is out of
order against the apply order, harmlessly: Supabase replays by recorded
timestamp, a rebuild replays by filename, and both put it after 0074.

**Two findings fell out of doing it.** `src/lib/consensus.test.ts` pinned the
aggregate-provider list against **0074** — a view definition production no
longer runs — so the guard was watching the wrong file; it now pins both, plus
a test that fails if 0077 stops being the per-market one. And the worry worth
checking: **`make_pick` never needed the correction.** Its `latest` CTE filters
to the requested market before the books-exist test, so it was per-market by
construction. Read off the live function definition rather than assumed. The
view and the pick path agree, which is what that test exists to guarantee.

Migration count is **75 files / 75 recorded rows, in sync** — numbering runs to
0077 with two gaps, 0004 and 0060.

### Aug 20 — the migration ledger does not say what §1 said it said (MIG-1, MIG-2)

Turned up while verifying 0076's apply, by counting the directory instead of
trusting the number this repo has been carrying. Two things, neither of them
new today:

**One migration is live and not in the repo.**
`consensus_excludes_aggregates_per_market` (`20260819034059`) was applied one
minute after 0074 and never committed. It is DQ-15's per-market correction —
0074 filtered the aggregate row-level, which cost three archive games the only
spread they had. Production's `line_consensus` carries the corrected rule and
**`supabase/migrations` does not**, so any rebuild from the repo silently
restores a fixed defect with every test still passing. The statement is
recoverable from `schema_migrations.statements`.

**The numbering has two gaps, not one.** 74 files running to 0076, missing
**0004 and 0060**. Only 0004 has ever been written down. Nothing breaks —
Supabase orders by its recorded timestamp — but counts derived from the
highest filename have been off by one since.

Net: **74 files, 75 recorded rows**. The "74 files, 74 recorded rows, in sync"
in `docs/STATUS.md` §1 was wrong in both halves and netted out, which is the
kind of agreement worth distrusting. Both tracked in §2.1h; neither fixed here,
because filing a migration after the fact is a decision about the ledger and
not a cleanup.

### Aug 20 — OPS-4b: the cancelled-run fix could never have worked

Found while checking the day's dated watch in `docs/STATUS.md` §2.5, not by
anything alerting. OPS-4 shipped on 08-19 with a SIGINT/SIGTERM handler in
`recordJobRun` and **two more stuck rows appeared behind it** — `job_runs`
**217** (08-19 03:40) and **242** (08-20 03:40), both `scoreboard-loop` runs
cancelled by the next hourly launch, run 242 checked out at `d9fad2a` with the
handler in the code it was running.

**The number that settles it:** Actions run `32329026607` cancels at
04:30:07.64 and completes at **04:30:07.90** — 0.26 s later, after printing
`Terminate orphan process` for `npm exec tsx`, `sh`, two `node`s and
`esbuild`. The signal goes to the step's bash shell, not to the grandchild
that installed the handler; and even delivered, a Supabase round-trip does not
finish in a quarter second. A signal handler is structurally the wrong
instrument here — it stays as the local-Ctrl-C path and a backstop, not as the
fix.

**What replaces it:** the same log shows the post-checkout step running *after*
the cancellation, so a step guarded by `if: cancelled()` has both time and a
live process. `recordJobRun` publishes its row id to `JOB_RUN_ID_FILE`;
`scripts/settle-canceled-run.ts` settles that exact row, guarded on
`status = 'running'`. Settling **the row it knows** rather than sweeping by job
name is deliberate: the Sat/Sun seam puts two `scoreboard-loop` runs in
different concurrency groups and genuinely alive at once for ~3 minutes
(`jobs.yml:265-268`), and a name-based sweep would file the live one as
cancelled — the same class of error as calling a cancelled run healthy.

`finished_at` **is** written here, unlike 0073's swept rows: this cancellation
is recorded by something that watched it happen. A row still reading `running`
keeps the meaning OPS-4 gave it — killed hard enough that nothing got a word
in.

`0076_settle_ops4b_stragglers.sql` settles 217 and 242 on 0073's rules
(3-hour cutoff, null `finished_at`, no DELETE). **Applied to
`mjijyutmbtnwcjspozsx` as `20260820195625`** and read back: both rows
`canceled`, `finished_at` still null, **0 rows left at `running`**,
`scoreboard-loop` at **19 `ok` / 15 `canceled` / 0 stuck**. State was checked
before applying — the only two `running` rows were 16 h and 40 h old, so the
3-hour cutoff had nothing live to catch. Seven tests added (`scripts/lib/jobs-core.test.ts`) covering the
id publish, the drop on finish, the unset-env path, the observed finish time,
the `status = 'running'` guard, and the no-op on a run that finished first.

### Aug 20 — PR #103 opened; 0075 applied and read back

The four rounds went up as one PR (base `main`, everything default-off, the
taste-pass tour in the body). `0075_crowd_signs` applied to
`mjijyutmbtnwcjspozsx` via the Supabase MCP and **verified by reading the
catalog back**: 74 files / 74 recorded rows in sync (0004 has never
existed), `crowd_signs` RLS on with exactly 4 policies — crew-visible
SELECT, own-row INSERT/UPDATE/DELETE — **0 anon policies, 0 TRUNCATE
grants**. Apply-vs-deploy order was free as the migration header claims:
nothing running reads the table until the PR lands.

### Aug 20 — The Sign-Off (FUN-16): the day gets its closing beat

Owner direction request, answered with a thesis rather than a feature list:
the fun side no longer lacks parts, it lacks **composition** — a gameday
should have the shape of a broadcast (the Cover opens, the slate and the
Jumbotron carry, and nothing closed). The Sign-Off is the missing bookend:
after 9pm on a gameday with finals on the board and nothing live, the site
says "That was Saturday." — the upset or the closest call, the finals
count, how many the viewer had a piece of, and a pointer at the recap.
Same toggle, stamp and data diet as the Cover (the bookends are one
ritual). Deliberately counts **action, not results**: pick grades land
Sunday, and a Saturday-night record would be a guess wearing a number.
Preview: `/?funday=sat&daypart=lights`. Tests unchanged (pure logic is
selection over the slate payload); typecheck/lint/build green.

### Aug 20 — Round 5: the Jumbotron, the Game Flow river, The Slate Wrapped

Owner request: *"What else should we add? Come up with best-in-class ideas."*
Three picked from an offered four (swipe + instant nav declined). **Decisions
recorded, not implied:** these are features, not costume — none sits behind a
Fun Mode toggle (the Jumbotron and Wrapped are destinations you enter; Game
Flow is information, MovementChart's sibling). Game Flow's NFL prior is the
**market close** — there is no NFL model by design (SPEC §10.5), the market
is the number the product shows there, and the chart's caption says "market
prior" rather than dressing it up. Wrapped unlocks at the **CFB national
championship** and its `?preview=1` renders fixtures only — a half-season
dressed as a season would be a lie. No migrations; `src/model/` untouched.

- **The Jumbotron** (`/jumbotron`, R5-A): the leave-it-running stadium board —
  featured game at broadcast scale, rotation by a pure reducer (20s dwell,
  red-zone/closing games jump the queue, round-robin by rank so every game
  gets air), wake lock held for the couch, next-kickoffs board when nothing
  is live, `/demo/jumbotron` for the layout. **A finding worth its own line:
  the cross-league Live view's realtime subscription has been effectively
  inert since it shipped** — `fetchLiveSlate` returns a placeholder
  (seasonId, week 0) and `useGamesRealtime` pointed at it; the 30s healing
  poll was always what kept the view current. Recorded here, fixed for the
  new surface with an additive `SlateData.buckets` field and one refcounted
  channel per bucket; the slate's own view is unchanged (UX-36b's state
  machine is not where a drive-by fix belongs).
- **The Game Flow river** (game pages, finals, R5-B): the whole game's win
  probability reconstructed from stored scoring plays through `liveWinProb`
  — pregame anchor, score-after at every clocked play, computable decay
  between plays, OT in a compressed band, the terminal point pinned to the
  outcome because a final is a fact. Server SVG in the MovementChart idiom;
  the ScoringTimeline beneath is its data table. Fail-closed: no clocked
  plays or no prior → no chart. NFL preseason finals verify it today.
- **The Slate Wrapped** (`/wrapped`, R5-C): the season as scroll-snap story
  cards from the receipts — record, ledger, high water, best call, the
  contrarian, the heater, the worst beat (cover flips joined to the viewer's
  losing sides, `last_play` verbatim), the truth serum (avg CLV framed
  honestly in all four win/CLV quadrants), the crew finish. Every card skips
  honestly when its data is empty. Loader is RLS-only (home.ts query shapes;
  no definer functions). Sharing rides `/api/share-card` as a
  `kind: "wrapped"` discriminated branch — the bets payload carries no kind
  and parses exactly as before, its route test untouched and green.

37 new tests (jumbotron 13, game-flow 13, wrapped 11) — **1,767 across 127
files**, `typecheck`, `lint`, `next build` green in-session. Not yet seen
rendered on a device: the Jumbotron wants a live NFL preseason evening (wake
lock ≥30 min, rotation, a real red-zone jump), Game Flow wants any preseason
final's page, Wrapped is fixture-verified until January by construction.

### Aug 20 — Fun Mode motion: the pulse, news ripples, view transitions (FUN-13…FUN-15)

Owner follow-up to the pageantry round: *"What sort of animation could we add
to make the site alive?"* Three motion systems, chosen from a pitch and placed
**behind Fun Mode toggles** by owner decision (a new Motion group joins
Rituals and Atmosphere on `/me`; same master switch, same off-by-default).
The standing exemption row above covers them; the lines that still bind held:
**no fabricated state** (nothing tweens a score or ticks a clock — the drive
trail and momentum surge animate only observed history, which is the exact
line that disqualified `CountUp`), reduced motion flattened, compositor-only,
no new deps, migration-free.

- **The pulse (FUN-13).** Live cards breathe, and the tempo *is* the game
  state: 5.2s on an ordinary drive, 2.8s in the red zone, 1.8s inside two
  minutes. One opacity-only ring per live card, painted once — scoped by
  `.card-live`, so the 70-aura/8fps lesson stays learned. A touchdown floods
  the scoring team's end zone and drains; a game going final exhales the aura
  once before dimming. TD detection rides the card's existing score diff
  (`isTdDelta`, 6–8; a 14 is two merged updates and honestly declines).
- **News ripples (FUN-14).** Kickoff sweeps a team-color band across the card
  as the field strip wipes in (detected on the actual scheduled→live flip,
  never on mount); a score sends a wave down the ticker (changed chip +
  neighbors at 80ms steps — a traveling gradient was rejected in design: it
  fights the marquee's transform loop); the win-prob bar shimmers toward
  whoever gained on a ≥8-point swing (`probSurge`); the field strip keeps the
  drive's last spots as fading ghost dots (`drive-trail.ts`: possession
  resets, dedupe, cap 5).
- **View transitions (FUN-15).** The finding worth recording: **Next 16.3.0
  ships React's `<ViewTransition>` in the App Router with no config flag**
  (in-package docs + vendored canary verified) — but the installed
  react@19.2.8, which vitest resolves, does not export it, so all use goes
  through `src/lib/react-vt.tsx` (real component in the app, passthrough
  under tests — the shim is why all 1,729 tests stay green with zero test
  edits). Slate card ⇄ game page share `game-hero-<id>` (morph on back-nav
  and cached forwards; cold taps suspend into the loading boundary and get
  the enter — designed degradation, noted in the code). Week changes slide
  directionally via `startTransition` + `addTransitionType` with the grid
  keyed by week; scroll and the sticky chrome are untouched by construction.
  One real gap closed: the global reduced-motion clamp's selectors cannot
  match the `::view-transition-*` pseudo tree, so those get their own zeroing
  rule under the same media query.

Pure helpers all tested (`pulseCycle`, `isTdDelta`, `foldTrail`, `probSurge`,
`weekDirection`, and `underTwo` — hoisted from GameCard into `kick.ts` with
the tests it never had). **1,729 tests across 122 files**, `typecheck`,
`lint`, and `next build` green in-session. Still unrendered on a real device —
FUN-12's taste pass now covers the Motion toggles too; live NFL preseason
games exercise the pulse and ripples against real updates before Saturday.

### Aug 20 — Fun Mode: the pageantry layer (FUN-1…FUN-11)

Owner request: *"This needs to be an app that feels like Football Season… I want
immersion of the pageantry of college football. The feel of fall on a Saturday
and Sunday morning… optional toggles… I don't want it to be corny or cheesy or
AI slop at all."* Built as one master switch plus ten per-piece toggles on
`/me`, **everything off by default** — the default app is pixel-identical to
yesterday's. The safeguard exemption this required is a row in the decisions
table above; the rules that still bind (reduced motion, league rules, brand
voice, no content layout shift) are listed there too.

What shipped, in one pass (`docs/STATUS.md` FUN-1…FUN-11 for the row-level
detail): the **fall light engine** (the page ground follows the viewer's clock
through dawn haze → noon → golden hour → under the lights, every wash a
color-mix of existing tokens); **weather on the glass** (the stored forecast
rendered as rain/snow/wind/frost on live and pinned cards and the game header —
pure CSS sweeps, no canvas); the **broadcast package** (status wipes, a field
ball that travels between snaps, a possession-colored lower third); the
**rivalry takeover** (trophy games split at a chalk-stitched seam, the trophy
named in the display face); **pennants** (starred/favorite teams as felt flags
that pin their game to Focus); **ticket stubs** (a derived stub per fully
graded week of picks, the trophies idiom); **The Cover** (a gameday program
cover on first open — Graduate masthead on `.brand-surface`, the marquee
matchup as the cover story via `pickHero`, once per gameday per device);
**The Panel** (crew picks for the Game of the Week flip over one chair at a
time, last chair long — theater over RLS-visible picks only); **crowd signs**
(migration **0075**, the one schema change: one 80-char posterboard sign per
member per week, crew-visible, own-row writes, marker face — the one new font,
see the exemption row); and **The Rundown** (the first gameday slate load
arrives as a broadcast rundown, once per session).

Infrastructure is the theme's own idiom end to end: localStorage store via
`useSyncExternalStore` (`src/lib/fun-mode.ts`), a pre-paint script beside
`themeInit`, CSS gated on `html[data-fun-*]`, and preview overrides
(`?funday=sat|sun`, `?daypart=…`) so every Saturday-gated piece can be judged
on a Tuesday. Taste-critical pieces have standalone mockups in
`public/design/fun-{cover,light,signs,panel}.html`; `/demo` poses live weather
on the rivalry card. **1,712 tests across 120 files** (15 new: daypart
boundaries, preview overrides, prefs normalization, stub minting/retraction),
`typecheck`, `lint` and `next build` all green in-session.

**Not verified, stated plainly:** nothing here has been seen rendered on a real
phone — that is FUN-12, the owner taste pass, and the reason the mockups exist.
Migration 0075 is unapplied to production (soft ordering: the slate select
degrades to "no wall" until it lands). The four rejected-idea precedents this
walked past on purpose — split-flap board, `CountUp` tweening, ambient motion
beyond `[data-tint="position"]`, a chat room — were each re-checked against the
decisions table: none is re-proposed here (the Rundown staggers existing cards
rather than tweening numbers; signs are one artifact per week, not a thread).

### Aug 19 — the slate's rank stops being a footnote

Owner report: *"I don't like the rankings being behind the college football team
names on the slate. I want them in front and more prominent so they stick out
more."*

The game card rendered the rank as a 10px `text-dim` `<sup>` **after** the school
name — which is where a footnote goes. The eye reaches it having already read the
name, and at that size in a dim room it mostly did not survive the trip. On a
screen whose whole job is "is this game worth watching", a top-25 rank is one of
the two or three things that answers the question. The row now reads **"#2
Georgia"**: pip first, 13px, semibold.

**The fix was to delete markup, not add it.** The card had its own `<sup>` while
every other surface — group boards, matchup cards, the admin picker — used the
shared `RankPip`. Routing the card through the same component bought the rule the
superscript never carried: **accent when a human poll ranked them, dim when it is
only the model's own rating**. The old `<sup>` titled every rank `"Model rank"`
unless a poll existed and coloured both identically, so the card was making a
claim it could not distinguish, on a board where those two claims routinely
disagree by ten places. It also gains the `sr-only` source string the `<sup>`
never had. `RankPip` grew one `size` variant (`sm` for the dense rows, `md` for
the scoreboard row) and forks in nothing else.

Implementation mode per `docs/DESIGN.md`: **no new colour, weight, spacing or
radius**, and both sizes were already on the scale. `shrink-0` on the pip against
`min-w-0`/`truncate` on the name means a long school gives up characters before
the rank gives up existing; `.stat` keeps it tabular, so a rank changing width
shifts nothing.

Tests pin **DOM order rather than presence** — putting the pip back after the name
would still render `#4` and still pass a presence check — plus the accent/dim
split asserted in both directions. 1,697 tests across 118 files, `typecheck` and
`lint` green.

**Two things not fixed, stated rather than softened.** In light mode `--accent`
is 3.77:1 on the card face and 13px semibold is not "large text", so a
poll-ranked pip is now *less* legible than a model-ranked one, which inverts the
hierarchy the accent exists to express — that is **UX-06b**, whose colour
`docs/BRAND.md` owns, and this change makes its consequence more visible rather
than creating it. And **nothing here has been seen rendered**: there is no
`.env.local` in the build environment, so the numbers above come from the source,
the suite and the measured contrast ratios. It wants the Aug 21 real-device pass.

### Aug 19 — "too much 2025 in the number?" — asked properly, and answered no

The owner compared the live top 25 to SP+ 2026 and raised the right kind of
objection: Texas Tech at #1 (SP+: #8, AP: #12) looks like over-weighting last
season. The pattern is real and measurable — across all 138 teams the boards
correlate 0.926, but our gap vs SP+ correlates +0.18 with prior-year rating
and only +0.04 with talent, and every big divergence fits it (higher than SP+:
Utah/Vanderbilt/Iowa/Arizona, all high-prev low-talent; lower: LSU/Michigan/
Florida/Alabama, the reverse). The three stored week-1 market lines all sided
with SP+'s direction. That is a legitimate hypothesis: portal-era roster
turnover should make scoreboard carryover decay faster.

So it went to the tuners rather than to a debate, with the rule fixed first
(ship only on ≥0.003 early-week NLL over the incumbent, interior argmin, E4
agreement within one grid step) and `--tune-prior`'s grid widened to 0.30
BEFORE the run so "wants less than 0.5" could not hide at an edge. Run
32288545303, both windows:

**Lower carryover is monotonically worse.** Every step down from 0.70 costs
early-week accuracy at the wide window (0.50 costs 0.0062 NLL / 0.25 MAE;
0.30 costs 0.019 / 0.68), and the E4-only run agrees in shape with a flat
interior around 0.65–0.70 (Δ 0.0003 — noise). The pooled argmin actually sits
at 0.80 — the top edge, under the bar, and era-flipped vs E4's 0.65, so
nothing ships in either direction. `--tune-sp-blend` re-earned α = 0.5 exactly
at both windows, with pure-SP+ (α=0) worse — independent evidence against
regressing harder toward SP+-style inputs.

Verdict recorded in the decisions table: **0.70 stands, twice-earned.** The
model believing breakout seasons more than SP+ does is where its early-week
accuracy comes from, not a defect. Whether that survives contact with 2026 is
exactly what the week-1 frozen receipts and CLV grade — the honest arbiter the
product was built around. Both temp run scaffolds deleted; the widened grid
stays, with its reason in the code.

### Aug 19 — the talent the season is waiting on gets a substitute, and a tuner to judge it

The only red gate between production and 2026.5.0 is CFBD's unpublished 2026
talent composite, and the standing answer (Q1/CFBD-3) is to ship **last
season's** composite from Aug 22 — a rating with no incoming class in it. The
composite is a derived file over classes signed by February, and CFBD-1's
probe already distinguishes "raw material in, derived file missing" — but even
when it says so, nothing can act on it. What landed today is the path from the
classes to a rating, gated exactly like every other model change:

- **`scripts/lib/recruiting-talent.ts`** — trailing four classes →
  mean-of-available × 4 (≥2 classes required) → z × 5.5 clamped ±18, the
  composite's exact scale. The z is pinned to the FBS pool rather than
  inherited from the feed: `/talent` returned FBS+FCS through 2023 and
  FBS-only after (BT-6), and the substitute does not reproduce that shape
  problem. What it structurally cannot see is the portal — the model prices
  that separately, and how much the residual gap costs is the tuner's question,
  not an assumption. 8 tests.
- **`backtest.ts --tune-talent-source`** — four arms on the production-shaped
  chain, only the talent input differing: fresh composite, stale composite
  (today's fallback), recruiting classes, none. Pre-registered rule in the
  decisions table; the bar is non-inferiority against the STALE arm, because
  that is the thing it would replace — on any day CFBD has published, the
  composite is used and all of this is inert.
- **BT-6 closed on the way** — every talent-reading tuner now goes through
  `loadPriorInputs` (two private copies of the z loop deleted), which prints
  the per-season FBS∩talent join count and warns under 95%. The runtime floor
  the manifest could not be.
- **`build-preseason.ts` reads `TALENT_SOURCE`** — identity default
  `composite` reproduces every prior build byte-for-byte; `recruiting` (set
  only on the tuner's verdict) tries the class substitute before the stale
  file, floors it at 120 matched FBS teams, stamps `detail.talent_kind` on
  every component row, and `/model` renders the substitute note affirmatively.
  A healthy substitute is a `--check` note rather than a decline; a thin one
  falls through to the stale path and says so.
- **Coverage machinery extended** — `recruiting/teams` is a declared feed
  (floor 80) for the new tuner, and `probe-cfbd-history.ts` probes it
  2013–2025 counting only classes with real points. The committed manifest
  predates the feed, so a re-probe is owed with the CFBD-5 dispatch; until it
  lands the tuner warns rather than refuses, and its own Gate 0 counts the
  join at runtime either way.

The decision itself is **not taken here** — CFBD-5 in `docs/STATUS.md` owns
the dispatch and the rule acts on the numbers, not on the idea sounding right.
The idea sounding right is precisely what this table exists to check.

**Same day: the dispatch ran and the rule adopted it** (decisions table for
the numbers; all three gates passed, with the recruiting arm beating the stale
composite on every axis rather than merely staying within its bounds). Two
things the run surfaced beyond the verdict. First, the initial probe burst
tripped CFBD rate-limiting for five consecutive recruiting years — verdicts
that outlived the client's single retry and were one `--write` from being
committed as permanent ERROR rows gating every talent-reading tuner; a paced
diagnostic proved the years fine, and the probe now waits 250ms between calls.
Second, BT-6's new join-floor table came back clean: the 2017 talent file's
odd 157 rows still join 128/128 FBS ids, so the feed's shape change never cost
FBS coverage — measured now, not assumed. `TALENT_SOURCE=recruiting` is live
on every preseason build task, so the next `preseason-refresh` after merge
builds READY on the class substitute and loads 2026.5.0 with the incoming
class in the number — no Aug 22 stale-talent force needed. The dispatch could
not go through `backtest.yml` (this session's integration cannot dispatch
workflows), so a temporary push-triggered workflow ran the identical two
commands on this branch and was deleted once the numbers were recorded — runs
32278070129, 32278431303, 32278795011.

### Aug 19 — the load that could not tell you whether it worked

`load-preseason.ts` upserts rows and prints `Done: N rows loaded`. It never
reads the database back. So the job is green whenever the writes did not error,
and **a green run that loaded the wrong thing looks exactly like one that
worked** — the same shape as OPS-4 earlier tonight, where a healthy handoff and
a dead process wrote the same `job_runs` row.

That matters on a date. The Q1 escalation fires **Aug 22 at 11:00 UTC,
unattended**, and it is the first time the build → load path will ever have
completed for 2026. `docs/STATUS.md` says of the checkpoint four days later:
*"Do not let this get decided by silence."* Until now the only thing standing
between a silent bad load and Week 0 was someone reading a calendar and running
queries by hand, twice.

So `verify-preseason` asserts the post-load invariants — a full board, one
`model_version` matching the code, `team_hfa` and `preseason_components` in step
with it, `talent_stale` all-or-nothing, the halves reconstructing the overall,
and the chain intact. Chained onto every load so a bad load fails its own run,
and dispatchable. Reached only when a load actually ran, so it cannot go red on
the days the readiness gate is correctly saying "not yet".

**Against production right now it says the two true things** — better validation
than the unit tests:

```
::error:: model_version is 2026.2.0, code ships 2026.5.0 — the load did not take
::error:: team_hfa carries 70 distinct blended_hfa values; teamHfaBlend is 0,
          so a current build has exactly 1 — these rows are from an older build
```

Both clear on Aug 22 if the escalation works, and stay red if it does not. The
`team_hfa` one is the sharp check: that table is derived at build time, so it is
exactly the thing that can go stale while the ratings beside it look new.

#### Two bugs in the checker, both found by running it rather than trusting it

The halves check used a `1e-6` tolerance and flagged **64 of 138** rows.
`build-preseason` asserts the halves sum to within `1e-9` *before* rounding and
then stores all three columns at two decimals — so overall −3.15 with offense
−1.58 stores defense −1.58 and the sum is −3.16. The tolerance was measuring the
storage format, not the arithmetic. Now 0.011: two roundings of up to 0.005.

The chain check compared each team against last season's board — of which this
project has **zero rows**. The comparison set was empty, so the check passed for
every team while testing nothing. That is `--tune-team-hfa`'s Gate 0 defect
again, three weeks and one subsystem apart: an absent measurement reported as
evidence of absence. It is now a **notice rather than a failure** — loud about
being unevaluable, and not a reason to turn a good load red, which is the
cry-wolf pattern `jobs.yml` warns about in three separate places.

Also corrected: STATUS said the FBS-admission fix stopped production "pricing
Jacksonville State, Sam Houston, Kennesaw State, Missouri State and Delaware at
−30". Read against the live board, those five sit at **−3.15 to −13.90** and the
whole floor is −24.52. What is true is that all five carry `final_prev_rating`
**null** — no chain term at all, a thinner basis rather than a broken number.
The −30 came from the replay and was carried to production without being read
there.

1,682 tests (14 new). **No parameter moved.**

---

### Aug 19 — the quality floor, computed: a focus ring that only worked at night

The Aug 21 item asks for a light-mode pass with contrast "computed, never
eyeballed". So it is computed — `src/lib/contrast.ts` reads `globals.css` and
derives WCAG ratios from the palette itself, and `contrast.test.ts` pins them.
A second copy of a colour is how a palette and its accessibility guarantee stop
agreeing, so there isn't one.

**The focus-ring finding is the one worth reading.** 17 controls used
`focus:outline-none` with nothing but `focus:border-accent` to mark focus.
Measured against the idle border they replace:

| idle border | dark | light |
|---|---|---|
| `chalk/12` | 6.81 | **2.95** |
| `chalk/15` | 6.19 | **2.77** |
| `chalk/25` | 4.45 | **2.20** |

The same markup is an obvious focus change at night and a barely perceptible one
in daylight. It is invisible to anyone testing in the default theme, which is
the whole reason the light-mode pass is a separate line item. All 17 now carry
`focus-visible:outline-2 outline-offset-1 outline-accent` — the pattern the
other 23 focusable elements already use, not a new one — and a test scans every
`.tsx` so the next copied class string cannot reintroduce it.

**UX-06's three suspects are all confirmed**, and the row understated the scope.
On the card face — which is `--glass-surface` over the page, **not** `--surface`;
in dark mode #201a14, not #241d16 — light mode is legible from `/60` up and dark
from `/50`. Below that sits **164 className strings in light mode and 112 in
dark**, and the 3:1 large-text exemption applies to none of them: the usages are
9–14px.

Deliberately **not swept**. Bumping every failing step to the nearest passing one
collapses `/25` through `/55` into one value in light mode and erases the
hierarchy the ladder exists to create. The real fix is named semantic steps whose
value differs per theme — a token change plus ~164 call sites, which under
DESIGN.md means one screen converted and approved first. Not a thing to start ten
days from Week 0.

**And one the row never named: `--accent` fails AA as body text in light mode.**
`#a97b0c` on the light card is **3.77:1** — fine as a focus ring or control
border (SC 1.4.11 asks 3:1), not fine on the 11px text it carries in **277**
className strings. Dark mode is 9.46, which is why it went unnoticed. Tracked as
UX-06b and left as a decision: `--accent` is a brand colour and `docs/BRAND.md`
owns it.

Along the way the review turned up 8 form controls with no accessible name and
two email inputs missing `autocomplete`/`spellcheck` — all fixed, all in the
admin panels.

**Two things a machine could not do**, said plainly rather than implied: nothing
here was seen rendered, and the 375px real-device pass still needs hands. Also
found and not fixed: 11 admin controls and 3 slate controls are under the 44px
tap target DESIGN.md requires — a layout decision, already tracked under UX-08.

Reduced motion passes: a global clamp plus real per-component fallbacks.

1,671 tests (13 new). **No parameter moved.**

---

### Aug 19 — DQ-15 decided: an aggregate is not a book, and the fix nearly deleted three lines

CFBD's `/lines` returns a synthetic `consensus` provider **alongside** the
individual books, and the archive backfill stored it like any other. Every
consensus site takes the latest snapshot per provider and means them, so a blend
was being averaged with its own components — DQ-14's double-count under a
different name and about seventy times the reach.

**The rule: books when there are books, the aggregate alone when there are
none.** An aggregate is a bad thing to average *with* a book and a perfectly
good thing to use *instead* of one.

The fallback is the design rather than a safety net. **486 games have
`consensus` and nothing else**, and 2015–2018 has no per-book coverage in this
table at all — the only providers there are `consensus`, `teamrankings` and
`numberfire`. Deleting the aggregate would not have corrected those games, it
would have deleted their market and taken the early seasons of the puzzle
archive with them.

**`teamrankings` and `numberfire` count as books**, deliberately. They are
aggregator sites rather than sportsbooks, so the case for excluding them is
real — and refused for one decisive reason: they are the only market for
2015–2018. There is no version of that change that improves a single line.

**Landed in all three implementations at once** (migration 0074):
`consensusFromSnapshots`, the `line_consensus` view, and `make_pick`.
`consensus.ts` says the SQL "mirrors" it, and that is an obligation rather than
a note — its own header records the phantom CLV a half-point rounding mismatch
between them already caused. A test pins the migration's aggregate list against
`AGGREGATE_PROVIDERS` so they cannot drift.

#### Verifying the fix caught a regression inside it

The first cut filtered whole rows: drop the aggregate whenever any book is
present. Checking the view against the rule — rather than trusting that it did
what it said — turned up **three archive games where `consensus` posts a spread
and no total, while teamrankings and numberfire post a total and no spread**.
Row-level, "a book exists" was true, the aggregate was dropped, and the only
spread those games had became **null**. The fix was deleting lines.

The rule is now **per market**: a book that only hangs a total says nothing about
who is quoting the spread. `make_pick` needed no change, since it already selects
one market and filters its nulls before the rule applies.

#### Numbers

| | |
|---|---|
| games with a line | 9,496 |
| carrying `consensus` | 6,515 |
| carrying it beside a real book | 6,029 |
| **games whose spread moved** | **1,813** (30.1%) |
| mean shift where it moved | **0.850 pts** |
| consensus-only games preserved by the fallback | 486 |

Applied live and verified against an independently written per-market rule: **0
disagreements on spread, 0 on total** across 9,497 games, and the three broken
games no longer among the movers.

**Inert against live play.** The newest `consensus` row is 2023-09-04 — it exists
only in the archive BF-4 backfilled. No 2026 game has one, so `make_pick` and the
slate compute exactly what they computed yesterday. What changes is the puzzle
archive and anything reading a historical line.

1,658 tests. **No parameter moved.**

---

### Aug 19 — a healthy handoff that looked exactly like a dead job

`scoreboard-loop` had thirteen rows in `job_runs` reading `status = 'running'`
with a null `finished_at`. OPS-4 guessed the cause — the hourly cron overlapping
a 63-minute loop, GitHub cancelling the older run — and the guess was right.
It was also confirmable from `job_runs` alone; the Actions list the row said to
check was never needed.

A run is stuck **exactly when the next one starts before it ends**: 03:50 stuck
/ 04:39 ok, 10:17 stuck / 11:15 ok, and the 20:31 → 21:28 → 22:30 chain all
stuck with 23:28 ok. `jobs.yml` sets `concurrency: cancel-in-progress: true`,
commented "the hourly scoreboard loops overlap by design; the new run replaces
the old". So the cancellation is the design working, and one healthy handoff per
hour of live football was writing a row shaped like a job that died.

**The tracked mechanism was wrong, and the correction moved the fix.** OPS-4
called it "a hole in the thing that is supposed to notice holes" because the
watchdog reads `job_runs`. It does — but `watchdogJob`'s `lastOkAgeH` filters
`.eq("status", "ok")`, so a stuck `running` row was never counted as a success
and never blinded it. The watchdog was fine throughout.

The real blind spot was **`/admin`**. Its freshness card takes the latest run per
job and calls anything that is not `error` healthy, so a cancelled row rendered
green — and so would a loop that had genuinely crashed, in the one place someone
would look.

Both halves fixed:

- `recordJobRun` traps SIGINT/SIGTERM and writes `canceled`. Recording it when
  it happens beats sweeping stale rows later, and it leaves a lingering
  `running` row meaning something real: killed hard enough that even the handler
  did not land.
- The card shows a `running` row older than three hours as **"never finished"**
  in amber. Three hours because the longest job is the ~63-minute loop; a run
  inside that window is left alone, since asserting it is dead is the same
  mistake in the other direction.

**The database caught a bug that would otherwise have shipped silently.**
`job_runs_status_check` was `IN ('running','ok','error')` and refused
`canceled` — the migration failed on its first attempt, which is the only
reason anyone found out. `recordJobRun`'s `finish` swallows write errors *on
purpose* ("observability must never break the thing it observes"), so the
constraint violation would have been caught and dropped, the row would have
stayed `running`, and the fix would have looked shipped while doing nothing at
all. Migration **0073** widens the constraint and settles the thirteen rows, and
**must be applied before the deploy** — it is inert against the running code,
which is what makes that ordering safe.

`finished_at` stays null on the settled rows. Setting it to `started_at` would
claim a zero-second run and `started_at + 63 minutes` would be a guess wearing a
timestamp; nobody observed these finish, and that is what a null says — the rule
`backfillSnapshotRows` already applies to a line with no kickoff.

Applied live and verified: scoreboard-loop reads **15 `ok` / 13 `canceled` / 0
stuck**. 1,650 tests (4 new). **No parameter moved.**

---

### Aug 19 — one book under two names, and the tracked row was wrong about the fix

DQ-14 said "one book is stored under two provider names" on game 401873278, and
prescribed normalising in the ESPN parser. Both halves were wrong, and the
second one changed what the fix had to be.

Reading `line_snapshots` instead of the one game: it is **82 games**, and
`Draft Kings` splits **102 rows from `cfbd-backfill` against 33 from `espn`**.
Fixing the ESPN parser alone would have left three quarters of the defect in
place and ticked the box — CFBD emits both spellings too.

So: one normaliser in `src/lib/providers.ts`, applied at all four writers of
`line_snapshots`, with a test that fails if a writer stops using it. It matches
on the name with casing, spacing and punctuation squashed out, so the next
spelling of a book already here ("DRAFTKINGS", "draft-kings") lands without
another edit. A rename list only catches the variants already observed, which is
how this got past two audits.

Why it matters at all: `consensusFromSnapshots` takes the latest row **per
provider** and means them, so a book under two spellings is averaged against
itself and carries double the weight of every other book. On the real shape from
game 401762521 — the same book at −6.0 and −6.5 under two names, against one
other book at −3.0 — the split consensus is **−5.0** and the correct one is
**−4.5**. Still a plausible half-point, which is exactly why nobody noticed.

**Regional books are deliberately not merged.** `Caesars`, `Caesars
(Pennsylvania)` and `Caesars Sportsbook (Colorado)` look like the same defect
and are not: their date ranges are disjoint and they co-occur on **0 of 9,496**
games. Merging them would invent a double-count rather than remove one.

Migration **0072** renames the existing rows and then dedupes. The dedupe is not
housekeeping — 1,487 (game_id, provider, captured_at) groups hold more than one
row once the rename collapses the spellings, and in **9 of them the rows
disagree on the spread**. There the latest-per-provider fold picks whichever row
came back first, so the consensus line would be nondeterministic: today's answer
and tomorrow's could differ with no write in between. That is worse than the
double-count it replaces. Highest `id` wins, which is the precedence an
append-only table already implies.

**And the bigger one it turned up: `consensus` is stored as if it were a book.**
CFBD's `/lines` returns a synthetic `consensus` provider beside the individual
books, and the archive backfill stores it like any other — so the mean averages
a blend against its own components. **6,029 games** carry it beside a real book
and it **changes the snapped line on 1,823 of them (30%)**, mean absolute gap
0.768 points. Archive only; the newest such row is 2023-09-04, so no Week 0
grading reads one. Recorded as **DQ-15** rather than fixed here, because it is a
decision: deleting the rows would remove the **486 games where `consensus` is
the only market**, and there is a second question behind it — `teamrankings` and
`numberfire` are aggregators rather than sportsbooks, and whether they count as
books is an owner's call rather than a lookup.

1,646 tests (11 new). **No parameter moved.**

---

### Aug 19 — the coverage manifest lands, and the probe's own count was the bug

`scripts/lib/cfbd-coverage.json` is now a reviewed fact rather than an empty
placeholder: `probedAt: 2026-08-19`, 78 rows, from run `32208194660`. That flips
`assertFeedCoverage` from a warning into a gate — a tuner whose feed is thin for
the old end of the window now refuses to print a number instead of quietly
scoring fewer seasons than its label claims.

**The load-bearing row: `/ratings/sp` 2014 is OK at 129 rows.** A 2015 season
seeds its priors from 2014 SP+, so the 2015–2025 default window that shipped on
Aug 18 now rests on a measurement rather than an assumption.

**Two constraints the probe found, both permanent.**

| Feed | Coverage | What it costs |
|---|---|---|
| `ratings/elo@wk1` | thin 2015–2021 (78–96 rows vs. a floor of 100), OK 2022–2025 (131–136) | `--tune-anchors` is confined to the recent end however wide the window gets. It was one of the two near-miss re-tests; that re-test cannot be run on the wide corpus at all. |
| `stats/game/advanced` | thin 2020 only (70 rows) | Nothing. 2020 is chain-only and unscored, so `--tune-epa` never reads it. |

Checked against the real default window before committing: of the seventeen
entries in `FEED_REQUIREMENTS`, **sixteen pass and only `--tune-anchors` is
refused** — with an error that names its own fix (`--seasons=2021-2025`) rather
than just stopping. `--tune-epa` passing on a window whose 2020 is thin is the
`scored`/`all` split doing exactly what it was built for.

**The first run's answer was wrong, and the shape of the wrongness is why.**
Run `32206890515` reported `rankings@wk1` as thin for *all eleven* seasons.
Uniformity across a decade is the signature of a broken instrument, not a
broken feed — genuine coverage gaps vary by year. `/rankings` returns an array
of WEEK objects with the ranked teams nested at `polls[].ranks[]`, so a
single-week query is length 1 against a floor of 20, in every season, forever.
The probe was counting weeks and calling them teams.

Fixed by letting a feed declare *how* it is counted rather than special-casing
this one, so the next nested payload does not repeat it silently. On the re-run
`rankings@wk1` is OK for all eleven at 125–250 ranked teams, and **every other
row is unchanged** — which is the check that matters: a fix that had moved other
rows would have been a second bug.

**One thing the floor cannot see, recorded as BT-6 rather than fixed here.**
`talent` runs 232, 237, **157**, 237, 231, 219, 224, 233, 240, **134**, **134**
for 2015→2025 — the feed looks like FBS+FCS in the older seasons and FBS-only
from 2024, and 2017 is an outlier at 157 against ~235 either side. Every season
clears the floor of 100, so the gate passes and will keep passing. The floor
asks whether the join lands at all; it does not ask whether it landed for the
same population each season, and six experiments read this feed. Settling it is
a per-season set intersection over already-cached data and zero CFBD calls.

The manifest from the first run was deliberately not committed. Freezing a wrong
verdict into the file that gates the tuners is worse than having no file, because
the wrong file stops warning.

Also: `jobs.yml` now prints the written manifest into the run summary as well as
uploading it. The step comment already asked for a by-hand review, and an
artifact you have to download and unzip is a worse review surface than a diff —
and it expires, while the run's summary does not. `tee -a`, not `>>`: sending a
group's stdout straight at `$GITHUB_STEP_SUMMARY` writes the file and leaves the
job log empty.

**No parameter moved.** The count fix and the summary print are PR #94; the manifest itself is committed separately, since it is data the fix produced rather than part of the fix.

---

### Aug 18 — the backtest window opens to 2015, and the FBS pool turns out to have been frozen

**The question was whether the archive backfill could tune the model. It could
not, directly — and the answer it did give was worth more.**

The 2015–22 backfill (BF-4) writes to **Supabase**. The tuner reads the **CFBD
REST API** into `.backtest-cache/`. Two independent corpora, nothing wiring them
together, and the tuner cannot see a single row the backfill wrote. What the
backfill settled, for free, is the question that had kept the window at three
seasons: **CFBD line coverage runs 95–100% per season back to 2015**, against a
55–70% guess. Every tuner scores against a stored spread, so thin old-season
lines was the plausible blocker, and it is not real.

So the window widened. `SEASONS`/`SCORED` are parsed from argv
(`scripts/lib/window.ts`), the default is **2015–2025**, and
`--seasons=2023-2025` reaches the old one. 2015 is the SP+-seeded warm-up and
**2020 is chain-only** — replayed so the prior chain into 2021 is unbroken,
scored by nothing, because empty stadiums collapse HFA league-wide and the
Pac-12 played no non-conference games at all. Nine scored seasons where there
were two.

**What widening it first turned up is a defect, not a gain.** The FBS pool was
frozen at one season's SP+ membership for the entire window — see Methodology
findings, which is where this belongs, because the transferable part is the
shape rather than the fix. `admitNewFbs` (`scripts/lib/replay.ts`) now admits a
team the season it appears in SP+ and retires one the season it leaves, gated on
the feed being healthy so a thin year cannot mass-relegate the league. It is
applied inside `replaySeason` rather than in each caller's chain loop: there are
a dozen such loops and a membership fix applied to eleven of them is worse than
none, because the twelfth would produce a number that looks comparable and is
not.

Landed with it:

- **`--tune-team-hfa`** (02:M-05 / 03:M-1v), which STATUS had recorded as
  blocked on CFBD publishing 2026 data. Wrong blocker: the point-in-time
  question — build each team's HFA from seasons **before** S, price S with it,
  score S — needs prior seasons, and prior seasons are what just arrived.
  `replaySeason` accepts `hfaByTeam`, which closes the gap that made audit
  03:M-1 invisible to every calibration report ever run: production priced with
  a per-team table and the replay priced with a scalar. Gate 0 is a split-half
  correlation, deliberately an **identification** test rather than an accuracy
  one — if a team's home edge does not reproduce against itself on disjoint
  samples, no MAE number could mean anything.
- **Per-season FCS membership** in `--tune-fcs`. `fcsMarginsVsFbs` now accepts a
  per-season lookup as well as a set, because James Madison's games are buy
  games through 2021 and FBS games from 2022, and one set has to be wrong about
  one half or the other.
- **A coverage probe and a committed manifest.**
  `scripts/probe-cfbd-history.ts` (78 calls, one time) measures per-season row
  counts for SP+, talent, returning production, PPA, Elo and polls;
  `scripts/lib/coverage.ts` refuses a window whose feeds a tuner cannot cover,
  reading the committed manifest so the check costs no calls and runs in CI
  without a key. Unprobed warns; probed-and-empty throws, naming the narrower
  window that would work. Games and lines are deliberately not probed — BF-4
  already answered that from Supabase for nothing.
- **Era reporting, mandatory.** `scripts/lib/eras.ts` fixes boundaries on rule
  changes *before* any wide-window number exists: E1 2015–17 pre-portal, E2
  2018–19 portal without the one-time-transfer exception, E3 2021–23 one-time
  transfer and NIL, E4 2024–25 realignment and the twelve-team playoff. Every
  tuner prints per-season and per-era metrics, and `--tune-churn` now evaluates
  the era-flip rule rather than merely describing it. This is Q8's complaint —
  "fitted against a distribution that no longer exists" — generalised: a
  parameter pooled over eleven seasons has that defect structurally.
- **All tuners now score `SCORED`.** Only the prior-construction tuners did;
  `--tune`, `--tune-hfa`, `--tune-epa` and `--tune-sigma` pooled every loaded
  season including the SP+-seeded bootstrap. Tolerable at one season in three,
  not once the window also contains COVID.
- **The market bar calibrates itself.** `MARKET_MAE = 11.98` was a 2023–25
  measurement policing whatever window ran. It is computed from the loaded
  predictions now, so `warnIfTooGood` cannot cry leak on an old season or miss a
  real one.
- **The PPA index is built only when something reads it.** At the shipped
  `epaWeight` of 0, `blendedPoints` returns the raw score before touching it, so
  `efficiencyMargins` was a Map over ~10k rows per season per grid point feeding
  a weight of zero — 440 of them in a wide `--tune-churn`. The advanced fetch is
  now opt-in and its failures are logged rather than swallowed.

**No parameter moved.** Everything here is window plumbing, a membership
correctness fix, reporting, and one new registered experiment. `DEFAULT_PARAMS`
is untouched.

#### The numbers, from runs 32186646908 and 32187035313 (BT-4 paid)

Three readings, so the code change and the window change are separated rather
than confused with each other. The reference-window run is reproducible at any
time with `--seasons=2023-2025`; the third column is what the docs had recorded.

| | 2015–2025 (new default) | 2023–2025 (reference) | 2023–2025 as recorded (Aug 15) |
|---|---|---|---|
| scored seasons | 9 | 2 | 3 |
| margin MAE | 13.37 | **12.93** | 13.25 |
| σ | 16.89 | 16.28 | 16.67 |
| bias (actual − model) | −0.09 ± 0.19 | +0.60 ± 0.39 | +0.03 ± 0.33 |
| totals MAE (model/market) | 13.40 / 12.72 | 13.02 / 12.44 | 13.09 / 12.51 |
| edge flags ≥2 | 48.3% (n=5130) | 50.2% (n=1173) | 49.6% (n=1825) |
| `--diagnose-edges` b₁ | **−0.043 (t=−1.46)** | — | +0.035 (t=0.83) |
| b₂ (market) | 1.035 (t=37.61) | — | 0.985 (t=22.87) |
| n | 7639 | — | 2611 |
| market MAE | **12.24** | — | 11.98 |

Read the second and third columns together carefully: they are not the same
sample. The recorded run scored three seasons including the SP+-seeded
bootstrap; every tuner now excludes it. On an identical 2,629-game basis the
code change is **13.25 → 12.96**, and BT-3's own control says the whole of that
is the FBS fix.

Four things worth pulling out:

- **The edge gate fails harder, and the sign flipped.** b₁ = −0.043 (t = −1.46)
  against +0.035 (t = 0.83). Not significant either way, but at n = 7,639
  "the model adds nothing beyond the close" is a much tighter statement than it
  was at n = 2,611. Every one of the five tier tests is also negative now.
- **The market's own MAE is window-dependent** — 11.98 on 2023–25, **12.24** on
  2015–2025 — which is why `warnIfTooGood`'s bar had to stop being a constant.
  A 2023–25 number policing an eleven-season run would have been wrong in both
  directions.
- **2020's chain-only row behaved exactly as pre-registered.** The prediction
  was a strongly negative home-signed bias — empty stadiums, so we over-predict
  the home side. It came in at **−1.98 ± 0.73**, the most negative of all eleven
  seasons. That is a free integrity check on the whole exclusion mechanism, and
  it passed.
- **The model is better on recent football**: E1 13.90 → E2 13.34 → E3 13.28 →
  E4 13.05. Unsurprising, since every parameter was fitted on 2023–25 — but it
  is now visible rather than assumed, which is what the era tables are for.

#### The window changed, and that restates things

Every figure in this file and in STATUS predating today was computed on
2023–2025. Making 2015–2025 the default means the calibration report is no
longer comparable to its own past, which is the same objection STATUS raises for
not silently lifting the replay's preseason tilt to 0.4. Recorded here rather
than absorbed:

- The reference window is reachable exactly — `--seasons=2023-2025` reproduces
  the old split (`SCORED` = 2024, 2025) and is pinned by a test.
- **The side-by-side restatement is paid** — see the table above, and note that
  it is now paid *continuously*: `backtest.yml` runs the reference window beside
  the default on every model PR, so the comparison cannot go stale the way a
  changelog entry written once does.
- Every decisions-table row from here carries its window label. The runner
  prints it and says so.

Also: 2020's unscored row is a free integrity check. It should show a strongly
negative home-signed bias — we over-predict the home side in empty stadiums. If
it does not, the exclusion machinery is broken rather than 2020 being normal.

### Aug 18 — the survivor board reads as a ledger (PR #88)

Follow-up to the receipt work below, same report: *"Will it show who I've picked
this season and can we add a strike through on teams that a user has picked since
they are unable to pick them again."*

The first half already shipped — the **Your picks** log is the season, week by
week. The second half is the board, and it was under-saying what it knew. A
spent team was drawn like any other refusal: dimmed, an `X`, and the caption
"already used". But the three refusals are not the same size. "Kicked off" comes
back next week and "out of pool" was never yours; **a spent team is gone for the
season**, and that is the one piece of bookkeeping the whole format runs on.

So a used team is now **struck through**, and the caption names the week that
spent it — **"used Week 3"**, not "already used". The second half of that is
a promise `SurvivorPicker`'s own doc comment had been making since 0053 (*"Used
in week 3" and "kicked off" are different problems with different answers*)
while `BLOCK_WORD` said neither. `SurvivorHome` already holds `me.weeks`, so it
is a map, not a query.

Struck only where the database would actually refuse: a `reuse_teams` pool
produces no `used` block at all, so nothing is struck in one. Not colour and not
opacity alone — `line-through` survives a dim room and does not depend on the
10px caption being read first. `tsc`, lint, `next build` and 1316 tests clean; no
new tests, since the rule being rendered (`blockReason` → `used`) is already
pinned by three.

### Aug 18 — the survivor pick that never said it landed (PR #88)

**Owner report:** *"The Survivor Pool Group doesn't do anything when you click a
team for that week. I just selected one and there isn't a review picks or any
action item to see if the bet was confirmed. There's no action items or
anything."*

**The pick was going in.** `make_survivor_pick` had every rule it needs and the
row was being written; what was missing was every part of the app that says so.
Three of them, and the first is a regression of a lesson this repo had already
paid for:

1. **The board disabled itself on every write.** `disabled={blocked || pending}`
   greyed all ~30 buttons for the length of the round-trip and brought them back
   looking the same. That is audit **08/UX-10** exactly — the treatment
   `PickButtons` abandoned in August because it "reads as *my tap did nothing*
   for the whole round-trip". Survivor was written after that fix and did not
   inherit it.
2. **The confirmation was a border colour.** One button of thirty picked up
   `border-accent`, and the only sentence about it was an 11px caption above the
   list — off-screen by the time you have scrolled to the game you want.
3. **There was no bottom bar and no review destination.** Pick'em has had one
   since `PickBoard`: what you hold, that it saved, and *Review picks*.
   Survivor — the format where you make exactly **one** pick a week, so the
   stakes per tap are highest — had neither, and
   `/groups/[slug]/week/[week]` redirects a survivor pool back home, so there was
   nowhere to go and check.

**Fixed by giving survivor what pick'em already had**, rather than inventing a
treatment for it: per-button in-flight state with nothing disabled by a write
that is out; a receipt on the card you tapped ("Georgia is your pick · saved",
"tap again to clear"); and the same fixed thumb-zone bar, same offsets and same
glass tokens as `PickBoard`, carrying the held crest, the save state, and a link
to a new **Your picks** section — the pool's season as a week-by-week log
(week, crest, survived/lost/tied/no pick) instead of the undifferentiated row of
crests that was the only history on the page.

**Two bugs fell out of reading it.** The board was drawing your own current pick
with the caption **"already used"**, because `usedTeamIds` includes the week
being viewed and that is what `blockReason` was given — a refusal
`make_survivor_pick` deliberately does *not* make (0053 excludes the week being
written, so re-picking the same team is the no-op it looks like).
`teamsSpentElsewhere` is the fix. And a **held pick stayed tappable after its
own kickoff**, because `blocked` was suppressed whenever `chosen`, while
`remove_survivor_pick` refuses with "Kickoff — that pick is locked." — so the
one control that looked live on a locked card could only produce an error. It
now reads "locked in" and is disabled.

No migration and no RPC change: every rule was already enforced in 0053, and
none of this touches what is allowed — only what the screen admits to. 3 tests
(1313 → 1316), `tsc`, lint and `next build` clean. **Not seen rendered** — no
survivor pool exists in the live database to open (`groups where kind =
'survivor'` was 0 rows at the last check), so the layout claims here are read
off the shared `PickBoard` bar rather than off a screenshot.

### Aug 18 — the roster was never there: PGRST201, five days silent

A screenshot settled it. The Degens page said **"0 bettors"** and, under the
roster shipped an hour earlier, **"MEMBERS · 0 people"** — while the add box
refused hayden as *already in this group*. Both statements were true. The
membership row existed; the query that reads rosters could not read it.

**`group_members` has two foreign keys to `profiles`.** `user_id` since 0020,
and `removed_by` since **0038** — the SEC-02 fix on Aug 13. From that moment
PostgREST could not tell which relationship `profiles!inner(…)` meant, and
answered every roster read with `PGRST201`, "Could not embed because more than
one relationship was found". Reproduced against the live REST API before
changing a line, and fixed by naming the constraint:
`profiles!group_members_user_id_fkey(id, display_name)`.

**What that cost.** `fetchGroupMembers` is the roster: pick'em standings, the
betting sheet and its header count, survivor standings, the week grid, the picks
page, the arcade, the settings roster. All of them have rendered an empty list —
confidently, with a count of zero — for five days. It is also the real reason
the add-by-name feature "didn't pop anywhere": GRP-3 built a roster section on
top of a query that returns nothing, and shipped an empty box.

**The five days are the actual defect.** The function read
`const { data } = await …` and returned `[]` when the query failed, so a broken
request and an empty group produced the same answer. That is the shape this repo
keeps finding — audit bug #9, P2-5, the watchdog's `{notified: 0}` — a path
reporting success without having verified the thing its caller believes it
verified. It now throws. A group always has at least one member, because the
deferred keep-admin trigger (0020) will not permit otherwise, so "no rows" is
never a truthful answer here; an error page is worse to look at and better to
have, because somebody reports it the same day.

**Guarded by tests that read the request string**, since no mock of a Supabase
client can see PostgREST's parser and the DB suite never speaks HTTP. Blunt, and
the only kind that could have caught this — both checked failing against the
pre-fix source. The schema was audited rather than assumed:
`group_members → profiles` is the only multi-FK pair anything in the codebase
embeds. No migration. 3 tests (1310 → 1313).

### Aug 18 — a group with no roster

**Owner report, minutes after the add-by-name feature shipped:** *"I had added
hayden, i assume successfully, but it didn't pop anywhere that he was in the
group. I want a member roster."*

The add had worked. The membership row was written at 03:18:49, and the GRP-2
notification fired and recorded `skipped — no devices` — correct, for somebody
who has never installed the app to a Home Screen. Everything downstream of the
button was right and there was still nothing on any screen that said "he's in",
which is the only part the person pressing it can see.

**Every group home already listed its members. None of them listed membership.**
Pick'em ranks people by record, a betting group by units, survivor by who is
still alive. All three build that list from the roster, so hayden *was* on the
Degens page — as the second row of a units leaderboard, with an em dash for a
record and "nothing graded yet" under his name. That reads as a rounding error,
not as a member, and it is not what somebody checks when the question is "did it
work". A leaderboard answers *how is everyone doing*; nothing answered *who is
in here*.

So: `GroupRoster`, on all three homes, last on the page because it is a
reference rather than something anyone glances at during a game. Names, who runs
the place, and when each person came in. `joinedLabel` gives the recent days
words instead of a date — "joined today" is the sentence the report was asking
for — and compares **calendar days in the group's timezone**, not elapsed hours,
because somebody added at 11pm was added today and the one person able to check
that is the person it is about. The header counts ("2 bettors", "5 members")
were dead ends that said how many and never who; they are now links to it.

The same label rides each row of the settings roster too. That is the screen the
admin is standing on when they press Add, so it is where "it worked" has to be
legible.

No migration — `group_members.joined_at` has been there since 0020, and
`fetchGroupMembers` simply never selected it. 9 tests (1301 → 1310).

### Aug 18 — a second door into a group: by name

**Owner request:** "I want to be able to add people to groups by name along
with join code." Along with, not instead of — the code is still the only path
for a person the admin cannot see yet, and it is untouched.

**What the code costs when everyone already has an account.** Signing up here is
invite-only, so by the time an admin wants somebody in a pool that person is
already a row in `profiles`. The code then buys nothing and costs three steps
that each fail silently: it has to be sent, read off a screen, and typed into a
box the recipient has to find. `join_group` is a boundary and earns its entropy
and its throttle (0039) because the caller is asserting a claim about
themselves. An admin naming an existing account is asserting a privilege they
demonstrably hold, so `add_group_member` gates on `is_group_admin` and throttles
nothing — the worst case is a wrong person added to a group the admin already
runs, and they can remove them again.

**Migration 0064.** Three functions: `search_group_candidates` (admin-gated,
returns membership state rather than filtering members out, escapes `%` and `_`
so a name is a name, and answers nothing under two characters), plus
`add_group_member(uuid)` and `add_group_member_by_name(text)`. The insert is
`join_group`'s minus the code and the throttle, and deliberately keeps its role
rule from SEC-02 (0038): rejoining restores the row and restores the *role* only
if you left on your own. Removed by an admin, re-added by an admin, you come
back a member — one rule, two doors, rather than a second door that quietly
undoes the first one's fix.

**`display_name` has no unique constraint** (0001:181) and never has. The typed
name is therefore ambiguous by construction, and the function refuses a shared
name instead of resolving it — `min(uuid)` does not exist before Postgres 18,
which is how the first version of this failed the DB suite, and it should not
have been reaching for one anyway. The search returns ids, so the UI's Add
button never goes through the name at all; the typed path exists for the admin
who knows exactly who they mean, and it says so when it cannot be sure.

**And then notified — GRP-2, migrations 0065/0066.** Being added is not
consented to, and unlike the code there is no moment where the person does
something: nobody types a join code by accident. So the add announces itself.
The kind ships `default_enabled` **true**, which is the opposite of bad beats
and for the opposite reason — that one is a firehose, this one fires a handful
of times ever and is always about you, so silent-by-default would miss exactly
the people who have never opened the notification settings. The copy names the
admin: "you were added to Saturday Boys" reads like something the site did,
where "Chase added you" is a person, and a person is who you ask about it.

The send runs inside `next/server`'s `after()` — a push is two round-trips to a
push service and the admin is waiting on a roster that has already changed — and
it swallows its own failures on purpose. A notification that failed to send is
not a membership that failed to happen, and reporting it as one would be a lie
about what the button did. The subject is the group, so it fires once per person
per group, ever; somebody removed and re-added a season later is told nothing,
which is the same trade the receipt table makes everywhere else.

**Found in passing:** `updateNotificationSetting`'s allowlist never carried
`watchdog`. 0037 says "the copy is editable from /admin like every other kind"
and it has been false since the day it was written — the allowlist predates the
kind. One word, fixed alongside.

**A thing found while wiring it up.** `/groups/[slug]/settings` redirected every
group that was not pick'em, because the page is built around the board. So a
betting or survivor admin had no page for the roster, the name, the visibility,
the join code or archiving — five RPCs with nothing calling them, the same shape
as the finding that produced `GroupAdmin` in the first place. The board load is
now a `loadBoard` split that runs for a pick'em admin only (it had been fetching
the whole slate for plain members as well), `GroupAdmin` hides the two controls
that are pick'em's alone, and both other homes gained the Members link they
never had.

27 DB assertions (327 → 354) and 9 tests (1292 → 1301), including the one that
matters most: two accounts sharing a name, the second row clicked, and the add
going by **id**. ✅ 0064–0066 applied to production 2026-08-18, in
order and before the deploy — functions, an enum value and a settings row, all
inert against the running code, and verified afterwards against the live
database (see `docs/STATUS.md` §1).

### Aug 18 — the talent gate: an instrument, and an override

**The question was "which CFBD feed are we waiting on?" and the product could
not answer it.** It could answer the consequence — `build-preseason --check`
prints one line per failing gate, and the Aug 17 11:15 UTC `preseason-refresh`
printed exactly one, `talent: 2026 not published, using 2025` — but nothing
anywhere printed a row count for `/talent`, and the difference matters. Five of
the six gates were green (returning production, portal, coaches, week-1 lines,
the ≥10 cross-tier games the tier recentre needs) and the build reached a full
138-team board on the 2025 file before refusing to load it. So the wait is one
file wide, and that was reconstructed from a workflow log rather than read off
an instrument.

**CFBD-1 — the access probe never looked at the inputs.** `probe-cfbd.ts`
covered 11 endpoints and none of them was `/talent`, `/player/returning`,
`/player/portal` or `/coaches`. Not an oversight so much as a category error:
the probe answers *tier* questions, and those four need no paid tier, so they
were never in scope. The cost is that "CFBD has not published it" was an
inference. A sound one — `cfbd.ts:69` throws on any non-2xx, so a renamed route
or a revoked key turns the job red rather than printing "not published" — but
it is reasoning nobody re-derives on a Tuesday morning, and it has one hole:
`/talent` empty for a *completed* season would print the same sentence forever.

Now a second table, six calls, probed at SEASON where the access table is
probed at SEASON−1 — because in the readiness table EMPTY is the answer, not a
fault. Two of the six are controls rather than inputs: `/talent` at SEASON−1
proves the route works, and `/recruiting/teams` at SEASON says whether the
composite's raw material is in while the composite is not. `talentReadiness`
(pure, 6 tests) turns the three into one of three verdicts, and the gating is
the point: **broken is red, unpublished is green.** Waiting out a bug and
waiting out CFBD must not produce the same coloured run — the same rule that
killed `emptyIsHealthy` and the 20-byte backup artifact. Probe cost 11 → 17
calls, against a 30,000/month budget running near 10,000.

**CFBD-2 — Q1's override, wired before it is needed.** `--check --force` prints
every problem and exits 0 anyway; the new `preseason-force` task runs the whole
sequence (gate, build, load). Dispatch-only and pinned by a test: a readiness
gate that can override itself on a cron is not a gate. The daily job and
`preseason-bootstrap` share the branch and must not carry the flag, so the test
asserts both halves.

A forced build ships a knowingly degraded rating, which is only defensible if
it says so where people read it. Every `preseason_components.detail` now
carries `talent_source` and `talent_stale`; `/model` renders a note off them
and a rebuild on the real file clears it. `talentProvenance` only ever renders
the affirmative — rows written before the stamp exists (production's 2026.2.0
build, every backfill) carry neither field, and absence has to read as unknown.
Inferring "fresh" from silence is the defect this repo keeps finding; it is not
being introduced on the page whose job is provenance. 7 tests, and `/model`
goes dynamic for one indexed read — `required()`, because a dropped error there
would render a page with no note, which is exactly what a healthy build looks
like.

**CFBD-3 — Q1 answered yes, same day, and dated into the job.** Owner call. The
override stops being a thing somebody has to remember: from **Aug 22**
`preseason-refresh` carries `--force` itself and loads the best build available.
`preseason-force` stays for doing it sooner by hand.

The ladder was notice (quiet green through Aug 19) → alarm (red from Aug 20) →
nothing. The missing rung was a human seeing a red run on the right morning,
which is the failure this checkpoint's own instruction warns about: *do not let
this get decided by silence*. A date is that decision recorded once instead of
re-made every morning, and it is safe for the same reason `--force` was cheap to
build: it changes no number. On a day CFBD has published, the flag is inert and
this is an ordinary refresh. On any other day the build carries last season's
talent, says so on `/model`, and a later refresh overwrites it in place —
`ratings` and `preseason_components` are both keyed on `(season, team)`, so the
good build lands on top and rewrites `talent_stale` to false with no cleanup.

`preseason-bootstrap` is excluded by name, because it writes the append-only
tables and a season's first load is not something a date should decide. The test
reads the condition rather than the flag, so hoisting `--force` onto the shared
invocation fails it.

One consequence worth stating plainly, because it bounds everything above: the
window closes at the first final. `load-preseason` refuses a season with
completed games, `ratings-update` owns the numbers from then on, and the last
automatic chance to pick up real talent is the **Aug 27 11:00 UTC** refresh.
Talent published in September does not get loaded at all.

**No model change.** No parameter moved, and `--force` changes no number — the
build already falls back. What changed is whether the gate stops the load, and
whether the fallback is visible afterwards.

### Aug 18 — Guess the Game is replaced by three games, tried side by side

Owner: *"I like the concept, but it's way too random. There's hardly any trivia
around it and just trying to randomly guess a team. We need to come up with
something else."* Asked for a handful of thought-out options, picked three of
them, and asked to see how they play.

**The diagnosis, because it is half the design.** Two independent causes, both
in the code. `cfbDeck` takes every CFB regular-season final we hold a score for,
uniformly weighted — so most days the puzzle is a Tuesday MACtion game nobody
watched, and knowing football cannot help because there is nothing to know. And
`gtgHints` carries almost no information until its last rung: a final score
narrows 266 teams to 266, a record to ~130, a conference to ~16, and the
visitors to one. Burning guesses to reach rung four is the rational play, which
is exactly what "randomly guessing a team" feels like.

**SAL-1 fixes the first half and no mechanic change could.** A better question
about a forgettable game is still a question about a forgettable game.
`salienceScore` ranks how much a game was an *event*. The weights are a
judgement and are labelled as one — there is no training signal for
"memorable" — so the tests pin properties instead: total-nullability (a NaN
would make `Array.sort` order-dependent garbage and corrupt the deck silently),
monotonicity per term, and a **golden ordering** over four real games. That last
one is the only test that catches weights which are individually sensible and
collectively wrong, which is what the complaint was actually about.

**The three, and what each is for.**

*The Tape* (`/tape`) inverts the ask. The game is named up front with crests,
then five questions arrive one at a time: who won · who was favoured · by how
much · over or under the real closing total · was the home team ranked that
week. Worst case is one in four instead of one in 266, and the questions chain,
so it rewards reasoning as well as recall.

*Chains* (`/chains`) is a fixed daily run of higher-or-lower. Structurally it
cannot be the thing complained about: there is no space to guess into, and the
only thing that moves you off a coin flip is knowing something.

*Depth Chart* (`/depth-chart`) is sixteen teams and four hidden groups of four.

**Three decisions worth recording because they were close.**

1. **Answers are frozen at generation.** `six-pack.ts`'s closure rule says a
   question must settle from the slate's own games so the grader never waits
   forever. For a game played in 2018 the risk is not grading, it is
   generation — so the rule is applied a step earlier and comes out stronger: a
   question is minted only if its answer is already computable, and stored with
   it. No pending state, no settler returning null, no re-grade. A corrected
   poll row next season cannot restate an answer somebody was already scored
   against.

2. **Generated ahead with a queue, not computed on read.** This is GTG-1's
   lesson made structural. Guess the Game hashed the day against a deck read at
   request time: no job, no cadence, nothing that could be late — which is why
   its empty deck went unnoticed for weeks. `daily-puzzles` banks a fortnight
   and **fails below four days**, so a transient error with the queue full is a
   green run carrying an error string, and a generator broken for ten days is a
   red one, days before any player sees an empty screen. The rendezvous hash did
   not go away; it moved inside the generator, so the same day still yields the
   same puzzle for everybody.

3. **Two of the three cannot promise secrecy, and say so.** `games`,
   `line_snapshots` and `poll_rankings` are all anon-readable (migration 0011),
   and more decisively the answers are on the open internet. Guess the Game's
   anti-spoiler contract worked because the game's IDENTITY was hidden; once The
   Tape names the fixture, every fact about it is a search away. Withholding the
   score until the round is over is worth doing and the routes do it — calling
   it a guarantee would have been a lie, so the migration headers and the tests
   say what is actually being claimed. **Depth Chart is the exception and it is
   the point of having it**: the hidden thing is not a fact but a *grouping*,
   which is not derivable from public data at all.

**Depth Chart's validator, and the measurement that changed it.**

A grid is fair only if exactly one assignment of tiles to categories is
possible. Generating categories from a fact index produces overlapping tiles
constantly, and a grid with two solutions marks a correct player wrong — not
hard, *unfair*, which is worse than the problem being fixed.

`countPartitions` decides it exactly: a DFS over (tile index, remaining capacity
per group). That is the permanent of a structured 0/1 matrix — #P-hard at scale
and trivial at this one, because the capacity vector collapses the state space
to 16 × 5⁴ = 10,000 states. Sub-millisecond, and it runs at generation. It
early-exits at two, and caching a truncated count is safe for a reason worth
writing down: a truncated value is always ≥ the limit, so any parent reusing it
also reaches the limit — the answer is exact below two and "at least two" above,
which is precisely the question. There is a test for the case a naive "any tile
in two categories is ambiguous" heuristic gets wrong: an overlap the capacities
still resolve.

**The rival-category check was wrong on first build, and only measuring showed
it.** It rejected any grid where another stored fact covered exactly four of the
sixteen tiles — and threw away about three quarters of otherwise-fair grids,
because a dense index almost always has some fact lying exactly over one of the
chosen groups. The reject histogram is what diagnosed it: 151 of 200 attempts
`rival_category`, 0 `too_easy`. **A rival whose four tiles ARE an intended group
is corroboration, not ambiguity** — a second true label over the same four leads
to the same submission and the same verdict. With that, generation succeeds on
over 90% of days, pinned by a test over sixty. The histogram stayed, because
`ambiguous` means the index has too much overlap and `too_easy` means too
little, and the fix for one is the opposite of the fix for the other.

The external-ambiguity promise is **bounded and written into 0070's header**,
because someone will eventually find a grouping we never stored: no fact in
`dc_facts` covers exactly four of the tiles beyond the intended four. NYT's
Connections has the same hole. If it proves too weak the fix is to widen the
index, not to weaken the validator.

**Rejected, and why — do not re-propose.**

- **Column grants instead of route-only tables.** `revoke select (answer) …`,
  the 0040/0052 pattern, does work. But PostgREST's `select *` *errors* on a
  revoked column rather than omitting it, so every incidental reader breaks
  instead of degrading — and each of these games also has to hide rows a player
  has not reached, which no column grant can express.
- **Renaming `src/components/guess/`.** A new `src/components/daily/` takes the
  three pieces that are genuinely shared. `EndState` and `StatsStrip` were
  deliberately copied rather than shared: four different screens wearing one
  name would be a props union with four mutually exclusive branches.
- **Refactoring `gtg-stats.ts` onto `daily-stats.ts`.** The arithmetic moved and
  the tests came with it, but Guess the Game is the control these three are
  being tried against, and churning it during the trial buys nothing.
- **Wiring the three into `arcade.ts`.** Deliberately not done — see below.

**The three trial games do not feed the arcade, and Guess the Game is left
running untouched.** `weeklyCeiling()` equalises each game's weekly ceiling into
[60,70]; adding three now and retiring two later would re-score a live
cumulative board twice, and this file's own header says a total that decreases
is one nobody trusts. Chains is the sharpest case: its ceiling is a generation
parameter rather than a structural one, and nobody knows the right cap before
there is data. One commit at the end of the trial picks the winner, retires the
rest, and moves the ceiling once, with the measured distributions recorded
(TRIAL-1).

**One bug found while building, worth its own line.** `daily-stats`'
distribution was fixed at eight buckets — lifted from `gtg-stats`, where six
guesses is a hard ceiling — which silently dropped every Chains run past seven.
It grows to fit now, with a guard against a corrupt row allocating an enormous
array. A distribution that quietly omits the good days is worse than none.

**No model change.** No parameter moved.

### Aug 18 — BF-1/2/3: the archive gets eight seasons, a market and polls

Owner on Guess the Game: *"I like the concept, but it's way too random. There's
hardly any trivia around it and just trying to randomly guess a team."* The
diagnosis has two halves and only one of them is a mechanic problem.

`cfbDeck` takes every CFB regular-season final we hold a score for, uniformly
weighted, so most days the puzzle is a Tuesday MACtion game nobody watched —
knowing football cannot help, because there is nothing to know. And `gtgHints`
carries almost no information until the last rung: a final score narrows 266
teams to 266, a record to ~130, a conference to ~16, and the visitors to one.
Burning guesses to reach rung four is the rational play, which is exactly what
"randomly guessing a team" feels like.

Three replacement games are coming (The Tape, Depth Chart, Chains — STATUS).
This entry is the data underneath all three, which is worth landing on its own
because it changes no screen.

**Eight more seasons (BF-1).** Migration 0067 seeds 2015–22. `backfillTargets`
already discovered every non-current CFB season, so the job needed no change —
0063 did the same work for three seasons and the mechanism held.

**Conference at kickoff, not as of today (BF-2), which is a correctness bug and
not a feature.** `teams.conference` is the CURRENT conference. Read it for a
2016 game and Texas is in the SEC and Maryland is in the ACC. Widening to 2015
turns that from a latent wrongness into eight seasons of it, in the one field
every puzzle idea wanted to use.

The fix cost nothing to fetch: `CfbdGame.homeConference` is already the
alignment at kickoff — the field's own comment in `src/lib/cfbd.ts` says so —
and `backfillRows` was dropping it on the floor. 0067 adds two nullable columns
and both the backfill and `sync-games` carry them.

**They are deliberately NOT backfilled from `teams.conference`**, and that is
the decision worth recording. It would have filled the column instantly and
destroyed the only thing it exists for, unrecoverably: nothing downstream could
then tell a real 2016 value from a fabricated one. NULL means "unknown at
kickoff" and readers fall back to `teams` explicitly. The existing GTG
conference verdict is left alone — it compares both sides through the same
current column, so it is self-consistent and lights no chip wrongly; it is
answering a different question than its clue implies, which is recorded rather
than fixed in a feature being replaced.

**A market and polls (BF-3).** `backfill-lines` and `backfill-rankings`, both
dispatch-only on `backfill-games`'s rule: a finished season does not change, so
a cadence would spend CFBD calls to learn nothing and would need a watchdog
horizon invented for it. Both endpoints are season-scoped — one call each per
season, about sixteen for the widening, against a 30,000/mo budget running at
~10,000.

This is the gap GTG-5 hit and routed around. The "closing spread" clue was a
shrug on every puzzle because `line_snapshots` held nothing before 2026, and
the rung was deleted rather than the data fixed. Every interesting question a
room of bettors would ask about a historical game — who was favoured, did it
cover, were they ranked — needed this.

Rankings are `syncRankingsFor`, factored out of `syncRankingsJob` with the
season as a parameter. Copied, it would have been a second KEEP set, a second
team name-index build and a second matching loop — three things that drift.

**The one number that decides whether any of this works is `captured_at`.** The
closing line is defined as the last snapshot with `captured_at < start_ts`, and
CFBD's historical feed carries no capture time. The obvious choice is the
column default, `now()` — which for a 2016 game is *years after kickoff*, so
every reconstruction would be invisible to every closing-line reader. The
archive would look like it had no market data at all, and it would present as a
CFBD coverage problem rather than as a bug here.

Reconstructions are stamped **one hour before kickoff**. An hour rather than a
second because `refresh-lines --burst` captures inside ninety minutes, so on any
game carrying both, the real observation is later and takes the closing slot —
which is the right precedence. They carry **`source = 'cfbd-backfill'`**, which
does two jobs: a re-run deletes only its own rows (so re-running cannot double
a provider and skew the consensus mean), and no reader can mistake a
reconstruction for an observation.

The test does not assert the timestamp string. It runs the output through
`consensusFromSnapshots` and asserts the closing read comes back — the failure
being guarded against is invisibility, so the test has to look through the same
function the bug would hide behind. A second one puts a real snapshot ten
minutes before kickoff beside a reconstruction and asserts the real one wins.

Signs pass through untouched: CFBD's spread is already home-perspective with
negative meaning home is favoured, so the correct amount of arithmetic is none,
and there is a test in both directions rather than a comment saying so.

**No model change.** No parameter moved and no screen changed.

### Aug 18 — GTG-9 + GTG-10: the two chips and the streak get real data

The redesign below shipped with two holes it was honest about: two of the
three guess chips had nothing behind them, and the stats strip folded into
localStorage. Owner asked for both properly. Neither needed a migration, which
is the part worth recording.

**GTG-9 — REGION and RECORD are real comparisons.**

*RECORD* compares the guessed team's record entering the puzzle's own kickoff
against the home team's, both cut by one shared `recordFor`. That sharing is
the whole correctness argument: a guessed team's full-season record measured
against a home team's mid-season record would light more or less at random,
and the two used to be computed in different places. Both halves must match —
4-2 does not hit 4-1.

*REGION* is Census region, derived in `src/lib/regions.ts` from the modal state
of the team's **non-neutral home venues** (`games.venue_id → venues.state`).
Two decisions inside that sentence:

- **Not from the conference.** The obvious cheap implementation is a
  conference → region table, and it is wrong now in a way a fan spots
  instantly: the Big Ten reaches both coasts, the ACC holds a California
  school. Region is geography.
- **Neutral sites excluded.** A team that opens in Dublin or plays a September
  game in Arlington has not moved, and over a short sample one such row can
  flip a mode. Counted per game rather than per distinct venue, so a borrowed
  stadium in one season does not weigh the same as the real home field.

The marks are **stored** with the guess, not recomputed on read: a reload must
show the row you saw when you guessed, and recomputing would put two region
lookups per historical guess on every GET. They ride in the existing `guesses`
jsonb, so there is no migration and a row written before today simply has no
marks — which reads as "not compared", the truth about it. The chip state
stayed three-valued for the same reason it was three-valued before: a team
with no home venue on file still cannot be placed, and a dark chip would
claim a comparison nobody performed. `venues.state` comes from CFBD and is not
guaranteed, so that path is reachable rather than theoretical.

Cost: two extra reads per guess, on POST only, bounded by six guesses a day.
Region is cached per instance and never invalidated, which is safe because a
school does not change region and the map is bounded by the 266 CFB teams.

Practice scores all three axes the same way — practice that showed two dead
chips would be practice for a different game — and still contains no write,
which remains the structural reason it cannot touch anyone's points.

**GTG-10 — the record follows the account.**

`/api/guess-game` now folds the caller's own `gtg_guesses` rows into the
payload. **No migration and no definer function**: the route already reads
that table through the service client scoped to the session's user, so this is
one more read on a query path that was always the caller's own data. A year of
play is 365 rows of three columns.

The arithmetic did not move. `recordDay` is byte-identical to the localStorage
version and `gtgStanding` is that reduce with the rows sorted — which is why
its edge cases (month boundaries, busts, gaps) kept their tests rather than
being re-derived. The sort is load-bearing and now has its own test:
`recordDay` refuses a day it has already passed, so a newest-first feed would
fold one row and report "played once" rather than erroring.

One rule worth naming because it is invisible in the diff: **days still in
progress are filtered out before the fold.** A row with two wrong guesses and
no `solved_at` is not a bust yet, and counting it as one would zero the streak
of anyone who opened the puzzle and walked away from it.

The anti-spoiler contract picked up two new assertions rather than being
trusted. `GtgAnswerCtx` gained `homeRegion` and `startTs` for the chips, and a
kickoff timestamp printed beside a final score identifies the game outright —
a worse leak than the school name. `gtgPayload` copies fields rather than
spreading the context, and there is now a test that fails if that ever
changes.

### Aug 18 — GTG-8: Guess the Game, redesigned as a game

Owner brief, one sentence of which is the whole diagnosis: "the current
version reads like a settings page and that is the problem." It did. The most
interesting thing on the screen — a final score from an archive game — was set
at 14px in a two-column table between "Home team" and "When", at exactly the
same size as its own label, and the six-guess ladder was invisible until you
had already paid for a rung of it.

Presentation only, by instruction. **The route, the payload, the hint ladder,
the rendezvous selection and the model are untouched**; every change is in
components, one pure formatting module and a CSS block. The anti-spoiler
property is unchanged and still proved by the route test — the answer arrives
exactly when it always did.

What shipped:

- **The score is the hero.** Full-width scoreboard, two numerals at 72px split
  off a hairline with HOME / AWAY beneath, on `.scorebug` (Barlow Condensed
  700, tabular). Measured in the browser: 72px against a 24px next-largest, so
  the hierarchy is a fact rather than an intention. Tabular figures mean 7 → 10
  does not move the divider.
- **All five clue slots render on load**, the four unbought ones behind a lock
  and a dimmed bar sized to the value it replaces, so unlocking swaps text for
  text without moving the row. The clue a miss buys hinges open over 300ms.
  This is the change with the most behavioural weight: a wrong guess is now a
  trade you can see before you make it.
- **Guesses read as three fixed-width chips** (CONF / REGION / RECORD) after
  the crest and the school, replacing one emoji square plus the words "right
  conference". Fixed columns so gold reads *down* the list.
- **Six pips** under the scoreboard, gold as spent and red on the sixth.
- **Two end states**: a gold radial burst under the winning crest with
  "Solved in N", or a card up from the bottom with "Out of guesses". Both hand
  off to a stats strip (streak, best solve, solves-by-guess).
- **The group pills moved down** to head the leaderboard, which is what they
  actually choose. The puzzle owns the top of the screen.
- **The share block is a chip grid**, Wordle-shaped: header with the date and
  the score, one row of three squares per guess actually spent, a streak
  footer. Still spoiler-free — no names, no score, no conference — and still
  pinned by a test that asserts so.

Practice mode shares the same presentational parts (`src/components/guess/`)
rather than keeping the old clue table two scrolls further down the same page.

No new dependencies, no new tokens, no new fonts. All five animations are CSS
keyframes in the existing `Motion` block and inherit the global
`prefers-reduced-motion` clamp. Verified rendered at 390px in both themes:
nothing under a 44px tap target, no horizontal overflow, hero confirmed
largest, and the unlock flip confirmed to replay on the locked → unlocked
class swap rather than only on mount.

**Two things the brief asked for that the data cannot yet support**, both
recorded as open (`docs/STATUS.md` GTG-9, GTG-10) rather than faked:

1. *REGION and RECORD chips.* `gtgVerdict` returns correct / conference /
   miss and the payload says nothing about the guessed team's region or
   record. Those two chips therefore render a third `unknown` state — dashed
   and dimmed, "not compared" to a screen reader — on every row but a correct
   guess, where all three match by definition. A dark chip would have been a
   claim about a comparison nobody performed, in the only feedback this game
   gives. `gtgChips` is three-valued precisely so the route can light them
   later without touching a component.
2. *Streak, best solve, distribution.* `gtg_leaderboard()` aggregates per
   user, never per day, so none of the three is derivable client-side.
   `src/lib/gtg-stats.ts` folds each finished day into localStorage and the
   screen says "Kept on this device" — a second phone starts at zero. The fold
   (`recordDay`) is pure, idempotent by day and tested, so a future definer
   aggregate can feed it unchanged.

Both are data changes, and the brief was explicitly presentation-only. Doing
them quietly would have been the wrong call twice over: it would have exceeded
the brief, and it would have buried the fact that two thirds of the new chip
row is currently decorative.

### Aug 17 — M-5 + F11: the opener test on Receipts, the soft map on Edges

The owner asked the fair question — if flagged edges went 49.2%, can't we
carve out the buckets that hit and list those as bets? The decisions log
already answers it ("beware the bucket that clears": the 6–10 band's 53.5% is
the winner of a five-way lottery, ~1 SE over break-even, non-monotonic, and
contradicted by the regression), so what shipped instead is the two things the
evidence does support — both already tracked, neither touching the model.

**03:M-5 — the opener test.** Receipts now grades every frozen lean from the
OPENER to the close (`openerClv` in `src/lib/clv.ts`; the side is the model's
disagreement with the opening number, which can differ from its freeze-time
side once the line crosses the model mid-week). Two tiles — all leans, and
the 4+ bucket the backtest residual lives in (51.8%, avg CLV +0.27, every
bucket positive) — with the pre-registered rule printed beside them so the
thresholds cannot quietly move to fit the season. Read-side only: the freeze
and the Sunday grader were already writing `open_spread` and `close_spread`
(migration 0019); nothing new is stored.

**F11 — the §5.1 taxonomy.** `/edges` now leads with the 4+-vs-opener bucket
(`edgeVsOpener` in `src/lib/slate.ts`, distinct from `edge` for the same
crossing reason), keeps every other flag deliberately unbucketed, and closes
with the soft-market map: G5/FCS, weekday MACtion, September rosters, backup
QBs, small-conference totals, August win totals. The two tags the data can
derive — G5-vs-G5 and Tue/Wed kicks — mark flagged rows
(`src/lib/soft-markets.ts`, tested, Thursday/Friday excluded as national
broadcast windows); the judgment calls stay editorial, because nothing in the
database knows a depth chart. Page framing throughout: softness is a
structural claim about the market's attention, profit is not claimed, CLV is
the only verification (§11.1). Rows with an opener also print the price story
("opened −3.5 · now −4.5 · toward the model") on the same ≥1.5-pt bar
`spreadMoveRead` uses everywhere else.

`tierOf`/`tierMatchup` moved from `scripts/lib/tiers.ts` to
`src/lib/tiers.ts` on the way — the dependency runs scripts → src, never the
reverse (`src/lib/void.ts` records the precedent) — with the build-time pool
re-levelling staying in scripts behind a re-export, so no script import
changed.

No `DEFAULT_PARAMS` value moved. The decisions table gains the opener test as
registered-not-run, next to `--tune-fcs`.

### Aug 17 — GTG-1: the puzzle had no deck, and the deck could not heal

Owner question — "it says there's no puzzle today, why not?" — and the answer
was not "today". Guess the Game has said that every day since R2-C3 shipped.

**The literal was the bug.** `src/app/api/guess-game/route.ts` built its
candidate deck with `for (const season of [2023, 2024, 2025])`. Those three
seasons were never ingested into this database — `games` holds 2026 CFB and
2026 NFL and nothing else — so the deck was an empty array, `pickDailyGame`
returned null, and the page rendered its honest empty state forever. No error,
no failed job, no watchdog lane: the puzzle has no job at all, because
selection is a rendezvous hash computed on read. Nothing was ever going to go
red.

**And it could not fix itself.** When 2026 finishes, those games are season
2026, which the list does not name. A backfill alone would have bought three
seasons and then quietly starved again.

So the seasons are now **discovered, not declared**: the route reads the CFB
season rows and plays whatever exists. A backfill widens the deck by landing
rows; the season being played widens it every Saturday. Rendezvous hashing is
exactly what makes a growing deck safe — a new candidate only changes the days
it would itself have won, so yesterday's puzzle never moves. Finals with no
score are excluded, since a scoreless "final" cannot answer its own first hint.

Read per season rather than in one query, and the comment says why: a season is
~870 regular-season games against PostgREST's 1000-row cap, so one query over
all of them would **silently truncate** — and a silently truncated deck still
works, which is the kind of bug nobody finds.

**Migration 0063** seeds the 2023–25 season rows with their real Week 0 dates
(all Saturdays: 08-26, 08-24, 08-23) and `is_current` **false**. That flag is
load-bearing: two rows already carry true, and `fetchCurrentSeasonWeek`
resolves the pointer with `is_current = true AND sport = ?`. Verified after
applying — still exactly one current row per sport.

**`backfill-games`**, dispatch-only, is the job that lands the games. Two
refusals are written into it:

* **It never touches `seasons`.** `scripts/sync-reference.ts:17` hardcodes
  `is_current: true` and `week0_start: '2026-08-29'`, so aiming the reference
  sync at 2024 would give that season the wrong Week 0 *and* steal the live
  pointer. The season rows come from the migration instead.
* **It drops games whose teams it does not know**, and counts them.
  `games.home_team_id` references `teams(id)`, and a 2023 FCS opponent that
  never played an FBS team in 2026 is not in those 298 rows. A silent FK
  failure mid-batch leaves a season half-loaded; a puzzle deck does not need
  the Week 2 buy game.

**No cron, deliberately** — a finished season does not change, so scheduling a
re-pull would spend CFBD calls to learn nothing, and a job with no cadence
cannot be late (no watchdog horizon to invent). `jobs-yml.test.ts` pins the
absence, because that is the property a future edit would break by accident.
Re-running is idempotent: a season already loaded is skipped unless `--force`.

**Follow-up the same day: it was unreachable.** Shipped at the bottom of the
choice list, which was the wrong call — GitHub's *mobile* dispatch form renders
about twelve options and then stops, and the list is 34 long. A dispatch-only
job the owner cannot start from a phone is not a job. Moved to position two,
which it earns under this list's own rule rather than by convenience: the rule
is "order by what is safe to run by mistake", and a loaded season is skipped
without `--force`, so a stray tap costs one `seasons` read and three counts.
`backup` keeps the top slot — `task` is required with no `default:`, so the
first option is what a "Run workflow" tap runs without ever opening the
dropdown, and a new test pins it there now that reordering this list is a thing
we do.

**Then a second screenshot, and the reorder was not enough.** The push had
landed two minutes earlier (verified: `7d6a5b1` on `origin/main`, the option at
position two) and GitHub's form was still serving a cached definition. Waiting
out a cache is not a fix, and reordering a list is not one either — it just
moves which two thirds are unreachable.

So **OPS-14 is closed properly**: a `task_override` free-text input that wins
over the dropdown when non-empty. Type the name, any job is reachable, from any
device. The dropdown stays exactly as it was — it is the discoverable list, and
it keeps `backup` first for the accidental-default rule — and a blank override
changes nothing about the existing flow.

Two things it does carefully. The value is read through `env:` rather than
`${{ inputs.task_override }}` inside the `run:` body, because a `${{ }}` in a
script body is textual substitution and free text spliced into a shell is
injection; and it is constrained to `[a-z0-9-]+` before it reaches the step
that interpolates it. Dispatch requires write access, so this is not a hostile
input boundary — it is the difference between a typo that fails loudly and a
typo that runs something. `jobs-yml.test.ts` asserts the env binding is present
AND that the pattern is absent from the script body, which is the half that
would rot silently.

Found while reading, reported, and then **fixed on the owner's call** — see the
next entry.

### Aug 17 — ADJ-1: manual rating adjustments have been broken since the NFL landed

Found while auditing what migration 0063 might disturb, and it turned out to
predate it by weeks.

`src/app/actions/adjustments.ts` resolved the season with `is_current = true`
and **no sport filter**, then `.maybeSingle()`. Since migration 0041 gave the
NFL its own season row, two rows carry true — and `.maybeSingle()` over two
rows is a PostgREST **error**, not a coin flip. So `season` came back null and
the action returned "No current season configured" for every adjustment
anybody has tried to make since.

Two things made it invisible. The failure mode is a polite message rather than
a crash, and the message points at the wrong thing entirely — it reads like a
seeding problem, so the natural next move is to go stare at a `seasons` table
that is in fact correct. And SPEC §2.2 adjustments are a Thursday-before-the-
freeze tool: nobody had reached for it yet this season.

The fix is `.eq("sport", "cfb")`, and CFB is the right answer rather than a
tiebreak: `rating_adjustments` feeds the ratings replay, which is CFB-only
(`ratings-update` runs against `SEASON`). Same shape as
`fetchCurrentSeasonWeek` at `queries.ts:842` — one definition of how a season
pointer resolves. The "no season" message now says CFB, so the next time this
does fail it points somewhere true.

**The regression test is the deliverable**, because the bug is invisible
without one — and it needed care to be worth anything. `FakeSupabase`'s
`maybeSingle()` is more forgiving than PostgREST: it returns the first match
instead of erroring, so a naively seeded fixture would pass against the broken
code. The NFL row is therefore seeded **first**, which makes an unscoped query
pick it and the two versions distinguishable. Verified by reverting the fix:
`expected 102026 to be 2026`.

Migration 0063's past seasons were never part of this — they are `is_current
false`. The NFL was. Swept for the same shape elsewhere: `queries.ts:844`
already filters by sport, and the four scripts that write `is_current: true`
each own exactly one season row. This was the only unscoped runtime read.

### Aug 17 — A pass over STATUS.md itself, and two things it was getting wrong

Owner asked whether everything from this session was actually recorded. It
was — all thirteen IDs are present and correctly boxed — but checking properly
turned up three problems, two of them pre-existing.

**§5's route-test row had been wrong for three days.** It read "41 test files,
585 tests, none exercise a route". The counts were stale (91 files, 1,239
tests), and "none" stopped being true on 2026-08-14 when
`api/share-card/route.test.ts` landed — a file whose own header says *"the first
test in the repo that exercises a route (docs/STATUS.md §23 #42)"*. So the
claim was contradicted by the very commit it was describing. That row's stated
purpose is "named, not rounded up", which makes a stale number in it worse than
a stale number anywhere else in the file.

The row now also carries the evidence this session produced for why the gap
matters: **GTG-1 and GTG-3 both lived inside a route**, and neither was
reachable from a unit test. The puzzle answered "no puzzle today" every day for
weeks with the whole suite green.

**A live follow-up was buried inside a checked box.** GTG-2 was ticked, and its
last sentence said `backfill-games` could move back down the dispatch list —
which is work nobody would ever see again, because a checked box means done.
AGENTS.md's rule is that if work isn't in this file it isn't tracked; a
follow-up hidden inside a completed item is the same failure with extra steps.
It is **OPS-15** now, unchecked, with the constraint that matters written down
(the reorder has to keep `backup` first, which `jobs-yml.test.ts` pins).

No code changed.

### Aug 17 — GTG-6/7: practice rounds, and crests on the puzzle

**Practice: the archive, for fun, scored by nobody.** The ask was "a way to
play for fun that won't count towards the season score so I can keep trying it
out", and the design follows from taking that literally.

*It cannot touch your score because there is no write in the file.* Points come
from `gtg_leaderboard()`, which aggregates `gtg_guesses`, which only the daily
route ever writes. "Practice doesn't count" is therefore the absence of an
INSERT — a property visible in a diff — rather than a rule somebody has to keep
remembering.

*Today's game is excluded, and that is the point.* A practice round that served
up the daily puzzle would spoil the only part of this feature that is shared.
`practicePool` is pure, exported and tested by picking today's game and then
trying to land on it from 300 different seeds. A comment claiming the route
filters it out would not have been worth anything.

*Stateless, and the header says why that is allowed here.* The client holds the
round and tells the server how many guesses it has spent. That trusts the
client with its own attempt count, which is fine precisely because nothing is
scored — lying to a practice round only spoils it for the liar — and the
alternative is a table, a cleanup job and RLS bought for nothing. The daily
puzzle, which IS scored, keeps its state in the database where the client
cannot reach it. Both halves are written down so nobody copies the loose
pattern onto the strict one.

Reads are now shared through **`src/lib/guess-game-data.ts`** — the deck query,
the answer context (including the record clue) and the guess resolver. Extracted
rather than copied: a practice round that resolved guesses differently from the
daily one would stop being practice for it.

**Crests.** `TeamMark` — which already had the logo, the team-colour monogram
fallback and the broken-image guard — now appears on the type-ahead rows, the
guess history, the clue that names the visitors, and the reveal. Its prop type
widened from `TeamView` to the four fields it actually paints, so a caller
holding a name and a logo does not have to invent a rank and a mascot.

Two spoiler details. `GtgHint` gained an explicit `team` field instead of the
client scraping a school name out of the clue text — parsing a sentence for a
team name works until a school has "State" in it twice — and it only ever
carries a team the clue has already revealed. The home crest ships in
`answerTeams`, gated on `done` in the same expression as `answer`, so one
condition governs both: a future edit cannot reveal the crest while withholding
the name. A logo gives away exactly as much as a name does.

264 of 266 CFB teams have artwork; the other two get the monogram.

### Aug 17 — GTG-4/5: a type-ahead on the guess box, and a clue that was a shrug

Two owner reports from the first real play, and the second one was a defect.

**"How picky is the spelling — does UNT work?"** It did already: the route
matches case-insensitively against `school` AND `abbreviation` before it tries
anything fuzzy, and a guess it cannot resolve returns 422 *before* `attempts`
is incremented, so a typo costs nothing. But "it already works, trust me" is
not an answer anybody can see from the guess box, so the box now says so:
`matchSchools` filters the 266 CFB schools as you type, ranked exact → school
prefix → abbreviation prefix → contains, and each row shows the abbreviation
beside the school so the "UNT" affordance is visible rather than folklore.

Two deliberate restraints. The list is **absolutely positioned**, because a
list that pushes the guess history down on every keystroke is exactly the
layout shift DESIGN.md rules out. And tapping a suggestion **fills the box and
stops** rather than submitting — six guesses is not enough to spend one on a
fat-finger. Schools already guessed are filtered out, since re-guessing one is
a wasted attempt the server would happily accept.

A full dropdown was **rejected**, and not on effort: 266 rows is punishing on a
phone, and scrolling a list until something looks right turns recall into
recognition, which is a materially easier game than the one being played.

**"There was no closing line available."** Correct, and it always will be:
`line_snapshots` holds **zero** rows for 2023, 2024 and 2025 — the backfill
landed games, not lines, and nobody is going back for three seasons of dead
markets. So the second rung of the ladder — the one your FIRST wrong guess buys
— could only ever read "no line survives for this one". Six guesses, five clues,
one of them a shrug.

It is now the home team's record **coming in**, which the 2,759 backfilled
games make computable for the first time. Coming-in rather than final on
purpose: it is what you would have known watching that day, and it does not
give away how the season ended. A game with nothing behind it reads "opening
the season" rather than a uselessly literal "0-0". A game with no score is
skipped rather than counted as a loss, and a tie counts as neither — CFB has
not had one since 1995, but the data shape still permits it and inventing a
defeat inside a clue would be a lie.

The owner chose to drop the spread rung entirely rather than fall back to it
when a line exists, so every puzzle now reads the same way regardless of which
season it came from. That also removes the `line_snapshots` read from the
route.

### Aug 17 — GTG-2/3: the deck is filled, and an empty one is no longer cached

`backfill-games` ran green at 19:03 UTC. **2,759 games** — 2023 (909), 2024
(918), 2025 (932) — of which **2,624** are deck-eligible: regular-season finals
carrying a score. The puzzle has candidates for the first time since it
shipped.

**Five games dropped**, total, across three seasons, for referencing a team not
in `teams` (1 / 2 / 2). The drop path was built expecting far worse — the
reasoning was that a 2023 FCS opponent who never played an FBS team in 2026
would be missing — and the reference sync's FCS coverage turned out to be
better than that. The guard was still right to build: five silent FK failures
mid-batch would have left three seasons half-loaded, and the count is what
turns a guess about coverage into a number.

**Then the failure mode that was still live.** `deckCache` is per-instance per
day. Any warm instance that read the deck between the deploy and the backfill
had cached `[]` for 2026-08-17 — and would have gone on answering "no puzzle
today" for the rest of the day no matter how many games landed, until it
happened to recycle. That is precisely the shape that hid GTG-1 for weeks: a
correct-looking empty state, no error, nothing to notice.

So an empty deck is **never cached** now. It is not a valid state to hold: it
means something is wrong or a backfill is in flight, and both want the next
request to look again. A non-empty deck is still cached, because it only ever
grows and the rendezvous pick is deterministic regardless.

Verified end to end as far as it can be from here: the backfill's own
`job_runs.detail`, then the route's exact query predicates re-run against
production (2,624 rows). The payload itself needs a session, so the last hop is
the owner opening the page.

### Aug 17 — Round 3, Batch E3: the Arcade, and trophies that can be taken away

Four games with four separate boards is four things to check, and no answer
to the only question a crew actually asks: who is winning. The Arcade is one
standing across all four, per pool — on `/games` and on every group hub.

**The one number that matters is the ceiling.** Guess the Game is daily and
cheap to win; left unweighted it decides the arcade inside a month, and the
arcade quietly becomes "whoever plays that one the most". So the weights
equalise each game's *weekly ceiling* into [60,70] — streak 10 a win (70),
puzzle points × 1.67 (70), lines `max(0, 7.5 − 1.5·error)` over an eight-game
slate (60), six-pack 8 a correct answer plus 12 for a clean sheet (60) — and
`weeklyCeiling()` is exported for one reason: its test fails first if a weight
change ever breaks the band. This is calibration against a *theoretical*
ceiling, not against what people score, which is a real difference and is why
**UX-41** is queued to re-check it after Week 6.

**It imports scoring; it does not re-implement it** — `pool-machine.ts`'s
discipline. Streak points fold through `streakFold`, so there is one
definition of what a run is. Guess the Game's points arrive as the column
`gtg_leaderboard()` already computed in SQL: there is deliberately **no
`7 − attempts` arithmetic anywhere in TypeScript**, because a copy of that
formula in a second language is exactly the thing that drifts silently and
re-scores a season. The six-pack's weeks fold through `entryScore`, which
already owns the void accounting.

**No participation floor, and that is the decision.** The total is cumulative,
so somebody who joins in November is rankable from their first day — they
simply have fewer points, like a late-joining pick'em member has fewer wins.
A floor would make them *literally unrankable*, which is the failure worth
avoiding; `n` and `perWeek` ride along so a strong newcomer is visible without
distorting the season total. Floors stay where they belong, on rate boards
(the mean-error list, n ≥ 5).

**Every total renders its four components.** A row that shows only a sum
invites the question it cannot answer, and at crew size the answer is three
short numbers.

**Trophies are derived, never stored** — the survivor and streak rule, for the
fourth time. Seven pure predicates over rows the arcade already fetched:
Perfect Call, Sharp Eye, Ice Cold, Iron Man, Unbroken, Six-Pack, Regular. The
consequence is deliberate and correct: **a trophy can be taken away.** If a
re-grade means your run was never really ten long, the badge vanishes, because
it was only ever a statement about the data — and the test that proves it
flips a result, watches the badge go, and restores it.

**The shelf is yours, and the reason is RLS, not preference.** `gtg_guesses`
is own-rows-only (0059); other members' puzzle results reach the app solely
through `gtg_leaderboard()`'s aggregates, which never expose per-day attempts.
So Ice Cold is underivable for anyone but the viewer, and a shelf rendered for
someone else would be *silently incomplete* — a badge they earned quietly
failing to appear, which is worse than no shelf at all. Crew-wide trophies
would need a definer aggregate over `gtg_guesses`; that is a migration, and one
to take only if somebody asks.

**One gap, closed rather than papered over.** `weeksPlayed` counts weeks from
the dated rows a viewer can see — streak days, and the `created_at` of line
guesses and six-pack entries. Guess the Game contributes no readable date for
other members, so a puzzle-only player's denominator would collapse to one and
flatter their rate. `gtg_leaderboard()`'s `played` count closes it: twenty
daily puzzles cannot fit inside one week, so `ceil(played / 7)` is a true lower
bound and the denominator takes the larger of the two.

**Rejected:**
* **`current + best` for the streak.** It double-counts a live run and it can
  go DOWN when you lose. A cumulative total that decreases is one nobody
  trusts, and every other component here is monotone — which the monotonicity
  test now pins. `current` and `best` stay visible on the Streak board, where
  they are that game's own currency.
* **A run multiplier** (`10 + 2·min(current−1, 5)`). It compounds for whoever
  is already ahead, which is precisely wrong for a 5–15 person crew whose
  point is that everyone keeps playing.
* **A participation floor on the arcade**, above.
* **Per-member trophy chips on the standings**, above.

No migration. `src/lib/arcade.ts`, `trophies.ts` and `arcade-data.ts` (the
reads, including the scope filter — a product filter over rows RLS already
allows, never a boundary), `ArcadeBoard`/`GroupArcade`, and the group-hub
section placed after the survivor and betting early branches so it renders for
**all three kinds of group**: the arcade needs a roster, not a board.

### Aug 17 — Round 3, Batch E2: the Six-Pack

A fourth game, and the first weekly one: six questions on the week, free to
play, scored in points. Migration 0062 — whose header records that **0060 was
deliberately never created** (the R2-D1 crew-splits function was rejected
during that build and 0061 took the number).

**The closure rule is the whole design.** Every question settles exclusively
from the slate's own six games — no league-wide scans — so the grader's read
set is exactly the games the slate names and no question can wait forever on
data that never arrives. The kinds are `winner`, `cover`, `total`, `margin`
and a slate-wide `high_game` whose candidates are the games the other five
already named.

**Rejected, and worth naming because they are the obvious ones:** total
touchdowns, first scorer, longest play, turnovers, halftime leaders. They
need stats we do not store (`game_team_stats` is unbuilt — SCORE-3), and a
question that grades only when an ingest happened to fire is worse than no
question. Revisit only if SCORE-3 is ever built.

**Four things it deliberately does not store**, each the same mistake in a
different hat: no `locks_at` (the lock is `min(start_ts)` over the slate's
games, computed live — a stored lock is what a rescheduled kickoff
contradicts), no `group_id` (R3-E1's rule: the roster is the scope), no
rollover counter, and no stored perfect-week flag. The rollover — "nobody's
cleared it in four weeks" — is a fold over graded slates, so a re-grade moves
it, and its test proves exactly that by flipping a result.

**Void accounting, stated because it decides who gets a clean sheet.** A push
on a cover or total, a tie, and any dead game grade `void`, and a void drops
out of BOTH the numerator and the perfect bar: five-for-five on a
five-gradable week IS a clean sheet. Same rule the streak uses — a dead game
breaks no run, and it must not take somebody's perfect week either.

**Writes are all-or-nothing.** `submit_six_pack` takes all six answers in one
call and refuses seven ways: not signed in, no such slate, a partial entry,
nothing to lock against, kickoff (with TBD counting as locked — the
fail-closed convention picks already use), a choice the question never
offered, and once grading has begun. Six separate inserts would let one fail
and leave a half-answered week; `supabase/tests/six-pack.sql` pins all of it
plus the blind (21 assertions).

The cron seam got the treatment it has earned three times over (SCHED-1,
P1-9b, PUSH-11): schedule, resolve case, run-job case, dispatch list and both
`jobs-yml.test.ts` route assertions in one commit. The watchdog lane is
weekly *and* seasonal like the notify jobs — an hours horizon would go red
every week from January to August until nobody read it — with the same
never-run exemption the streak earned.

### Aug 17 — Round 3, Batch E1: the Games tab, and Edges gives up its slot

Owner report, and a fair one: the R2-C games were undiscoverable — reachable
by URL or by a line of 12px links on the hub — and **every leaderboard was
site-wide**, so there was no way to compete inside a pool. R3-E1 is the tab,
the hub, and the scoping.

**UX-33, answered.** The open question was whether `/edges` keeps a bottom-nav
slot now that edges are information. The answer is no, and it gives up its
desktop tab too: the bar holds four plus More, the desktop strip already
truncated Receipts at 768px, and `--diagnose-edges` (49.2% against the close,
n=1801) is exactly why edges stopped being a destination. Games takes the
fifth bottom slot and the vacated desktop tab; `/edges` moves to the More
sheet behind a new `overflowOnly` flag — a demotion, not a deletion, and a
test pins that it stays reachable. Cost stated rather than buried: six cells
is ~62px each at 375px and ~53px at 320px, both inside DESIGN.md's 44px rule
against a 64px bar. **The six-cell bar has not been seen rendered — that
check is manual and is not claimed as tested.**

**The nav tests now name their items.** Both slot assertions counted before
(`DESKTOP_ITEMS` had length `NAV_ITEMS.length - 1`). A count cannot tell
"Edges left" from "Games arrived" — it would have passed unchanged through
this exact swap, which is how a semantic change hides behind a green test.
Both are literal label lists now, each with a comment saying what the list
means. Added with them: the `/games` vs `/game/:id` collision pins, because
Slate owns `/game` as a detail route and nothing said the two could not
fight.

**Scoping: no migration, because the roster is the scope.** `betting-groups.ts`
already settled this argument for `bets` — "a betting group stores nothing of
its own beyond its roster" — and the games work the same way: you play once,
and `WHERE user_id IN (roster)` ranks that one play inside every pool you're
in. A `group_id` column would let one day's streak pick exist three times with
three results, which is a worse product and a worse schema. The new
`daily-games.sql` block says out loud that this is a **product filter, not a
security boundary**: it asserts that a revealed row outside your pool is still
readable, so nobody later mistakes the filter for privacy.

**Two cookies, one writer each.** `cfb_games` (this) and `cfb_group` (the
slate) are separate because the pool you play the arcade with and the pool you
bet with are legitimately different, and because the everyone-sentinel written
into `cfb_group` would make the slate's `resolveActiveGroup` fall through to
`mine[0]`. `cfb_games` falls back to `cfb_group` when unset, so a one-group
member lands on their pool having touched nothing — the owner's ask, verbatim.
A `?g=` is a view and writes neither, the rule the slate already documents.

**Rejected: `gtg_leaderboard(p_group uuid)`.** A security-definer function with
a group argument and no membership gate is a leak; with a gate it is a new
signature, new grants, a new DB block and an overload-ambiguity risk — for a
fifteen-row board that is already site-wide. The page filters the RPC's
aggregates instead, which keeps E1 migration-free. Trip-wire written into the
code: revisit past ~100 accounts, or if that board ever returns more than
aggregates.

Also fixed: the hub's games line was three 12px links in a paragraph, well
under DESIGN.md's 44px rule — a defect R2-C introduced and this replaces with
one 64px row.

### Aug 17 — Round 2, Batch D: scenario engines and the social layer

The last batch (R2-D1…D4, STATUS §4 Round 2), and the one where two planned
designs got smaller on contact with the code — recorded here so they are not
re-proposed at full size.

**Crew splits, without the migration.** The plan carried a 0051-style definer
fn (`group_game_splits`) emitting side splits gated on `picks_revealed`.
Building it revealed it answered nothing RLS doesn't already answer: once a
game reveals, the caller can read every pick row and aggregate them; before
it reveals in a hidden group, the split is exactly what we'd REJECTED
(reverse-engineerable at crew size, given the public count). And the week
board's MatchupCard already draws the halves and the lean bar. So: **no
migration**, and the genuinely missing half shipped instead — **crew money**
on the game page, tickets vs units by side from the crew-readable ledger
(`moneySplits`, markets with 2+ bets). People check splits to locate
themselves, not to predict.

**The Pool Machine + win-the-week %.** Toggle who covers; the race re-sorts.
Scoring is imported from records.ts and the parity test (no toggles ⇒ the
graded standings, at `PICKEM_WIN_PAYOUT` exactly) is the drift alarm. Totals
stay pending under any toggle — a side cannot answer a number — and the UI
says so, as it says hidden picks aren't in the projection. The % column is a
seeded Monte Carlo (deterministic under test) over the pending picks: frozen
`homeWinProb` where a prediction exists, market-implied via the published
logistic slope otherwise, and coin flips for covers and totals — pricing
those better than 50/50 being ~impossible is this site's founding evidence,
so the simulation says so too.

**Reactions, not a chat room.** Migration 0061. The design decision worth
the sentence: visibility is **invoker** semantics — the policy asks "can the
CALLER see this pick/bet" under the caller's own RLS, so reacting to a
blind-hidden pick refuses byte-identically to reacting to a pick that does
not exist (proven in `daily-games.sql`). Four allow-listed emoji, tap to
give, tap to take back, no free text anywhere. The conversation stays in the
group chat; the receipts get to feel it.

### Aug 17 — Round 2, Batch C: the daily game layer

Three games that exist only inside the crew, built entirely from data already
in Postgres (R2-C1/C2/C3, STATUS §4 Round 2). All free-to-play, scored in
points — no units, no stakes, no "lock of the week" copy (BRAND §16).

**Guess the Lines.** Submit your spread before the books hang one; grade
against the OPEN; season board ranks mean absolute error. The integrity rule
is enforced from both sides: the RPC refuses a guess the moment any
`line_snapshots` row exists, and the selection job never picks a game that
has one — so the race between Monday's selection and the 12:00 UTC lines
refresh is harmless one way and unrepresentable the other (proven in
`daily-games.sql`). The grading number is `openingSpread` in consensus.ts —
true opens where `spread_open` exists (NFL), earliest-capture proxy
otherwise (CFB) — shared by the job and the reveal display so they cannot
disagree. Selection: top-8 marquee CFB (poll-rank quality, with #25 floored
at the unranked baseline — watchability's raw curve scores #25 below
unranked, harmless in a display sort, wrong as a selector's dominant term)
plus the whole NFL week.

**The Streak.** One curated matchup a day, either league, straight up. The
streak is DERIVED from graded picks on every read (`src/lib/streak.ts`) —
a stored counter is the second source of truth the survivor build already
declined. A tie, postponement or cancellation voids and passes through:
a run is broken by a wrong answer, never by a dead game. Kickoff lock and
post-kickoff reveal mirror 0023/0038. The daily job also backfills a missed
"today" while its game hasn't kicked. Watchdog gains a 30h absence row.

**Guess the Game.** One historical game a day from the 2023–25 backfill,
selected by RENDEZVOUS HASH — `argmax hash(day:id)` — so the deck growing by
a season never reshuffles other days' puzzles (pinned by test). Six guesses
at the home team; each miss buys the next hint (score → spread → season/week
→ conference → visitors — the ladder never names the answer). The play
surface is a route, not page props: the answer is server-side until the game
ends, and the anti-spoiler contract is a pure test over `gtgPayload`. Share
string is the Wordle lesson: emoji rows, no names, safe for the group chat.

Product-day arithmetic (`productDate`) lives once in `src/lib/streak.ts` and
the jobs import it — the page and the job must agree on what "today" means.

### Aug 17 — Round 2, Batch B: the day-aware home and the Tuesday Drop

The daily-rhythm pair (R2-B1/B2, STATUS §4 Round 2), same branch and same
merge-deferred posture as Batch A.

**Day-aware home.** `planToday` (`src/lib/home-today.ts`, pure) decides which
question the hub leads with: Mon results · Tue the Drop · Wed the board ·
Thu–Sun the next kickoff — with two priorities that beat the calendar: live
football first (MNF is a Monday), and picks still owed beat a kickoff that
hasn't happened (lock beats watch). Day-of-week is computed in `DEFAULT_TZ`,
never server UTC — Tuesday 00:30 UTC is Monday evening in Chicago, and a
block that flips a night early answers tomorrow's question today. A quiet
week renders nothing; the demo pins the live block so it reads the same any
day. The signed-in block counts live positions across both leagues the same
way `homeRefreshTier` does, for the same Aug-14 reason.

**The Tuesday Drop.** The ratings update becomes a named event: migration
0056 (`rating_drops`, one row per season+week, app reads only),
`scripts/generate-drop.ts` mirroring the verdicts producer, arithmetic pure
in `scripts/lib/drop.ts` (movers = newest ratings week vs previous; dissent =
poll rank − model rank via the `/rankings` machinery). The paragraph defends
ONE position — the largest poll gap ≥ 3, else the biggest mover — and the
producer **skips loudly instead of writing** when the ratings week hasn't
advanced or nothing is defensible: a drop confidently defending stale
ratings would hide exactly the upstream failure that should be visible.
Cron `0 15 * * 1` lands in the same commit as its `jobs-yml.test.ts` route
assertion (the SCHED-1/P1-9b/PUSH-11 seam); `ANTHROPIC_API_KEY` was verified
present in the job step's env rather than assumed.

### Aug 17 — Round 2, Batch A: NFL parity pages, calendar feeds, grading gaps, where-to-watch

Owner decision: build the ROADMAP.md feature set now, on
`claude/ultimate-football-site-b8tzog`, **merge deferred past Week 0**. This
entry is Batch A (R2-A1…A5 in `docs/STATUS.md` §4); nothing here touches a
launch path in a way the old fixtures don't pin.

**What shipped (on the branch).** `/standings?sport=nfl` — divisions from
`teams.conference`, ties worth half, preseason excluded, the W-L fold
extracted pure into `src/lib/standings.ts`. `/recap/[week]?sport=nfl` —
finals, bad beats (the NFL board shares `applyScoreboard`, so `cover_flips`
carries NFL rows), crew CLV; the model sections branch away *before* their
`required()` reads. Calendar feeds — migration 0054, `/api/calendar/[token]`
on the service client (the `api/push/resubscribe` posture), RFC 5545 builder
in `src/lib/ics.ts` with octet-correct folding, a card in `/me`;
`supabase/tests/calendar.sql` proves the token's containment. Grading gaps —
migration 0055 adds `team_side`/`marked_odds`/`marked_at`; the grader settles
team totals on their subject team and first halves **only when
`scoring_plays` prove the halftime score exactly, both directions** (the
under-count case is a missed play; the over-count case is a reversed score
the feed never took back, which `unaccounted`'s zero-clamp alone would wave
through). Legacy team totals (team_side null) skip rather than guess.
Where-to-watch — `src/lib/watch-on.ts`, full label on the game page, `title`
on the slate chip so the card's width is untouched.

**Two rejections, recorded so they are not relitigated:**

1. **Futures auto-marking.** Neither sanctioned feed module (`src/lib/cfbd.ts`,
   `src/lib/espn.ts`) carries futures odds, so a weekly mark job would fetch
   nothing and record green runs — the PUSH-11 silent-no-op shape, built on
   purpose this time. The ledger takes a **manual** mark (one prompt, the
   0055 trigger stamps `marked_at`) and nags at >14 days stale.
2. **NFL upsets-by-close on the recap.** The stale-close guard
   (`closingConsensus`, 6h) lives in jobs-core; a display-side copy in the
   page would be the drift the consensus extraction (audit #43) exists to
   prevent. Deferred until the guard moves somewhere shared, rather than
   shipped wrong.

**One near-miss worth the sentence:** the first cut of 0055 re-created
`enforce_bet_void_only` from 0013's shape and silently destroyed 0045's
retag branch — caught by the existing `bets.sql` suite before it ever ran
anywhere real. The landed function is 0045's definition plus the mark branch,
and the suite now pins all three permitted edits (44 assertions).

### Aug 15 — `/welcome`, the page for people who have never seen this

Owner request: a marketing page for anyone not signed in, and a way for the
admin to view and share it.

**What shipped.** A public, static `/welcome` — the hero, two real game cards, a
week-by-week walkthrough, an inventory of every screen, the pick'em and ledger
sections, an honesty section, and the phone/PWA note. `PitchPanel` sits above
Invites on `/admin` with the absolute URL, a View link and a share button on the
existing `shareOrCopy` path. The signed-out home card and `/login` both link in.
Its own `opengraph-image`, because the site-wide tile is written for people who
already know what the product is.

**Three decisions, taken with the owner, recorded so they are not relitigated:**

1. **`/` is unchanged.** The literal reading of the request — signed-out
   visitors get the pitch at the root — was offered and declined. A signed-out
   visitor still lands on the week and a way in (`app/page.tsx`), and the pitch
   is a page you *send*. That also keeps the demo, the slate and the hub exactly
   as they were for someone with the URL already in their home screen.
2. **It colours from BRAND §5, not from the app's charcoal tokens.** Same call
   already made for the share card ("this is the product's marketing piece, so
   it colours from `BRAND`"). Implemented by adding `.brand-surface` to the
   *existing* `html[data-theme="field"]` selector lists in `globals.css` rather
   than restating the palette — one Field palette in the file, two ways to ask
   for it, so they cannot drift. The palette is pinned rather than themed, so a
   screenshot of the page looks the same whichever theme the sender runs.
3. **The CTA is the demo, then a mailto.** Signup is invite-only and there is no
   self-serve path, so the page walks people into `/demo` and asks second. An
   email-capture form was offered and declined — it would have been a new public
   write endpoint for a page whose whole job is to be read.

**The copy is written against the product's own honest note, not around it.**
§05 leads with **49.2%** — how the model's flagged disagreements did against the
closing line across the 2023–25 backtest, where 52.4% is break-even at −110 —
and **+0.27**, the average CLV in the 4+ disagreement bucket. Both numbers are
already on the site (`/edges`' docblock, SPEC §5.1). A pitch page that quietly
omitted them while the app prints them would have been the one place the product
lies about itself.

**The cards are the real component, not a screenshot.** `CardShowcase` imports
`GameCard` and feeds it `demoSlateData` at a frozen instant, so the marketing
page cannot drift from the card it is advertising, and the page stays static
(`/demo` anchors its Saturday to page-open time; that would have made this
dynamic). The grid is `inert`, not `aria-hidden` — the cards are full of real
buttons, and `aria-hidden` would have taken them out of the accessibility tree
while leaving every one of them in the tab order.

**Checks.** `welcome-links.test.tsx` walks every href on the page and resolves it
against `src/app`'s actual `page.tsx` files, so a renamed route fails the build
rather than shipping a 404 to a stranger; it also pins that the demo link
precedes the invite ask. Rendered and read at 390px and 1280px: no horizontal
overflow at either. `themeColor` is pinned per-route to `#020A08` because the
root layout would hand a light-mode visitor an `#F2F3F6` status bar above a
near-black page — verified that the root `viewport` (viewport-fit, the UX-35
zoom decision) still inherits intact, and that other routes are untouched.

**Not done, deliberately:** the page uses the browser's default focus ring like
every other button on the site. Adding `focus-visible` rings to one page would
have made it the only page with them. Recorded as a site-wide gap in
`docs/STATUS.md` §6 rather than fixed here.

### Aug 15 — GRADE-2: the last game of a slate could never be graded live

Owner report: three bets on the Friday NFL preseason slate, two graded within
minutes, the third — on the game that finished last — still open four hours
later, with the next scheduled backstop two days away.

**The bug is a collision between two correct-looking facts.** `applyScoreboard`
grades the board it has just polled (GRADE-1), and the loop only polls a league
while `activity()` reports something live. So the instant the *last* game of a
slate goes final, `activity` returns `idle`, `nflScoreboardJob` stops being
called, and the tick that would have offered that game as `"completed"` never
happens. `gradeGames` has no other caller. One game per slate — always the last
one — falls through to the scheduled pass every single time. GRADE-1's own
entry claims it closed the "open bet on a finished game for up to a week" gap;
it closed it for every game except the one this describes.

Ruled out before that, each with the query that ruled it out: the game **is**
`final` at 7–27 with four line snapshots; the bet has a valid side and line, so
the grader's spread branch settles it; ESPN's `dates=20260814` board still
returns all three games as `STATUS_FINAL`, so it is not board membership. The
timing agrees too — the ungraded game's last scoring play was written at
01:52:51 against 01:49:44 for the two that settled.

**The sweep, at three moments.** `gradeSeasonFinals` — the same function the
scheduled backstop runs, so no second implementation of the grading math — is
now called on the live → idle edge inside a run (the exact tick the last game
finished, ~30 seconds), at the end of a run (for a game that finals between the
last tick and the deadline), and at the *start* of every run before the idle
guard returns (for a game that finals in the gap between runs). Worst case goes
from Monday to about an hour; the normal case is half a minute.

Affordable because of an ordering GRADE-1 already established: the ungraded
reads come before the closing-line read, so a sweep with nothing to settle is
one games read and three empty ones and never touches `line_snapshots`. There
is a test for exactly that, because it is what makes calling this every run
defensible.

**`nfl-grade` goes daily**, from `30 13 * * 1,2,5`. Not because the sweep needs
help on a good night, but because this night was not one: **six
`scoreboard-loop` runs died without writing `finished_at`** (08-14 20:18/21:13/
22:09, 08-15 02:59/03:50/04:39 — the two that completed are the two that had
live games). A backstop that only runs three days a week is not a backstop for a
loop that dies. Four extra runs a week, one query each when there is nothing to
do.

Two things this turned up and did not fix, both in `docs/STATUS.md`: those stuck
`running` rows (**OPS-4** — the watchdog reads that table to decide whether a job
has gone silent, so a run that dies without marking itself is a hole in the hole
detector), and **DQ-14**, one book stored under two provider names —
`DraftKings` and `Draft Kings` on the same game — which makes
`consensusFromSnapshots` average a book against itself. It did not change the
close here, and CLV is graded against that number.

### Aug 15 — The logouts were Supabase revoking token families, not our cookies

Reported as "it's not keeping me logged in on a device forever anymore", which
sounds like a cookie lifetime and is not. **Refresh-token rotation with reuse
detection** is on, so replaying an already-used refresh token revokes the entire
family — including the token that is currently valid. The auth logs show three
in one evening:

```
22:33:13  "Possible abuse attempt: 41"   refresh_token_already_used  400
02:19:59  "Possible abuse attempt: 42"   refresh_token_already_used  400
02:22:40  "Possible abuse attempt: 57"   refresh_token_already_used  400
```

The revocation is visible in `auth.refresh_tokens` as well, which is what makes
this a diagnosis rather than a theory: token 55 was the live token, and its
`updated_at` is stamped `22:33:13` — the same instant token **41** was flagged.
Flagging the old token revoked the live one. Fifty minutes later, 23:23–23:25,
a **108-request storm** replayed the dead token from **ten distinct Vercel IPs
plus the phone**, and at 02:22:51 the owner gave up and asked for a new magic
link.

**The replays are stale, not concurrent.** Token 42 was created 08-13 05:24 and
presented again on 08-15 02:19 — two days later, from a Vercel IP, so a client
sent a two-day-old cookie. That distinction decides the fix: a longer reuse
interval covers refreshes that collide within seconds and does nothing for a
cookie from Wednesday.

**What we were feeding it.** 629 `/user` calls in one hour. The proxy ran
`getUser()` on every matched request *and* `/api/ticker` and `/api/slate` each
call it again, so every 30-second poll was two GoTrue round trips from a fresh
serverless instance with no shared lock. That is almost certainly why this
started recently: the moving ticker, the moving home page and the live slate all
landed in the last few days. (Inference. The revocations above are not.)

**Ruled out, with the query that ruled it out.** Time-boxed sessions are off —
`not_after` is null on all four rows of `auth.sessions`. `createBrowserClient`
is a singleton in the browser, so this is not duplicate client instances. The
400-day cookie config is correct. And one wrong turn worth recording: an early
check for two tokens sharing a `parent` came back empty and was read as "no
refresh race". Wrong test — the reuse path errors instead of issuing a child, so
an empty result is consistent with the race rather than against it.

**The fix is a project setting: Authentication → Sessions → Refresh Token
Rotation off.** The trade is that a stolen refresh token stays usable until
sign-out, which is the trade this product already made when it chose invite-only
with deliberately never-expiring sessions.

Shipped here is the other half, and it is explicitly not the fix:

  * `/api/*` is out of the proxy matcher. Those routes build their own server
    client from the same cookies and can set cookies on their own responses, so
    the proxy's pass was duplication.
  * A request with no `sb-…-auth-token` cookie no longer constructs a client.
    Signed-out browsing is most of the traffic and has no session to refresh.
  * The proxy stopped overriding `maxAge` on every cookie `@supabase/ssr` hands
    it. That override rewrote ssr's `maxAge: 0` **deletions** into 400-day empty
    cookies — and was redundant anyway, since ssr's own `DEFAULT_COOKIE_OPTIONS`
    has been 400 days since 0.10. The 400 in that docstring now comes from the
    library instead of from us.

`src/proxy.test.ts` pins the matcher. Re-including `/api` later would double the
auth traffic and nothing would look broken, which is the kind of regression a
comment does not survive.

**Applied, and the rotation setting is off.** `0053_survivor_pools` went to the
live project as `20260815044806` — 52 files, 52 rows, in sync. Verified after
applying rather than assumed: `groups_kind_check` accepts `'survivor'`, **0**
TRUNCATE grants to `anon`/`authenticated` on either new table (0049's `alter
default privileges` half is holding for tables created after it, which is the
first time that has been tested), `survivor_picks` grants only `SELECT`, five
policies and four functions present, `create_survivor_group` executable by
`authenticated` and not by `anon`. The probe call stopped on the sign-in guard,
so production has **0** survivor groups — nothing was created to test it.

The owner unchecked "Detect and revoke potentially compromised refresh tokens"
the same evening. That is the actual fix for the logouts; everything in the
commit above is load reduction. It is not yet *observed* fixed — that needs a
few days of `auth_logs` with no `refresh_token_already_used` across a real
sleep/wake cycle, and the row in `docs/STATUS.md` says so rather than claiming
the win early.

### Aug 15 — Seven owner-reported items: the sign-up wall, a rename, survivor pools

One report, seven items, from someone using the site rather than reading it.
Three of them were defects that only a real user hits; the other four are
product. The first is the one that mattered.

**Sign-up did not work, and the error was the literal string `{}`.**

Not our string. `@supabase/auth-js` treats every 5xx as retryable and builds the
message with `_getErrorMessage(error)` where `error` is the **`Response`
object**, not its parsed body (`dist/main/lib/fetch.js:34-42`). A `Response` has
no own enumerable properties, so `JSON.stringify` of it is `"{}"` — which means
**any** 500 from GoTrue reaches the UI as `{}` with the real reason thrown away.
Worth writing down because it is not a bug in our code and reading our code will
never find it.

Two different 500s are live behind that `{}`, and they need different answers:

  * the invite-only trigger. `handle_new_user` (0002) raises for an address not
    on `invite_allowlist`, which aborts the `auth.users` insert. GoTrue answers
    500 `unexpected_failure`, and the raise message — which says exactly what is
    wrong — never leaves the database;
  * a custom SMTP sender that cannot authenticate, which also fails the request
    with a 500.

The fix identifies a brand-new address **before** running the signup path:
`signInWithOtp({ shouldCreateUser: false })` sends the link for an account that
exists and otherwise returns a clean 422 `otp_disabled`, the one unambiguous
"there is no account here". Only then does the second call, the one that can
create a user, run. So a 500 becomes attributable by which call produced it, and
the form says either "this address isn't on the invite list" or "the service
errored" instead of `{}`. It costs no extra email: the probe only sends when the
account already exists, in which case that IS the link.

*What this does not do:* the two 500s still cannot be told apart from the
browser, so the signup message names both causes. Distinguishing them needs
either an `is_invited(email)` RPC — an enumeration oracle on the allowlist — or
GoTrue surfacing the trigger's message, which it does not. Recorded in
`docs/STATUS.md` rather than guessed at.

**Renamed to The Slate.** The product has carried the NFL since v1.0, so a name
saying CFB described half of it. Wordmark, manifest, `<title>` template, OG
cards, share card, push payloads, the service worker, the CSV and image export
filenames, and the iOS splash (`npm run brand`, wordmark string only — the icon
artwork was not touched). `docs/BRAND.md` records the change at the top; the old
name stays in this log and in the audits, which are history.

**Survivor pools, the third kind of group (0053).** One team a week, straight
up, no team twice, wrong answer and you are out. CFB pools scope to a conference
— "SEC survivor" is how these are actually run — and the NFL is one league-wide
pool, which the RPC enforces rather than merely defaulting.

The cheap version of this is a pick'em week with one `straight_up` market and a
one-pick minimum, and it is wrong twice: `picks` has no way to express a
constraint that spans weeks (you cannot take a team twice), and pick'em has no
failure state at all. So it is a third `groups.kind` sharing roster, join code
and visibility with the other two and nothing else — the same relation `betting`
has to `pickem`.

**Elimination is derived, never stored.** Whether you are out is a function of
your picks and the final scores; a stored flag would be a second source of truth
that a corrected score could contradict. `src/lib/survivor.ts` recomputes every
standing from the whole season on each read. Two rules that are easy to get
wrong and are pinned by tests: a **tie is a strike**, and a **missed week is a
strike only once every game in that week has kicked off** — our picks lock per
game, so somebody holding out for Monday night has not missed Sunday.

**The Groups tab's weeks were preseason weeks wearing regular-season labels.**
Reported as "preseason week 2 is listed as week 2, with the first set of games
not on week 5", and that is exactly the mechanism: the group pages carried
`?week=` and took the season *type* from the live calendar pointer, which in
August says `preseason`. So "Week 2" was preseason week 2, every week link
stayed inside a four-week season type, and the regular season had no reachable
link at all — nothing in the group UI could change the season type. `/slate` has
carried `?st=pre|post` since NFL-6; `src/lib/group-weeks.ts` is that model made
shared, and the chevrons now walk one ordered calendar across the boundaries.
It also surfaces a rule that was invisible: `set_group_week_config` refuses
`preseason`, so an August admin was being sent to a page whose save could only
throw. It now says pick'em does not run in the preseason and links to the
opener.

**Box scores on the game page**, pregame, live and final. Derived from
`scoring_plays` (0048), which already stores each score's period and the running
total after it — the points in a quarter are the difference across it. No new
table, no new feed call, no new job. Where the derived quarters do not sum to
the scoreboard (a feed reporting a score whose play we never captured) the
difference is footnoted rather than parked in the fourth quarter. **Team stat
lines — total yards, first downs, turnovers — are not in this**: they need a
`game_team_stats` ingest off ESPN's boxscore block and CFBD `/games/teams`, and
that is queued, not half-built.

**The cover strip reads bets, not just picks, and lost its big number.** Live,
the strip was gated on a pick'em pick, so a card you had money and no pick on
glowed green from the aura with no word saying why; it now ranks a bet over a
pick, the order `tintFor` already used. The 18px signed margin (`COVERING +2½`)
and the totals room line are gone — the colour already says which side of the
number you are on — and the tail that says *what you hold* went from 10.5px at
75% opacity to 13px at full weight. It was smaller than the crew line under it,
on the one element whose entire job is telling you where your money is. The home
hub's position rows now render the same strip; they had the aura and no word.

**The ticker highlights whoever is in front** — weight and brightness, not
colour, because the strip already spends colour on your own verdict. Ties
highlight neither side.

Lands with 969 vitest assertions across 70 files and 257 DB assertions against a
real Postgres 16 cluster (27 of them new, in `supabase/tests/survivor.sql`).
**Migration 0053 is not applied to the live project** — see `docs/STATUS.md`.

### Aug 15 — Shipped: PR #76, and a migration split that earned itself

Merged and deployed. The interesting part is the ordering, because it is the
third time this project has been bitten by a migration whose safe position
depends on what code is running.

`0050` originally did two things: create `is_current_user_admin()` and revoke
`is_admin` from `authenticated`. As one file the middle step of the rollout had
nowhere to stand. Applied before the deploy, the revoke denies the running
code's `select("is_admin")` and breaks every admin gate — including `/me`,
which reads it inside a multi-column list and throws rather than degrades.
Applied after, there is a window where the new code calls a function that does
not exist; `lib/admin.ts` fails closed, so that window is admins quietly losing
their admin links rather than seeing an error, which is worse for being the
kind of thing nobody reports.

Split into `0050` (the function, inert against old code) and `0052` (the
revoke). Executed as: apply 0049/0050/0051 → merge → confirm the deploy →
apply 0052. Between the two halves `is_admin` was deliberately checked and
found **still readable**, which is what proved the split was doing its job
rather than merely looking tidy.

**The deploy was confirmed by behaviour, not by a badge.** `/ledger/stats`
answering 200 in production is proof the new build is serving, because that
route does not exist in the old one. A green Vercel status only says a build
finished.

Verified after 0052: TRUNCATE reachable on **0** public tables (was 32),
`is_admin` no longer readable by `authenticated` while `display_name` and
`timezone` still are, `/admin` still returning its 404 body to an anonymous
caller, and twelve production routes at 200 with nothing 500ing.

51 migration files, 51 recorded rows.


### Aug 14 — The NFL lane audited against the live database, and a push channel that never worked

No code shipped here. This is a reconciliation pass: `docs/STATUS.md` had the
NFL recorded as built and largely verified, and the preseason has since put a
week of real traffic through it, so the question was whether "we added the NFL"
and "the NFL works" are the same claim. They are not. Six findings, all in
§2.1d, and the two that matter are not NFL problems in their consequence.

**The scheduled push cannot send, and never could.** `jobs.yml` passes five
secrets to every job and none is a VAPID key, so `pushConfigured()` is false in
every Actions run. The live evidence was sitting in `job_runs` the whole time:
`notify-picks-due` on 08-13 returned `{"skipped":"no vapid keys"}`. What makes
this worth its own entry is what it takes down with it — `notifyWatchdog` opens
with the same guard, so **OPS-2 is inert**. OPS-2 was built three days ago
*because* P1-8 found nine delivered failure emails and zero opened; the
replacement channel has never been able to fire. PUSH-3 and PUSH-9 are not
wrong: the iPhone test went through Vercel, where the keys exist. Nothing ever
exercised the Actions environment. That is SCHED-1's shape exactly — both sides
of a seam verified, the seam itself never crossed — and it is now the third
finding to come out of that same gap.

**The watchdog's liveness gate is CFB-only.** Both `games` queries inside
`watchdogJob` filter `season_id = SEASON`, so the scoreboard freshness check
only arms when a *CFB* game is live. Through the entire NFL preseason — the only
football being played — the check designed to catch a dead live layer has been
switched off, and it will switch off again for every NFL-only Sunday in the
autumn. `NFL-6` had already recorded the missing NFL job-age rows; this gate is
the more expensive half and was written down nowhere.

**The close-pass crons missed the slot the preseason kicks in.** Proved on rows,
not inferred from cron strings: the Hall of Fame game and the three Thursday
23:00/23:30 UTC kicks carry zero `line_snapshots` ever, while the three that
kicked at Fri 00:00/01:00 each got one 15–16 minutes out — the `45 23 * * …`
cron working exactly as designed for the slot it was written for. Extending the
check across the stored schedule: 29 of 49 preseason and 39 of 272
regular-season games sit outside any close pass, including all six international
games and the week-1 opener. No close means no CLV.

**Two numbers in the paragraph above were wrong when first written, and one
framing was.** The counts were published as 30 and 40: the coverage query did
day-of-week arithmetic without wrapping the week, so a Saturday-night cron
scored as not covering a Sunday-morning kickoff. Redone modulo 10080 minutes,
it is 29 and 39. And "four games never got a line at all" is true but reads as
worse than it is — the daily non-burst chain had run once and skipped at that
point, and it snapshots the whole earliest unplayed week twice a day, so
upcoming games do get a line. What the crons buy is a capture *near kickoff* —
a real close, and therefore real CLV — not the difference between a line and
none. Both corrections are in the `NFL-23` row, which is where someone reading
the tracker will hit them.

**Method note, since it is the transferable part.** Every one of these needed
the live database and `jobs.yml` read *together*. The test suite is green (861
tests, 63 files, re-run here), the code is correct in isolation, and each
finding lives in the wiring between a scheduler and a thing it is supposed to
drive. `jobs-yml.test.ts` already guards one direction of that seam — every cron
resolves to a task — and would not have caught any of these.

**What went the other way.** League isolation held up under the same scrutiny:
`fetchCurrentSeasonWeek` takes a `sport` and filters on it, so the two
`is_current` season rows never collide, and NFL teams carrying
`classification = 'nfl'` fall out of `/standings`' FBS filter without that page
knowing the NFL exists. Reference data is complete — 32 teams, none missing a
logo, division, colour, abbreviation or classification. The offset id scheme in
`src/lib/league.ts` is doing what it was designed to do.

### Aug 14 — What the design review caught, which was a lot

`docs/DESIGN.md` §"Before saying it's done" asks for a `web-design-guidelines`
pass over your own work, unprompted. Run over this branch it returned thirteen
confirmed defects, and they were not nitpicks — three of them broke the ticker
that had just been built, and one was the exact bug the bet-slip fix was
supposed to have fixed. Recording them because the lesson is about the review,
not the code: every one of these was invisible from reading the diff and from a
green test suite.

**The ticker had three, any one of which would have shipped.**

A mouse drag-off froze it permanently. `onPointerUp` sat on the track; touch
captures the pointer implicitly and a mouse does not, so press a chip, drag off
the strip, release — the `pointerup` lands on some other element, `held` never
clears, and the marquee is paused for the rest of the session. `setPointerCapture`
on down, plus `onLostPointerCapture`.

It re-measured on the game *count*, which is the wrong signal. Chip width moves
a long way without the count changing: "7:00 PM" becomes "1st 12:43" at kickoff,
and each score adds glyphs to both sides. So a five-game strip that measured as
fitting before kickoff stayed `still` once the clocks appeared — and because the
track is then `width: 100%` with `shrink-0` children inside a clipped viewport,
the overflowing chips had no animation *and* no swipe. Unreachable. A
`ResizeObserver` on the measured copy replaces the count, and incidentally fixes
the narrower version of the same bug: measuring before webfonts settle.

`overflow: hidden` made the viewport a scroll container. Hidden boxes are still
programmatically scrollable, so tabbing to a chip past the frame set `scrollLeft`
on it, and that offset stacked with the animation's own transform — one Tab pass
and the strip was misaligned with its leading chips scrolled out of reach.
`overflow: clip` is not a scroll container and `mask-image` applies identically.

**The bet-slip fix had missed its own twin.** The slip moved to `.panel`; the
confirmation toast that replaces it in the same fixed slot over the same
scrolling slate was left on `.card`, at the same 80% that was reported as
unreadable. Raising the panel's opacity also *exposed* a control that had been
hiding in the murk: the remove-selection icon at `text-chalk/30` computes 2.5:1
dark and 1.9:1 light, under 1.4.11's 3:1.

**Both new destructive controls were the dimmest text in their rows** —
`text-chalk/40`, 3.4:1 dark and 2.5:1 light — and both announced themselves
identically to a screen reader, so a button list held twenty indistinguishable
"Cancel this pick" entries with no way to tell which was about to be destroyed.
Both now carry the row's own text in their name, and every async failure on the
branch is `role="alert"`; a delete that fails silently is the worst case of it.

**One place UX-35 did collateral damage, found rather than assumed.** The new
tail/fade audit is a five-column table that needs horizontal scroll on a phone.
Pinch-to-zoom-out used to be the escape hatch for exactly that, and this branch
removed it — so a scroll region containing nothing focusable became unreachable
from a keyboard (2.1.1). Both tables are now labelled `tabIndex={0}` regions.
That is the shape of cost a knowingly-accepted a11y failure has: not the thing
you accepted, but the thing that was quietly load-bearing for it.

**And the most visible seam on the branch.** `SportToggle` was three raw `<a>`
tags with a comment citing "the LedgerTabs pattern" — which uses `next/link`. So
every league switch was a full document reload: white flash, ticker remounted,
scroll position gone, client cache dropped, on the one page whose governing rule
is *never steal scroll position*. The comment named the right pattern and the
code did not implement it, which is the failure mode this repo keeps writing
down.

**Two things deliberately not fixed**, both recorded in `docs/STATUS.md` §6
rather than decided unilaterally. Light mode's `--accent` on `--accent-ink` is
3.83:1 and fails AA at 12px — pre-existing, carrying the slip's primary action
and the pick buttons, and `--accent` is the product's value language out of
`docs/BRAND.md`, so darkening it is a palette decision DESIGN.md says to ask
about. And `touch-action: pan-x pan-y` is app-wide with no way for a descendant
to opt back in, so a future zoomable surface would have to remove the rule.

**Smaller, in passing:** `.panel`'s blur is 12px, matching the `backdrop-blur-md`
the nav, header and ticker already use rather than introducing a second radius;
and it is switched off entirely in light mode, where `--glass-panel` resolves to
opaque white and the filter was compositing a backdrop nothing could see on
every scroll frame.

**A correction to my own comment.** `globals.css` claimed `touch-action:
manipulation` on interactive elements was "the more specific promise of the
two". It isn't — effective touch-action is the intersection down the ancestor
chain, so `pan-x pan-y` on `html, body` had already removed pinch and that rule
is now redundant. Kept, with the truth written next to it, because the redundancy
is the thing worth knowing.

**Not measured in a browser.** Every contrast ratio above is computed from the
token values against the composited surfaces, not read off a rendered page.

### Aug 14 — Every score in the game, and a Live tab that spans both leagues

SCORE-1 and UX-36; migration 0048. The last of the betting/game-card batch, and
the only two that were features rather than defects.

**What did not exist.** Asked for "the individual scores in that game… for all
scores in that game", and the honest starting position was: nothing. No `plays`,
`drives`, `scoring_plays` or linescore table; neither API client parsed any; and
`games` carries only the *current* live state, every field of which is a moving
value. Worse — `current_situation` and `last_play` are deliberately NULLED the
moment a game goes final (0007's header comment), so postgame there was no play
text in the database at all. `cover_flips` (0026) was the only per-event table
and it is a Q4+ betting-verdict log. `scoring_plays` is the first table in this
project that records what happened *during* a game rather than what is true
about it now.

**Two decisions inside the schema that are easy to get wrong.**

Order is the feed's array index, not the clock and not the feed's play id. A
game clock counts down, resets every quarter and stops; a touchdown and its
extra point are routinely stamped at the same second. Nothing about a clock can
order a timeline.

The running score is stored per row rather than accumulated at read time. These
look equivalent and are not: a feed occasionally reports a score whose play we
never captured, and a browser-side running total would then be wrong for every
row *below* the gap rather than for the one row that is missing.

**The cost control is the whole feature.** `NFL-12` left ESPN's per-game
`/summary` as a decision owed, on the grounds that one call per live game per
tick is ~16× the single scoreboard call on an NFL Sunday. That arithmetic is
right and it is also avoidable: because each stored row carries the score after
it, the timeline itself reports how many points are already accounted for. The
call happens only when the scoreboard has moved past that number — **~1 call per
score, not per tick**. A 47-point game costs about a dozen calls across three
hours instead of roughly 360. `gamesNeedingScoring` is six tests on its own,
because if it ever stops being right the answer is an invisible order-of-
magnitude increase in a free feed's traffic.

**CFB's shape is forced by CFBD, and the cost is stated rather than buried.**
There is no per-game plays route, so one call returns every play of every FBS
game in the week and the scoring rows are filtered out of it. That is one call
*per week* — a fifteen-game afternoon costs exactly one, and the arithmetic
improves as the slate gets busier — but it is a multi-MB response for a few
dozen rows, which is why both jobs ride a 3-minute tick inside the scoreboard
loop rather than the 30-second one. If the payload or the live lag proves
unworkable on the first real Saturday, the fallback is `/drives`: far lighter,
gives the scoring drive and its result, and gives up the player names that were
the point of the request. Either outcome gets a decisions-table row. **Not
measurable before Aug 29** — there is no live CFB game until then.

Two smaller absences the CFBD side has to absorb: it publishes no play *type* at
all (which is why the column is nullable — `live-play.ts` solved the same
absence for `last_play`), and it names the scoring team as a school string
rather than an id, matched against the game's own two teams. A name matching
neither leaves the crest off the row rather than dropping it. The play text is
the feature.

**The Live tab, and the query that was not written.** The obvious implementation
is one cross-league query on `status = 'in_progress'`. It is wrong, and
expensively so: half of `fetchSlateView` is enrichment keyed to a single season
— ratings, poll ranks, SP+/FPI/Elo, season ATS records — so a cross-league query
would have to fork every one of them, and the same game would then render
differently on the Live tab than on its own league's tab. That drift is the
failure this codebase keeps recording.

Instead: find the live game ids first (one indexed read — 0044 added
`games_sport_status_start` for almost exactly this predicate), resolve their
distinct (season, week, season_type) buckets, and load each through the ordinary
path. Usually one bucket, two when an NFL Sunday overlaps a CFB Saturday night.
Every card is then identical to the card its league's tab would draw.

**Buckets rather than "each league's current week"**, which is simpler and
drops games. The NFL pointer rolls forward while Monday Night Football is still
being played, so a viewer with money on MNF would find the Live tab empty at
precisely the moment it matters most. Reading the buckets off the live rows
cannot make that mistake.

One consequence worth recording: the refresh poller's week guard — which drops a
response for a week the reader has navigated away from — has to be skipped here.
The Live view has no week to compare, so the guard would reject every poll and
the one view that must stay current would be the only one that never updated.

**A test helper moved into the shim, and why.** `public.expect_denied` now lives
in `00_shim.sql`, shared by two suites. It takes the message it expects, because
a helper that treats *any* error as a refusal reports PASS when the object under
test does not exist — verified earlier the same day, when four authorization
assertions passed on "function admin_remove_pick does not exist". A
missing-object error is now reported as vacuous rather than absorbed, which is
what makes "checked failing against the pre-fix schema" mean anything.

**Testing.** 25 new (836 → 861) and 5 DB assertions (200 → 205), the latter
checked failing without 0048. One of the new tests was wrong on its first run —
it asserted an empty result for a board where a game genuinely had scored — and
the code was right; recorded because the fix was to the assertion, not the
implementation.

**Not verified against live data.** Both ingest paths are pinned against
fixtures shaped from the feeds' documented responses, not against a capture from
a live game. The NFL side can be proved this week against a preseason final; the
CFB side has nothing to run against until Aug 29.

### Aug 14 — A ticker that moves, no zoom, a slip you can read, and the Why field goes

Four items from the same batch. UX-34, UX-35, UX-38, LEDGER-1; migration 0047.

**The ticker was never a ticker.** `ScoreTicker.tsx:119` was a `flex` row with
`overflow-x-auto` and `shrink-0` chips — a strip you had to swipe, which on a
phone meant every game past the fourth was invisible unless you went looking.
Now a CSS marquee: the track holds the chip list twice and travels exactly
−50%, so the instant the first copy leaves the frame the second is in the
identical position and the reset cannot be seen.

Duration comes from the **measured** content width rather than from
`games.length`. Chips are variable width — an NFL tag, a live dot, a
four-letter abbreviation — so counting them would drift, and the point of
measuring is a constant ~55 px/sec: a sixty-game Saturday travels further
instead of blurring past twelve times faster than a five-game Tuesday.

Paused on hover, on focus-within and while a finger is down, because every chip
is a 44px link and a moving target is not a target. The duplicate copy is
`aria-hidden` and untabbable, so a screen reader and the Tab key each walk the
games once. Content narrower than the frame does not animate at all. Under
`prefers-reduced-motion` the global clamp stops the animation and the viewport
keeps `overflow-x: auto` — it degrades to precisely the strip it replaced, with
the second copy hidden, since without motion that is just every score printed
twice.

**Zoom off, and it fails WCAG 1.4.4 knowingly.** Three changes, because none of
them covers every surface: `maximumScale`/`userScalable` in the viewport, which
the installed PWA honours and which is where this was reported;
`touch-action: pan-x pan-y` for Android Chrome; and a `gesture*` preventDefault
for Safari in a browser tab, which has ignored `user-scalable=no` since iOS 10.

It is recorded as a residual in `docs/STATUS.md` §6 rather than left to be
rediscovered and reverted. What makes it defensible is that the layout is fluid
and reflows to the OS text size — nothing in the app is a fixed-width image of
text — so a reader who needs larger type gets it from Settings. The
`web-design-guidelines` review will flag this every time it runs, which is
correct and is not a reason to stop running it.

`globals.css` had carried the sentence *"Zoom itself is untouched — pinch still
works, and nothing here disables it."* That is now false and is corrected in
place.

**The slip's transparency was a token-scope bug, not a styling choice.** It has
no `backdrop-filter` at all: `globals.css:444-447` reserves blur for "the bars
that genuinely have content scrolling underneath (nav, header, ticker)", and the
slip — a panel fixed over the scrolling slate — was simply never counted. It
also used `.card`, whose face is `--glass-surface` at 80%, and the comment at
`:52-57` says in as many words that 80% was tuned for a *game card*, which has a
controlled blurred aura behind it. The slip has neither an aura nor a blur, so a
fifth of the cards scrolling underneath came straight through and the 11px type
sat on top of moving scores.

New `--glass-panel` (96% of the same `--surface`; fully opaque in light mode,
where the missing 4% would be the page's own grey) and a `.panel` class with the
card's border, radius and shadow plus a blur. Derived from an existing colour,
which is the "extract tokens as named values first" rule rather than a new
value. No sheen — it exists to make a large pane read as curved glass, and on a
panel whose whole job is legibility it is one more thing between the reader and
a number.

**The Why field, and why the answer was already in the database.** The owner
asked whether it was needed: *"I think it's only useful for tails or fades, but
that should be automatic if betting with or against people in your betting
groups."*

That is right, and the automatic half has existed since betting groups shipped.
`src/lib/tailing.ts` derives origin / tail / fade from the one fact nobody has
to be asked for — who got their money down first on that game and market — and
its docblock already argued the case: a stored pointer *"would only be set on
the ones who used the Tail button, which would make the stats a measure of
button usage rather than of who is worth following."* The required picker was
asking people to self-report something the system could observe.

So the picker comes out of the slip and the form, and the ledger's marquee
section keeps its heading and changes its question: what you opened, what you
tailed, what you faded — plus `pairStatsFor`'s "am I better off just copying
Jeff?", which `tailing.ts:210-217` notes is not answerable from anyone's own
record, because a source's record counts the bets you never saw in time to copy.

**Per betting group, never pooled.** Origination means "first in *this* group",
so merging two groups' bets into one crowd would change who was first and
quietly invent tails that never happened. Each group gets its own block; a
viewer in no betting group sees the section not render rather than an empty
table. The ledger's per-row Tag column is dropped rather than replaced — a
relation is per group, so one column could not say which group it meant.

**The column stays, nullable (0047).** Dropping it would be tidier and is wrong
twice: existing rows carry values that were true when they were entered, and
`ledger/export/route.ts` ships `reason_tag` in the CSV, so removing it would
silently change an export people may already hold copies of. The CHECK
constraint needed no change — a CHECK passes on NULL by definition, so it keeps
constraining the values that *are* written while permitting the absence the app
now produces.

**Testing.** 8 component tests (828 → 836) and 2 DB assertions (198 → 200), both
checked failing without 0047. `docs/SPEC.md` §5.3 amended in three places.

**Not measured, and worth saying:** the marquee's speed and the slip's contrast
were reasoned to, not seen. jsdom has no layout, so the ticker's width
measurement has no meaningful unit test and none was written rather than one
that asserts zeroes. Both need a device pass.

### Aug 14 — The final card, the clipped name, and the ball on the home page

Three owner reports from the same screen. NFL-20, NFL-21, UX-37.

**"The nfl game cards get cut off when you click into them on the team names."**
`GameHeader.tsx:368` was `truncate` on `{team.school}` in a `1fr` column beside
a 48px mark. The cause is that `school` means different things in the two feeds:
CFBD gives the school alone — "Georgia" — and ESPN gives the full display name,
"Jacksonville Jaguars", nearly three times as wide in the same slot.

The plan for this was a `teams.short_display` column and a re-sync. Checking
rather than assuming killed it: `nfl-sync-reference.ts:64` already writes ESPN's
`name` ("Chiefs") into `teams.mascot`, and `mascot` is already on `TeamView`.
The short form had been in the database since the NFL shipped. So the fix is one
function, `teamHeadline(team, sport)`, and no migration. CFB deliberately keeps
`school` — there the mascot is a *different* word, not a shorter form of the
same one, and nobody scanning a slate is looking for "Bulldogs".

`truncate` also became a two-line clamp, same reasoning as NFL-9(c)'s last-play
box. The min-height is in `lh` rather than pixels because the header steps from
`text-lg` to `text-xl` at `sm` and a pixel value would be right at one
breakpoint and wrong at the other.

Found beside it: the Systems section is `card overflow-hidden` with no inner
`overflow-x-auto`, where the Market section directly above it has had one all
along. A table wider than the phone was clipped rather than scrollable.

**"For the NFL game that went final there's nothing that says Lost, Won or
Pushed."** Two independent causes, both read off the routing rather than
guessed.

A final renders `FinalFooter`, which builds chips from `myPicks`, ATS, O/U and
the model — and never reads `myBets`. `PregameFooter` *does* have settled-bet
chips, behind `settled = live || final`. But a final never renders that footer,
so the `final` half of that condition has been unreachable since it was written,
and the comment beside it described behaviour the routing prevents. That comment
is the reason nobody looked, and it is corrected in place rather than deleted.

Separately, the cover strip — the big word across the top, which is what the
request meant by "a bigger tab at the top like the demo of live games" — was
gated on `live && a pick`. A bet never produced one and a final never did.

The strip now runs on finals and reads a bet first, matching `tintFor`'s
ordering: real money is the louder fact. Won / Lost / Push through the existing
`.cover-covering / -losing / -push` tiers, so no new colour, size or radius
enters the system — `.cover-word` was already the broadcast score-bug idiom the
request was asking for.

The grader-first precedence rule had been hand-written in three places with the
same comment each time; it is now one `settledResult()`. It is load-bearing in
both directions. The grader settles types a score cannot — `team_total`,
`first_half` and `future` are entered by hand — so for those the stored result
is the only answer. And until the grader runs, recomputing from the final score
is the only thing that can answer at all. **That second half is what the NFL
exposed:** `nfl-grade` runs Mon/Tue/Fri, so a Sunday final carries `result:
null` for the whole afternoon. GRADE-1 shortens that window to a scoreboard
tick; this makes the card readable even when it hasn't closed yet.

**"The Home Screen should also have who has possession of the ball like the
slate shows."** A rendering gap, not a data gap — `fetchHomeData` goes through
`fetchSlateView`, so `possession` was already on the hub's `GameView`. The
football lived in two places the hub cannot reach: inside `GameCard`'s own
`right` override, and inside `FieldStrip`, which the hub's `compact` mode drops
on purpose (a 12px playing field in every row of a list reads as decoration).
It is a `hasBall` prop on the shared `TeamScoreLine` now, drawn once for both
callers, and the two comments asserting the football is deliberately card-only
are corrected.

**Testing.** 18 new (810 → 828). Nine of NFL-21's twelve were checked failing
against the shipped code first; the other three are negative controls that must
pass either way — a live card still says "Covering" and not "Won", a voided bet
still says nothing, and a game you had no position on still shows no verdict.

One of those controls caught a bad assertion of my own. "Names the bet the
verdict is about" passed against the pre-fix code, because the ATS chip renders
the same string `KC -3` and an unscoped text query cannot tell them apart. It is
now scoped to the strip element. Same failure shape as the DB-assertion defect
recorded below on the same day: a check that reports success without having
tested the thing it names.

**Not seen rendered.** These were verified by test and by reading, not on a
device. The device pass is `NFL-3`, still open.

### Aug 14 — Admin cancellation, and the test runner that had been dead for a day

Owner request: *"There needs to be a way to fully cancel bets before and after
they kickoff and finish as someone with admin power. I'm doing test bets so i
want to be able to cancel them. The voided bets still sit in the ledger. The
betting and pickem groups also need to have an admin cancel pick option."*
Tracked as ADM-1 and ADM-2; migration 0046.

**Why voiding was the wrong tool, in the owner's own sentence.** `voidBet` has
existed since 0001 and does not solve this: a voided bet is still a row, drawn
at 40% opacity in the ledger forever. Voiding is correct for a bet that was
really placed and then taken back — it is a fact about the week. It is wrong for
a test row that should never have existed.

**The append-only exception, narrowed rather than waived.** `0001:210` opens the
bets table with *"Append-only ledger: no deletes; voided_at instead (Honest Note
#5)"*, and `docs/SPEC.md` §5.3 says the same. Hard delete was an explicit owner
decision against that. Rather than quietly break the invariant, it was
rewritten: every deletion copies the whole row into a deny-all `deleted_wagers`
archive *before* removing it, so the rule goes from "nothing is ever removed" to
"nothing is removed without a record". Any deleted row can be reconstructed by
hand, which is the property the original rule existed to protect.

That guarantee lives entirely in the ORDER of three statements — read, archive,
delete — which is exactly the kind of thing a later refactor folds into one
round trip for tidiness. So it is asserted directly: force the archive write to
fail, and the bet must still be there.

An archive table rather than a third status, deliberately. A status is what
`voided_at` already is, and the complaint is that voided rows still show up. A
third state would need filtering at every one of the ledger's tallies, and one
missed filter puts test bets back in the units curve.

**Two admin powers, not one.** ADM-1 is a *site* admin (`profiles.is_admin`)
deleting a bet through the service role. ADM-2 is a *group* admin cancelling a
member's pick through a new `admin_remove_pick` RPC. `admin_remove_pick`
deliberately refuses a site admin: `is_admin` is a platform role, and letting it
reach into a pool's picks would make every group's board editable by someone who
is not in it. The two powers stop in different places on purpose.

`remove_pick` could not be reused for ADM-2 in two independent ways. It deletes
`user_id = auth.uid()`, so an admin calling it removes their **own** pick and
reports one row happily; and it raises at kickoff (`0038:62-64`), which is the
case an admin most needs. Betting-group admins get no power over a member's
*bet* — a bet is one row in that person's own ledger, and a group is a lens on
it rather than its owner.

**A defect in the tests, found by the test of the tests.** Every new DB
assertion is supposed to be checked failing against the pre-fix schema. Doing
that here found that the refusal helper passed on *any* error: with 0046
removed, all four "cannot cancel someone else's pick" assertions reported PASS
on `function admin_remove_pick does not exist`, having proved exactly nothing
about authorization. Each refusal now names the message it expects, and a
missing-object error (42883 / 42P01) is reported as **vacuous** rather than
absorbed as a pass. This is the same failure shape the repo keeps finding: a
path that reports success without having verified the thing its caller believes
it verified.

**`npm run db:test` had not run a single assertion since 0043 landed.** That is
how the above got noticed. 0043 and 0044 open with `create extension if not
exists pg_cron`, which is Supabase-provisioned and not installable into a stock
Postgres, so the runner aborted on migration 43 of 45 — and because it failed
with "extension pg_cron is not available", it read as a broken *environment*
rather than a broken *tool*. `scripts/db-test.sh` now writes inert `pg_cron` and
`pg_net` stubs into the installation's extension directory when the real ones
are missing, and removes them on exit. The stubs record a scheduled job and
never run it; a test cluster that started making outbound HTTP calls on a timer
would be a defect of its own. If it cannot write the stubs it **exits 1 naming
the problem**, rather than skipping migrations and reporting a green run over
reduced coverage.

Consequence worth stating plainly: `docs/STATUS.md` §1's "163 DB assertions,
run in-session against a real Postgres 16 cluster" was honest when written and
has been unverifiable since 0043. Today's measured number is **198**.

**Testing.** 24 DB assertions (174 → 198), 9 unit tests (801 → 810). The unit
tests mock the two Supabase clients at the module boundary, because the action
calls `createClient()` for cookies and `createServiceClient()` for env keys and
neither exists in a test process.

**Not verified from here:** the delete against a real test bet in the live
database. That needs production.

### Aug 14 — Grading happens when the game ends (GRADE-1)

Owner question, from the betting/game-card batch: *"When a game goes final does
it grade as soon as its final?"* It did not, and the honest answer explained a
second item in the same list.

**What was actually true.** `applyScoreboard` — the write half both leagues'
live boards share — wrote status, points, period, clock, cover flips and bad-beat
pushes, and touched **no `picks` or `bets` row anywhere in it**. Grading lived
only in `gradeSeasonFinals`, reached from `ratings-update` on the Sunday
13:00 UTC cron and `nfl-grade` on Mon/Tue/Fri. So a bet on a Saturday-night
final sat open on the ledger for up to a week. It also meant the slate's final
card had no `bet.result` to render, which is most of the reason the "an NFL
final says nothing about my bet" report looked like a rendering bug.

**The shape.** `gradeGames(db, gameIds)` is `gradeSeasonFinals` narrowed to a
named set of games; both delegate to a shared `settleGames`. The scheduled pass
stays and is now explicitly the backstop — it still catches the two things a
live tick cannot: a game that finaled outside a scoreboard cron window, and the
dead-game League Rule #4 voids. This is the same shared-function-plus-backstop
arrangement P1-1 built for `voidWagersForGames`, chosen for the same reason.

**The design decision worth recording: not gated on a status transition.**
Detecting one is cheap — `applyScoreboard` already reads the stored rows to diff
against. It was rejected because the NFL's 10-second edge function (migration
0044) writes finals straight to Postgres on its own pg_cron schedule, so by the
time the Actions loop next ticks, the stored row already reads `final` and there
is no transition left to see. A transition-only trigger would have worked
perfectly for CFB and never once fired for the NFL — the league the defect was
reported on. Every completed game on the board is offered to the grader instead,
and idempotency does the rest: every query filters `result is null`, so the
second and every later tick settle nothing.

**One ordering change that is not cosmetic.** `settleGames` now reads the
ungraded predictions, picks and bets *before* the closing lines, and fetches
`line_snapshots` only for the games those rows actually name. Under the old
order, a live tick would have re-read snapshots for every final on the board
every 30 seconds for the length of a Saturday. The test counts the reads rather
than trusting the reasoning: after the first pass settles everything, the second
issues zero snapshot queries.

**Failures are swallowed and logged, deliberately.** The scoreboard's job is
scores. A grading error must not cost the slate its live layer, and the
scheduled pass will report the same failure loudly on its own run. Asserted:
with the bets read forced to fail, the tick still writes the final score.

**Testing.** 10 new tests, 791 → **801**. They run against a new in-memory
PostgREST stand-in, `scripts/lib/fake-supabase.ts`, because every interesting
property here is at the database seam — which rows a query claims, which it
skips, whether a second run finds anything left — and no pure-function test can
reach any of it. It is not a Postgres emulator and says so; RLS, triggers and
grants remain the DB assertions' job.

*(Two stale test counts were found while writing this: `§1` of `docs/STATUS.md`
said 659 and the NFL-9 row said 698, against 791 actual. The new number is
measured.)*

**Not verified against a live game**, and there is none to use — the first
honest proof is `NFL-4`, the watched TNF settlement on Sep 10.

### Aug 14 — The image share, and a confidence tier to organise it

Owner request: an image of your bets you would actually post, sorted by
conviction then by time, titled `<display_name> Bets`, shareable from the slip,
the ledger and a group. Commits `2105fd7`, `2a9731e`, `dece0c1`, `3986472`,
`083cf71`, `029c15d`, `a4c7a1f`. Tracked as SHARE-1…7 in `docs/STATUS.md`.

**The text share was never the problem.** `src/lib/share-text.ts` opens by
conceding what it cannot do: iMessage renders markdown literally and sets a
proportional font, so *"no amount of padding will make columns line up."* That
sentence is the entire case for an image. The card's right-hand column is fixed
width, in Plex Mono, with every stake printed to one decimal — units under
units, decimal under decimal. If the image did not do something text cannot, it
would not be worth a second button.

**Four design directions, and the winner was none of them.** Three were built
per DESIGN.md exploration mode (`public/design/share-card-a|b|c.html`) and the
owner picked a hybrid, `share-card-d.html`: B's row engine, A's tier headings
printed in full but only on a tier *change*, and C's hero made conditional —
the panel appears iff exactly one bet sits alone at the highest tier. That last
clause is the whole reason C alone was not chosen: it promoted its first row
unconditionally, so on a Saturday where every bet is the same tier the card
asserted one of them was special when nothing said so. A card that lies quietly
is worse than one that looks wrong.

**Rendering the mockups found three bugs that reading them did not.** A
overflowed 1350px by ~275px and was clipping two bets and its own footer; B's
stub stretched to the frame and left a 200px hole under seven bets; D's
single-bet hero ballooned into an empty green slab. The last two are one
problem — a fixed canvas holding a variable-length list, where leftover space
is the *normal* case and one bet leaves ~800px of it — and one `filler` fixes
both, collapsing to nothing on a dense card and carrying the S at 6% on a
sparse one.

**Storing the tier was not just a column.** Migration 0013 put
`enforce_bet_void_only()` on `bets` and its rule is absolute: the only
user-driven edit is ungraded → voided, every other column rebuilt from `OLD`.
`0045_bet_confidence.sql` widens that whitelist by exactly one transition, and
the boundary is **kickoff, not grading**. Freezing at insert makes a typo
permanent; letting it move after kickoff destroys the only reason to store it,
because *"how do my Bet of the Day picks actually do?"* is answerable only if
the tier was set before anyone knew. 11 new SQL assertions, 174 passing.

**Three defects only rendering the real route caught.** A bet with no teams drew
an empty coloured circle — the monogram fallback needs an abbr and a future has
none. The eslint rule against constructing JSX inside a try/catch was right and
load-bearing: `ImageResponse` renders lazily as its stream is consumed, so the
guard caught nothing and only looked like it did. And the four committed fonts
do **not** carry the ʻokina, so Hawaiʻi would have set a tofu box — satori draws
tofu rather than falling back to a system face. U+2212 *is* covered, which
retired an earlier flag.

**SSRF, named because an image route hides one well.** The payload is
client-supplied and satori will fetch whatever URL it is handed, server-side,
from inside the deployment — and because the response is a picture, a probe of
an internal address fails silently and looks like a broken logo. Logos are
resolved before render against an ESPN-CDN allowlist, with a timeout and a size
cap; a test asserts `169.254.169.254` is never reached.

`POST /api/share-card` is also **the first route in the repo with a test**
(§23 #42). It asserts the PNG magic number and a floor on byte length rather
than just a 200, because an empty canvas is exactly what satori returns when it
renders and finds nothing to draw.

**Not verified first-hand, and worth knowing:** nothing here has been run
against a real Supabase, a real phone or a real share sheet. `npm run db:test`
cannot complete in the build container — 0043/0044 `create extension pg_cron`,
which is not installed — so the SQL suites were run with those two migrations
excluded, which also means **0043 and 0044 have never been exercised by
`db:test` in that environment at all.**

**One tension, recorded rather than resolved.** BRAND.md §38 says to avoid
"🔥 LOCK OF THE WEEK 🔥"; "Bet of the Century" sits near that register. §16
nonetheless lists *confidence* among the preferred vocabulary, and these are the
user labelling their own conviction rather than the product shouting. They are
set in Graduate small-caps in chalk, not gold and not oversized. The owner's
decision stands; the tension is on the record.


### Aug 14 (night, last) — The home hub's refresh asked the wrong league

Reported straight after the hub's refresh shipped: *"the Home Screen isn't
refreshing at all, I have a live Titans 49ers game I'm tailing a bet on and it
only updates if I click on another page."*

The refresh was wired to `data.liveCount > 0` and `data.firstKick`, and **both
describe the CFB week deliberately** — `fetchHomeData` says as much three lines
above them: *"the hero stays CFB, Saturday is the product's spine."* The hub,
though, shows both leagues. On Aug 14 the CFB week was Week 0, fifteen days
out, nothing playing — so a page with a live NFL game on it, with the viewer's
money on that game, evaluated to `live: false, imminent: false` and settled onto
the **five-minute idle tier**. Five minutes, while watching a game, is
indistinguishable from never.

The mistake was taking a signal that happened to be nearby and assuming it meant
what its name said. `liveCount` is an honest field with an honest comment; it
just answers a different question than "should this page be polling hard".

`homeRefreshTier` now decides from the positions actually on the page, which
span both leagues, OR'd with the CFB week for a signed-out visitor who has no
positions. Kickoffs use the slate's own −3h/+6h window, bounded at both ends so
a game stuck at `scheduled` cannot hold the fast tier forever. The three tests
covering the reported case were checked failing against the shipped derivation
before the fix went in.

`HomeAutoRefresh` also gets its own test now. `router.refresh()` is the only
way a server-rendered hub can update at all, so a no-op there would present
exactly as this bug did, and that wiring should not have been resting on an
assumption.

### Aug 14 (night, later) — The timeout ate the touchdown

Owner report, two complaints that turned out to be one bug: every TV timeout
replaced the last play with `Official Timeout at 11:36.`, and made field goals
and extra points never seemed to show up.

ESPN's `situation.lastPlay` is whatever happened most recently, and a good deal
of that is not football — `Official Timeout at 11:36.`, `Timeout #2 by DET at
01:21.`, `Two-Minute Warning`, end of quarter. Each one overwrote the stored
play. And because a TV timeout follows almost every score, **the plays it
replaced were the field goal, the extra point and the touchdown**: the ones
worth reading were precisely the ones structurally most likely to be erased,
usually within seconds of happening.

It cannot be filtered in the UI. By the time a card renders, the real play is
already gone from the database — the fix has to be in the writer, which is the
only place that can see both the incoming play and the one it would replace.
`src/lib/live-play.ts` sits in the shared `scoreboardPatch`, so CFB gets it
through the same door, and is mirrored into the edge function (standalone Deno,
no imports from `src/`).

Two signals, in order of trust: ESPN's `lastPlay.type.text`, a small controlled
vocabulary confirmed against the live feed (`Rush`, `Pass Reception`,
`Pass Incompletion`, `Penalty`, `Fumble Recovery (Own)`, `Field Goal Missed`,
`Two-minute warning`, `Official Timeout`); failing that, an anchored text
pattern, because CFBD supplies no type at all. Anchored matters — a play that
merely mentions a timeout afterwards is still a play, which a naive
`includes("Timeout")` would throw away.

**The list is a deny-list, so it fails open.** An unrecognised play type is
treated as a play and shows up, rather than a new ESPN string silently deleting
plays from every card. Penalties count as plays; a flag on the field is exactly
what a glance wants explained. Keeping the stored value also means the diff sees
no change, so nothing fans out over realtime for a play that did not happen.

Every string in the 10 tests was captured from the live feed rather than
invented. Verified in production on function v4, with cache-busted reads —
earlier polling had been quietly serving cached responses and showing a frozen
value, which looked exactly like a broken writer:

| ESPN said | database held |
|---|---|
| `Timeout #1 by SF at 00:30.` | `(Shotgun) A.Martinez pass incomplete short right to S.McCormick.` |
| `Official Timeout at 09:56.` | `(Shotgun) A.O'Connell pass incomplete deep left to P.Dorsett.` |

Two for two, none copied.

**And the field goals do reach the card — confirmed, after a second look.**
The first six minutes of sampling caught only a `Field Goal Missed`, which was
not enough to answer it, so this was written down as owed rather than claimed.
A longer pass caught two made kicks in one window, both ESPN type
`Field Goal Good`, both stored verbatim:

```
TEN @ SF   J.Slye 55 yard field goal is GOOD, Center-M.Cox, Holder-T.Townsend.
IND @ NE   S.Shrader 61 yard field goal is GOOD, Center-L.Rhodes, Holder-R.Sanchez.
```

The type is not on the deny-list, so the fail-open rule keeps it, and NFL-11
means the block still renders once the score clears the down and distance. Two
bugs were hiding them, both now fixed; an extra point was not separately
observed, but it is the same code path.

What was never a bug: the kickoff after a score is itself a real play and
legitimately replaces the scoring play twenty to forty seconds later, so a made
kick is visible for a few ticks rather than indefinitely. Making scoring
*persist* would be a new feature with a new column, logged as NFL-18 and not
built.

### Aug 14 (night) — Ten seconds, for a third of the price, and a home page that moves

Three things, one of them a number worth keeping.

**The live pull runs at 10s now and costs less than the 30s one did.** 0043
fired every 30 seconds year-round and let the edge function decide whether
there was anything to do. That decision was correct but arrived too late to
matter: an "idle" tick still costs an Edge Function Invocation, and those are
metered — Free plan, 500,000/month. 30s year-round is ~87,700 a month, ~18% of
the quota, essentially all of it spent on nights with no football.

So the gate moved out of the function and into the cron command. pg_cron still
ticks every 10 seconds — a tick is a local query and costs no invocation — but
`net.http_post` now sits behind a `where exists (...)` copy of the idle
predicate. Invocations happen only while a game is live or about to be:

| | invocations/mo | % of free quota |
|---|---|---|
| 30s year-round (0043) | ~87,700 | ~18% |
| 10s, gated (0044) | ~31,300 | ~6% |

**The short-circuit was proved before applying, and the obvious test for it is
wrong.** `select 1/0 where exists (select 1 where false)` raises
division_by_zero — which looks like proof the target list is always evaluated,
and is nothing of the kind: `1/0` is a constant expression folded at *plan*
time. A VOLATILE function is never folded, so the test has to use one.
`nextval()` behind a false `where exists` came back with `is_called` still
false; behind the real predicate, it fired. That is the whole basis of the cost
saving, so it was worth two queries to not take on faith.

Two things came along because 10s makes them matter. The gate query gets
`games_sport_status_start` rather than seq-scanning every stored game six times
a minute. And `cron-log-purge`, because pg_cron writes a `job_run_details` row
for every tick whether the gate opens or not — ~712 bytes each, ~187 MB a month
at 10s, against a 500 MB Free-plan database, and nothing purges it by default.
It would have filled the disk before November.

**CFB is not in this lane, and was not in 0043 either.** Worth stating plainly
because the shorthand "the 30-second refresh" has been hiding it: the edge
function is `.eq("sport","nfl")` against ESPN's NFL board. CFB live scores come
only from `scoreboardJob` → CFBD → the GitHub Actions loop — the scheduler that
stalled on Aug 13 and is the entire reason this lane was built. Week 0 is Aug
29. Two real blockers, recorded as NFL-15: `games.id` for CFB rows is a CFBD id
and there is no ESPN id column to join a college board on, and the CFBD route
is metered at 30,000/month, where a 10s pull over a 14-hour Saturday is ~5,000
calls a Saturday.

**The home hub never refreshed at all.** Worse than the slate's bug, which at
least polled: `/` is a server component top to bottom, so it rendered once and
sat there until you navigated. `HomeAutoRefresh` drives `router.refresh()` off
the same `useLiveRefresh` — the server render re-runs in place, scroll and
client state kept, and no `/api/home` route duplicating `fetchHomeData`'s
queries. And it never showed the down, the spot or the last play, though
`fetchHomeData` goes through `fetchSlateView` and had all three on the
`GameView` the whole time — only the slate drew them. `LiveSituation` is now
its own module used by both, `compact` on the hub because a 12px playing field
in every row of a list is decoration.

### Aug 14 (later still) — The touchdown was the one play guaranteed not to render

Owner report: the slate cards don't show what the touchdown play was.

`LiveSituation` opened with `if (!game.situation && !pos) return null`. ESPN
publishes a down and distance only while a snap is pending, so the entire
dead-ball stretch after a score — through the PAT and the kickoff — arrives as
`situation: null`, and possession goes null with it, which makes `pos` null
too. Both null, so the guard dropped the whole block: down, field strip, and
the last play together. The play that just scored is the one play on a live
card anybody wants to read, and it was the one play structurally guaranteed to
be missing. Same for end of quarter and timeouts between possessions.

Caught in the stored rows rather than by reading the code: game 401874392 sat
at `current_situation: null` with `last_play: "Official Timeout at 04:42."`
The last play is now a situation in its own right, and the down-and-distance
row is skipped rather than rendered empty above it. The new test was checked
failing against the old guard before the fix went in.

**What this feed cannot give, recorded rather than guessed at.** The down and
distance a play was *snapped* on is not in the scoreboard endpoint:
`lastPlay.start.down`, `.distance` and `.downDistanceText` are all null, and
`lastPlay.drive` carries only `"3 plays, -18 yards, 1:07"` — verified across
six live games. The card's down-and-distance is the *next* one, computed after
the play, which is why a sack reads "4th & 27 at DET 12" above "sacked at DET
12 for -12 yards". Pre-snap down needs `/summary?event=<id>`, one extra call
per live game per tick; queued as a decision (NFL-12), not built.

### Aug 14 (later) — `Number(null)` is 0, and week 0 is a real week

Found while verifying the deploy above against production, not by looking for
it. `/api/slate?sport=nfl` came back `week 0`, `seasonType regular`, **0
games** — with five NFL preseason games live at that moment.

The route read `Number(request.nextUrl.searchParams.get("week"))`.
`URLSearchParams.get` returns `null` for an absent param, `Number(null)` is
`0`, and week 0 is a genuinely addressable week here (`MIN_WEEK` — the last
Saturday of August, SPEC §249). So `isValidWeek(0)` was correctly `true`, and
the route concluded the caller had explicitly asked for week 0. `hasWeek` then
also pinned `st` to `regular`, which is the second half of the wrong answer.

`parseWeekParam` was written for precisely this — it checks `null`,
`undefined` and `""` before touching `Number` — and had **no callers** in the
codebase. The route uses it now.

Two things kept this invisible. `SlateView.refresh` always sends an explicit
`week=`, so the slate's own polling never took this path; and on the CFB side
week 0 is populated, so a bare `/api/slate` returned the eight Aug 29 games
and looked entirely reasonable. It took a league with no week 0, queried bare,
while games were live.

The seven page routes that call `isValidWeek` take their week from
`searchParams` destructuring, where an absent param is `undefined` and
`Number(undefined)` is `NaN` — correctly rejected. None of them carried this
bug. They do still read `Number(raw)`, so a literal empty `?week=` would parse
as 0; no known link produces one, and it is recorded in `docs/STATUS.md`
rather than fixed on spec.

New `src/lib/week-range.test.ts`, 5 tests, with absent-vs-zero as a named
regression case.

### Aug 14 — The scoreboard nobody was allowed to just leave open

Owner report, watching NFL preseason on an iPad: *"it doesn't look like the
NFL scoreboard is refreshing on its own — I have to leave the page and go to a
different tab on the site to get it to refresh."* Plus two things missing from
the NFL card that the CFB demo has: the ball's spot on the field, and a last
play that wasn't cut in half. Three separate defects, one screen.

**1. The poll could not survive a tab going away.** `SlateView` and
`ScoreTicker` each ran a bare `setInterval` gated on
`document.visibilityState`. Two failure modes stack on a tablet. A backgrounded
or dimmed tab has its timers throttled or frozen, and when it comes back the
old interval is armed for a *full fresh period* from whenever it happens to
resume — nothing refreshes on the way back in, which is exactly why navigating
to another tab of the site and returning "fixed" it: that remounts the page and
re-renders it on the server. And the slate slowed its poll to **180s whenever
the realtime channel reported `SUBSCRIBED`**, which is precisely the state a
socket that quietly died on sleep still reports. A dead socket and a healthy
one were indistinguishable, with three minutes of nothing behind either.

New `src/lib/use-live-refresh.ts`, used by both. It decides on the **wall
clock** rather than on tick count — elapsed-since-last-run checked on a short
tick, so a suspended timer catches up on its first tick back, and shortening
the interval (a game kicks off) measures against the last run instead of
restarting the countdown. And it refreshes on **wake**: `visibilitychange`,
`focus`, `pageshow` (iOS restores from bfcache with timers frozen) and
`online`, floored at 4s so the events can't stack. Hidden tabs still cost
nothing. 12 new tests, including the reported bug as a test: hidden for ten
minutes, zero fetches, then one on the visibility event.

The channel's status is no longer an input to the cadence. Live is **30s**
(matching the ESPN pull behind it, migration 0043), imminent 60s, otherwise
120s. That is up to 6× more `/api/slate` reads than the old connected path
during the few hours a week games are actually live, and it is the right trade
for a product whose whole premise is being left open next to a TV.

**2. The football never reached an NFL card.** `parseEvent` stored ESPN's
`shortDownDistanceText` — "2nd & 10" — where `parseSituation` needs a spot.
NFL-5 verified that field against a live game and recorded the strip as never
rendering; what it did not connect is that the strip *is* the field-position
feature. `downDistanceText` carries it ("2nd & 10 at GB 31") and the short form
is now only the fallback for ESPN's spotless kickoff snapshot. Changed in both
writers — `src/lib/espn.ts` and the edge function's own copy.

ESPN drops the abbreviation at exactly one spot, midfield: "2nd & 10 at 50",
observed live on IND@NE. `parseSituation` takes a null `sideToken` there, and
`fieldPosition` accepts it **only at the 50** — a token-less spot anywhere else
would be genuinely ambiguous and still fails closed, as does `isRedZone`.
Verified against the live feed: `yardLine` is measured from the home goal line,
which agrees with the parsed string on all five in-progress games.

**3. The last play was one `truncate`d line**, which cut roughly half of every
real play description ("(Shotgun) F.Mendoza pass short right to M.Washington
to ARZ 6 for 6 yards (S.Murphy-Bunting) [B.Ojulari]"). Now `.last-play`: two
lines, clamped, in a box that is two lines tall whether or not it needs them —
letting it grow and shrink with each snap would bounce every card in the row,
which DESIGN.md forbids. Checked rendered at 1024×768 and 390×844.

Also here, because CI has been red on it since #66: `supabase/functions/**` is
Deno, not Next, and is now in `globalIgnores` rather than failing
`npm run lint` on four unavoidable `any`s over ESPN's untyped JSON.

**The edge function needed its own redeploy**, since it ships to Supabase
separately from the app. Done the same hour, owner-approved: `nfl-scoreboard`
v3, `verify_jwt` unchanged, the repo file verbatim. One cron tick later all
five live preseason games had gone from `"1st & 10"` to `1st & 10 at CIN 46`,
`3rd & 2 at IND 35`, `3rd & 9 at LAC 47`, `1st & 10 at GB 42` and
`2nd & 11 at LV 34`, with clocks still advancing — so the 30-second pull is
intact on v3, and every side token matches a stored `teams.abbreviation`,
which is the condition `fieldPosition` resolves on.

### Aug 13 (night) — NFL preseason: August is real on the NFL side

Owner request an hour after go-live. `preseason` becomes a third
season_type — NFL only, no CFB row ever carries it — stored 1:1 from
ESPN's boards (weeks 1–4, week 1 the Hall of Fame game). No migration:
`season_type` has no check constraint anywhere, verified against the live
catalog rather than the migration files. `nflStoredWeek` stops dropping
type 1, sync fetches four more boards (dry-run 321 = 272 + 49),
refresh-lines picks its week by earliest scheduled kickoff — a
season-type sort can't order pre → regular → post — and the slate's NFL
week select gains Pre 1–4 behind `?st=pre&week=N`. The pointer needed
one line: `toPointer` passing the type through; the kickoff-derived
current-slate logic (audit bug #6's fix) already lands on tonight's
preseason week by construction.

Preseason games are real games — scores, live states, lines when the
book posts them, bets that grade — with two deliberate exclusions
unchanged: `set_group_week_config` still rejects the season type, so no
pick'em board can be hung on an exhibition, and the model never sees the
NFL at all.

**Found live, fixed the same hour: two scoreboard coverage gaps.** The
opening preseason kicks (23:00 UTC Thursday) sat dark because every
scoreboard window started at the following midnight — built for
regular-season TNF at 00:15, never for a 7pm-ET weeknight kick. The
Black Friday game (20:00 UTC) sat in the same hole. New window
`0 20-23 * * 4,5`; the first stranded hour was bridged by hand through
the same write path the loop uses. And the Phase-2 table's "widen the
post-midnight windows" row turned out to be planned but never applied —
the SNF/MNF and TNF windows still ended at 03:00, whose last 63-minute
launch dies ~04:03 while winter night games run past 04:15. Now `0-5`
Mon/Tue and `0-4` Fri/Sat, as the plan always said. The jobs-yml test
holds strings consistent; it cannot know a kickoff calendar — coverage
gaps only surface against real games, which is what tonight was for.

### Aug 13 (later still) — The NFL, as a second seasons row

The site carries both leagues now: NFL scores and lines on the slate behind a
CFB | NFL toggle, NFL bets grading into the same ledger, pick'em groups with
an admin-chosen league scope, betting groups reading their members' whole
book with a per-league split. BRAND.md §17 has wanted this since v1.0; this
is the plumbing catching up. Branch `claude/nfl-scores-lines-l4bhio`.

**The load-bearing decision is that NFL 2026 is season id 102026** (100000 +
year, `src/lib/league.ts`), not a second week-space inside 2026. Every
season-scoped CFB job — freeze pricing, the ratings replay, weather, rankings
— filters by `season_id` and is therefore blind to NFL rows with zero filter
changes, and CFB week 3 / NFL week 1 never meet in a query, a realtime
channel, or a `group_week_config` key. Cross-league reads (ledger, home,
grading, sheets) opt in via `.in("season_id", [2026, 102026])`. Team and
venue ids offset by the same constant (ESPN NFL ids 1–34 collide with CFBD's
college ids); game ids stored raw because ESPN allocates event ids globally —
an assumption the ingest enforces by refusing any event id already stored as
a CFB game rather than trusting it.

**The model is untouched, deliberately.** No `src/model/*` change, no tuner
run, no decisions-table row. NFL games render with `prediction: null`, which
every consumer already handles (it is the early-season CFB state), the
`freezeJob` pricing path never sees season 102026, and `ratingsUpdateJob`'s
replay half is unchanged — its settlement half was extracted verbatim as
`gradeSeasonFinals(db, seasonId)` so the new `nfl-grade` task can run the
identical grading/CLV/void math over NFL finals. Same shape for the live
layer: `applyScoreboard` is the old `scoreboardJob` body, fed by CFBD for
CFB and by the new `src/lib/espn.ts` (the only module allowed to talk to
site.api.espn.com) for NFL, cover flips and bad-beat pushes included.

**The odds sign convention is pinned by fixtures captured from the live feed**
(2026-08-13, preseason week 2 + the season openers), favorites verified
against the book's own `details` string: ESPN's `spread` is home-perspective,
negative = home favored — the stored convention exactly — and the parser
drops any spread its own cross-checks (details string, favorite flag)
contradict, because a dropped snapshot costs nothing and an inverted one
poisons an append-only table. ESPN carries true openers
(`pointSpread.home.open.line`), so NFL snapshots have real
`spread_open`/`total_open` rather than a first-capture proxy. One book per
snapshot (`source='espn'`, provider from the feed — DraftKings currently);
`line_consensus` handles a one-provider game by construction.

Dry-runs against the live feed: 32 teams with the editorial division table,
272 regular-season games (TBD playoff slots skipped until January), 16 week-1
snapshot rows with lines already posted. Migration 0042 (sport columns,
one-current-per-sport partial unique index, `groups.leagues` +
`set_group_leagues`) proved against a local cluster — 163 DB assertions, 8
new. 683 vitest tests. **Not yet live: 0042 is unapplied and
`nfl-sync-reference` undispatched — and the order is load-bearing** (the
sport-aware pointer must deploy before the second `is_current` row exists).
Open rows in `docs/STATUS.md` §4 under NFL-2…NFL-6.

### Aug 13 (later) — Making silence stop looking like success

Three fixes, one theme: a failure that produced the same observation as health.
This repo keeps finding that shape — the backup step that exited 0 with a
20-byte artifact, the dead-man ping discarded by `|| true`, the six notification
crons that resolved to `task=unknown`. Two more of them, plus a box that was
ticked on work that fixed nothing measurable.

**Query errors were dropped at every call site**, so a dead data layer rendered
as an empty season. `const { data } = await supabase…` discards `error`, and
nothing downstream could tell "no rows" from "no database".

**My first measurement of this was wrong, and the correction is the useful
part.** I reported that a build pointed at a non-resolving database served 200
on every route. That experiment was invalid: Next inlines `NEXT_PUBLIC_*` at
build time *including in server components*, so overriding the URL at
`next start` did nothing — the server was talking to the live project
throughout. Confirmed by finding the real project ref baked into
`.next/server` chunks. Rebuilt with the bad URL actually baked in, the defect
reproduced cleanly: `/standings`, `/ratings`, `/receipts`, `/recap`, `/slate`,
`/rankings`, `/teams` and `/ledger` all rendered an empty season in silence.
After the fix, all eight render the error boundary.

`src/lib/db-result.ts` — `required()` throws on a failed read, never on an
empty one, because empty is a real state here. Applied to the rows each page
**is**, not to enrichment: a missing dome flag should not blank a slate. That
line is the whole design, and it is written down rather than left to taste.
Fixing it also exposed an unsound `as TeamRow[]` on `/recap`, where the query
selects four columns and the cast claimed nine.

**`emptyIsHealthy` is gone**, and the argument it caused turned out to be about
nothing. This file's tracker wanted it removed; `KICKOFF_READINESS.md:69` said
it "costs nothing and stays". Both were arguing a red/green trade that never
existed — `probeFailures` has only ever counted DENIED and ERROR, so EMPTY
never failed a run. Removing the flag changes what the probe *says*, not what it
*does*. Zero rows now reports EMPTY everywhere, and a required endpoint
returning nothing raises a warning naming it. Going red on empty still needs one
observation of a live game, which is still `observe-scoreboard`.

**UX-28 was reopened.** It shipped `min-w-0` plus a `title` on the standings
team cell, and the box was ticked. Measured against the live database, the
symptom does not reproduce: nothing clips at 375px or 320px, and column widths
are identical with and without the change — `[172, 43, 64, 66]` both ways —
including a forced worst case of the longest FBS name beside full
end-of-season records. Shipping a defensive change is not fixing a defect, and
a checked box in `docs/STATUS.md` means the latter. The Aug 21 device pass
settles it; if nobody can make a name truncate, it closes as "not a defect"
rather than as done.

659 tests across 47 files, 155 DB assertions, `tsc`, lint and `next build`
clean. No decisions-table row: nothing here touches `DEFAULT_PARAMS`.

### Aug 13 — The post-launch queue, opened early, and nine rows that lied about themselves

§2 had nothing buildable left — every unchecked row in the blocking list is
owner-run, a dispatch or a dated watch — so §4 was opened 16 days early by owner
decision. Eleven rows landed across three commits: four security, five UX, five
ops/data-quality. 645 → 649 tests, 129 → **155 DB assertions**, `tsc` and lint
clean.

**The number worth keeping is nine.** Nine of the rows described their own
defect wrongly, and in four cases the wrong detail changed the fix. They were
not found by re-reading the tracker — a reconciliation on 08-12 read the whole
file looking for exactly this and passed over all nine. They were found by
writing the fix and having the code disagree.

The four where it mattered:

- **SEC-02 could not be fixed the way it was written.** "A removed admin
  rejoins as admin" is true, and the obvious repair — always rejoin as
  `member` — locks a sole owner out of their own group. `leave_group`
  deliberately lets the last member out without a successor, so they would come
  back to a group with no admin and the deferred keep-admin trigger refuses the
  insert. Removal and departure had to stop being the same event:
  `group_members.removed_by` is null when you left and set when an admin removed
  you, and only the second demotes on rejoin.
- **SEC-01's throttle forced a shape that looks like a downgrade.** `raise`
  aborts the transaction, which rolls back the very attempt row a rate limit
  counts — so a function that raises on a bad code can never accumulate evidence
  that codes are being guessed. `join_group` now returns null on a miss and the
  server action words it. Codes themselves were **six upper hex characters**,
  16^6 ≈ 16.7M, not the 36^6 the row implied; now ten Crockford base32,
  ≈1.1e15.
- **P1-1b's mechanism was backwards.** The row said a frozen prediction on a
  dead game "is re-read as ungraded every Sunday forever". It is never read at
  all — the query filters to `finalIds`, which excludes dead games by
  construction. That also retires one of the two options the row offered, since
  "exclude dead games from the ungraded set" is already the behaviour. The only
  user-visible half, receipts saying "graded after kickoff" about a game with no
  kickoff left to come, is fixed.
- **§1 said migrations 0034/0035 were unapplied.** The live ledger is 36 files,
  36 rows, and has been since 08-13. It mattered because two ticked rows depend
  on them: P1-1's re-pick fix *is* 0034, and OPS-2's watchdog push needs 0036's
  enum value and 0037's settings row — and `notifyWatchdog` returns
  `{notified: 0, errors: 0}` rather than throwing when that row is missing, so
  it would have been silently dead rather than loudly broken. Both confirmed
  live against the project, along with two admin push subscriptions for it to
  reach.

The other five: `remove_pick`'s `ok:true` was the server action, not the RPC;
P2-6's "the game page was already narrowed by 09:P-5" — 09:P-5 narrowed
*profiles*; OPS-14a listed the probe, which self-meters, and missed
`build-preseason`, which runs twice a day through August; DQ-15's "local-dev
only", when ~25 call sites pass `useCache: true` as a literal; and DQ-5's
"schema churn isn't worth it" on a column with zero readers.

**Two things checked and found *not* to be defects**, recorded so they are not
re-raised. `error.tsx` destructures `retry` where the Next in training data
passes `reset` — but both exist in 16.3.0, `retry` is the recommended one, and
it became stable in exactly this version. Reading `node_modules/next/dist/docs/`
instead of trusting the remembered API, which `AGENTS.md` asks for, was the
difference between a fix and a regression. And `scripts/db-test.sh` prints
"0 failed" when a suite aborts mid-way, which reads like a silent pass — but
`set -euo pipefail` is set and the run exits 1. Verified with a
deliberately-aborting probe suite rather than by reading the script.

**A live discrepancy found while correcting a comment, and deliberately not
fixed.** `02:M-12`'s stale note claimed the backtest replays at tilt 0 to match
production "unless `PRESEASON_TILT_CARRY` has been set". The default is in the
code, not the environment — `build-preseason.ts:91` reads
`envNum("PRESEASON_TILT_CARRY", 0.4, …)` — so production ships **0.4 and the
headline calibration is computed at 0**. Raising the replay would silently
restate every number this report has produced, including the b₁/b₂ figures and
the 2026.5.0 identity check, so it is queued for `--tune-preseason-tilts` after
Week 0 with a decisions-table row owed either way. **No decisions-table row for
this entry otherwise: nothing here touches `DEFAULT_PARAMS`.**

**Migrations 0038–0041 are in the repo and proved against a local Postgres 16;
they are NOT applied to the live project.** Each of the 26 new DB assertions was
checked to fail against the pre-fix schema before being kept. Both column
revokes needed the table grant dropped first — a column-level revoke against a
live table-level `SELECT` is a no-op, which is the lesson `0013:26` already
recorded and which an assertion failing against a "working" migration taught
again.

**Rendered against the live project the same day**, after the commits above
said they had not been. A build pointed at `the-cfb-slate` and driven headless
at 375px, and it changed three of the claims:

- **UX-22 shipped a defect the tests could not see.** Push and void both used
  `Minus`, and `--push` (#9aa1ad) against `--text-dim` (#a89f90) is two greys
  differing only in temperature. Distinct in the DOM, identical to the eye at
  10px. Void now takes `Ban`. All five states confirmed separable.
- **UX-28's symptom did not reproduce.** No school name clips at 375px or
  320px, the document never scrolls sideways, and the column widths are
  identical with and without `min-w-0` — including a forced worst case of the
  longest FBS name beside full end-of-season records. The change is correct
  defensively and inert today. Recorded rather than claimed.
- **UX-27 and the tap targets measured clean.** The boundary renders both navs;
  "Try again" 44×44, BetSlip remove 44×44, units input 48×44. P2-6's `/ratings`
  serves 138 rows with `logo_url` wired through the narrowed select.

Reaching the error boundary needed a temporary throwing route, and that is its
own finding: a build pointed at a **non-resolving database still served 200 on
every route probed**, because the query helpers destructure `{ data }` and drop
`error`. A data-layer outage renders empty pages, not the boundary — which is
the `emptyIsHealthy` argument in different clothes. Tracked in §4.

Still unrendered: the receipts tooltip, because `predictions` is empty by design
after 0028, so no receipt rows exist to hover.

**Left undone on purpose, each with its reason in the row:** three of UX-08's
seven tap targets (a 44px target in a ~30px stacked row overlaps its sibling —
needs a layout change seen on a device), `backtest.ts` metering (Supabase
secrets in a workflow that fires on every model PR), the `game/[id]` teams
query (two rows, no win), P2-2's signed-in half (needs an
`is_current_user_admin()` RPC across six call sites), and the existing
six-character join codes (regenerating invalidates codes already sent).

### Aug 13 — Three green runs, and only the third one meant it

P1-9b is closed. Run #122, `jobs · backup`: `dead-man ping ok — backup
(HTTP 200)`. The scheduler finally has a witness that does not depend on the
scheduler — the gap `watchdogJob` cannot cover, because a job cannot report
its own death, and OPS-2's push is sent from inside that same job.

**It took three runs, and all three were green.** That is the finding, not the
setup.

- **#120** — secret set, and the ping never left the runner: `curl: (3) URL
  rejected: No host part in the URL`. Malformed value.
- **#121** — value fixed, request delivered, `curl: (22) 404`. The value was
  an **API key** rather than the project **ping key**. Healthchecks answers a
  key that matches no project exactly as it answers a slug that matches no
  check, so the two failures are one status code.
- **#122** — ping key, `HTTP 200`.

Every one of those runs reported success, because the step was
`curl -fsS … > /dev/null || true`. A dead-man switch that did not exist was
indistinguishable from one that did — and the whole value of the thing is that
it fires when something is *absent*. An absence detector that is itself
silently absent is worse than none, because it is trusted.

This is the same defect as the backup step directly above it, which shipped
`pg_dump | gzip` under a non-`pipefail` shell and uploaded 20-byte artifacts
green for a day (Aug 12, below). Same shape, same file, one step apart, eight
days later. Worth naming: the reflex to write `|| true` after anything
described as "best effort" is how both were built.

So the step reports now. It still cannot fail a run —
`scripts/lib/jobs-core.ts:134`, observability must never break the thing it
observes, and that rule is why `|| true` was there in the first place. The fix
is not to remove the rule but to stop conflating "does not fail the run" with
"says nothing": missing secret is a `::notice::` matching the backup step's
wording, `200`/`201` prints the slug and code, `404` is a `::notice::` because
an unknown slug is the designed way to monitor 6 of the 24 tasks, and no
answer at all is a `::warning::` naming the shape the URL must have. #120 and
#121 would each have been one run to diagnose instead of three.

Proven for `backup` only. The other five slugs are configured and unobserved
until their crons fire, `watchdog` first at 20:00 UTC — and a slug that misses
its check now says so, so each first firing is its own proof.

### Aug 13 — P1-9b, decided down to the click

No code. P1-9b has sat open as "create a healthchecks.io project" since audit
07, estimated at half an hour — but the half hour was never the clicking, it
was reconstructing what the ping step actually wants from a workflow file that
has grown to 22 tasks and 30 crons. That reconstruction is now written into
`docs/STATUS.md` rather than being done again by whoever picks it up.

Four things it decides. **The secret is a ping key, not a check UUID** — the
step pings `"$HEALTHCHECK_PING_URL/<task>"`, which is healthchecks' slug form
(`https://hc-ping.com/<ping-key>/<slug>`), and a UUID with a task name glued
on the end matches no check. **No trailing slash**, for the same reason and
with the same failure mode: a silent permanent 404, invisible in the Actions
log because the curl is `-fsS … > /dev/null || true`. **Six slugs, cron
schedules copied from `jobs.yml`, grace ≥ 2 h**, because Actions cron lags
5–30 min by design and a one-hour grace alerts on a healthy scheduler. And
**no `?create=1`**: all 24 task names ping, auto-provisioning would create a
check for each, and the free tier holds 20.

`watchdog` is called out as the one to do first. It pings 3×/day and the step
is `if: success()`, so a red watchdog withholds its ping — one check covers
both "a data job went silent" and "the scheduler is gone", which no other
single check does.

The alert channel is the part P1-8 changes. Nine failure emails arrived over
Aug 10–12 and none was opened, so routing healthchecks to email would buy a
second alert into the same unread stream. Anything else — ntfy, Telegram,
Pushover, Discord, Slack — is on the free tier, and the requirement is only
that it is not the GitHub notification inbox.

Verification does not have to wait for a cron: `backup` is dispatchable and
read-only, so a `jobs · backup` dispatch proves the secret end to end against
the `backup` check.

Still unchecked. It needs a third-party account and a repository secret, and
neither is reachable from a session — this removes the deciding, not the
owner.

### Aug 13 — Fourteen history files, one door

`docs/` held five live documents and one frozen one; `audit/` held the other
thirteen frozen ones. So `AUDIT-2026-08.md` sat apart from its three siblings
for no reason except the order things were written in, and a newcomer had to
open several files to learn which of them was still true.

Moved to `audit/`, and `audit/README.md` is now the single door. `docs/` is
exactly the five live documents.

The index earns its place on one thing more than the filing. `docs/STATUS.md`
cites findings as `04:DQ-13`, `09:P-16`, `05:N9`, `07:OPS-11` — and nothing
anywhere said that **the leading number is the file**. The mapping was
tribal knowledge; it is now a table, verified rather than assumed (the first
draft had `F-NN` in `10-gap-analysis.md`; it is in `01-feature-inventory.md`,
and `10` owns `G-NN`). It also warns about the two collisions: `09`'s `P-NN` is
not `KICKOFF_READINESS`'s `P0/P1/P2-N`, and `M-N` appears in both `02` and `03`.

The README closes with what four audit passes did not catch — the unrouted
notification crons, `make_pick` never clearing `result`, and nine unread failure
emails — because the pattern connecting them is worth more than the list. Each
component was verified at its own level and the seam between them was not
testable by any of those verifications: a push proved on a real iPhone, a cron
proved by reading YAML, and nothing proving the cron reached the push.

Path references were rewritten across the frozen files. That is not a revision
of a finding, which the freeze rule forbids — it is a moved file, and the
alternative was knowingly leaving twelve broken links in the history.

`docs/STATUS.md`'s document table and `AGENTS.md` both collapse four rows into
one pointer at the index.

No model change. `DEFAULT_PARAMS` untouched, no tuner run.

### Aug 13 — The last audit that read as a live worklist, and a table that copied the code

Two doc fixes found by asking whether the five documents actually agree.

**`audit/KICKOFF_READINESS.md` was the only audit without a history banner.**
`AUDIT-2026-08.md` and `audit/CHECKLIST.md` have carried one since 08-12; this
one still opened as a live audit with P0/P1/P2 findings and a day-by-day plan.
It is also the file most affected by today's work — it discusses P2-1 ten times,
P1-1 seven times, P2-10 and Q4 five times each, all now closed. Someone opening
it cold would have concluded eleven items were open that are not. Banner added,
listing what closed, and pointing at what the file is still worth reading for:
the reasoning, and §1's record of where its own first pass was wrong.

**`SPEC.md` §8's schedule table had three rows that were never true and one that
stopped being true.** This morning's pass fixed the seven contradictions the
tracker listed; these were not on it, which is the point — nobody had checked
the table against the code, only against the tracker.

- "Live scoreboard poll: every 2–5 min on game days (**client polls our DB — no
  websockets project**)" was inverted. Browsers are updated by Supabase realtime
  over `postgres_changes`, and the loop polls CFBD every **30 seconds**.
- "Injury/news LLM scan | Daily 7am" and "Calibration report | Sunday after
  rating update" describe jobs that do not exist. They are `F3` and `07:OPS-8b`,
  open in `docs/STATUS.md` §4, and the table listed them beside real schedules
  with nothing to distinguish them.
- "Weather pull | Saturday 6am local per stadium" — one run at 10:00 UTC. Per
  stadium would need a cron per timezone and was never built.

The table also gained the rows it was missing entirely — push, backup, watchdog
— and lost the thing that caused the drift: **it no longer reproduces cron
expressions.** `jobs.yml` is the only place those live. A document that copies a
fact the code already states will drift from it, and the copy is the one people
read. That is the same failure as the notify crons, one layer up: the schedule
existed in two places and only one of them was true.

No model change. `DEFAULT_PARAMS` untouched, no tuner run.

### Aug 13 — CI confirmed the FCS change is inert

The identity claim was asserted locally in `replay.test.ts`. PR #54's
auto-triggered backtest checked it on a second machine against live CFBD data,
and the report is **character-identical** to run `31563098426` — the Aug 12 run
that shipped 2026.5.0 — line for line: `totals -0.063/-0.81/0.865`, `thin 428
0.077/1.00/0.990`, `thick 2183 0.021/0.41/0.986`, `conference 1635
0.070/1.03/0.921`, `non-conference 976 0.017/0.31/1.019`, the three opener
buckets to the unit, and `b1 0.035 (t 0.83)` vs `b2 0.985 (t 22.87)` at n=2611.

Both buckets sit at −30, so bucket membership is unobservable and a wrong
classification cannot move a number. That is what makes the machinery safe to
land now and the values safe to defer to `--tune-fcs`.

It proves inertness, not correctness — nothing here says the split is right, and
Gate 0 may yet return "one bucket, on evidence."

### Aug 13 — Nine alerts arrived and nobody read one

P1-8 asked a yes/no question: did the Aug 10 watchdog failure email arrive? It
did — `Run failed: jobs - main (de8e7f2)`, 09:26 UTC, in the inbox, "Failed in
19 seconds", which is the watchdog tripping on a cold `job_runs` table exactly
as the tracker described. The channel works.

Reading the same inbox answered a better question. That email is **still
unread**, and so are the eight other failure emails from Aug 10–12 — including
all three `jobs · backup` failures, the sequence that found five real defects.
Nine delivered alerts, zero opened. They arrive among a few hundred GitHub
notifications and are visually identical to the Vercel build comment sitting
above them.

So "does the email arrive" was the wrong question, and ticking the box on a yes
would have been technically true and practically wrong. **OPS-2:** `watchdogJob`
now also sends a push, to the one channel proven to reach a person — the stack
shipped in 0031 and verified on a real iPhone the day before. Fifth notification
kind, admin audience, enabled by default (unlike bad beats: this one only fires
when something is already broken, so the firehose argument does not apply).

Three details that are the actual work:

**Deduped on the UTC date, not the problem.** The watchdog runs on
`0 8,14,20 * * *` plus a Saturday afternoon pass. Keying the receipt on the
failing job alone would re-send on every run until it recovered — four buzzes a
day about the same dead cron, which is how someone learns to swipe the app away.
Keyed on the day, a persistent fault is a daily reminder; a *new* job going
silent is different subject text and notifies immediately, because that is news.

**It swallows everything.** The push happens on the line before the throw. If a
push failure propagated, the red run would say "push service down" instead of
naming the job that went quiet — the alerting layer would have eaten the signal
it exists to carry. There is a test for exactly that.

**It is not a replacement for healthchecks.io, and the code says so in three
places.** A push sent by a job that has itself stopped running cannot fire; a
scheduler that dies entirely takes `watchdogJob` and its push down together.
That is the hole the external dead-man covers and this does not. What this
closes is the commoner case — one job goes silent while the scheduler lives —
with something that vibrates in a pocket.

Migrations 0036/0037, split for the same reason 0032/0033 were: Postgres refuses
to use a new enum value in the transaction that adds it.

Also this session, applied to the live project: **0034 and 0035**. Verified by
query rather than by assumption — 34 rows in `supabase_migrations`, the
constraint present and `NOT VALID` as intended, `make_pick` containing
`result = null`, and `fcs_avg_margin` null across all 266 team rows, which is
the inert state. The constraint was probed behaviourally inside a block that
force-rolls back: `postponed` and `canceled` accepted, `cancelled` and
`weather_delay` refused, and all 888 games still `scheduled` afterwards. Worth
recording that **zero existing rows violate the constraint**, so the `NOT VALID`
could be validated whenever someone wants to.

645 tests, 129 DB assertions.

No model change. `DEFAULT_PARAMS` untouched, no tuner run.

### Aug 13 — The FCS split, built so that it changes nothing

Q4 asked whether to build the specced two FCS buckets or amend the spec down to
the one the code actually runs. Owner said build. This is that, with the
property that makes it safe sixteen days out: **it changes no number.**

`fcsTopRating` and `fcsOtherRating` have been in `DEFAULT_PARAMS` since v1 at
−25/−35, read by nothing, while a flat −30 was hardcoded in four separate
files. Every fitted parameter in the model was fitted against the flat number.
Both params now ship at **−30**, which is a stronger guarantee than an identity
default usually gives: because the two are *equal*, `fcsRatingOf` returns the
same value whichever bucket a team lands in, so bucket membership is not merely
inert — it is unobservable. A wrong classification cannot move a prediction.
`replay.test.ts` asserts bit-identity between a replay with a bucket set and one
without, and a negative control proves the assertion is not vacuous: separate
the buckets and the same classification does move the numbers.

**What decides a bucket** is the FCS team's own average margin against FBS over
prior seasons, split at the **median of the qualifying population**. The median
rather than a tuned threshold on purpose — a free threshold would make
`--tune-fcs` a three-dimensional grid and hand the search another degree of
freedom to overfit with.

**The lookahead trap, which nearly went in.** `replaySeason`'s one invariant is
that week-N predictions see nothing from week N onward, and there is a test that
perturbs week-2 scores to prove it. A bucket computed across 2023–25 and used to
price a 2023 game breaks that quietly, in the direction that flatters the
backtest. So `before` is a **required** parameter of `fcsMarginsVsFbs` and the
season filter lives inside the function: a caller who forgets cannot compile.
The residual is a window mismatch — with SEASONS 2023–25 the fit sees one prior
season for 2024 and two for 2025, where production gets three. That is written
into the tuner's docblock as the first thing to check if a result looks too
good; closing it costs two metered calls for 2021–22.

**Production genuinely cannot see this signal**, and saying so plainly matters
more than working around it. Production prices from `ratings` rows and the
database holds only the current season, so there is no prior-season margin
history in it. The number is therefore computed where the history already is —
`build-preseason` has 2023–25 in memory — and materialised on
`teams.fcs_avg_margin` (migration 0035), which `freezeJob` and
`ratingsUpdateJob` read back through the *same* `fcsTopIds` the backtest fits
with, so the served rule and the fitted rule cannot drift. Nullable with no
default: while it is empty every FCS opponent prices at `fcsOtherRating`, so if
`preseason-refresh` never goes green before Aug 29 nothing changes at all.

The rejected shortcut, recorded because it looks obviously right: writing FCS
teams as week-0 `ratings` rows. `ratingsUpdateJob` builds its priors from every
week-0 row and the replay Elo-updates anything in priors, so FCS teams would
silently become rated, drifting entities. That is a different model, not a
lookup.

`--tune-fcs` carries its criteria in the docblock and prints them before the
first number. Gate 0 comes first and is the point of the whole thing: at the
flat anchor, is the top half's error even distinguishable from the other half's?
If |t| < 2 the split has nothing to correct, and Q4 gets answered **"one bucket,
on evidence"** rather than by deferral. Only past that gate does a grid run, and
a pair ships only on all four criteria — both biases toward zero, FBS-vs-FCS MAE
better by ≥ 0.25, pooled MAE and NLL not degraded, and the population-weighted
mean FCS rating within ±1.5 of −30, because a level shift would re-open the
already-shipped `--tune-tier-recenter` fit and is a different experiment.

The run is **not** happening before Week 0 and the decisions table says so.

Also here: the four hardcoded copies of −30 are gone, replaced by the one pair
in `DEFAULT_PARAMS`. And `backtest.yml`'s experiment dropdown had drifted — four
tuners that exist in `backtest.ts` were missing from it and could only be
reached by editing the workflow. Added, with `tune-fcs`.

637 tests.

**Model change: none.** `DEFAULT_PARAMS` moves `fcsTopRating`/`fcsOtherRating`
from −25/−35 to −30/−30, which changes no output because neither value was ever
read — the code used a hardcoded −30, and the new pair reproduces it exactly.
No tuner run. `MODEL_VERSION` stays 2026.5.0.

### Aug 13 — Seven places the docs described a product we do not have

`docs/STATUS.md` §2.3 collected the doc-vs-code contradictions found by reading
both. All of them are now amended, each with the code cited rather than the
memory of it. The two that were load-bearing:

**§8 said all jobs run on Supabase pg_cron → Edge Functions.** They never did in
production, and as of this morning they cannot — that code is deleted. A reader
following the spec would have gone looking for a scheduler that does not exist.
The Stack line repeated it. Both now name GitHub Actions and, more usefully,
state the constraint every schedule in the file is shaped around: Actions cron
lags 5–30 minutes, which is why each close pass sits ~40 min ahead of its wave.

**§2.2's K-factor still said "start ~0.15–0.20, tune via backtest".** The tuning
happened months ago and landed on 0.3. The amendment carries the part that keeps
it from being re-opened: the joint K/HFA refit preferred K=0.4, which is *the
edge of the grid*, and that config bought no margin MAE while moving the 0.7–0.8
win-prob bucket from 1.6 points off to 6.2. §2.3's win-prob slope is now 0.101,
with the fact that matters more than the number — it is not independently
fitted, it is 1.7/σ, so it moves whenever `marginSigma` does.

The rest: §4 R3 described migration 0010's crew-wide picks when 0023 made
visibility a per-group setting (and §8's Accounts paragraph repeated the old
claim); §7 listed `/crew` in the nav, which is a redirect; the burst poll was
specced as a 5–10 minute cron when it is deliberately dispatch-only; both
`README` and §1 said the CFBD free tier "won't survive the backtest backfill",
which is false by a factor of sixty — the backfill is 16 calls, and Tier 1+ is
an entitlement question, not a quota one. Bug #9's evidence in the Aug 6 audit
was stale in two places, not the one the tracker recorded.

**`probe.ts`'s `emptyIsHealthy` comment was corrected and the flag deliberately
left on.** The comment claimed `/scoreboard` "returns `[]` all week and only
fills on a Saturday"; the Aug 12 probe pulled 889 rows on a Wednesday. So the
flag's entire stated justification was false, and what it does in practice is
mask a genuinely empty board — the one symptom that would reveal a dead live
layer. Removing it is still the wrong move today: two documents disagree on the
remedy, and tightening a health check sixteen days out on an endpoint whose
first real in-season call has not yet happened is not a trade worth taking. The
comment now records the truth and the disagreement; the decision waits for the
`observe-scoreboard` dispatch over the openers, which is the one observation
that settles it.

Also fixed: `docs/STATUS.md` §4 asserted PUSH-6 was "worth closing before Week
0" three paragraphs after marking it declined. The owner's decision stands and
the prose now agrees with it.

Line-number citations survived: §8 grew by two lines, and every `SPEC.md:NN`
reference in the live docs points above it — except the slip-order line, which
moved 253 → 255 and is now cited by section instead. The audit files keep their
original citations; they are history and are not edited to look better in
hindsight.

No model change. `DEFAULT_PARAMS` untouched, no tuner run.

### Aug 13 — Deleting the second scheduler, and a table that said "all 0"

**Q7, answered: the edge function is gone.** `supabase/functions/jobs/` was 710
lines of a parallel pg_cron implementation that was never deployed, sat four
model versions behind `scripts/lib/jobs-core.ts`, and had inverted CLV in all
four of its branches. `05:C5` described it as a deliberate tombstone. A
tombstone is a reasonable thing to keep; a tombstone containing a live sign
error is not, because the next person to revive it inherits the bug along with
the head start. Git has it. The only two live references were comments, both
rewritten to say what was removed and why rather than to point at a path that no
longer exists. This also deleted the fourth copy of the hardcoded
`FCS_RATING = -30`, which matters for the FCS work.

**P1-5: `/ratings` had no empty state.** With zero rows it rendered a sortable
table header over an empty body, a scale explainer that ended "…is where that
team sits among all 0", and a footnote explaining why a column that wasn't there
was hidden. It now uses the same empty state `/rankings`, `/standings` and
`/edges` already carry. The subtitle was its own small lie: `latestWeek === 0`
rendered "preseason", and an empty table also has `latestWeek === 0`, so the
page announced a state it was not in.

Neither page was seen rendered — both need a live Supabase — so the empty state
is the shipped markup from `rankings/page.tsx` reused rather than written fresh.

No model change. `DEFAULT_PARAMS` untouched, no tuner run.

### Aug 13 — A rule that had never once run, and the re-pick that could not work

League Rule #4 — a postponed or canceled game voids every wager on it — has been
implemented correctly in the grader since 0013 and had never executed. Nothing
in the system writes those statuses: `sync-games` only ever asserts `final`, the
scoreboard patch is a closed map to `in_progress`/`final`, and CFBD's game feed
carries a bare `completed` boolean with no cancellation signal anywhere in it. A
human is the only available source of truth, so P1-1 is a **Game status**
section on `/admin`.

The display layer turned out to be finished already — `GameCard` and
`GameHeader` print the status, `isDead` sinks the card, suppresses the aura,
hides the odds and disables all three bet-slip cells. Every bit of it had been
unreachable.

**The void runs inline, not on Sunday.** A game postponed at noon would
otherwise show open picks on a game that will never be played until
`ratings-update` fires, which is the job with the longest overdue horizon on the
admin card. Both callers share `voidWagersForGames` and both filter on the
result still being null, so running twice is a no-op.

**The state machine refuses more than it allows**, which is the substance of the
work rather than a detail of it. Voiding is destructive to other people's picks
and nothing gives them back, so: a `final` game cannot be voided, because
grading has already written results, CLV and units against it and flipping it
would void nothing while making the card read POSTPONED over a final score; a
live game cannot be *postponed*, because the scoreboard loop rewrites
`in_progress` every 30 seconds and the postponement would vanish within a tick
while the picks it voided stayed voided — but it can be *canceled*, which is the
honest word for an abandoned game; and an unrecognised status is refused rather
than defaulted.

**Two things surfaced while building it.**

*The "member re-picks" path did not work.* `jobs-core.ts` has carried a comment
since 0013 saying voided picks stay voided and the member re-picks on the
revived game. They could not have. `make_pick`'s `on conflict do update` set
`side`, `line_at_pick` and `locked_at` — not `result` — so re-picking updated
the row that already held `result='void'`, and the grader reads
`.is("result", null)`. That pick would never have been graded, in any season.
Migration 0034 clears `result` and `clv` on replace, which also closes the
general case: any pick replaced after grading kept its old result. The DB
assertion for it fails against the old function and passes against the new one,
which is the only reason to believe the fix.

*A voided pick rendered as nothing.* Five sites guarded their result chip with
`result !== "void"`, so a member whose pick was voided by Rule #4 would watch it
silently disappear from their own screen. Four of them fall through to the same
neutral styling a push uses and just needed the exclusion dropped. The home hub
needed more: it labels chips in words, and "Push" on a canceled game is not a
softer way of saying void, it is wrong — a push means the number landed exactly,
a void means nothing happened. Its verdict now carries a label beside the tone.

0034 also gives `games.status` a check constraint, `not valid` so it cannot fail
on a legacy row. The five states had lived in a trailing SQL comment since 0001.
That was survivable while only sync jobs wrote the column and stops being
survivable the moment an admin can — and the constraint rejects `cancelled`,
which matters, because `isDeadStatus` deliberately does not recognise the
British spelling and a stored `cancelled` would read as alive.

Deferred with the reasoning written down (`docs/STATUS.md` §4, P1-1b): frozen
`predictions` on a dead game are never settled, so they re-read as ungraded
every Sunday forever. It is invisible to users, costs a few rows, and settling
it banks a "no close" reading indistinguishable from a genuinely missing
snapshot — a decision, not a bug fix, and not one to take sixteen days out.

622 tests, 129 DB assertions.

No model change. `DEFAULT_PARAMS` untouched, no tuner run.

### Aug 13 — An empty environment variable is not a zero

`Number("")` is `0`. Every numeric env guard in this repo was written as
`Number.isNaN(v)` or `Number.isFinite(v)`, and `0` passes both, so a variable
that existed but held nothing was read as a deliberate zero in four places:

- `PRESEASON_TILT_CARRY=""` disabled the fitted tilt and shipped withheld
  totals — the exact failure `04:DQ-13` recorded as fixed, having closed only
  the NaN half of it;
- `envDays` returned **0 rather than the fallback**, so `LINES_IDLE_DAYS=""`
  would set a zero-day idle horizon and every lines run would skip;
- `CFBD_MONTHLY_BUDGET=""` set the scoreboard budget to zero, which throttles at
  80% of nothing and refuses to poll at 95% of nothing;
- `SCOREBOARD_INTERVAL_SECONDS=""` gave a zero-second poll interval.

None has bitten, because none of the four is currently set to blank. What makes
it worth fixing now rather than filing is how a blank one arrives: `FOO=` in a
shell, a GitHub secret created but never filled in, a `.env` line with nothing
after the `=`. All three are the shape of a half-finished setup, which is
exactly what the next two weeks are full of — and `SUPABASE_DB_URL` spent 98
runs empty already.

`scripts/lib/env-num.ts` now owns the parse: blank and whitespace-only mean
unset, `"0"` still means zero, and a value that is present but unparseable or
out of range throws with the variable's name in the message. `envDays` keeps
its tested fall-back-on-garbage contract — taking a scheduled job down over a
typo'd idle threshold is the worse failure — and gains only the blank fix.

**Also in this commit.** P2-11: the two `gameMedia` calls in `sync-games` were
bare `.catch(() => [])`, swallowing a tier denial, a 500, a timeout and a parse
error identically. They now rethrow anything that is not a `CfbdError` (a
missing key raises a plain `Error`, and a config mistake should go red rather
than quietly ship a slate with no networks) and otherwise log the status with
the 401/403-vs-rest split, recording it in `job_runs.detail` so it is visible on
`/admin`. P2-10: the early-Saturday insurance crons, with one substitution
recorded in `docs/STATUS.md` — the lines cron is `5 10 * * 6`, because
`0 10 * * 6` is already weather's and taking it would have retired weather
rather than added lines. P1-3: `.env.example`, 20 keys, every one verified
against a real reader.

No model change. `DEFAULT_PARAMS` untouched, no tuner run. `PRESEASON_TILT_CARRY`
still resolves to 0.4.

### Aug 13 — The push notifications were wired to nothing

Every piece of the notification feature works and has been verified. The
subscription is stored, the VAPID keys are set in both Vercel and Actions, a test
push was delivered to a real iPhone on 08-12 and its receipt logged `sent`.
`run-job.ts:39-40` registers `notify-picks-due` and `notify-log-bets` against
`notifyPicksDueJob` and `notifyLogBetsJob`. `jobs.yml` declares six crons for
them. **None of the six was ever routed.**

The scheduler resolves a cron to a task with a bash `case` on the literal
schedule string, and none of `0 15 * * 6`, `0 18 * * 6`, `0 22 * * 4,5`,
`45 15 * * 6`, `15 19 * * 6` or `15 23 * * 6` appeared in it. Each fell to
`task=unknown`, then to the `Run job` fallthrough's `exit 1`. Dispatch was broken
by the same omission from the other direction: both tasks are options in the
dropdown, neither had a branch in the second `case`. So the count is **six red
runs a week and zero notifications**, since the feature shipped — and Week 0's
picks-due nudge would not have gone out.

**Why nothing caught it.** The parts were each tested at their own level and the
seam between them was not testable by any of those tests: the job functions are
unit-tested, the delivery path was proved on a device, and the workflow is YAML
that nothing type-checks. The one instrument that would have caught it was added
the day before — `watchdogJob` picked up both notify jobs on 08-12 (PUSH-10),
gated on a scheduled game inside the next week — so it would have fired its first
red around **Aug 22**, seven days before kickoff. That gate is correct and stays;
it just reads the symptom nine days after reading the file would have.

Fixed by adding the two mappings and extending the shared `run-job.ts` branch.
`scripts/lib/jobs-yml.test.ts` now parses the workflow the way bash reads it —
literal strings, first match wins — and asserts that every declared cron resolves
to a task, every scheduled and dispatchable task has a command, and no two tasks
claim the same cron string. That last one is not hypothetical: `0 10 * * 6` is
the weather cron, and `docs/STATUS.md` P2-10 asks for it to be given to
`refresh-lines`, which would have retired weather rather than adding lines.
Verified by running the assertions against the pre-fix file: **6 orphan crons
before, 0 after.**

The lesson, and it is the same one the iPad splash taught in the entry below: a
component verified in isolation says nothing about the wiring that reaches it.
What proves a scheduled job works is a run, not a passing test of the function
the run would have called.

No model change. `DEFAULT_PARAMS` untouched, no tuner run.

### Aug 12 — Stop guessing at the iPad, and measure it

The landscape fix did not fix it: the owner deleted the home-screen app, re-added
it, opened in landscape, still stretched. The generated images are correct —
`ipad-pro-129-landscape.png` is genuinely 2732×2048 — so the failure is upstream
of the artwork. Nothing is matching, and iOS stretches a fallback rather than
showing a plain frame.

Two more sizes were missing: the 10.2" iPad (810×1080, the cheap one, therefore
the common one) and the iPad Pro 10.5"/Air 3 (834×1112). Added. 24 images to 27.

But the sizes are a guess again, and this table has now been wrong twice. So the
real change is `public/brand/splash-check.html`: open it on the device in the
orientation that is broken and it evaluates every generated query with
`matchMedia`, printing the device's own `screen.width`, `screen.height` and
`devicePixelRatio` alongside a MATCH/— for each. If nothing matches, that is the
bug, and the numbers at the top are exactly what the table is missing.

The reason this needed a tool rather than another guess: `apple-touch-startup-image`
fails silently and misleadingly. An unmatched query does not degrade to nothing;
it degrades to something stretched, which looks like a bad image rather than a
missing entry. There is no way to tell the two apart from the device — so build
the way to tell.

### Aug 12 — The iPad splash was stretched, because nothing matched it

Reported by the owner on an iPad. Two causes, both in the device table, both
mine.

**Portrait only.** Every one of the thirteen entries carried
`(orientation: portrait)`. The comment above them said landscape was skipped
because "on iPad the app is very rarely launched to a cold splash in landscape",
which is a guess, and a bad one for a device most people hold sideways. The
failure mode is not a missing splash — when nothing matches, iOS stretches
whatever it has to fill the screen, which is exactly what was seen. iPads now
get both orientations; iPhones stay portrait-only because iOS genuinely ignores
landscape startup images on them.

**Stale sizes.** A current iPad mini is 744×1133, not the 768×1024 of the 9.7"
and the mini 5. The M4 Pros are 834×1210 and 1032×1376, not the 1194 and 1366 of
their predecessors. Three current iPads matched nothing *in either orientation*.
The old sizes are kept — those iPads still exist — and the new ones added
alongside.

`device-width` and `device-height` stay the portrait values in both queries,
because iOS reports the natural size regardless of how the device is held; only
`orientation` varies and the image dimensions swap. Getting that backwards
produces a table that looks right and matches nothing.

13 images to 24, 936 KB to 2.0 MB. Verified by rendering the case that was
broken — a 2732×2048 landscape iPad — and confirming the mark keeps its aspect.

The lesson for the device table: **an unmatched query is worse than an absent
feature.** No startup image at all gives a plain dark frame; a table that misses
a device gives a stretched one.

### Aug 12 — Closing out the brand and push queues

Four owner decisions and two builds.

**PUSH-10, the absence check.** `watchdogJob` now covers `notify-picks-due` and
`notify-log-bets`, and the interesting part is the gate rather than the horizon.
Both jobs are weekly *and* seasonal, so a plain hours-since-last-ok check would
go red every week from December to August — and a watchdog that cries every week
for eight months is one nobody reads by the time it matters. The check only
applies when there is a scheduled game inside the next week. 8 days rather than
7, so a run that slips a day is not a fault. Four tests, including the offseason
case, which is the one that would have made this useless.

**BRAND-7, the vector master.** `public/brand/slate-icon-master.svg`: layered
and named, palette in a `<style>` block so a recolour is one edit. Outlines are
the trace, so the letterform is exact at any size — print, embroidery, a
one-colour reversal.

It is **flat**, and that is the decision worth recording. §20 also asks for Bevel
and Lighting layers. Those live in the raster, and rebuilding them as vector
would mean guessing at the original's lighting — which is exactly the mistake
that produced two rejected recreations earlier today. A flat master is also what
print and embroidery actually want. Anything that should look dimensional uses
the raster.

**DB-3 closed, and a correction.** `0017_rivalries_seed` is now recorded in
`supabase_migrations` (version `20260806061800`); 32 files match 32 rows. An
intermediate version of that entry claimed re-running the seed would duplicate
rows or hit a constraint. **It would not** — the insert has a `where not exists`
guard on the pair in both directions. That claim came from grepping for
`on conflict`, finding none, and concluding the worst instead of reading twelve
more lines. The original entry, which called it harmless, was right.

**PUSH-6 declined, BRAND-8 answered no.** Field stays one of three themes. PUSH-6
is kept in the file rather than deleted: the exposure is real — no daily cap, no
quiet hours — but bad beats now default off, so it reaches only someone who
switched them on and can switch them back.

### Aug 12 — Bad beats go opt-in, and betting groups get a nudge

Two owner requests, migrations 0032/0033, both applied.

**Bad beats now default off.** An absent `notification_prefs` row used to mean
"on" for every kind, which is right for a nudge you asked for and wrong for one
that fires per late swing across a twelve-game Saturday. The default is now
per-kind and lives in `notification_settings.default_enabled`, so it is
admin-editable rather than a constant — an explicit preference still wins either
way. The reason this matters more than it sounds: muting is per-app on iOS, so
the firehose kind would have taken picks-due and log-bets down with it.

**"Log your bets"**, a fourth kind, to betting groups only —
`groups.kind = 'betting'`, the flag `group_is_betting` already reads. A pick'em
group has nothing to log. Three Saturday crons at 15:45 / 19:15 / 23:15 UTC,
which is 15 minutes before the 11:00 / 14:30 / 18:30 CT waves while CDT holds.
Like every cron in `jobs.yml` these are UTC and do not shift for DST.

`lead_minutes` is 20 rather than 15, and the job excludes games that have
already kicked off. That combination is deliberate: Actions cron lags, so the
slack lets a prompt run still land ~15 minutes out, and a badly delayed run
sends **nothing** rather than telling someone to log a bet on a game already
playing. Missing is the right way for this one to fail.

The reminder is **one push per group per wave** — three on a Saturday, not one
per unlogged game. The body names the group and the time and says nothing about
which games are missing, because this is a nudge to open the sheet, not a
checklist. The subject is keyed on the wave's date and UTC hour rather than on
the earliest kickoff still in the window: those differ, because a run that lags
past the first game filters it out as already-started and promotes the next one,
which under a kickoff-keyed subject would let a second notification through for
a wave already covered.

Split across two migrations because Postgres will not let a new enum value be
used in the transaction that adds it, and 0033 seeds a row keyed on the value
0032 creates. One file fails with "unsafe use of new value".

### Aug 12 — Push notifications, and the console that drives them

PUSH-1 through PUSH-4 and PUSH-7. Migration 0031, a service worker, a sender,
two triggers, the opt-in and the admin console.

**The dedupe is the design.** `sendToUser` inserts the `notification_sends`
receipt *before* it talks to the push service, and a unique violation on
(user, kind, subject) is what "already told them" looks like. That ordering is
the whole safety property: the scoreboard loop re-observes the same cover flip
every 30 seconds and the picks-due job runs on three overlapping crons, and
neither can notify twice because whoever inserts first owns the slot. Send-then-
record would double-notify on the race and on any crash between the two. Four
tests pin it against a stub client, since what is being tested is the order of
operations rather than any SQL.

**The triggers.** Picks-due is a new job on three crons, firing for any group
whose first kickoff falls inside `lead_minutes`; running it more often than that
window is a no-op rather than a duplicate, which is what lets it be scheduled
early against the 5–30 minute Actions lag. Bad beats send from inside the
scoreboard job, because a cover flip is a transition and is only observable
live — the detector was already there since 0026. The send happens after the
write loop, not inside it, and `notifyBadBeats` cannot throw: a polling job that
has already written its scores must not die because a push service had a bad
minute.

**The console.** `/admin` gets compose-and-send (just me / one group / everyone),
the send log read off the receipts, and a switch per trigger with its lead time
and copy in `notification_settings` rather than in code. That last part is the
difference between the owner running this and the owner filing a ticket for it:
after this, only a genuinely new *kind* of trigger needs a deploy.

**iOS.** The opt-in has three shapes and the platform picks. Not installed on
iOS gets instructions and no switch — Safari refuses `requestPermission()`
outside a home-screen app and there is no `beforeinstallprompt` to automate the
install, so "tap Share" is the only lever that exists. Permission is requested
from a click handler because iOS drops it silently otherwise, which reads as a
broken app rather than a policy. The worker handles `pushsubscriptionchange`
and posts to `/api/push/resubscribe`; the client also re-syncs on launch. Both
halves are needed — iOS rotates subscriptions while the app is closed, and
without the worker the user silently stops receiving anything.

The worker caches nothing, deliberately. This app is live scores and lines, and
a stale-while-revalidate shell is how you end up reading Saturday's board on
Sunday.

Nothing sends until VAPID keys are set and 0031 is applied; until then `/admin`
says so in a banner instead of throwing. Tracked as PUSH-8.

### Aug 12 — The admin console stops hiding behind a footnote

`/admin` has existed since the invites work and was reachable exactly one way:
an 11px line of dim text at the bottom of `/me`, below the favourite-team
picker. The owner — the only account in the database, and `is_admin` since the
first migration — could not find it.

The nav's account button now resolves the role, not just the session, and sends
an admin to `/admin` and everyone else to `/me`. It waits for both before
rendering: resolving them separately flashes "Account" and then settles on
"Admin", which is worse than the 200ms of nothing it already renders while the
session loads. `/admin` gains the link back to account settings it never needed
before, since it is now the page an admin lands on.

No new gate. `is_admin` was already checked server-side in the page itself and
that is still the only thing enforcing anything — the button is navigation, not
authorisation, and a non-admin who types the URL still gets a 404.

### Aug 12 — Field becomes a third theme, not a replacement

Correction to the entry below. The palette and the display face were applied to
the whole product; they should have been offered, not imposed. Dark and light
are back to exactly what they were — charcoal tokens, Barlow Condensed
headings, the scorebug on the condensed face, `.cover-word` italic. The brand
palette now lives behind `html[data-theme="field"]`, and the toggle cycles
**dark → light → field**.

Everything the Field theme changes is an override in one block: the tokens, the
glass bar (field green, so the header is a surface and not a hole), and three
type rules — Graduate for headings, Plex Mono for `.scorebug`, Archivo for
`.cover-word`. Graduate loads always but only binds under that selector, so the
default themes are byte-for-byte the design they were.

`useLightTheme` becomes `useTheme`, returning the current theme, a setter and a
cycle. The pre-paint script in the layout now accepts `light` or `field` rather
than testing for one string, so a saved Field choice does not flash charcoal
first. The toggle shows where you *are* rather than where you are going — three
states need a legend, and the Slate S is the one that needs no explaining.

`theme-color` goes back to the app's own `#100e0b`: a media query cannot know
which of three themes a reader picked, so it tracks the OS default. The launch
chrome in `manifest.ts` stays on the brand near-black, which is what the icon
sits on.

What stays from the recolour: the traced vector mark and its lockup in the nav,
every icon and startup image, and the three share cards, which are standalone
brand surfaces rather than app UI.

**BRAND-2, BRAND-3 and BRAND-5 are reopened as an opt-in theme rather than the
default**, which is what they now are in `docs/STATUS.md`.

### Aug 12 — A traced vector, and the app finally matches its own icon

**Partly superseded the same day — see above.** The vector and the nav lockup
stand; the palette and the display face were reverted to opt-in.

Three things, in the order they unblock each other.

**1. A vector, traced rather than drawn.** `scripts/trace-brand-mark.ts` walks
the boundary between lit and unlit pixels in the supplied artwork and chains the
resulting edges into closed loops — outer contour and both counters in one pass
— then Douglas–Peucker straightens the staircase into the letter's real edges.
Every vertex comes off the owner's pixels, so the letterform is exact; the check
is to render both paths translucent on top of the source at full size and see
the S disappear underneath them.

Separating the seam from the letter took three tries, and the failures are worth
recording. Distance-from-the-edge does not work: the blade is drawn *along* the
letter's diagonal edge, so no gold pixel is more than 15 units from a boundary.
"Everything that isn't chalk" does not work either — the gold extrude is also
not chalk. What works is connected components with two tests: the seam is the
only gold blob whose box spans nearly the letter's full width *and* straddles
its vertical centre. The extrude sits along the bottom, around a counter, or in
the notch, and each fails one. The gold test itself had to be loosened well past
a saturation cut — tight enough to exclude chalk also drops the lit tops of the
laces, which is how an earlier pass traced the blade's darkest edge and nothing
else, producing a hairline where a football seam should be.

`<SlateMark>` renders the two paths with the letter on `currentColor`, which is
what makes it legal on the light theme, and the seam pinned to `--accent`. It is
back in the nav lockup. **BRAND-6 closed.**

**2. The palette.** `globals.css` is on the brand tokens. Two values are
deliberately not what §5 prints:

- `--surface` is `#0b2e23`, not the brand's raised green `#0e3b2c`. That value is
  specified for *a card*, and a card is small; spread across a slate of them it
  turns the page into a green wash and breaks the 60/25 ratio §6 asks for. Dark
  first, green second.
- `--elev` is a quiet step above the card rather than a jump. It is what the odds
  cells are made of, and at the brand's raised green every cell read as pressed.
  Selection is gold's job.

`--live` stays red. §35 asks for a gold pulse or a restrained green indicator and
both are wrong here: gold is this product's value language and green reads as a
win, so either would make a kicking-off game look like a graded pick. Recorded
rather than quietly ignored.

**3. Typography.** Graduate is the display face — one weight, no faux bold, and
tracking cut because it is much wider than the condensed face it replaced. Two
things moved *off* the display face rather than onto it: `.scorebug`, which is
numbers and therefore Plex Mono per §12 (Graduate has no tabular figures and a
varsity ornament on the 1 that has no business in a live score; negative tracking
claws back the width a mono costs in a dense row), and `.cover-word`, which is
italic — Graduate has none, and a synthesised slant at 13px is mush. Barlow
Condensed is gone entirely, so the app loads three faces, not four.

Both share cards and the demo card move to the brand palette with the traced
stamp. Verified by screenshot at 420px in both themes: the light theme is the
same relationships inverted — chalk becomes the ground, field green the ink, and
gold darkens until it clears contrast on it.

**BRAND-2, BRAND-3, BRAND-5 and BRAND-6 close.** Still open: **BRAND-4** (install
on real hardware — the row test needs a phone) and **BRAND-7** (a layered vector
master; a trace is a silhouette and carries no bevel, grain or rim light).

### Aug 12 — The icon was supplied; I should have used it

Correction to the entry below. The first pass rebuilt the Slate S as vector
geometry — a block S with a horizontal middle bar, then a redraw with a diagonal
spine, a stroked bevel and a turbulence grain. Both were recreations of artwork
that already existed, and both were visibly off: the counters, the bevel, the
rim light and the chalk texture are not things you converge on by eye against a
reference.

The supplied PNG is now the master. `public/brand/slate-icon-source.png`,
1254×1254, committed as delivered. **`scripts/build-brand-assets.ts` does not
draw the icon any more** — every export is a resample, a crop or a composite of
those exact pixels. The only things the script still draws are the splash ground
and the outlined Graduate wordmark under the mark. `scripts/lib/brand-mark.ts`,
the S geometry in `src/lib/brand.ts` and `<SlateMark>` are deleted; the palette
is all that is left in `brand.ts`.

**What the artwork made easy.** The letter sits 0.369 of the canvas from centre,
inside the 0.400 Android safe radius, so the maskable exports are the same file
— no second composition to drift out of sync. The square is painted near-black
corner to corner with no alpha, so the iOS tile needs nothing done to it. Both
are asserted in `scripts/brand-assets.test.ts` rather than assumed, along with
every export the manifest and layout reference.

**What it made harder, and how.** Three surfaces cannot take a 1254px tile:

- *32px favicon.* A downscale of the whole artwork turns the sideline rail into
  three grey specks. The tab cut is the mark alone on flat field green (§30).
- *Splash and share cards.* Both sit on near-black and want the letter without
  its panel. The mark is keyed out by flood-filling it away from the dark field
  and using the blurred fill as an alpha channel — `slate-mark.png`. The keyed
  edge is only ever composited onto near-black, which is where it is invisible.
  A 192px copy is base64'd into `src/lib/brand-mark-data.ts` for the OG routes,
  which run on the edge and cannot read from disk.
- *The nav.* Reverted to the wordmark alone. The mark is a chalk letter on a
  dark field and this header also renders on the light theme, where chalk
  disappears. That needs a light variant or an outline that can take
  `currentColor` — **BRAND-6**.

Sharp's `joinChannel` cost an hour: it promotes a single-band mask to 3-band
sRGB on the way out, so the alpha plane was a third of the buffer read at the
wrong stride and the mark came out inverted — solid bowls, invisible letter.
`.toColourspace("b-w").raw()` fixes it, and the test now pins three pixels
(corner clear, arm opaque, bowl clear) so it cannot come back.

Two size decisions. There is no 1024 export: the committed source is 1254² and
the manifest lists it directly, rather than a megabyte of near-identical pixels
beside it. And the splash set and the keyed mark are palette-quantised — a
splash is one dark ground, one aura and two colours of type, which 256 entries
hold without a visible step, and it takes the startup images from 5.5 MB to
936 KB. The icons stay full-colour, where the rim gradient would band.

**Still not met: §20, the true vector master with outlined typography.** The
supplied artwork is a raster, so there is no vector to export, and every size
below 1254 is a downscale rather than a re-render. Nothing on a phone shows it —
the largest surface any of this feeds is a 512px launcher icon — but print, a
large-format OG variant, or a recolour would all need the vector. Tracked as
**BRAND-7**.

### Aug 12 — The Slate S: one master, every size cut from it

**Superseded the same day — see the correction above.** The letterform
described here was a recreation and is no longer in the repo; the manifest,
layout, startup-image and share-card wiring it introduced all survived.

New brand identity (`docs/BRAND.md`, supplied v1.0). Icon, logo and the iOS /
Android install surfaces only — **the app's own palette and display face did
not move**, see the seam below.

The old mark was a rotated gold football on warm charcoal, drawn twice: once as
`app/icon.svg` and once, differently, as a JSX `apple-icon.tsx` that rendered
the letter **H**. Two hand-drawn copies of one logo is how a logo drifts, and
this one had already drifted into a different glyph.

Everything now comes off one vector master. `src/lib/brand.ts` holds the
palette and the geometry — the S outline, the seam crescent, the six laces —
and both consumers read it: `scripts/lib/brand-mark.ts` composes the SVG for
the exports, `src/components/SlateMark.tsx` renders the same paths in React for
the nav and the share cards. `npm run brand` writes every asset. Nothing is
drawn per size; the variants differ only in detail level and foreground scale.

**The letter.** 118-unit bars on a 424×628 box, outer corners cut at 45°,
terminal inner corners cut smaller, reflex corners left sharp — the sharp
reflex corners are what make it read as varsity block rather than a rounded
geometric S. Counters are 306×138 top and bottom, so the letter is symmetric
under 180° rotation. The seam is a crescent across the middle bar that enters
inside the letter on the left and breaks past its right edge into the dark;
laces sit square to the local tangent. Under the chalk face is a gold copy
offset (9, 12), which is the whole of the "dimensional edge" — no bevel filter.

**No text anywhere in the master.** The yard numbers are built from rectangles
as scoreboard segments, so the vector master has no font dependency and needs
no outlining step before it opens in an editor (§20). The wordmark is outlined
at build time from Graduate with hand-rolled tracking (`opentype.js`); the
committed SVG and the splash PNGs carry outlines only.

**Detail is a function of size, not a redraw.** The master carries field
markings, yard numbers, vignette and a drop shadow. The 32px cut drops all of
it and pushes the letter out to 1.16 — at that size the field is mud and the
contrast is worth more. The maskable cut pulls the foreground to 0.94, which
puts the worst-case vertex at 337 of the 409.6 safe radius (82%); the field
markings are allowed to be cropped, the S is not.

Four things are now asserted in `scripts/lib/brand-mark.test.ts` rather than
eyeballed, because each is a Definition-of-Done line that otherwise only fails
after someone installs it: the maskable safe-radius margin, the laces staying
on the seam, **zero transparent pixels** in the master (iOS composites the
touch icon over white — one transparent pixel and the tile grows a bright
fringe), and **square corners** (the OS rounds the tile; rounding it here too
gives the double corner that is the most reliable tell of a homemade icon).

The contact sheet §21 calls mandatory is generated too — `/brand/contact-sheet.html`,
the master downscaled by the browser at 300/120/72/60/40/32 on near-black, plus
the maskable under circle and squircle crops.

**iOS launch.** 13 portrait startup images with device media queries, written
by hand in `layout.tsx` because the Next metadata API has no
`apple-touch-startup-image` field, plus `apple-mobile-web-app-capable` — Next
emits only the standardised `mobile-web-app-capable`, and iOS before 16.4 reads
only the apple-prefixed one. The splash aura is a disc around the mark rather
than a wash over the screen: §15 wants it localized, and a full-canvas gradient
cost 20× the bytes in a PNG that is otherwise flat black (6.2 MB → 3.4 MB
across the set). Landscape startup images are deliberately not built — iPhone
ignores them and iPad cold-launches to portrait almost always.

**The seam that is left.** The icon, the manifest, the launch chrome and both
OG cards are now on the brand's green (`#020A08` / `#08251C` / `#0E3B2C`). The
application shell is still on the warm charcoal tokens in `globals.css`
(`--bg: #100e0b`, `--accent: #f2b63c`) and still sets headings in Barlow
Condensed, not Graduate. Both near-blacks are effectively black on a phone, so
the launch-to-app transition holds — but §5, §12 and §41.4–5 are not satisfied
and the two accents are visibly different side by side. Recolouring the app is
a whole-product change against `docs/DESIGN.md`'s "no new colours" rule and was
not in scope here; it is queued as **BRAND-2 / BRAND-3** in `docs/STATUS.md`.
The in-app mark sidesteps the mismatch by taking `currentColor` for the letter
and `var(--accent)` for the seam, so it is correct under whichever palette is
live, in both themes.
### Aug 12 — Reconciling the tracker against a day it did not keep up with

`docs/STATUS.md`, `audit/AUDIT-2026-08.md`. No code.

The point of a single tracker is that it is true; a day of parallel work is
exactly when that stops being free. Re-checked §1's numbers against the repo and
the live project rather than against the last time they were written:

| claim | was | is |
|---|---|---|
| reconciled at | `61e1363` | `cc1a9d8` (8 commits behind) |
| tests | 569 / 39 files | **585 / 41** |
| migrations applied | 28 | **31** |
| Actions runs | 98, 97 green | **111**, reds are the backup sequence |
| §5 route-smoke row | "37 files, 488 tests" | 41 / 585 |

**A claim of my own was wrong and is corrected in place.** The backup closeout
said "five red runs, five distinct defects". There were **three** red runs
(#107–109). Two of the five defects never produced a red run at all — the
mis-dispatch produced a *green* run of the wrong job, and the unfindable
dropdown option produced no run to look at. Conflating defects with runs
undersells the actual finding, which is that the two worst failures were the
invisible ones.

**Push notifications shipped from another session**, so audit row #38 goes from
`~` to done — with the piece that did *not* ship named, as the row format
requires: red-zone is still an alert state, not a push. PUSH-6 (caps, quiet
hours) stays open in `docs/STATUS.md`.

**The invariant is now literally true.** "STATUS.md is the only file with
unchecked boxes" was nearly true — the Aug 6 audit still carried three `[ ] ❌`
rows for the same items STATUS §5 tracks. They keep their text and lose the
checkbox, so a reader scanning for open work cannot find a second list.

Also recorded, because it cost a wrong conclusion here: **a stale `node_modules`
fails two suites on missing deps and reads exactly like a regression.** `npm ci`
first, then believe the number.

### Aug 12 — The receipts have a copy

Run #110, `jobs · backup`, green:

```
conn: user="postgres.mjijyutmbtnwcjspozsx" host="aws-0-us-east-2.pooler.supabase.com" port=5432 db="postgres" password_len=20
pg_dump (PostgreSQL) 17.10 (Ubuntu 17.10-1.pgdg24.04+1)
wrote backup-20260812.sql.gz (16K, 11 tables)
```

Artifact `db-backup`, 14,261 bytes, 90-day retention. `predictions`, `picks` and
`bets` are append-only and had no copy outside Supabase's 7-day PITR window;
they do now. That was the largest open risk in the product by elimination, and
it is closed.

**A comment corrected on the strength of one run.** The PGDG fallback added in
the previous entry was written as insurance for images where the repo is not
configured, on the reasoning that GitHub's is — the stock client reports itself
as `...pgdg24.04+1`. Wrong. The log shows `E: Unable to locate package
postgresql-client-17`, the fallback firing, and 17.10 installing from the repo
it added. The PGDG *build* is baked into the image; the apt *source* is not, so
only the pinned-in major is installable. The comment now says what the log says.
Had that fallback been left out as unnecessary — which the reasoning supported
— this would have been a sixth red run.

**Five red runs, five distinct defects**, worth listing once because the shape
matters more than any of them: wrong task dispatched; the option unfindable in a
20-long dropdown; an unqualified pooler username; a client major behind the
server; and a package that is not installable from the stock image. Every one
was a real defect, and every one would have exited **0** with a 20-byte artifact
before this week's `pipefail` fix. A backup job that cannot fail is not a backup
job — it is a weekly green tick over an empty file, and it would have held that
posture until the first restore.

### Aug 12 — The backup ran, and the client was a year behind the server

`jobs.yml` backup step. No model change.

With the connection string finally right — the preflight from the previous entry
printing `user="postgres.mjijyutmbtnwcjspozsx" … password_len=20` and Postgres
accepting it — the dump hit the next wall:

```
pg_dump: error: aborting because of server version mismatch
pg_dump: detail: server version: 17.6; pg_dump version: 16.14
```

`pg_dump` refuses to dump a server newer than itself, `ubuntu-24.04` ships
`postgresql-client-16`, and the project is on Postgres 17.6. The guard made it
worse rather than better: `which pg_dump || install` found the v16 binary and
installed nothing, so the mismatch was structural and would have recurred every
Sunday. Now the client major is pinned to the server's and invoked by absolute
path (`/usr/lib/postgresql/17/bin/pg_dump`) rather than trusting whatever
`pg_dump` resolves to, with a PGDG fallback for images where the repo is not
already configured. When Supabase upgrades the project, bump `PG_MAJOR` — the
failure names both versions, so it diagnoses itself.

**Verified by running the step, not by reading it.** The previous entry's
process note was that validating the YAML is not validating the shell inside it;
this time the `Run job` script was extracted from the workflow, `bash -n`'d, and
then *executed* against a stubbed `pg_dump` at the pinned path in three
scenarios: good string → `wrote backup-20260812.sql.gz (4.0K, 11 tables)`,
exit 0; pinned binary absent → apt install attempted and a loud failure, never a
silent fall-through to v16; bad username → the preflight fails first, exit 1,
before apt or pg_dump are touched at all.

Four red runs to get here, each on a genuinely different defect: the wrong task
dispatched, then an option that could not be found in the dropdown, then an
unqualified pooler username, then this. None of them would have been visible
before this week — the step used to exit 0 with a 20-byte artifact no matter
what happened.

### Aug 12 — Two wrong things, one sentence: the backup learns to say which

`scripts/lib/db-url.ts` (pure, 10 tests), `scripts/check-db-url.ts`, a preflight
line in the backup job. No model change.

Three backup runs failed on:

```
FATAL:  password authentication failed for user "postgres"
```

and the password was never the problem. Supabase's pooler routes by tenant, so
it needs `postgres.<project-ref>`; handed a bare `postgres` it rejects the
credential rather than reporting an unknown tenant. **A wrong username and a
wrong password produce the identical sentence**, so each round of diagnosis was
a guess, and the fix for one looks nothing like the fix for the other.

The job now describes the secret before it dials: username, host, port,
database, and the password's **length** — never the password, never the whole
string. Length alone separates "empty" from "placeholder" from "real", which
covers most of what goes wrong, and a length is not a secret.

It fails fast on the three misconfigurations that cannot connect from a runner,
each with the fix rather than the symptom: an unqualified username on a pooler
host, port 6543 (the transaction pooler, which drops what `pg_dump` needs), and
the `db.<ref>.supabase.co` direct host, which is IPv6-only while Actions runners
are not. It warns, without failing, on a password carrying URI-significant
characters — those end a component early and silently deliver a *different*
password than the one typed.

Pure and total, so all ten cases are tested without a network, a database or a
secret — including that the password never appears in anything printable.

Two process notes worth keeping. The first attempt at this put a Python heredoc
inside the workflow's `case` block; `yaml.safe_load` passed and it would have
failed on the runner, because an indented heredoc terminator never closes in
bash and uniformly-indented Python is an `IndentationError`. **Validating the
YAML is not validating the shell inside it** — which is the same class of error
as the `pipefail` bug this job already had. And one of the ten tests was wrong,
not the code: WHATWG's URL parser splits userinfo at the *last* `@`, so an
unencoded `@` in a password parses fine and quietly yields a different password.
That is exactly what the unsafe-character check is for, so the test now asserts
the warning instead of a parse failure that does not happen.

### Aug 12 — The safest job goes first, because the first job is the default

`jobs.yml` option order. Nothing else.

`backup` was added to the dispatch list at position 14 of 20 and then could not
be found in the dropdown at all — GitHub's dispatch form does not reliably
render a `choice` list that long. So the secret that had gone unverified for a
day stayed unverified for another one, this time because the control to verify
it was not reachable.

Moved to the top, which fixes a second thing for free. The first option is the
**default**: `task` is `required` with no `default:`, so GitHub pre-selects the
head of the list and a "Run workflow" click that never touches the dropdown runs
it. That used to be `refresh-lines` — a live job that writes line snapshots and
chains `freeze-groups` — which is exactly the accident that happened on run
#106. Now the accident is a read-only `pg_dump`.

The rule this settles: **order the dispatch list by what is safe to run by
mistake, not by what runs most often.** The crons resolve their own task from
the schedule string and never read this list, so frequency was never a reason to
put `refresh-lines` first — it just happened to be written first.

### Aug 12 — Every run was called "jobs", so the wrong one looked right

`run-name` on `.github/workflows/jobs.yml`. Nothing else.

The first attempt to verify the backup ran `refresh-lines` instead. `task` is a
`required` choice with **no `default:`**, so GitHub pre-selects the first option
— `refresh-lines` — and a "Run workflow" click that never touches the dropdown
runs that, succeeds, and looks exactly like the run you meant. The log said so
plainly (`{"job":"refresh-lines","skipped":"next_game_gt_7d"}`) but only if you
opened it; from the Actions list all 19 tasks and 25 crons render as one
undifferentiated column of "jobs".

`run-name: jobs · ${{ inputs.task || github.event.schedule || 'scheduled' }}`
puts the task in the run title, so the list reads `jobs · backup`,
`jobs · scoreboard-loop`, `jobs · 0 13 * * 0`. The mis-dispatch that took a log
read to find is now visible at a glance.

Not fixed, deliberately: the dropdown still defaults to `refresh-lines`. Giving
it a harmless default would mean either adding a no-op task to the enum or
reordering the list so the first entry is the safest rather than the most
common, and neither is worth it when the run title now names what ran. Worth
knowing when dispatching: **change the dropdown, or you get lines.**

### Aug 12 — Week 1 takes the full slate

No model change, no migration. One `group_week_config` row.

The Week 1 board (Sep 3–7, 91 games including the Georgia opener) is
`full_slate`, markets `[spread, total]`, min-picks 0 — the same settings the
Week 0 board carries, so the two weeks behave alike apart from the selection.

**Written as data, not as a migration**, deliberately. 0028–0030 were schema-
adjacent corrections that belong in the ledger; a board is ordinary app state
that `/groups/[slug]/settings` writes every week. A migration inserting one
group's config would also be meaningless on a fresh project, where that group
UUID does not exist — it would silently insert nothing and pretend to have
worked.

Verified through the resolver rather than by reading the row back:
`group_week_game_ids` returns **91** for week 1 with **0** rows materialised,
which is what `full_slate` should do while unlocked — the live branch at
`0020:184-200` resolves from `games` so a late schedule addition joins the board
on its own, and `freeze-groups` materialises `group_week_games` and stamps
`locked_at` at the first kickoff. Week 0 still resolves to its 4 handpicked
games from the materialised list.

Two things this makes real rather than hypothetical: 91 games × 2 markets is 182
pickable legs per person on one page, and that page is now the honest load case
for `09:P-10` (board picks-query collapse) and the `09:P-16` rehearsal — seeding
a 10-game week would measure nothing.

### Aug 12 — The board was already a Week 0 board

`supabase/migrations/0030_move_board_to_week_zero.sql`, applied. No model change.

Asked to create a Week 0 board for the crew, and found one already there under
the wrong number. The single `group_week_config` row sat at week 1 with four
handpicked games — TCU/North Carolina, Virginia/NC State, Stanford/Hawai'i,
UNLV/Memphis. Every one kicks Aug 29 or 30, so 0029 had just moved all four to
week 0. The owner had handpicked the Week 0 slate; there was simply no Week 0 to
file it under at the time.

Creating a *second* board would have been the wrong read of the request.
`group_week_games_for` resolves a handpicked board straight from
`group_week_games` on `(group, season, week, season_type)` and never re-checks
`games.week` (`0020:175-182`), so the untouched board would have kept rendering
its four Aug 29 games under a "Week 1" heading, beside a slate that now starts
Sep 3 — while the real Week 1, 91 games including the Georgia opener, had no
board at all. Two wrong weeks instead of one.

So the board moves rather than multiplies, carrying `selection_mode`, `markets`,
`conference`, `min_picks_per_week` and `updated_by` untouched. The mechanics are
worth recording: `group_week_games` has a **composite** foreign key onto
`group_week_config` (group, season, week, season_type), so `update … set week =
0` fails on either table alone — the child cannot point at a parent that does not
exist yet, and the parent cannot leave while a child still points at it. Copy the
parent to week 0, move the children, drop the old parent.

Guarded so it can only ever fire on this shape: unlocked boards only, only when
**every** pinned game moved to week 0 (a board legitimately spanning the new week
1 is left alone), and never when a week-0 board already exists.

**Week 1 now has no board, deliberately.** Which games, and handpicked versus
full slate, is an owner's choice made in `/groups/[slug]/settings` — not
something a migration should decide on their behalf.

### Aug 12 — Week 0 is a week, and 297 receipts nobody wrote

`scripts/lib/weeks.ts` (pure, 9 tests), `src/lib/week-range.ts`, migrations 0028
and 0029, both applied to the live project. No model change; `DEFAULT_PARAMS`
untouched.

**The freeze that would have fired into a wall.** Every one of the 99 games in
CFBD's week 1 carried **three** frozen `predictions` rows — 297 total, from
three `load-preseason --bootstrap` runs on Aug 5 and Aug 7 at model versions
2026.1.0, 2026.2.0 and 2026.3.0. `predictions` has an identity primary key, so
an upsert appends; the Operations note in this file already warned that a second
`--bootstrap` duplicates them.

The duplication was not the damage. `freezeJob` builds `alreadyFrozen` from any
`frozen = true` row and `freezableGames` drops those games, so **the Thursday
freeze before the openers would have returned `{frozen: 0, already_frozen: 99}`
and gone green.** Week 1 would have shipped receipts computed on Aug 5 against
Aug 5 lines; 2026.5.0's market-anchored tier recentre — the fix for a measured
~10-point cross-classification lean — could never have reached the openers; the
grader would have counted every game three times across three models; and two of
the three rows per game carry `total = 57.0`, the constant-for-every-game number
the original audit filed as bug #4.

`0028` clears them, scoped to season 2026, unstarted games, the three superseded
versions and ungraded rows only, with a guard that aborts above three rows per
game. 297 → 0. The append-only guarantee is *restored* by this, not bent: it
exists so a receipt somebody acted on is never rewritten, `picks` was 0 rows and
`profiles` 1, and from here every row in the table was written by a freeze.

**A finding that was wrong, recorded rather than quietly dropped.** The same pass
reported 400 of 808 `line_snapshots` rows as duplicates. They are not. The
grouping key omitted `provider`: the pairs are DraftKings and Bovada captured at
the same instant with different numbers (−28.5 vs −25.5 on the first game
checked). On the full column set there are **zero** duplicates — a two-book
consensus working as designed. The claim had already reached a merged PR, so it
is corrected in place in `docs/STATUS.md` rather than deleted.

**Week 0 is a week.** CFBD labels the Aug 29 openers and the Sep 5 slate both
`week: 1` — 99 games over ten days and two Saturdays. Every surface keys on
`week`, so that is not cosmetic: it put the Sep 5 Georgia opener on the same
slate as games played the previous weekend, gave that slate seven day-tabs, and
asked one freeze to price both weekends. `freezeJob`'s per-game horizon exists
specifically to survive this; it stays correct and stops being load-bearing.

The split goes at ingest, and is derived rather than dated: within an
over-long regular-season week 1 (span > 8 days — a normal week is ~6), find the
largest gap between consecutive kickoffs, and if it is at least 2 days, the
earlier cluster is week 0. In seasons CFBD labels correctly, rule 2 never fires
and it is a no-op. 2026's seam is a **4.83-day hole** before the Sep 3 kickoff:
**8 games → week 0, 91 stay in week 1.** `0029` backfills the stored rows with
the same rule expressed in SQL, and is idempotent — afterwards week 1 spans four
days and the rule declines to fire.

Two consequences worth naming. Eight route validators hardcoded `week >= 1` and
would have 404'd or silently redirected the new slate — `UX-17` had aligned
their numbers but left eight copies, so they are now one `src/lib/week-range.ts`.
And the week selector offers Week 0 only when the season has one, via a `minWeek`
flag on the already-cached season pointer rather than a ninth magic number.

550 tests pass, `tsc` and lint clean. **Owner note:** the one `group_week_config`
row is (2026, week 1) and keeps week 1, now the Sep 3–7 slate. A Week 0 board is
a separate, deliberate act.

### Aug 12 — The backup could not fail, which is not the same as working

No model change. `.github/workflows/jobs.yml`.

`SUPABASE_DB_URL` was set today — the last of the three empty secrets, and the
one the readiness audit named as the largest open risk by elimination, since
`predictions` / `picks` / `bets` are append-only and had no copy outside a
7-day PITR window. Adding a `workflow_dispatch` option for `backup` (it was
mapped only from the `0 15 * * 0` cron, so the next proof would have been
Aug 16, then Aug 23, then **Aug 30 — after launch**) surfaced why the proof
mattered:

```bash
pg_dump "$SUPABASE_DB_URL" … | gzip > "backup-$STAMP.sql.gz"
echo "wrote backup-$STAMP.sql.gz ($(du -h …))"
```

Actions runs `run:` blocks under `bash -e`, **not** `bash -eo pipefail`. So the
step's exit code is gzip's. A `pg_dump` that dies on a bad password, a wrong
pooler port or an IPv6-only host writes to stderr, closes the pipe, and gzip
compresses nothing and exits 0 — **green run, `db-backup` artifact uploaded,
20 bytes, unpacks to an empty file, 90-day retention.** The one copy of the
receipts is exactly the place where a silent success is worst, and it would
have looked healthy every Sunday until someone needed to restore.

Now `set -o pipefail`, then `gzip -t`, then an assertion that all 11 requested
tables emitted a `COPY public.<t>` block — which catches the other silent
mode, a dump that connected fine and selected nothing. `COPY` headers are
emitted for empty tables too, so this checks the dump's shape without
asserting row counts that legitimately start at zero.

Verified against a stubbed `pg_dump` in three modes rather than reasoned about:
good dump → green, 11 tables; auth failure → **red** (was green); truncated
dump → red, naming the ten missing tables.

The same shape as the `observe-scoreboard` finding two entries down: an
instrument whose failure and whose success produce identical output isn't an
instrument. That one is still open — the board has to be watched over a real
kickoff. This one is closed.

### Aug 12 — Four checklists, one of them lying: the open work gets a single list

No model change, no code change. `docs/STATUS.md` (new), and four documents
edited to stop competing with it.

**The problem was arithmetic, not prose.** "What's left?" had six answers:
`audit/CHECKLIST.md`'s Packages A–C plus its deferred and calendar sections;
`audit/AUDIT-2026-08.md`'s §16 bug table, its §23 status table, *and* its 46 raw
checkboxes; `audit/KICKOFF_READINESS.md`'s P0/P1/P2 findings, §9 decisions and
§10 day plan; and this file's Open items. Three ID schemes — `04:DQ-13`,
`P2-1`, `§23 #40` — with no map between them, and at least one item appearing
in three of them under three names.

**The 46 boxes were the trap, and they were documented as one.** `AGENTS.md`
told readers *"read the table, not the boxes"* — a rule that only helps someone
who read `AGENTS.md` first. The boxes sat all-`[ ]` above a table saying 38 of
them were done. They are checked now, each carrying the table's verdict, so
both halves say the same thing and the warning is unnecessary.

**Two open items existed only as prose in this file** and had never reached any
checklist: re-running `--tune-churn` (the Aug 12 portal fix invalidated the
input distribution `returningProdWeight = 6` was fitted against) and dispatching
`observe-scoreboard` over the openers (the instrument shipped; the measurement
it exists for is still an assumption). A paragraph is not a tracked item —
that is how `03:M-3` went missing long enough to let a +9.8-point cross-tier
lean into the build.

**Three checked boxes were re-opened after reading the code**, which is the
whole reason the pass was worth doing rather than collating:

| ID | Claimed | Actually |
|---|---|---|
| `05:N9` | postponed/canceled grade `void` | The grader is right (`jobs-core.ts:953-977`); **nothing writes those statuses** (`sync-games.ts:93` asserts only `final`), so Rule #4 is unreachable → **P1-1** |
| `04:DQ-13` | rejects NaN/**empty** `PRESEASON_TILT_CARRY` | `Number("")` is `0`, not `NaN`, so the guard never fires and a fitted parameter disables itself silently → **P2-1** |
| `SEC-01` | "migration 0026" | 0026 and 0027 are taken; next free is 0028 |

Fourteen more open findings were re-verified against the code and stand: P1-3
(no `.env.example`), P1-4 (no cron maps to `refresh-lines-burst`), P1-6,
P2-3, P2-6, P2-10 (the existing `0 10 * * 6` is the weather cron, not lines),
P2-11, and audit rows #31/#38/#40/#42/#44/#45.

`docs/STATUS.md` is now the only place with unchecked boxes. `audit/CHECKLIST.md`
becomes the completed record of Packages A–C, `KICKOFF_READINESS.md` and
`AUDIT-2026-08.md` become the analysis behind the findings, and this file keeps
what a changelog owes a reader: the model state, and the residuals recorded
rather than hidden. Nothing was deleted and nothing was back-dated — the
superseded documents keep their original text and say what superseded them.

### Aug 12 — "Reachable" is not "live": an instrument for the one thing the probe can't ask

No model change. `scripts/lib/observe.ts` (pure, 30 tests),
`scripts/observe-scoreboard.ts`, an `observe-scoreboard` dispatch task.

The access probe closed the question of whether `/scoreboard` **answers**. It
left open whether it **moves**, and those fail differently. `scoreboardPatch`
matches the status string exactly:

```ts
g.status === "in_progress" ? "in_progress" : g.status === "completed" ? "final" : "scheduled"
if (status === "scheduled") return null;   // no write
```

so a feed that says `in-progress`, or renames `homeTeam.points`, produces zero
writes, `{live_or_final: 0, updated: 0}`, and a **green run**. Nothing else in
the stack contradicts it: realtime has nothing to push, the slate polls a table
that is correct-and-unchanging, and `watchdogVerdict` checks scoreboard
freshness only `if (gameLive)` — where `gameLive` is read from our own `games`
table, which in this exact failure never flips. **A dead live layer and a quiet
Saturday are the same observation.** That blind spot is real and still open;
this entry does not close it.

Why it can't be tested any other way: `/scoreboard` takes no year/week
parameter (the Aug 12 probe's other discovery), so there is no historical
replay. Liveness is only observable over a live game, once, unrepeatably.

**What it measures**, folded purely over samples so the analysis is testable
without a network, a clock, or a key:

| | why it is the number that matters |
|---|---|
| raw `status` strings, counted | the rename check — the failure above, named |
| lag from kickoff to leaving `scheduled` | how late our "LIVE" chip is, in seconds |
| median gap between any field changing | the real freshness floor. Polling faster than CFBD moves just re-reads the same board — the 30s loop interval is an upper bound on staleness only if this number is smaller |
| longest quiet stretch while live | halftime, or a frozen feed |
| fields **never** populated while live | `detectCoverFlips` reads `situation`/`lastPlay`/`possession`; absence is the actionable half |

Median, not mean, for the gap: one 20-minute halftime drags a mean of
30s/30s/20min to ~7 minutes, which is the wrong number to design a poll around.

**Four verdicts, and the ranking is deliberate.** `UNKNOWN_STATUS` outranks
`STALE` — when the enum drifts, "nothing changed" is the symptom and reporting
it would send someone hunting a polling bug. And `NO_LIVE_GAMES` is **not a
pass**: a mistimed run proves nothing, which is the same trap `emptyIsHealthy`
set in the probe, where a working key and a broken one looked identical because
nobody separated "we asked and it said no" from "we never got to ask". CI goes
red on the first two, exits 0 with a notice on the third.

Read-only against the DB apart from metering, so it runs beside the real
scoreboard-loop without racing it — but it does spend CFBD calls (140 at
70min/30s), so it meters into `api_call_log` like every other job rather than
quietly corrupting the budget the loop throttles off. Raw samples upload as an
artifact on failure too: a `STALE` verdict is exactly when the window you cannot
replay is worth keeping.

**Dispatch it over the Aug 29 openers.** Until then the liveness half of the
contract is still an assumption — the instrument exists, the measurement does
not.

Also noted, not fixed: `scripts/lib/probe.ts:52` still says `/scoreboard`
"returns `[]` all week and only fills on a Saturday". The Aug 12 probe disproved
that (whole season, 889 rows), and it is the stated justification for
`emptyIsHealthy` — which today would mask a genuinely empty board.

### Aug 12 — The tiers were mis-levelled by ten points, and the table that would have caught it

**Model change: 2026.5.0.** `DEFAULT_PARAMS` untouched — the change is a
preseason-build construction step, validated by a new tuner with a
pre-registered rule.

**The defect, measured before any code was written.** The 2026 preseason
ratings priced all 99 week-1 games; on the 29 cross-classification games with
a market line, the mean G5-signed edge was **+9.8 (t = 7.7)** — Toledo a
double-digit road favourite at Michigan State, Indiana −16 against a market of
−41, a BIG EDGE flag toward the G5 on essentially every P4-vs-G5 opener.
Within-tier slices were fine (P4vP4 −0.14). Independently, our twelve largest
rank overrates vs published 2026 FPI were all G5, the twelve largest underrates
all P4.

**The blind spot was fixed before the bug** (`03:M-3`, deferred until now):
`report()` prints signed error by slice — tier matchup, cross-tier by week,
favourite-signed by spread size, per conference — against the market AND
against actual margins, flagged past |t| ≥ 2, in every backtest run and in the
CI job summary (`scripts/lib/tiers.ts`, `scripts/lib/slices.ts`). Re-run on
2023–25, the table shows the same lean the 2026 market saw: cross-tier +4.03
pooled (t 9.8), +4.63 in weeks 1–2 decaying to +0.47 by week 9+, and — the
part that settles who is right — the G5 sides **underperform our numbers by
6.0 points** (t −4.2) in weeks 1–2. The market was right and we were wrong,
which is what makes this a defect and not a disagreement.

**Root cause, isolated by experiment** (`--diagnose-tiers`): the prior chain's
between-season regressions compress the P4−G5 pool gap, and a margin-Elo
cannot restore a pool LEVEL from within — intra-pool games are zero-sum, and
~1.5 cross-tier games per team per season re-level at only K/2·error per game.
The replay finals carry a ~16.5-point gap (final SP+: ~16); `chainPriors`'
0.7×-toward-zero cuts it to ~11.5 (weeks 1–4 lean +7.08, t 14.8); regressing
toward talent instead (gap ~8) still lands at +4.81. The three mechanism
hypotheses that did NOT survive: the SP+ blend share (`REPLAY_SHARE` swept 0
to 1 — on the 2026 market every construction lands +9.7…+10.4, because replay
finals and SP+ agree with each other and both sit ~8 below what the 2026
market prices); the flat FCS −30 (swept −25/−35: cross-tier moves ~0.1); scale
compression (the cross-tier edge regressed on the market gap is
intercept-only: 12.20 − 0.070·gap, slope se 0.133 — a pure level offset).

**The fix** (`--tune-tier-recenter`, rule fixed before the run): after the
build assembles ratings, shift the two pools zero-sum so the mean G5-signed
edge against the week-1 consensus lines is zero. Within-pool ordering is
untouched by construction; week-1 lines exist before week 1, so it is
point-in-time sound. Anchored to the market each August rather than a fitted
constant because the offseason divergence is accelerating: the fit is +4.4
(2024), +4.7 (2025), **+10.4 (2026)** — a δ fitted on 2023–25 under-corrects
2026 by ~6 points, and the static-δ grid is printed in the tuner to keep that
honest. Validation on 2024–25 (fit week 1, score out-of-fit): weeks 2–4
cross-tier edge +5.41 → **+0.78 (t 1.5)**; weeks 1–4 bias vs actual −6.31
(t −4.7) → **−1.57 (t −1.2)**; P4vP4 +0.51 unmoved; pooled MAE
**13.22 → 13.14**; NLL **0.4994 → 0.4956**; worst win-prob bucket 2.7. All
four pre-registered criteria passed — recentring is not a trade, it improves
the pooled numbers too.

**Verified on the real build output**: frozen week-1 cross-tier edge mean
−0.08 (t −0.06), n=28; SD 6.9 — per-game disagreement survives, only the
systematic lean is gone. BIG EDGE flags on cross-tier games drop 24 → 17;
Toledo @ Michigan State prices MSU −1.2 against a market of −10.5 (a
disagreement, no longer an absurdity). The recentre lands in
`preseason_components.detail` (`tier_level` per team) and the team page's
"How the number is built" grid gained the sixth tile so the decomposition
still sums to the rating.

**Known residuals, recorded not hidden.** (1) The FCS anchor (flat −30) was
implicitly calibrated against the OLD G5 level; with G5 down ~5.1, September
FCS buy games will pull the pools back together ~1–1.5 points through the Elo
before prior decay makes it moot — watched by the FBS-vs-FCS slice row.
(2) Within-pool spread is compressed too (our SD ~8 vs SP+'s ~10.5-11): a
separate, smaller defect the recentre deliberately does not touch; the
intercept-only regression says it is not what drove this one. (3) The 2026
gate's week-1 lines are the fit set — t < 2 there is by construction; the
out-of-sample evidence is the 2024–25 weeks-2–4 result and, going forward, the
weeks-2+ 2026 lines as they post. (4) `--tune-sp-blend`'s α=0.5 was re-tested
under the slice metric and left alone: it neither causes nor can fix the
mis-levelling.

488 tests pass, including sign-convention pins for the G5-signed edge (the
Toledo worked example is a test case) and `recenterTierGap` invariants
(exact target gap, mean preservation, no within-pool reordering).
### Aug 12 — The endpoint we bet the live layer on has never been called

`audit/KICKOFF_READINESS.md`, then a probe for the one thing it couldn't
settle.

**The audit.** Read-only pass 18 days out from the openers. 472 tests, 118 DB
assertions, tsc/lint/build all green, and — the result worth recording —
**zero regressions**: every correctness fix from the August program landed once
and was never overwritten, no migration re-grants anything a later one revoked,
and there is still exactly one CFBD fetcher. 19 findings, none of them a defect
in the model or the ledger.

**Then the run logs moved three of them.** Reading `jobs.yml`'s 98 Actions runs
resolved five of the six things the repo alone couldn't answer:

| Was | Now |
|---|---|
| CFBD tier unverified vs a hardcoded 30k budget | Tier 2 / 30k against ~10k of use. `OPS-14b` closed. |
| Has any scheduled job ever run? | 98 runs, 97 green. Secrets work, 2026 schedule ingested. |
| Is the preseason blocked on several inputs? | **One**: 2026 talent. Returning production, portal, coaches, games, lines, SP+ all live. |
| No Saturday line pass before 12:00 UTC ⇒ early kickoffs lose CLV | **Wrong.** `days_to_kickoff: 18.2` dates the first kick at ~Aug 29 14:48 UTC; the 12:00 pass is 2.8 h ahead of it, inside the 6 h stale-close guard. Downgraded P0→P2. |

That last row is the lesson, and it is the same one the decisions table keeps
teaching: **reason about a schedule, verify against the schedule.** The
early-kickoff CLV loss was ranked the #1 launch blocker on a completely
plausible reading of the cron table. One field in one job log disproved it.

**What the logs could NOT see, and neither could `--check`.** `/scoreboard` is
Tier 1+ and drives the whole live layer — scores, status transitions, the
cover-flip detector. It has **never been called with this key**. Every
scoreboard launch all summer exits through `idleSkip` before spending a call
(the Aug 12 01:16 run's job step took *two seconds*), so on a season opening
Aug 29 with `SCOREBOARD_IDLE_DAYS` at 2, its first real invocation lands Aug 27.
Two days of runway to discover an entitlement problem.

`build-preseason.ts --check` cannot cover this, and the reason is structural
rather than an oversight: it probes preseason *inputs*, and the tier-gated
endpoints are precisely the ones the preseason build never touches.

**`scripts/probe-cfbd.ts`** (+ `scripts/lib/probe.ts`, 13 tests). 11 endpoints,
all through `src/lib/cfbd.ts` — a diagnostic is not an exemption from SPEC §1's
one-fetcher rule. The design decision is the four-way status:

```
DENIED  401/403  → buy a tier
EMPTY   200, []  → wait for CFBD to publish
ERROR   5xx/net  → CFBD is having a bad day
OK
```

Collapsing DENIED and EMPTY into "no data" is how you spend $10 on the wrong
problem, or wait three weeks for data that was never coming. Two supports for
that split: historical probes run against `SEASON−1`, so EMPTY is unambiguous
rather than "2026 hasn't happened yet"; and `/scoreboard` carries an
`emptyIsHealthy` flag, because an empty board on a Wednesday is the correct
answer and demanding rows from it in August would report a working key as
broken.

Exit code is non-zero only for a **required** endpoint — `/stats/game/advanced`
is Tier 1+ but only feeds `--tune-epa`, which is rejected and sitting at
`epaWeight` 0, so losing it must not turn a launch-week run red.

Wired as the `cfbd-probe` dispatch task and as its own `always()` step beside
the daily August `preseason-refresh` — deliberately not `&&`-chained onto it,
because a declined refresh exits 0 on purpose and would have silently skipped
the probe. Exactly the failure mode the probe exists to catch.

**Also caught, from the env block printed in all 98 runs:** `ANTHROPIC_API_KEY`,
`SUPABASE_DB_URL` and `HEALTHCHECK_PING_URL` are all empty. The first is the
designated slip item. The second means **the append-only `predictions` / `picks`
/ `bets` tables have no copy beyond a 7-day PITR window** — which is the exact
thing the backup job was written to outlive. And the Aug 10 red run turns out to
have been the watchdog working correctly against a cold `job_runs` table, which
means `OPS-1b` (dispatch a deliberately-failing run, confirm who gets the email)
already happened for free — the only open question is whether the email arrived.

**The probe ran, and the answer is boring in the best way.** All 11 endpoints
reachable on Tier 2, including both Tier 1+ ones — `/scoreboard` 889 rows,
`/games/media` 103. No purchase, no code change, and the Aug 27 cliff is gone
for 11 calls.

It did teach us one thing nobody knew: **`/scoreboard` returns the whole season
(889 rows), not just live games**, and takes no week parameter. `scoreboardJob`
is already correct — it filters to `in_progress | completed` first and returns
early — but every live poll pulls ~889 games, 120×/hour on a Saturday. A
payload question rather than a call-count one, with no narrowing available.
Worth watching in the load rehearsal.

**And the backtest was re-run against the live key, because the audit was
quoting this file as evidence for itself.** Full cold 2023–25 plus
`--diagnose-edges`. Every claim reproduces:

| | recorded here | live run |
|---|---|---|
| model margin MAE | 13.25 / 13.27 | **13.25 / 13.26** |
| market margin MAE | 11.98 | **11.98** |
| signed bias | +0.03 | **+0.03 ± 0.33** |
| totals: model vs constant-57 | 13.09 vs 13.72 | **13.09 vs 13.72** |
| encompassing b₁ / b₂ | 0.035 (t 0.84) / 0.987 (t 22.81) | **0.035 (t 0.83) / 0.985 (t 22.87)** |
| n | 2611 | **2611** |
| five tier tests | all fail | **all fail** |

**A methodology finding, and it belongs in that section above.** Every figure
that drifted is computed *from the market line* (edge-flag n 1801→1825, the 6–10
bucket 53.5→53.8%, opener CLV +0.27→+0.26); every figure computed from our own
model was exact. The cause is that **the backtest is not bit-reproducible —
CFBD backfills `/lines`**, so the multi-book consensus shifts between runs and
reshuffles marginal games across edge buckets. Magnitudes are ~1% and no verdict
moves. But it means a future run differing in the third significant figure is
**not** a regression, and nothing said so until now. If it ever matters, commit
a hash of `.backtest-cache/lines-*.json` beside a recorded result.

Two things the summary tables hide, both relevant to opening weekend:

- **Weeks 1–2 margin MAE is 14.27 against a pooled 13.25.** The model is a full
  point worse on exactly the weekend we launch. Expected — in week 1 the rating
  *is* the preseason prior — but it is the honest number to set expectations
  against, not the season average.
- **The `--tune-sigma` rejection is visible in the standard report.** Weeks 1–2
  fit σ 18.08 against a pooled 16.67, which looks like an argument for widening
  until you read the next column: weeks 1–2 NLL is **0.3526**, far better than
  weeks 5–8 at 0.5677. Exactly the cupcake-blowout mechanism the decisions table
  describes — huge residuals against near-certain winners. Flat sigma stays.
- One caveat on framing: totals beat the constant-57 strawman (13.09 vs 13.72)
  and that is what they shipped on, but against the **market** they lose,
  12.51 to 13.09, in every week segment. "Beats a constant" and "is good" are
  different claims and only the first is supported. Consistent with O/U leans
  staying unflagged.

No model change from the audit or the probe; `DEFAULT_PARAMS` is untouched by
either. The portal fix below is a different matter.

### Aug 12 — The portal term was counting suitcases, not players

Found by eyeballing the ratings table — *"Vanderbilt above Texas, South Florida
above Alabama"* — which is worth recording, because **no automated check in this
repo would have caught it.** The unit tests pass, the DB assertions pass, the
backtest reproduces. A human looked at a list of teams and said "that's wrong."

The two named examples turned out to be the stale 2026.2.0 production build
(Texas is 11th and above Vanderbilt at 2026.4.1; Alabama 22nd and above USF).
But the instinct was right, and the cause was not the SP+ carry it was aimed at.

`churnAdjustment` takes `netPortalPoints` in rating points, so the builder
converted net star count with what was meant to be a z-score. **Both halves were
wrong.**

**Wrong population.** The divisor was computed over every school appearing
anywhere in the portal feed — 417 of them for 2026, only 138 FBS. The other 279
are FCS/D2 programs with small net movements, and they compress the spread:

| pool | n | mean | SD | RMS (as coded) |
|---|---|---|---|---|
| all schools (used) | 417 | −6.4 | 14.9 | **16.2** |
| **FBS only (where it is applied)** | **138** | **−6.9** | **21.6** | 22.7 |

FBS teams absent from the feed were dropped from the pool entirely, when their
true value is 0 and they belong at its centre.

**Wrong statistic.** `sqrt(Σv²/n)` is RMS about zero, not a standard deviation,
and nothing subtracted the mean. The mean is −6.9 because ~22% of entries (976
of 4,439) have no destination yet, so their origin is debited and nobody is
credited. *That debit is correct* — a player who enters the portal is gone
whether or not he has signed. Treating the resulting negative mean as zero is
not: **the average FBS team carried a −0.59 point penalty for an unremarkable
off-season.**

Together: the term was ~33% too large and shifted. A uniform shift cancels in a
spread; this one scaled with outflow, so it taxed whoever lost the most players.
**8 of 138 teams pinned at the ±4 clamp** — Florida State −68, Oregon −58, Ohio
State −55, Michigan State −53, South Alabama −51. Ohio State sent 37 out and
brought 17 in, almost all 3-star: −5.09, clamped to −4. Four rating points for
shedding buried backups.

`scripts/lib/portal.ts` (`portalScale`/`portalPoints`, 10 tests) centres on the
mean and scales by the SD over exactly the 138 FBS teams the adjustment reaches.
Clamped teams **8 → 1** (only Florida State).

| | before | after |
|---|---|---|
| Ohio State | 20.9 (2nd), churn −2.8 | **21.6 (1st)**, churn −2.1 |
| Alabama | 9.0 (22nd), churn −3.6 | 9.9 (22nd), churn −2.8 |
| Penn State | 10.4 (16th), churn −5.4 | 11.5 (14th), churn −4.3 |
| Vanderbilt | 10.7 (14th) | 11.3 (**16th**) |
| South Florida | 7.1 (29th) | 7.1 (**30th**) |

**What this deliberately does NOT fix.** 91% of portal entries are 2- or 3-star
(3,470 threes, 122 twos, 579 null→2; only 268 are 4/5-star), so the signal is
**headcount, not talent** — ~0.28 points per net player, and a team shedding 20
backups scores like one losing 20 starters. Only weighting by production, or by
the `rating` field the builder ignores (present on 65% of entries — `04/DQ-12`),
can tell those apart. That is a design question for `--tune-churn`, and patching
it silently alongside a defect fix would break the gating rule in `AGENTS.md`.

**This is a bug fix, not a parameter change, so it gets no decisions-table row —
but it invalidates one.** `returningProdWeight = 6` and `talentReloadStrength =
1` were fitted by `--tune-churn` against the broken input, so they are now fitted
on something that no longer exists. **`--tune-churn` should re-run before Aug
29**, and given that its recorded gain was already inside the ~0.25 SE
("a harmful setting was removed", not "churn improved"), the honest outcome may
be `netPortalPoints = 0`. Every other unearned parameter here sits at an
identity default.

Caveat for whoever re-tunes: `replaySeason` never calls `churnAdjustment` —
churn enters only through `build-preseason.ts` for the 2026 prior. Read how
`tuneChurn` builds its evaluation before trusting a new number from it.

### Aug 11 — The demo stops offering exits that don't exist, and gets a link card

No model change. `DEFAULT_PARAMS` untouched, no tuner run.

Three follow-ups off the demo review. One of the three turned out to be
already built, which is recorded here rather than quietly re-done.

**Every link out of the demo was a dead end, and now none of them are.** The
card overlay pointed at `/game/9104` — a game page for a game that never
happened — and the hub's `Ledger →`, `The board →`, group rows, pool-progress
rows and the ledger footnote all led to routes that, signed out, are the
sign-in card the demo exists to avoid. `GameCard` and `HomeDashboard` take a
`demo` flag; a `MaybeLink` helper renders the identical box without the
anchor, so nothing about the layout moves. The demo hub is now down to exactly
one link — the hero's own "Go to the slate", which stays inside the demo —
and that count is pinned by a test, as is the fact that the real hub still
links out everywhere. Everything else on a demo card (odds taps, star, pin,
the slip) still works; only the way out is gone.

**`/demo` has its own link card.** `opengraph-image.tsx` one segment up sells
the product; this is the link people actually send, so it previews the thing
the screens are built around — a live score with a verdict on it — and wears
"sample data" on its face, so a card sitting in a group chat carries the same
disclaimer the page does. Inherited by `/demo/slate`. Code-generated, no
asset, no font fetch, like the root tile.

**The watchability chip was already shipped** — `WatchRating` has rendered on
every pregame card since #37 (band + figure: "Good 72", "Filler 34"), and
`SystemsRow` likewise satisfies the §2.4 promise the audit still lists as
unmet. `audit/CHECKLIST.md` is stale on both counts. What was actually broken
nearby is **Game of the Week**, which was computed from the *filtered* list
and suppressed entirely unless the board was untouched — so picking a
conference either moved the crown to a different game or made it vanish. It
now comes from the whole week's games, a fact about the slate rather than
about your filter: the same game wears it whenever it's on screen, and
nothing wears it when it isn't.

**Noted, not changed:** a game you have only a *bet* on gets the verdict aura
(`tintFor` reads bets first) but no cover strip, because the strip reads
`headlinePick` — picks only. On the demo that's the Ole Miss / Georgia push:
amber glow, "On the number" chip, no broadcast strip. Giving money the loudest
verdict slot is a design call, not a bug fix, so it waits for a decision.

472 tests pass.

### Aug 11 — Amber means push, the glow gets loud, and the ticker learns whose money is where

No model change. `DEFAULT_PARAMS` untouched, no tuner run.

Owner feedback on the demo, verbatim in spirit: you can't tell at a glance
whether a game is covering. Three causes, three changes, and one bug the work
uncovered.

**The bubble tier is retired — amber now means exactly one thing: a push.**
`CoverTier` and `CardTint` are sign-based (green covering, red losing) with
amber reserved for a game sitting exactly on the number, live or graded. The
old "within a field goal" amber made the one distinction colour exists for —
good or bad — unreadable, and an actual push fell through to *team colours*,
the tint that means "you have nothing on this". The knife-edge read survives in
text: the cover strip now prints its margin in every tier ("COVERING +½" is the
sweat; the colour no longer pretends to be). `liveUrgency` lost its
bubble-first key and sorts by distance from the number, ascending — an
on-the-number game is the hardest sweat there is — and now reads the same
stake the aura does (ledger bet first, then pick), so the card the sort leads
with is the card glowing loudest.

**Found while retiring it: away spread picks graded backwards in the aura and
the strip.** `pickCoverView` and `tintFor` hand-rolled `sideMargin + line`
against the home-perspective `line_at_pick`, flipping the verdict for away
picks — the strip could say "Covering" while the chip on the same card said
"Down 7 ATS" (the chips route through `statusForPick`, which was right). Both
now go through `coverMargin`, the grader's own formula, and
`slate-live.test.ts` pins the convention with worked away-side examples.

**The verdict glow is now unmistakably louder than the wallpaper.** Live
verdict auras 0.42 → **0.55**, settled verdicts 0.14 → **0.20**, pregame team
tints 0.36 → **0.30** — the six-hundredths gap between "your money" and
"identity" was below noticing, which defeated the whole two-vocabulary
design. The aura's side inset widened −2px → **−6px** so the halo reaches into
the grid's 14px gutters, where a glance actually lands. Checked in both themes
at 375px; light mode still reads as glow, not stain.

**The ticker knows whose money is where.** `TickerGame` carries
`mine: covering | losing | push | on` — computed by `tickerMine()`, which
reads `tintFor` so the strip can never disagree with the aura. `/api/ticker`
fills it for a signed-in session (two RLS-scoped queries; signed-out gets
the plain strip), and `ScoreTicker` renders it as a 2px verdict underline —
an inset box-shadow, so a verdict appearing mid-drive cannot shift the strip —
with the read spelled out in sr-only text. "On" (plain chalk) marks action
that has no verdict yet.

**The demo gets the ticker, and stops phoning home.** `ScoreTicker` was the
one component on `/demo` still reaching past the page — polling the real
`/api/ticker` and joining the realtime channel, so the demo wore real games
(or an empty strip) above invented ones. `AppNav` now takes a `demoTicker`
payload built by `demoTickerData()`; in demo mode there is no fetch, no
channel, and chips don't link (there is no `/game/:id` for an invented game).
Selection reads the pose, not the clock — windowing against real time would
empty the "up next" chips six days a week. Verified headless: zero `/api/*`
requests from both demo pages over 65 seconds.

**And the demo slate finally shows a verdict.** The first demo shipped the
slate bare — no `myPicks`/`myBets` on any game — so the screen meant to show
off the verdict system never showed one, while the hub next to it posed a
signed-in viewer. `demoSlateData` now attaches the same positions
`demoPositions` builds, which also makes the "My bets"/"My picks" filters do
something. The three live games land one on each colour, arranged so every
state is honest arithmetic: OSU −3 down three (red), Ole Miss +7 with UGA up
exactly seven (amber), Utah +3.5 down three (green, by half a point).

469 tests pass, including new pins for push-only amber, the away-spread
convention, bet-aware urgency, `tickerMine`, and the demo ticker's pose.

No model change. `DEFAULT_PARAMS` untouched, no tuner run.

The site could not show itself to anyone. `/` and `/slate` are public to browse,
but signed out they render a week header and a sign-in card, because that is
honestly all a signed-out visitor has. The one surface with sample data,
`/slate/preview`, is a design harness — sections titled "Card states preview"
and "Loading skeleton", no actual slate page, and a `notFound()` in production
because its bet slip would write to the ledger with a bogus season id (audit bug
#10). So there was no link to send, and nothing to screenshot.

**`/demo` and `/demo/slate` are public, and render the real components.**
`src/lib/demo-data.ts` supplies the payloads `fetchHomeData` and
`fetchSlateView` would have returned — twelve games across Friday night and the
four Saturday windows, posed mid-afternoon: three final, three live, six still
to come. No session, no Supabase call, no season lookup.

**The Saturday is anchored to whenever the link is opened, not frozen.** The
design harness freezes its clock to a constant, which is right for comparing
screenshots and wrong for a link someone opens on a Tuesday in March. The demo
places every kickoff against the coming Saturday in Eastern time, which is what
keeps `kickSlot` ("Noon", "Primetime") and the day tabs correct — offsets from
`now` drift into the wrong window at the wrong hour. The DST arithmetic is real:
the season straddles the November change, so the ET offset is read off `Intl`
per instant rather than hardcoded, two-pass because the offset is a function of
the instant being solved for. `demo-data.test.ts` pins all twelve wall times
across five opening times including standard time. Game *states* stay fixed
rather than derived from the clock — derived, the link would show an empty
pregame board six days a week.

**The hub's layout moved into `HomeDashboard`.** `app/page.tsx` assembled its
sections inline and `PreviewClient.tsx` had hand-copied that assembly, which is
the failure mode that makes preview pages worthless a month later. Both now
render one component; the page is a loader and nothing else. `/slate/preview`
lost ~250 lines of duplicated fixtures with it and keeps only what the demo has
no room for — the overtime final, the postponed game, the betting sheet, the
skeletons.

**Everything that reaches past the page is off in demo mode.** `SlateView` and
`BetSlip` take a `demo` flag: no `/api/slate` poll, no realtime channel, no week
selector, and a slip that fills and confirms but never calls `logSlipBets`. The
poll is the one that mattered — it would have replaced the sample week with the
real signed-out one about thirty seconds after somebody opened the link.
Verified in a headless phone viewport: zero `/api/slate` requests over 75s, zero
POSTs after submitting a two-leg slip, the only socket being Next's own HMR.

**The numbers say they're invented.** A "sample data" chip and one line of text
sit above each screen, quiet enough to crop out of a screenshot and clear enough
that nobody mistakes the fake leaderboard for a real season. The bar also
carries the only link between the two demo screens: the app's own nav points at
the real pages, so following it out of the demo is a dead end — and for the same
reason the hub's primary action goes to `/demo/slate`.

Shipped as PR #33.

### Aug 11 — The aura was below the threshold of perception, and a React Bits round that lost

No model change. `DEFAULT_PARAMS` untouched, no tuner run.

**The React Bits round lost, all three directions.** The question was whether
anything at [reactbits.dev](https://reactbits.dev) would make the site cleaner.
Three `/slate` directions went up as standalone HTML under `public/design/` per
exploration mode — **slate-a** a split-flap departure board, **slate-b** a
wall-of-TVs bento, **slate-c** a scroll-driven spotlight — plus **slate-motion**,
a panel-by-panel study of what animation buys. All three read as worse than the
card that already ships, which is now the *second* time a card mockup round has
lost to the incumbent (Aug 8 was the first). The mockups stay as the record.

What the round was worth keeping, none of which required installing anything:

- **`CountUp` is disqualified, not merely avoidable.** It needs `motion`, and
  tweening a score 21 → 28 renders 22, 23, 24, 25, 26, 27 — six numbers that were
  never the score. Football scores jump by 3/6/7/8. Demonstrated live in
  `slate-motion.html` panel 01 rather than argued.
- **`ElectricBorder`, `ClickSpark` and `GooeyNav` escape the reduced-motion kill
  switch.** They animate via SVG `<animate>` or rAF; the global block in
  `globals.css` clamps CSS `animation-duration` only. Zero-dep does not mean
  free.
- **`GradualBlur` is 6–10 stacked `backdrop-filter` layers** for a problem one
  `mask-image` gradient solves. Same argument as Aug 8's: the ground is flat.
- Registry deps, verified: `gsap` for SplitText/ScrollReveal/MagicBento/Masonry,
  `motion` for CountUp/ShinyText/TiltedCard/Dock, `ogl` for the backgrounds,
  `lenis` for ScrollStack. `SplitFlapText` is the only shortlisted component that
  ships its own reduced-motion handling.

**The real ask underneath it was the aura, and the aura was invisible.** Drift
was `translate3d(±1.5%)` + `scale(1.05)` over 16s — about 11px over 8 seconds on
a ~360px card, call it 1.3px/sec, which is under the threshold of perception on a
phone. It had been doing nothing it was designed to do since Aug 8. Travel is now
5% with a 2% vertical term and a four-stop cycle, so the path wanders instead of
sliding along one axis.

The Aug 8 rule is **unchanged and deliberately so**: motion still means money,
`[data-tint="position"]` only. Broadening it was offered and declined — it is one
of three cues separating a verdict glow from a team glow, and pregame always
resolves to `teams`, so a morning slate still does not move. That is the accepted
cost, not an oversight.

Two things went with it:

1. **Scale barely moved, 1.05 → 1.06.** The blur lives on `.glass-aura` itself,
   so translating that element lets the compositor shift an already-rasterised
   texture while scaling it forces a re-raster. All the amplitude comes from
   translate. This is also why the two aura halves are *not* counter-phased —
   animating children inside a blurred parent re-rasterises the blur every frame,
   so the change that would most obviously read as "alive" is the one that costs
   most. `will-change: transform` is scoped to the animating selector, so it
   promotes ~10 auras rather than all ~70.
2. **A score now lifts the aura and lets it settle** — `data-flare` on the wrap,
   reusing the `useRef` previous-score effect that already drives `score-pop` and
   the 500ms opacity transition `.glass-aura` already carried. No new keyframe.
   It is a narrow, argued exception to "no opacity change": discrete news rather
   than ambient flicker, and gated on `[data-tint="position"]` **in the selector
   as well as** in the component, so it cannot leak onto a team card from a future
   call site that forgets. Deliberately stricter than `score-pop`, which fires on
   every card — correct for a scoreboard number, wrong for the thing carrying the
   money signal.

Incidental fix: the old keyframe was a two-stop `alternate`, so the global
reduced-motion clamp (one 0.01ms iteration) parked the aura permanently at
`translate(1.5%) scale(1.05)`. A cycle whose 0% and 100% match rests at `none`.
Verified: `transform: none` and unchanging under `reducedMotion: reduce`.

Measured, not assumed — Chromium at 390×844, `/slate/preview`, A/B in one session
by overriding the new tokens back to the old values:

| | 13 cards / 6 animating | 67 cards / 30 animating |
|---|---|---|
| old values | 60fps | 60fps |
| new values | **60fps** | **60fps** |

No regression, at three times the animating-aura count of the Aug 8 baseline
(61fps at 67 cards, 10 animating). Caveat worth recording: this was a headless
Linux container, not a phone, and 60 is the vsync ceiling — it says "no
measurable cost", not "fast".

`GameCard.aura.test.tsx` is new and pins the component half of the rule in five
cases, including the negative one: a score tick on a game you have nothing on
must not flare. 437 tests pass. `tintFor` and `live-status.ts` were not touched.

### Aug 11 — The hub gets the slate's scoreboard, and stops mixing money with the pool

No model change. `DEFAULT_PARAMS` untouched, no tuner run.

Three complaints from seeing the hub logged in on an iPad, and one design
round to answer them. Three directions went up as standalone HTML under
`public/design/` per `docs/DESIGN.md` exploration mode — **A** inside the
existing language, **B** a dense sportsbook board, **C** a broadcast score bug.
**A was chosen**, with one amendment: its score was a 10px `24–21` in the row's
corner, which made the most important number on a live row the smallest thing
on it.

**The scoreboard is the slate's, not a summary of it.** Each team now gets its
own row on its team-colour rail with a 24px tabular score at the right, the mark
growing 32→44px once there is a score, and the losing side of a final faded —
the construction `GameCard` has used since the cards were built. That
construction moved out of `GameCard.tsx` into `TeamScoreLine` in
`components/slate/TeamLine.tsx`, and **both screens use it**. What stayed in the
card is what only a card has: the star button, the possession football, the
score-flash and the odds cells, all passed in through a `trailing` and a `right`
slot. `GameCard` had no tests, which is exactly why a refactor of it needed
some: `TeamLine.test.tsx` pins the score/record switch, the losing-side fade,
the rank superscript naming its poll, and the colour rail.

**Bets and pool picks are two sections.** The first hub rendered them as
differently-tinted chips on one row, which undid what the ledger's two tabs
exist for — and the real account has the case that proves it: **UNC held at +7
in the pool and +6.5 on a ticket**, two numbers on one game that the old row
showed as one line. `splitPositions` puts a game with both in both lists
carrying only that list's layer, and narrows the game's own `myPicks`/`myBets`
with it, so a pool pick can't colour a money row's aura.

**The rows say something the slate can't: whether your number is still good.**
Every position line carries `held +4.5 · now +3.5 ▲1.0`. The arithmetic is
`spreadClv` / `totalClv` — this is the same question CLV asks, against the
running line instead of the close, and those two already encode the asymmetry
that makes it easy to invert (a spread holder wants a bigger number, an over a
smaller one, an under a bigger one). Deriving the signs a second time would only
have been a second chance to get one backwards. Seven worked examples in
`home.test.ts` cover it, including the home-side ticket and the over/under
split.

**And it looks like the app now.** `max-w-3xl` under a `max-w-7xl` nav became
`max-w-6xl` splitting into two columns on `lg` — positions left, groups and
season right. Rows carry the slate's `glass-wrap` aura through `tintFor`
unchanged, which works because `buildPositions` attaches the viewer's layers to
the `GameView`; that one assignment also makes every helper in
`live-status.ts` work on the hub. The CTA is capped at `max-w-sm` instead of
`flex-1`, which had it spanning the whole column on a tablet. The pool name is
dropped when you are only in one pool — it was printing "Test Group" five times
and saying nothing.

**The `web-design-guidelines` pass on the diff found three, all fixed.** The hub
was the one screen with no `h1` — its sections were `h2`s under nothing — so the
hero's week is now the page heading. The `▲`/`▼` glyphs are `aria-hidden` with a
sentence behind them, since "up-pointing triangle" helps nobody. And the 10.5px
`held · now` labels sat at `text-chalk/45`, around 3.3:1 on the card; they use
`--text-dim` now, which is what that token is for.

**Checked.** 432 tests, lint, types and build clean. `/slate/preview` renders
the new rows pregame, live and final in both themes at 375px and 1024px, beside
the real game cards on the same page — and the cards are unchanged after the
extraction. `fetchHomeData` re-run against the live project: 23 requests, no
errors. `/` rendered signed out off the real database, one `h1`, zero
horizontal overflow.

**Still not done, and worth deciding separately:** the hub is a server component,
so its scores are as-of page load. The slate polls (`use-games-realtime`,
`/api/slate`); the hub does not. Making the score the biggest thing on the row
makes staleness more misleading, not less.

### Aug 10 — The site stops opening on the slate

No model change. `DEFAULT_PARAMS` is untouched, no tuner was run, and nothing
here can move a number.

**`/` was `redirect("/slate")`.** Opening the site dropped you into sixty game
cards with no answer to the question you opened it with — what have I got
riding, where do I stand, how is the season going. Every one of those answers
already existed, spread across `/groups`, each group's hub and `/ledger`, and
none of them was the first thing you saw. `/` is now a hub that asks the four
questions in order and then hands off: a hero (the week, what you have on it,
per-pool pick progress, and one full-width **Go to the slate**), the games you
have a pick or a bet on, your groups with your place in each, and your season
record. It is deliberately short — the hub is somewhere you pass through, and
the primary action says so.

It renders **signed out** rather than redirecting, which keeps the property the
rest of the site has (`lib/supabase/middleware.ts`: public to browse, RLS does
the enforcing). A signed-out visitor gets the week, the CTA and a sign-in card;
nothing personal is fetched at all. The magic-link landing, the PWA `start_url`,
the header wordmark and the post-sign-out redirect all point at `/` now.

**Home takes a bottom-bar slot; Edges moves to More.** The bar holds four, and
"where's my stuff" beats a page of model-vs-market disagreements that the
changelog already demoted to information. Two things this needed:
`isNavItemActive` prefix-matched, and every pathname starts with `/`, so a naive
Home entry lights up on every screen in the app — `/` is now matched exactly,
with `nav-items.test.ts` pinning it. And Home is `mobileOnly`: the desktop strip
does not fit a tenth tab (it already truncates Receipts at 768px, unchanged by
this), so on desktop the wordmark is the link home.

**The hub is lazy on purpose.** A signed-out visitor and a brand-new account
each cost one small `games` query. `fetchSlateView` — fifteen queries — only
runs once the pick and bet rows say there is a position to draw. The picks come
from a query across *all* the viewer's pools rather than through
`fetchSlateView`'s pick layer, which can only be scoped to one group: someone in
two pools was otherwise going to silently lose half their positions.

**No new arithmetic.** Every number folds through `lib/records.ts`, so the hub's
tiles and the ledger's are the same numbers by construction rather than by
agreement. `cumulativeUnits` moved into that module, and the ledger's curve now
goes through it — which fixes a quiet disagreement: the curve summed
`payout_units ?? 0` while the Units tile above it synthesized the flat −110 for
a graded bet with no payout written, so the curve could end somewhere the tile
didn't. `UnitsCurve` and the stat tile are now `components/` files shared by
both screens (five other near-identical private tiles in receipts, recap, edges,
the team page and the game page are left alone — this is the two screens showing
the *same* numbers agreeing, not a sweep).

**Standings were not consolidated, deliberately.** `groups/[slug]/page.tsx`,
`groups/[slug]/week/[week]/page.tsx`, `groups/page.tsx` and `ledger/PicksTab.tsx`
each still re-derive a standings fold inline, and the hub adds a fifth in
`lib/home.ts`. A shared `fetchGroupStandings` is the obvious next move; doing it
in the same change as a new screen is four screens of risk on top of one, and
`docs/DESIGN.md` says build one completely first.

**Seen rendered.** The hub's components are in
`components/home/HomeHub.tsx` rather than in the page so `/slate/preview`
renders them against sample data — same reason `group/GroupHub.tsx` is a
component file. Reviewed there at 375px in both themes (zero horizontal
overflow), plus the bottom bar and the More sheet on a real route. The
`web-design-guidelines` pass on the diff found three things, all fixed: straight
apostrophes in two strings, an 11px pool-progress line that was a link with a
14px tap target (now a 44px row, per DESIGN.md's hard rule), and a live score
reading the nullable columns instead of the coalesced ones.

**Checked against the live database.** Worth writing down how, because the
signed-out branch of `/` issues one `games` query and nothing else — so the
queries that matter were, at first, covered only by unit tests over fabricated
objects, and a wrong column would have 500'd the page for every signed-in user
without anything failing locally.

- Every request `fetchHomeData` issues was run against the live project with a
  fetch wrapper failing the run on any non-2xx. 23 requests, none of them
  4xx. The three group-scoped selects are gated on being in a pick'em group and
  an unauthenticated caller is in none, so they were also issued verbatim
  against the real group: 200, zero rows, RLS behaving.
- `buildPositions` was driven off real `GameView`s out of `fetchSlateView`
  rather than fixtures, and collapsed picks and bets onto the right games.
- The numbers were then computed independently in SQL and matched: 99 games in
  week 1, no live games, first kick 2026-08-29T16:00Z; the one real account's 7
  week-1 picks land on **4** distinct games (so the hero reads 4, not 7 — the
  per-game collapse); its group has `min_picks_per_week = 0`, so progress reads
  "7 picks in" with no denominator; nothing in that group has graded, so
  `placeOf` returns null and the row shows "—" rather than a meaningless "1st of
  1"; and all 8 of its bets are voided, so the record block collapses to "No
  bets logged yet" instead of four dashes.
- `/` itself rendered signed out at 375px in both themes off the real database —
  "Week 1 · 99 games on the board · first kick Sat 11:00 AM CT", zero console
  errors, zero horizontal overflow, and Home marked current in the bottom bar
  and nowhere else.

**Not checked:** `/` rendered while signed in. Auth is magic-link, so a session
would have to be minted, and faking one means writing auth rows to the
production database. The query and arithmetic checks above are what stands in
for it. Also noted while looking: the signed-out hub is a short page, so on a
tall phone there is a stretch of empty ground between the sign-in card and the
footer. Left alone — the crew is signed in, and filling it would mean inventing
content for the one state that doesn't need any.

### Aug 10 — "8 of 4 picks", and why the game cards stopped being glass

**A board of four games with spreads and totals on is eight picks, and it said
"8 of 4".** The numerator counted picks — one per market per game — and the
denominator counted games. `pickableSlots` now counts the buttons that actually
exist, which is not games × markets either: a priced market with no posted line
cannot be picked, so a game nobody has hung a total on contributes its spread
and nothing else. Anything else can promise a total the board can't take. The
hero reads "5 of 8 picks · 4 games", so the two numbers can't be confused
again. Four tests. A weekly minimum still overrides it — "of 8 required" is a
different claim from "of 8 available".

**The game cards went opaque on Aug 10 and it was self-inflicted.** Measured
rather than guessed, on a rendered card:

| | member card | game card |
|---|---|---|
| height | 59px | **434px** |
| sheen falloff at `38%` of height | 22px — specular | 165px — a flat wash |
| aura transmitted through the face | n/a (no aura) | **12%** |

Two compounding causes, both introduced by the earlier "make the cards pop"
pass, and both landing only on the tall aura-backed cards:

1. `--glass-surface` went 74% → 88% to lift cards off the page. The game card
   is the only glass on the site with something *behind* it, so that traded the
   aura away for contrast. Now 80%, with `--surface` raised to `#241d16` so the
   face lands on the same colour over a plain background — the entire
   difference is in what it transmits, which is up two thirds.
2. The sheen fell off over a *percentage* of height, so the highlight scaled
   with the card: correct at 22px, a wash at 165px. Now a fixed 88px band.
   Glass does not get glossier because the pane is taller.

Plus a second lit edge (`--glass-floor`, inset along the bottom lip at 45% of
the top edge). A pane lit from one side shows two edges; with one, a 434px card
reads as paper with a highlight painted on it. Light mode opts out of both —
on white there is nothing for a white sheen to do.

### Aug 10 — The odds grid marks money only, and week 1 stops having two Saturdays

Both found by looking at a real slate card on a phone.

**A pool pick was lighting up the odds cell.** `OddsCell` had three tinted
states — in-the-slip, a logged bet, and *the cell you took in the pool* — and
the last two were nearly the same amber. So a card with a pick'em pick and no
money read as a card with money on it. Confirmed from the database rather than
inferred: the account had **0 live bets and 8 voided**, and 8 picks, so every
highlight on screen was a pool pick.

The pool's answer already lives one row down, in a labelled chip with the group
mark. The grid now marks exactly one thing — money — with the in-slip state on
top of it, and the corner pip stays so colour is not the only carrier. The
"— your pick" suffix comes off the odds-cell `aria-label` too: the chip below
announces it, and a screen reader should hear what the screen shows.

**Week 1 rendered "Sat · Thu · Fri · Sat".** The tab label was the weekday
alone, and week 1 opens Sat Aug 22 and closes Mon Aug 31 — so it contains two
Saturdays, with nothing to tell them apart and no visible reason a Saturday
sorted ahead of a Thursday. `dayTabLabels` now dates *both* members of any
colliding weekday ("Sat 8/22", "Sat 8/29") and leaves unique days clean, so an
ordinary week keeps its four bare chips. Championship week and the bowl slate
have the same shape and get the same treatment. Four tests.

`dayTabLabel` was also passing `tz` in and then formatting in the *server's*
zone — the parameter was accepted and dropped. Fixed in passing; it only ever
showed up on a kickoff near midnight.

**Checked and correct** on the same card, for the record: `BIG EDGE 4.8` is
exactly `|−11.8 − (−7)|`, and the 77% win probability is exactly
`logistic(0.101 × 11.8) = 76.7%`. The Noon/Afternoon banding is right too
(11:00 CT is 12:00 ET, under the 14:00 cut). What is *not* current is the model
behind those numbers: `ratings` in production are still `2026.2.0` against code
at `2026.4.1` — see Open items, unchanged.

### Aug 10 — Betting groups: who got there first, who tailed, who faded

A second kind of group. A pick'em group is a **format** — an admin's board,
one pick per market against it. A betting group is a **lens**: it has no board
and stores nothing of its own, it reads its members' ledgers and lays them on
the slate. Whoever is first on a game is the source; everyone behind them is
tailing or fading.

**The migration is one column, and that is the design.** The obvious schema is
`bets.group_id` — file each bet into a betting group as it's logged. Rejected
for three reasons, the third fatal: it asks a filing question at the moment
someone is placing a bet; it can't express one bet in two groups, which is the
normal case for anyone in a work pool and a friends pool; and it duplicates a
fact the ledger already holds, creating a state where the ledger and the sheet
disagree with no principled way to reconcile them. So `groups.kind` is the
whole of `0027`, plus two triggers refusing a pick'em board on a betting group
(a trigger rather than a guard clause inside `make_pick`, which would mean
re-emitting two amended plpgsql bodies and keeping the copies in step forever).

**Origination is per group, and that is correct.** The same bet can be the
source in one group and a tail in another because a different member got there
first — "first" is only meaningful inside a crowd, and each group is a
different crowd.

**The classification rules** (`src/lib/tailing.ts`, 15 tests):

- Key is **game + bet type**. Being first on the spread says nothing about the
  total, and someone betting the total hasn't faded your spread.
- Every follower's counterparty is **the source**, not the person immediately
  ahead of them. Jeff opens, Mo tails, Sam takes the other side: Sam faded
  Jeff, not Mo. One source per market keeps "fading Jeff" a single countable
  relationship instead of a chain whose meaning depends on arrival order.
- Ties on `placed_at` break on the row id. A slip logs its whole batch in one
  transaction where `now()` is fixed, so same-microsecond rows are routine, and
  without the tiebreak "who was first" changed between page loads.
- A **voided** bet never happened, so it can't hold origination — otherwise a
  taken-back bet keeps the credit and demotes whoever actually put the number
  up.
- Nobody tails themselves; a second bet of your own on the same market is
  another position, not a follow.
- **Derived, never stored.** A `tailed_bet_id` column would only be set by the
  Tail button, making the stats a measure of button usage rather than of who is
  worth following. Two people on the same side ten minutes apart are a source
  and a tail whether or not they spoke.

**What the numbers are.** Per member: overall, what they open, what they tail,
what they fade — plus **how everyone who tailed them did** and **how everyone
who faded them did**, which is the pair a good bettor who posts late fails.
Per viewer: a row against every other member, tailing vs fading, which cannot
be read off anyone's own record because their season counts every bet you never
saw in time. Hot/cold is a stated threshold, not a feel: ±3 on wins minus
losses over the last ten graded bets, with units printed beside it because 7-3
with one 5u loser is a losing week.

**On the slate**, each card grows a Sheet block: the source, the followers
indented under it, form pips, and a **Tail** button that puts their side on
your slip *at today's number* — copying their line would write a ledger row you
never held and a CLV against a price nobody offered you. A tailed selection
defaults the slip's reason tag to `tail`, so "is tailing profitable for me" is
answerable from the ledger's existing tag audit rather than from a report
nobody would build.

**Sharing** a sheet texts every position grouped by kickoff with one CTA back
to `/slate?g=<slug>`, which opens the slate with that group's sheet on the
cards. One link, not one per bet — a message with eight URLs is a message
nobody taps.

One bug caught in review before it shipped: the sheet row printed
`line_taken` raw, which inverts the sign on every away ticket — the exact bug
the pick formatter was consolidated to kill. All three call sites now go
through one `betSideLabel`, with tests.

**Applied to production 2026-08-10** as `betting_groups`, ahead of the merge
rather than after it: `fetchMyGroups` selects `groups.kind`, and PostgREST
answers an unknown column with an error that supabase-js hands back as
`data: null`, which `(data ?? [])` turns into "you are in no groups". Adding a
defaulted column is invisible to the old code, so migration-first has no window
where anything is wrong; merge-first has one where everybody's groups vanish.

Verified against the live database rather than assumed: the one existing group
took the `pickem` default, `create_group` has exactly one overload (the
three-argument one — the old two-argument function is dropped, so a call can't
be ambiguous), and both guard triggers were fired by a probe that inserted a
betting group, tried a week config and a pick against it, collected the errors
and then raised to roll the whole thing back. Both refused with *"That is a
betting group — it has no pick'em board"*, and the probe left no rows.

**A gap found while checking:** `0017_rivalries_seed` is not in
`supabase_migrations.schema_migrations`, though the `rivalries` table exists
with 29 rows and the slate reads it fine. It was applied outside the tracked
history at some point. Nothing to repair — recorded because the next person to
diff the migrations directory against the history table will find the same hole
and wonder whether a seed is missing.

**Two follow-ups, same day.** The kind is permanent — there is no honest
conversion between a group that stores a board and picks and one that reads
everyone's ledger — so the create form now says so *above* the choice rather
than leaving it to be discovered, and points out that the answer to "I want
both" is two groups with the same people in them. And the group switcher now
carries each group's kind on its chip: two identically-styled chips landing on
two completely different pages is the kind of thing that only reads as a bug
once somebody is in one of each.

### Aug 10 — Groups become a product: a hub, a board that keeps up with a thumb, and the two ledgers pulled apart

Eight complaints from actually using the site on a Saturday. No model change —
`DEFAULT_PARAMS` is untouched, no tuner was run, and nothing here can move a
number.

**The picks now land on the tap.** Every pick went through a server action, and
a server action revalidates the page that called it — on the group board that
meant a dozen queries plus a full `fetchSlateView` before the button you pressed
changed colour. Eight picks, eight of those waits, which is what "the picks take
a while to lock in" was describing. `PickButtons` is optimistic now: the tap
paints the pick from the line already on screen, the write goes out behind it,
and the server's row replaces the guess the moment the two agree on a side (so a
line that moved between render and tap corrects itself instead of being
believed). Verified in a browser with every POST delayed 4s — 150ms after the
tap the button reads `aria-pressed=true`. Reconciliation is a pure merge, not an
effect; a rejected *or* thrown write reverts the button and says why, where
before a thrown one took the error boundary and the whole board with it. Buttons
also stay live during a write, since disabling them mid-flight is half of what
made rapid picking feel stuck.

**And every tap on the site got ~300ms faster**, which was the other half.
`touch-action: manipulation` now applies to `button`, `a`, `[role="button"]`
and `label` in `globals.css`. Safari holds a tap to see whether a second one is
coming, so it can offer double-tap zoom; on a board whose entire interaction is
tapping in sequence, that hold *is* the latency, and no amount of optimistic
rendering removes it. Pinch zoom is untouched — nothing here sets
`user-scalable=no`, which the guidelines flag as an anti-pattern and which this
does not need.

**Three async messages started announcing themselves.** A rejected pick, the
bet slip's "N bets logged" confirmation and its share result are all updates
that happen without the reader doing anything, so they now sit in
`role="status" aria-live="polite"` regions rather than appearing silently. The
group-admin crown also stopped carrying its label on the SVG — `aria-label` on
an `<svg>` is unreliable without `role="img"`, so the text node does the work.
Found by running the `web-design-guidelines` review on my own diff, which
`docs/DESIGN.md` asks for and which had not been done on this batch until then.

**There is somewhere to go when you're done.** There was no submit button —
correct, picks save on tap — but nothing said so and nothing said where the
group went next, so the flow ended in silence. The board now carries a footer in
the thumb zone with a live count ("5 picks in · 3 to go", moving on the tap, not
on the server) and an exit to the full list of what you took.

**`/groups/[slug]` is a hub, not a board.** It used to be standings, then pick
controls for every game, then nothing — so the thing you came to do was below a
table, and the group itself was a header line. The picking moved to
`/groups/[slug]/picks`; the hub is now a week hero (format, progress, first
kickoff, one primary action), the members as cards in the slate's idiom, and an
admin block only an admin sees. `WeekHero`/`MemberCard` live in
`components/group/GroupHub.tsx` rather than in the page, so `/slate/preview`
renders them against sample data — the hub needs a database, a group and a
signed-in member before it draws a pixel, which is a poor loop for design work.

**Teams look like teams everywhere.** One `TeamLine` (mark, poll rank, name,
records) now identifies a team on the group board, the matchup cards and the
admin's game picker, all of which previously said "MIA at WMU" in plain text —
the same information a schedule PDF carries and none of the information a pick
needs. The rank pip is accent only when a *poll* ranked them and names its
source, since `displayRank` falls back to the model's own rank and those are
different claims. `TeamView` gains `confRecord`, off the schedule's own
`conference_game` flag (not a comparison of the two conference strings, which
would lie about games already played if a team changed leagues mid-season).

**Pool picks and bets stop pretending to be each other.** They were rendered in
the same accent chip, so a card carrying both couldn't tell you what you had
money on. Accent now means money: `PickedChip` is chalk with a group mark,
`BetChip` keeps the ticket and the ring. The slate's single "Mine" filter (pick
OR bet) becomes two independent toggles — both on reproduces the old behaviour
and `mine=1` links still work. The ledger gains a **Group picks** tab with its
own queries and its own arithmetic, so pool units (flat −110, League Rules #6)
can never leak into the ROI the ledger exists to compute.

**The cards read as material again.** `--surface` was `#191512` on a `#12100d`
page, and after the glass mix a card rendered at about `#17130f` — a 4% lightness
step, which in a dim room is no step at all. Ground, surface and elevation moved
apart, the line and specular edge came up, and `.card` gained a sheen falling off
over its top third (`--glass-sheen`, derived from `--glass-edge` — no new hue).
Same palette, three visible steps instead of one.

**Rankings say whose rankings.** The page was headed "Rankings" with a poll
switcher that only appeared once two polls existed. All three are always listed
now — CFP Rankings, AP Poll, Coaches Poll — with the unpublished ones inert and
the reason on hover, and the heading names the poll you are reading.

**Sharing moved to where the thing being shared is.** A slip can be shared from
the slip, both before logging and from the "logged" confirmation, which is the
second someone wants to send it. Shared picks and slips group under their
kickoff time (`groupByKickoff`) instead of arriving as a flat list, because the
person reading it in iMessage is working out what they can still watch. The
share-sheet-or-clipboard dance is one function (`shareOrCopy`) shared by both
buttons, and the group share context is built once (`buildGroupShareContext`)
for all three screens that offer it.

### Aug 10 — The verdict block stops disappearing, and three docs stop lying

**`UX-29`.** The team page rendered its Verdict section as `{verdict && (…)}`,
so with no row it vanished without a trace — while `generateMetadata` told every
crawler and every share card that the page carries "the verdict on The CFB
Slate". That reads like an edge case and isn't: `team_verdicts` is empty for
*every* team, because arming the writer (`F2` — add `ANTHROPIC_API_KEY`,
dispatch once) is still an open calendar item. So all ~130 team pages were
promising a block none of them rendered. The section now always renders and says
"Not written yet" when there's nothing, in the plain register `UX-23` set for the
slate's empty states. A row whose four fields are all blank counts as pending
too, so the fix can't produce a heading over an empty list.

**Three documents had drifted, all of them over-reporting open work** — which is
the direction that keeps drift alive, because nothing about reading them feels
wrong. Each claim below was re-checked against the code before its line was
edited, not taken from the previous doc:

- `docs/CHANGELOG.md` still listed the six hardcoded `#5b6472` fallbacks (closed
  by `UX-15`; it now survives only as the `--push` token definition in
  `globals.css`), still counted OG share images among the open audit items
  (shipped as `UX-12/F8`), and still said the code was at `2026.4.0` when this
  same file's Current-state header says `2026.4.1`. Self-contradictory, twenty
  lines apart.
- `audit/AUDIT-2026-08.md` §23 carried its 08-07 reconciliation into 08-10
  unchanged: row 36 still flagged the `build-preseason.ts` `SEASON` hardcode
  (closed by `04:DQ-14`) and row 46 still said "no `opengraph-image` route
  anywhere". **38 done, 5 partial, 3 open** now, and the three re-checked rows
  are dated; the rest of the table keeps its 08-07 stamp because it was not
  re-verified line by line.
- The scorecard at the top of that file still named shipped features as things
  blocking 100. It is a snapshot and stays unedited per the file's own receipts
  rule, but it now says so, and points at §23 and `audit/CHECKLIST.md` for live
  status.

What survived the check is as important as what didn't: §23's row 42 (no route
smoke tests) and row 31 (BetForm game search is still a plain `<select>`) are
both still true, and were left exactly as written.

`audit/CHECKLIST.md` needed no correction — every box I spot-checked matched the
code. It remains the file to trust.

### Aug 10 — Bets on the card in every state, TV populated, watch rating shrunk

*Reconstructed from `de8e7f2` (PR #24) on 08-10 — this entry was missed when the
PR merged, and the house rule at the top of this file says every shipped change
gets one. Written from the commit message and the diff, not from having done it
first-hand a second time.*

Four things, all from using the site. The watch rating went from a three-line
stack down the right edge of every pregame card to one chip in the existing row
— the band is the read, the number rides along for sorting. TV was rendered but
never populated: 0 of 888 games had one, because `scoreboardPatch` returns early
for scheduled games, so `tv` only ever arrived once a game was already playing;
`sync-games` now pulls CFBD `/games/media` daily, and the upsert groups rows by
column signature instead of the old two-pass split, because row shapes vary by
design. And a bet placed from the slate was invisible until the game went live
and vanished again when Sunday's grader touched it — the card now says both pool
and ledger in every state, with a ring and corner pip on the odds cell you have
money on (shape, not just tint, since a pool pick can sit on the same cell).

The follow-on bugs this left — the slate not refreshing, and "My picks" hiding
bet-only games — are the entry above.

### Aug 10 — A logged bet shows up when you log it, and counts as yours

Two bugs from real use, both fallout from putting bets on the cards the day
before:

**The slate needed a hard refresh to admit the bet existed.** The bet actions
call `revalidatePath("/slate")`, which is correct and inert: `SlateView` is a
client component holding the slate in `useState`, seeded once from the server
and thereafter refreshed only by its own `/api/slate` poll. Server revalidation
has nothing to invalidate on that path. So the confirmation of "Log bets" was
the next poll tick — 30s with games live, **90s pregame**, which is when a
person is actually placing bets, and which reads as a dead button. Voiding had
the mirror problem: `BetChip` hid itself optimistically, but an in-flight poll
carrying the pre-void payload could put the chip back.

New `src/lib/bets-changed.ts`: a module-level `betsChanged()` / `onBetsChanged()`
pair, the same no-provider shape as `session-picks` and `bet-slip-store`. The
two writers announce; `SlateView` refetches on the spot. It is an event rather
than a store because nothing renders from it. A module store rather than a prop
because the two emitters sit on opposite sides of the tree — the slip is
SlateView's own child, the void button is four levels down inside a card — and
prop-drilling a refresh callback through `CardGrid` → `GameCard` →
`PregameFooter` to reach it would be worse. The refetch reuses the existing
`refresh(week, showSkeleton: false)`, so there is no skeleton flash, no layout
shift, and the `liveEventAt` guard still keeps a slow response from rolling a
fresher score backwards. `revalidatePath` stays where it is; it is still what
makes a hard navigation correct.

**"My picks" hid the games you had money on.** The filter predicate tested
`myPicks.length === 0` and nothing else, so a game you had bet but not picked
was filtered out of your own view. That is exactly backwards for this product:
the ledger and the pool are independent, you can bet a game the pool never put
in play, and both are yours. It now passes on a pick **or** a bet, and the
toggle is labelled **Mine** rather than "My picks" so the label stops lying
about what it does. The `mine=1` URL param keeps its name — shared links.

353 tests, `tsc`, `eslint src/ scripts/` over the whole tree, and `next build`
all green. No new test: the predicate is inline in the component and had no
unit coverage before this, and extracting it for a one-clause change would be
the tail wagging the dog. Verified by reading, not rendered in a browser.

### Aug 10 — Bad beats, caught live, because there is no other time to catch them

`cover_flips` (migration `0026`) records late ATS and total swings — the
backdoor cover, the garbage-time TD that cashes an Over — as the scoreboard
poll sees them happen.

**The reason this could not wait for the season.** The audit filed it under
"needs real games data" alongside three other social features, and that was
wrong in a way worth writing down: a cover flip is a *transition between two
polls*, not a state. Nothing in the schema holds it afterwards. Worse,
`last_play` — the line that makes an entry worth reading ("Alston 34 yd pass
from Meyer") — is deliberately nulled the moment a game goes final. So the
detector either existed before Aug 29 or Week 0 and Week 1 were gone. The
other three genuinely do need a *sample* of graded picks first; the checklist
now says so separately.

**One cover formula, finally.** The signed cover margin existed four times
character-for-character — `grade.ts` (settlement), `live-status.ts` (the live
chips), the bet grader, and a home-perspective variant in `slate.ts` — which
is exactly the shape `pickSideLabel` was in before it drifted five ways.
Writing a fifth for the detector would have been absurd, so `src/lib/cover.ts`
holds `coverMargin` / `spreadCoverSide` / `totalCoverSide` and the other four
call it. A pure refactor of identical expressions: the 100 existing
grading-path assertions passed unchanged, and a new test walks six scorelines
proving `coverMargin`, `gradePick` and `liveSpreadStatus` still agree.

**Detection** (`detectCoverFlips`) is pure, like `scoreboardPatch` and
`freezableGames` beside it. It fires only from the 4th quarter on (`period >=
4` catches overtime for free) and only when the score actually moved — which
is also what makes a retried tick a no-op, since after the write prev equals
next. `winner_changed` separates a true backdoor (the game's winner never in
doubt, only the cover turned over) from a wild finish where both did. The
unique key is `(game_id, market, home_points, away_points)`: football scores
only go up, so a post-flip score happens once per game, and a tick that wrote
and then died cannot double-log.

**Cost.** The detector needs the number the game is measured against, so the
poll now reads `line_consensus` — but only when a game is actually in the 4th
quarter, so the great majority of ticks skip it entirely and a late tick pays
one narrow round trip and zero CFBD calls.

**Surfaces.** `/recap/[week]` grows a "Bad beats & backdoors" section: every
swing per game, oldest first, with the last one marked as the one that stuck
and tagged backdoor or wild finish. The group week board is where it gets
personal — the table stays a neutral fact about the game, and `MatchupCard`
turns it into "burned: Jeff · saved: you" using picks it already had in hand.
Keeping the names out of the table means the log stays correct when group
membership changes.

**Known limit, stated rather than discovered in November:** two scores inside
one 30-second tick collapse into a single transition, so an onside kick and an
answering score can hide a flip if the net cover side is unchanged. Games with
no consensus line are never flagged, and an unusable clock logs the flip with
`seconds_left` null rather than dropping it.

353 unit tests, 118 database assertions, build green. `0026` applied to the
live project and verified (two read policies, updates revoked). The recap
section and the card line were **not** rendered in a browser — there is no
flip data to render until a real game plays.

### Aug 10 — One game, one freeze: the merged Week 0/1 would have double-stamped the receipts

Checking whether Week 0 "messes with" week 1 turned up the real answer:
CFBD stores Week 0 *inside* week 1. Verified against the live project: 2026's
week 1 is **99 games across ten days** (Aug 29 → Sep 7), with 12 teams playing
twice. The product is per-game everywhere — picks, grading, CLV, cards — and
the ratings replay batches by week under the same convention the 2023–25
backtest was tuned on (those seasons merge Week 0 too), so nothing collides.

Except the freeze. `freezeJob` gated on the week's **earliest** kickoff and
then froze the whole week: the Aug 27 run would stamp the Sep 5–7 slate nine
days early on preseason ratings and stale lines, and the Sep 3 run would stamp
those games **again** — predictions is append-only, so the first batch becomes
a silently superseded "receipt" (newest-per-game hides it everywhere) and both
batches grade for CLV. A soft edit wearing a freeze's clothes.

Now: `freezableGames` — per-game horizon (a game freezes when *its own*
kickoff is inside `FREEZE_HORIZON_DAYS`) plus an already-frozen skip that even
`--force` cannot bypass, so a game gets exactly one receipt, priced with
everything known the Thursday before it kicks. The second Saturday's numbers
therefore include the opening weekend's results, which is what "frozen
Thursday night" honestly means in a ten-day week. Tested against the real
week-1 shape, including the re-run-freezes-nothing case.

Worth knowing for the week-1 board: `group_week_is_locked` reads the week's
**first** kickoff, so group boards for week 1 lock at the Aug 29 kick and
cover both Saturdays — configure them before then.

### Aug 10 — The audit's fix list: ledger integrity, quota-proofing, and the fence around the refresh

The full audit landed as PR #19 (`audit/00-SUMMARY.md`); this pass implements
its P0s and the P1s that need no CFBD data, shaped by two owner decisions:
stay inside the free tiers, and stop polling lines nobody bets — only the
close matters. Five commits, one per track.

**Ledger integrity (the P0).** The bet slip inserted the ticket's
side-perspective `line_taken` (+6.5 for an away dog) while the grader,
`liveSpreadStatus` and `spreadClv` all read home-perspective — so every away
spread bet would have graded backwards from the first Sunday, invisibly,
because the ledger displayed the raw stored number and therefore *looked*
right. Conversion now happens at the write boundary (`storedLine` in
`actions/bets.ts`, via `homeLineForSide`), displays convert back through
`lineForSide`, and `bet-line-convention.test.ts` walks write → grade → CLV →
display so no boundary can regress alone. Zero rows were affected: nothing
had been graded. In the same commit, `snapToHalf` now rounds ties away from
zero to match Postgres `round()` — a −3.25 consensus mean previously snapped
to −3.0 in JS and −3.5 in SQL, two different closes from the same snapshots.

**Quota-proofing, without giving up 30-second scores.** The binding quotas
are Supabase egress and realtime messages, not CFBD calls. Three changes:
`fetchSlateView` stops fetching a week of raw `line_snapshots` (~1 MB per
poll tick) that fed `spreadHistory` — a field with zero consumers since the
sparkline came off the card on Aug 9 (reduction is by construction; not
measured against a live server). `scoreboardJob` diffs against stored rows
(`scoreboardPatch`, pure + tested) so finals stop being rewritten identically
every 30s — previously most of a Saturday's realtime fan-out. And the line
schedule went minimal by owner decision: 2×-daily refresh plus one close pass
~40 min before each kickoff wave, now including Thu/Fri nights, which the old
schedule missed entirely. Paired with `closingConsensus`: a close whose last
pre-kick snapshot is >6 h old grades as no-close (CLV null, stated on
Receipts) rather than banking Tuesday's line as Saturday's.

**Sign display.** Four hand-rolled spread labels could print the wrong sign:
the `/edges` "Model lean" (away leans shown home-perspective), the game-page
Systems table (negated into home-positive under a footnote declaring market
convention — SP+ and Model disagreed about what a minus means), and the
game-page crew list + GameHeader pick chip (away flips, straight-up as "PK").
All four now go through `lineForSide`/`pickSideLabel`/`systemMargin`. The
`/edges` cover-prob stat is gone: it priced the model at weight 1.0 when
`--diagnose-edges` measured 0.034, three lines under the page's own
disclaimer.

**MODEL_VERSION 2026.4.1 — centered team HFA** (`centeredBlendedHfa`). Raw
home/away margin splits are inflated ~+1.9 at the FBS mean by scheduling —
home slates carry the FCS buy games — so production's mean raw HFA
back-computes to 4.91 against the fitted 3.0, and the old blend would have
re-introduced a ≈−0.9 home-side bias the moment `preseason-refresh` rebuilt
`team_hfa` at baseHfa 3.0. Invisible to the backtest: the replay prices with
flat `baseHfa` and never touches `team_hfa`. Centering pins the mean applied
HFA to the fitted value and keeps the between-team spread at half strength.
**Not tuner-validated** — the per-team component has never been replayed, and
its tuner can only run once CFBD publishes 2026 data; the gate here is
arithmetic (mean(blended) ≡ baseHfa, pinned by test), not a fitted gain.
Alongside it, `--check` now fails when >5 FBS teams miss the talent join (a
partially published file used to pass while unmatched teams silently took the
−8 constant), and a declined `preseason-refresh` goes red from Aug 20 instead
of quiet green through the window's end.

**Ops.** Migration `0024`: `job_runs` (written by every scheduled job via
`recordJobRun`; bookkeeping failure never breaks the job) with a Jobs
freshness card on `/admin` — red on a failed run, amber past cadence, which
is the absence check no error email provides. An inert dead-man ping step in
`jobs.yml` activates when a `HEALTHCHECK_PING_URL` secret exists.
`line_consensus` gains `as_of`, and both the slate header and the game-page
market table now stamp when the lines were captured — under the minimal
cadence staleness is by design, so it is said on screen. Scoreboard crons now
cover Sunday/Monday slates (Week 1 is Labor Day weekend; `idleSkip` exits the
no-game weeks in under a minute). Every page carries a footer: no money moves
through the site, 1-800-GAMBLER.

322 unit tests, 90 database assertions, production build green. Also verified
against the live project: the Aug 29–30 opener slate is stored as `week = 1,
regular` (8 games) — CFBD delivers "Week 0" as week 1, so the audit's worry
that a literal `week: 0` would make the launch slate unreachable (08/H3)
closes as a non-issue. Not done, on purpose: everything the audit marked
data-dependent (Aug 26 checkpoint, top-25 smell tests, verdicts batch, first
supervised grading run) and everything it marked in-season.

### Aug 9 — The group week page: matchups first, and who's on which side

The weekly picks page nested **game → market → person**, which reads as a
database dump. The question on a Saturday morning is *who is on which side of
this game*, and that layout made you assemble it yourself by scanning names down
two separate market sections. `/groups/[slug]/week/[week]?view=pick` now inverts
the inner two levels and makes the split spatial: the matchup is the headline,
the two sides are the two halves of the card, and each member sits under the one
they took with the number they actually got. The by-person view is unchanged and
still a toggle. Scope was the week page only — the board keeps its pick
controls, per `docs/DESIGN.md`'s "build one screen completely, then propagate".

**Every device on the new card already existed** (`MatchupCard.tsx`): the 3px
team split edge and `TeamMark` from the game card, `.trow`/`.trail` for the
team-owned halves, the accent ring `OddsCell` uses for "this one is yours", and
`ResultChip`'s icon-plus-colour rule for a graded pick. No new colour, weight,
spacing or radius token. `.trow`'s gradient is `var(--tc, transparent)`, so the
over/under halves reuse the identical class with `--tc` unset and come out
neutral — one component, colour only where a team owns it.

**All the week's matchups appear**, not only the picked ones; a game nobody has
touched says "nobody in yet" rather than vanishing. Dropped games keep their
greyed "no longer in play" card at the bottom.

**`pickSideLabel` in `src/lib/slate.ts`** — `"UNC +6"` / `"UNC to win"` /
`"UNC ML"` existed as **five** private copies (`week/[week]/page.tsx`,
`GameCard`, `PickButtons`, `game/[id]/page.tsx`, `share-text`), each rendering
straight-up slightly differently. All five now call one function, which calls
`lineForSide` — so the away-spread sign fix can't be forgotten in a sixth copy.
Same move as `src/lib/records.ts`.

**`0023_hidden_picks`, applied to production.** A per-group
`picks_hidden_until_kickoff` flag, off by default. The single picks policy
becomes three, because "mine" and "everyone else's" now answer differently:
own picks always readable, others' and anon's gated on `picks_revealed(group,
game)` — a `stable security definer` helper that is two primary-key hits. A
`null` `start_ts` counts as *not yet kicked off*, so a TBD game stays shut
rather than defaulting open. With the blind on RLS returns nothing, so the page
cannot even say how many picks are in; `group_game_pick_count` is a
security-definer counter, guarded on `is_group_member` so a non-member of a
public group cannot poll it for who has committed. `supabase/tests/hidden-picks.sql`
asserts all of it across three roles — 90 assertions total now pass.

**Four things only rendering caught**, at 390×844 against a temporary two-member
public group in the live project (deleted afterwards, along with the two game
rows it mutated):

- The lean bar rendered a 2–0 as a 50/50. A flex item's percentage width still
  shrinks to make room for its sibling; it is now one span over a coloured
  track, no flex math.
- The matchup header link was a 23px strip of team abbreviations — under the
  44px floor, with nothing else in the row to tap. The whole row is the link.
- "Nobody in yet." was shown to signed-out visitors on a blind board, where the
  page has no entitlement to the count and does not know. `blindCount` is now
  `number | null`, and null reads "Hidden".
- The blind repeated "they reveal at kickoff" on every card — the same
  sign-in-prompt-per-card mistake as the last round. The rule is stated once in
  a banner above the list; each card carries only its own number ("3 in ·
  hidden").

The `{group name} →` link on that page was also 16px tall; fixed in passing.

### Aug 9 — Groups live in production, and the gaps closed

`0020`–`0022` applied to the live project. The `0021` backfill found nothing to
rescue and no-opped, which is what it is for: the one pick in the database was a
week-1 test that the owner asked to drop first, so the first real group gets made
and named in the UI rather than inherited as "The Crew".

**A bug the production data exposed.** The backfill stamped `locked_at` on every
week it reconstructed, on the reasoning that a week with picks in it had been
played. The single pick was on week 1, which kicks off on Aug 29 — so the
backfill would have frozen an upcoming week, handing the owner a board of one
game that `set_group_week_config` then refuses to change. It now only freezes
weeks whose first kickoff has actually passed, and `supabase/tests/picks.sql`
asserts an upcoming week stays editable.

**`min_picks_per_week`** (`0022`). League Rules #6 has always claimed a
3-picks-a-week minimum and nothing displayed or enforced it; with per-group
formats the number stops being a site-wide fact anyway — a pool handpicking six
games cannot ask the same as one playing the full slate. Per week, 0 means none,
and it is displayed rather than enforced: the board shows "2 of 3 picks in" and
nothing is blocked or voided. `/rules` was rewritten around it.

**`update_group`** (`0022`). `create_group` set the name and visibility once and
nothing could change either, so a typo in a group name was permanent. The slug
moves with the name — the URL changes, which is the right trade for a pool
reached from the Groups tab against a slug that contradicts its name forever.
`archive_group` and `regenerate_join_code` had shipped as RPCs with no UI at all;
all four are now in a settings panel.

**Winners-only groups hide the money columns.** Straight-up takes no number, so
such a week grades no units, no ROI and no CLV. Those columns are inapplicable
rather than empty, and a column of dashes is a question the reader has to answer.

**Moneyline bets grade.** `if (b.line_taken === null || !b.side) continue` was
skipping them — a moneyline has no line to take, so the guard treated the normal
case as a broken row and they sat ungraded forever, quietly missing from the
ledger's record and units. The payout maths was already right for any American
price. CLV stays null: it is measured in cents against a closing price we do not
capture (spec §5.3), and inventing one from the spread would be worse than
leaving it blank.

**`/game/[id]` is read-only for picks**, per the owner decision that picking
happens on the group board. It shows what you took, in which group, and links to
the board to change it.

**Four fixes that only came from looking at it.** The pages were finally rendered
against the live database at 390×844, with a temporary public group that was
deleted afterwards:

- The by-pick view keyed on game × market, so a spread and a total on one game
  put "UNC at TCU" on screen twice in a row and two picks looked like two games.
  One card per game now, markets nested.
- Ungraded picks rendered a `·` in the result column, which reads as a glyph
  rather than as an absence. Nothing renders now.
- A member with nothing graded showed "— this week · — lifetime". It says
  "nothing graded yet".
- Signed-out, every game card repeated "Sign in to make your pick". One prompt
  above the board instead.

The away-spread sign fix from the previous entry was confirmed on real rows: a
pick stored as −4.5 home-perspective renders "NCSU +4.5", which is what the
bettor holds.

76 database assertions, 296 unit tests.

### Aug 9 — Groups, and six things that only said half of what they knew

The social layer becomes group-scoped, and several numbers that were on
screen without their meaning got the rest of it. No model parameter was
touched: `DEFAULT_PARAMS` is untouched, `watchability()`'s formula is unchanged
(only its presentation), so the gate in `AGENTS.md` does not apply and no tuner
run is owed.

**Groups.** Any user creates one and is its admin; the admin sets, per week,
which games are in play (handpicked / full slate / one conference) and which
markets members may pick (spreads / totals / winners). Migrations `0020` and
`0021`. Three decisions worth keeping:

- *Header plus join table, not a `game_ids` array.* No referential integrity to
  `games`, no index for "which groups carry this game", and `unnest` in every
  join. The join table also gives the freeze somewhere to write.
- *`full_slate` and `conference` resolve live and materialise at the freeze.*
  Live means a late schedule addition joins the board on its own; materialising
  means a postponement that moves a game to another week cannot pull it off a
  board people already picked. There is a test for exactly that.
- *The freeze reads the clock, not a flag.* `group_week_is_locked` asks whether
  the week's first kickoff has passed; `locked_at` only records that the
  `freeze-groups` job has materialised the list. That job is chained onto the
  lines refreshes rather than given a cron of its own — those already run daily
  and every ten minutes through the Saturday kickoff waves, the freeze is
  idempotent, and a missed run costs materialisation but never correctness.

`0021`'s backfill only runs when there are picks to rescue. On a project with
none there is no history to preserve, and minting a group called "The Crew"
would leave a row nobody asked for — and there is no rename RPC yet, so no way
to relabel it.

Picks are per group, so the same user can hold opposite sides of one game in two
pools. Straight-up is winner-only by owner decision — no line, no price, no CLV
— which is why `line_at_pick` is now nullable behind a check constraint.

**A pre-existing display bug, found by a test on new code.** `line_at_pick` is
stored home-perspective: `make_pick` snapshots the raw consensus and both
`spreadClv` and the grader read it that way. Every *display* path printed it
raw, so an away backer on a home −6.5 holds +6.5 and was shown "−6.5" — on the
card, in the pick confirmation, and in the weekly grid. `lineForSide` does the
conversion in one place now. Nothing stored was ever wrong; grading and CLV were
always correct, so there is nothing to backfill.

**A bug `0021` introduced and this fixes.** `fetchSlateView` fetched picks by
user alone and keyed them by game, so once a pick belonged to a group, two
pools' picks on one game collided and the last row back won. It takes a
`groupId` now. Within a group a game can carry three picks (one per market) and
a card shows one verdict, so `headlinePick` leads with the spread — the only
market with a number to be near, hence the only one with a bubble tier — and
falls back to the first pick made.

**The sparkline is off the game card.** It plotted consensus spread movement and
sat beside the watch rating, which is not what it measured. `MoveIndicator`,
immediately to its left, already stated the same fact numerically; its x-axis
was index rather than time, so snapshots an hour apart and a week apart drew an
identical shape; and it was `aria-hidden` at 56×18 with no text alternative.
`MovementChart` keeps the data on `/game/[id]`, where it has a real time axis and
a label. The component stays — `GameHeader` uses it for win-prob history, where
the x-axis genuinely is a sequence.

**The watch rating** was `watch 78` at 11px with its scale only in a `title`
tooltip a phone cannot show. It is now WATCH over an 18px figure, `/100`, and a
band — MUST-SEE / GOOD / FILLER. A number needs a scale; a word does not. Hidden
on live cards: once the game is playing, how watchable it was always going to be
is beside the point, and the cover strip owns that size.

**Ratings.** `rating-scales.ts` holds what each system measures, and mainly
exists to hold the awkward part: model, SP+ and FPI are all points-vs-average
and comparable, Elo is not. The 25-Elo-per-point conversion was written out
inline twice and is now in one place. `rankAndPercentile` replaces five ad-hoc
rank computations and adds the half that was missing everywhere — #14 means
different things in fields of 136 and 20.

**One tally instead of five.** Record math existed in the leaderboard, the weekly
grid, the slate's crew line, the recap and the ledger, and disagreed: two counted
pushes and three didn't, the −110 convention was inlined twice as a magic 0.909,
and only two computed ROI. `src/lib/records.ts` is the only implementation now.
`PICKEM_WIN_PAYOUT` stays at the shipped 0.909 rather than the true 10/11 —
nine ten-thousandths of a unit is not worth silently restating every historical
leaderboard over.

**Verification.** `scripts/db-test.sh` (`npm run db:test`) applies all 21
migrations to a throwaway Postgres with a shim for the three Supabase API roles
and `auth.uid()`, then runs `supabase/tests/*.sql` — 64 assertions impersonating
a member, a non-member and a signed-out visitor. RLS, revoked grants and
security-definer guards are not reachable from vitest, and reading a policy and
agreeing with it is not a test. Deliberately breaking one assertion was checked
to turn the suite red. 296 unit tests; card changes rendered and measured in
Chromium at 390×844.

### Aug 8 — Liquid Glass cards, and one colour vocabulary instead of two

Three rounds of card mockups all lost to the card that already shipped, so the
layout stayed and only the surface changed. Cards became translucent over a
blurred colour *aura* rather than gaining `backdrop-filter`: the slate's ground
is a flat `--bg`, so blurring through a card spends GPU blurring a solid colour.
`backdrop-filter` is still used on the header, ticker and bottom nav, which do
have content scrolling under them.

Most of that pass was surfacing data that already existed and was merely quiet.
Watchability was implemented, tested and sorting the slate while being thrown
away on live games; TV and weather were on the card at 10.5px, weather only when
notable. Rivalry was the one real gap — seeded by `0017_rivalries_seed.sql` and
read by `/game/[id]`, never joined into the slate — and joining it closed the
hole `watchability()`'s own comment had promised ("rivalry/stakes terms join when
that data exists"). Odds cells went to 44px and 13px, which is the readability
ask and the audit's under-sized-target finding in one change.

**The tint carries one fact: is your money good.** `tintFor()` resolves ledger
bet → pick'em pick → neither; green covering, red not, amber inside a field goal,
team colours when you have nothing on it. Pregame always resolves to team colours
— a position tint requires a live or final score.

That last rule is what makes the obvious objection narrower than it sounds: a
card can never show both vocabularies, so the risk was never *within* a card. It
was two cards in one scroll, and it is real, because half the sport wears red.
Alabama `#9e1b32` vs Georgia `#ba0c2f` washes a pregame card in near-uniform red
two rows above a live card where your bet is losing.

Rendered side by side, the original three separators were not enough — strength
(0.22 vs 0.42) only works when both are on screen, and the two-colour team split
collapses exactly when both teams wear the same hue. So the two vocabularies were
made structurally different instead of merely different in value:

- **Chroma, not brightness.** Team colours are mixed 55% toward `--surface` and
  desaturated to 0.6 (the `.card-final` idiom); verdict colours keep full chroma
  and are now the only saturated glows on the slate. First attempt also dimmed
  them to 0.18 and that erased team identity outright — a Nevada/San José State
  card had no visible colour at all — so brightness went back *up* to 0.30. Dull
  and present separates from signal; dim and saturated does not.
- **Motion means money.** The drift moved off `[data-live="true"]` and onto
  `[data-tint="position"]`. A live game you have nothing on no longer moves; it
  still says "playing" through `card-live`, the live dot and the ticker.
- Colour is never alone regardless: every position-tinted card states the verdict
  in words (`CoverStrip`, `LiveStatusChip`, `ResultChip`).

**Line movement lost its colour entirely.** `MoveIndicator` tinted green when the
market steamed toward the model's side and red away from it, and `Sparkline`
shared the tone. Green/red on this card means one thing, the movement carries no
money, and the colour was borrowing a vocabulary it had no claim on — the audit
called it semantic-free and it was. Arrow, magnitude and shape stay; the
model-lean read survives as title text, so `MoveRead.vsModel` keeps a consumer.

Live odds on live cards stay out: they are never captured mid-game, so there is
nothing to render. Data gap, not a UI gap.

**The bubble tier then had four amber signals at once** — a solid amber cover
strip, an amber card ring, the new amber aura, and the words "ON THE BUBBLE ·
a FG flips it". The wording went, and the strip stopped shouting.

The word now tracks the *sign* rather than the tier, so it says the thing colour
cannot: which side of the number you are on. Green **COVERING** with no figure is
comfortable; amber **COVERING +½** is a knife edge. The tier is unchanged and
still drives the aura, `.card-bubble` and `liveUrgency`'s sweats-first sort — it
just stopped being restated in words. `sub` drops to null for spread picks only;
the totals branch keeps its room label ("3 pts of room", "Over hit"), which is
information rather than a tag.

`.cover-bubble` also gave up its solid fill for the same coloured-text + soft
gradient + 3px edge bar the other two tiers use, which deleted the hardcoded
`#1c1405` that existed only to be legible on that fill.

That fill was doing accessibility work nobody had noticed. Removing it dropped
the amber text to **3.13:1** in light mode, and measuring the rest found the
whole family already under the 4.5:1 that 13px text needs — covering 4.01,
losing 4.12. All three are now mixed toward `--text` in light mode only, landing
at 5.23 / 5.40 / 4.80 with the hue and the tokens intact. Dark mode was always
fine (6.53 / 4.64 / 7.30) and is untouched. Bubble was first taken to 6.35, which
turned the amber olive; 72% accent keeps it gold and still clears the bar.

Measured, not assumed: 60fps at 14 cards and 61fps at 67 (10 of them animating),
Chromium at 390×844. No model parameter was touched — watchability is tuned by
feel per spec §7, not fitted by `backtest.ts`, so the gate in `AGENTS.md` does
not apply.

### Aug 7 — Off/Def back on the ratings page, behind the honesty gate

The audit reconciliation surfaced this: pulling the Off/Def columns was right
when the pipeline wrote `overall/2` twice, but the halves have been real since
2026.3.0 and were never restored, so `/ratings` under-reported what the model
knows. They're back — with the condition that made removing them correct in the
first place still enforced.

`splitInformative` decides, the same function that decides whether a projected
total is a prediction or a constant. Two identical halves are one measurement
printed twice, whatever the model version says, so the columns hide rather than
fabricate a pair. Hiding is the honest state, not a degraded one, and the page
says so in plain words instead of leaving a silent gap.

**This is live-correct today and will change on its own.** All 138 week-0 rows
in production sit at `offense == defense` exactly (max gap 0.000, version
2026.2.0), so the columns are hidden right now. They appear the morning the
preseason refresh lands 2026.4.0 with the 0.4 tilt carry — no deploy, no toggle.

Details worth keeping: Off and Def are signed (`+12.0`, `-3.0`) because they are
deviations from average, while Rating stays unsigned because it is a position.
Rank stays keyed to overall no matter which column is sorted. The cells are
positional, so a test pins header-to-cell alignment in both modes — adding a
header without its cell would shift every number one column left, silently.

Not done, by request: futures tracker (#40), generated db types (#44), ⌘K (#45)
and OG share images (#46) stay open. They are additive features, not defects.

### Aug 7 — the audit, reconciled

`audit/AUDIT-2026-08.md` had 18 numbered bugs and a 46-item checklist, all showing
`[ ]` months after most of the work shipped. Each was re-decided by reading the
code on `main` at `b500309` — not the commit message that claimed to fix it.

**Bugs: 16 of 18 resolved, one open (now fixed), one resolved with a remainder.**
**Checklist: 36 done, 6 partial, 4 open.**

The partials are the point. Rounding them up to done is how a checklist stops
being worth reading, so each names the piece that is missing: BetForm has no game
search (31), `build-preseason.ts` still hardcodes `SEASON = 2026` (36), PWA push
was never built (38), there are no route smoke tests (42), and no
`opengraph-image` route exists (46). The four fully open items — futures tracker
(40), generated db types (44), ⌘K (45), OG images — are additive features, not
defects.

**Bug #15 was genuinely open and is fixed here.** `Sparkline`'s doc comment
claimed it colored its stroke win/loss by direction; it used `currentColor` and
`GameCard` rendered it inside a `text-dim` row, so the movement was invisible and
the comment was false. It now takes `vsModel` and shares `MoveIndicator`'s tone.

Direction alone is deliberately still not colored. Green for "the line moved
toward home" would invent a valence that doesn't exist — green has to mean
*good*, and there is no rooting interest until the model takes a side. `vsModel`
(is the market steaming toward or away from our lean?) is the read that means
something, so the sparkline and the arrow beside it now agree instead of one
being decoration. With no read it renders `text-chalk/55` — legible, uncommitted.

One live remainder worth knowing: dropping the Off/Def columns from `/ratings`
was right when they were `overall/2`. They have been real since 2026.3.0 and were
never restored, so the page under-reports what the model knows.

### Aug 7 — CLV, and a sign that was backwards

The edge investigation demoted the model's leans from bets to information, which
left the product with no in-season scoreboard: the ATS record was the measure
while the leans were bets, and nothing replaced it. CLV is the replacement, and
it is the better question anyway — not "did the model win" but "did the market
come toward the model after it committed". It converges on one season where a
win rate needs several, and it can express the result the backtest actually
found: a losing ATS record alongside positive CLV.

**A pre-existing bug, found on the way in.** `jobs-core.ts` stored CLV for user
picks and bets with the sign inverted — in all four branches (home, away, over,
under), with no test on any of them. `backtest.ts` had it right, which is how the
disagreement surfaced. Concretely: bet home −3, line closes −6, you laid three
where the close lays six — that is +3, and the code stored −3. The Ledger, Crew
and Recap pages would have rendered a bettor who consistently beat the close in
red. **No data was corrupted**: zero picks and zero bets had been graded when the
fix landed, so nothing needs backfilling.

- **`src/lib/clv.ts`** — one implementation, used by picks, bets and the model.
  Spreads and totals run in opposite directions (a home backer wants the number
  down, an over backer wants it up), which is exactly how the sign gets lost, so
  the four cases are each stated in bettor's terms in the tests before the
  algebra. Negation is `-0`-safe: `-0` reaches Postgres and renders as "−0.00".
- **`predictions.open_spread` / `close_spread` / `clv`** (migration `0019`).
  The freeze job captures the opener; the Sunday grader writes the close and the
  value. Frozen prediction fields are never rewritten — the grader touches only
  the two columns that did not exist at freeze time. `predictions` stays
  append-only for users: table-level UPDATE was already revoked, which covers
  new columns, and that was verified against the live database rather than
  assumed.
- **Receipts** gains a CLV stat beside the three calibration stats and a
  per-game CLV column, with the reason it is the honest measure stated on the
  page rather than left implicit.

CLV is graded over every lean, not just flagged edges: flagging at |edge| ≥ 2
discards most of the sample, and CLV is measurable on any disagreement. A game
with no closing line is left ungraded rather than banked as 0, so a later lines
backfill can still pick it up — a stored 0 would read as "dead even".

One trap worth naming: `consensusFromSnapshots` computes the opener as
`spread_open ?? spread`, so a select that forgets `spread_open` does not error —
it silently reports the current line as the opener and every `open_spread`
becomes a copy of `vegas_spread`. The column list is now a shared exported
constant with a test pinning it, and a second test demonstrates the fallback so
the failure mode is visible rather than folklore.

Not fixed: `supabase/functions/jobs/index.ts` still carries the inverted
formula. It remains dead, undeployed and drifted, and patching one line would
imply it is maintained. Noted here so anyone reviving it knows.

### Aug 7 — the preseason load, automated

Merged PR #12 as `97c5a6a`. A **merge commit, not a squash**: the table below
cites 22 branch SHAs, and squashing would have left every one of them dangling.

Checking production after the merge turned up the gap the PR description had
only half-stated. `ratings` in the database are stamped `2026.2.0` while the code
is `2026.4.0` — the site has been serving a model from before the tilt carry, the
churn restructure and the HFA fix. `team_hfa` averages 3.607, consistent with
`0.5·raw + 0.5·2.3`. None of the merged work was reaching anyone.

Nothing was *broken*: the `hasCalibratedTotals` gate correctly suppresses totals
on those stale rows, so the site was showing less rather than showing wrong. But
the only path to fix it was a human running `build-preseason` and then
`load-json.ts` once per emitted file with a service-role key in their shell.

- **`scripts/load-preseason.ts`** — loads a build directory in one command.
  Order comes from the emit counter parsed as an integer, not from a hard-coded
  table list (which would silently skip a table added later) and not from a
  lexical sort (which puts `100-` before `99-`). `predictions` and
  `line_snapshots` have identity PKs, so an upsert appends a second copy rather
  than replacing — the same shape as the freeze-horizon bug — and the refresh
  path skips them; `--bootstrap` is the once-per-season exception. A load into a
  season with final games is refused outright: at that point week-0 ratings are
  history and `ratings-update` owns the current ones.
- **`preseason-refresh` / `preseason-bootstrap` job tasks**, plus a daily 11:00
  UTC cron across Aug 1–27. `--check` is the gate: it exits non-zero while any
  input is still falling back, and the job stops there rather than shipping a
  rating built on last year's talent. So the outstanding "2026 talent is
  unpublished, re-run `--check` before Aug 26" item now resolves itself — the
  job retries every morning and loads on the first day the data is real.

A declined refresh exits 0. Most mornings in August the honest answer is "not
yet", and a job that goes red every day for three weeks is a job nobody reads.
The standalone `preseason-check` task keeps its non-zero exit for when you ask
the question deliberately.

### Aug 7 — model correctness and the edge verdict (PR #12)

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

- `3ce9253` — full product audit (`audit/AUDIT-2026-08.md`, 739 lines, 18 numbered
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

> **The actionable list moved to `docs/STATUS.md` (2026-08-12)** — every open
> item in the repo, with its ID, evidence and date, in one place. What stays
> here is the model-and-data state a changelog reader needs in context. Two
> items that lived *only* in this section's prose — re-running `--tune-churn`
> after the portal fix, and dispatching `observe-scoreboard` over the openers —
> are now tracked rows there instead of paragraphs here.

- **CLV has no data yet.** Built and migrated, but the first values arrive the
  Sunday after Week 1 — the grader has nothing to grade until games are final.
  The path is unexercised against real rows until then.
- **Production is four model versions behind.** `ratings` in the database are
  `2026.2.0`; the code is `2026.5.0` (`src/model/ratings.ts`). Everything
  since — the tilt carry, the churn restructure, `baseHfa` 3.0, the centered
  team-HFA blend, the tier recentre — is dark until a rebuild lands. Until it
  does, production is pricing every cross-classification opener ~10 points
  toward the G5.
- **2026 talent is unpublished**, which is what the rebuild is waiting on —
  **and it is the only thing.** Confirmed against the Aug 17 11:15 UTC run:
  `--check` prints one line per failing gate and printed one. Returning
  production, portal, coaches, week-1 lines and the tier recentre are all live,
  and the build reaches a full 138-team board on the 2025 talent file before
  refusing to load it. `build-preseason` silently falls back to 2025, so a
  build today would carry **no incoming recruiting class**. `--check` catches
  this and refuses; the daily `preseason-refresh` job retries until CFBD
  publishes. **No manual step is required** — but if it is still red by ~Aug 26,
  that is worth looking at — except it no longer waits for anyone: **Q1 was
  answered yes on Aug 18 and dated into the job**, so from Aug 22 the daily
  refresh loads the best build available instead of declining. `preseason-force`
  does it sooner by hand.
  Since Aug 18 `cfbd-probe` also prints a row count per preseason input, so
  which feed is late is a number on the run rather than an inference from a
  fallback message.
- ~~**`supabase/functions/jobs/index.ts` is dead and drifted**~~ — **deleted
  2026-08-13** (Q7). This entry said it was "left untouched deliberately" and
  went stale the day the file went: it had inverted CLV in all four branches
  and was 4+ versions behind `scripts/lib/jobs-core.ts`, and a tombstone with a
  live landmine in it is worse than none. Git preserves it.
- **The matchup split has only been seen with a synthetic second member.** The
  Aug 9 render check used a throwaway "Jeff" profile; the geometry, the lean bar
  and the graded chips are verified, but nobody has looked at the card with two
  real names and a full week of picks in it. Worth a second look after the first
  real Saturday.
- **The blind reads `start_ts`, not status.** `picks_revealed` (the RLS rule)
  and `blindFor` (the page) both ask whether kickoff has passed. A game whose
  `status` goes final while its `start_ts` is stale therefore stays hidden — the
  Aug 9 fixture hit exactly that. Left as-is on purpose: `start_ts` is the
  single source of truth for the lock, and a second one in the security boundary
  is worse than the edge case. Only bites if the schedule feed and the score
  feed disagree.
- ~~**`#5b6472` is hardcoded as a colour fallback in six places.**~~ **Closed
  2026-08-10** by `UX-15`. It now appears only in `globals.css` as the
  light-mode definition of `--push`, which is where it belongs; every component
  fallback reads `var(--push)`.
- **Three audit items remain open**, all additive: futures tracker with weekly
  mark-to-market (#40), generated db types (#44), ⌘K quick-switcher (#45). OG
  share images (#46) closed on 08-10. Five more are partial. All eight, plus
  everything else outstanding, are in `docs/STATUS.md` §5.
- **Off/Def are built but dark**, for the same reason everything else is: the
  production ratings are still 2026.2.0 with even splits. The columns appear on
  their own once the preseason refresh lands.
- Untested model ideas that remain plausible: pass/rush splits, special teams and
  field position, QB modeling from player PPA (currently one boolean),
  re-expanding the compressed within-pool rating spread (our SD ~8 vs SP+'s
  ~10.5–11 — measured Aug 12, deliberately not patched), and letting the FCS
  anchor follow the recentred G5 pool (its −30 was calibrated against the old
  level; ~1–1.5 pts of September pull-back is the accepted cost).

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
--tune-tier-recenter # validate the week-1-anchored P4/G5 recentre (2026.5.0)
--diagnose-edges    # market MAE + encompassing regression (the edge gate)
--diagnose-tiers    # cross-classification level vs prior-chain construction

# The 2026 week-1 market gate for the tier level (candidates side by side)
npx tsx scripts/diagnose-tiers-2026.ts --examples

# Preseason — build
npx tsx scripts/build-preseason.ts --check          # readiness; non-zero exit when inputs incomplete
npx tsx scripts/build-preseason.ts --out DIR --top 40

# Preseason — load (FK order from the filename counter; refuses a season
# that has already played, unless --force)
npx tsx scripts/load-preseason.ts --dir DIR --dry-run   # print the plan, write nothing
npx tsx scripts/load-preseason.ts --dir DIR             # refresh: skips predictions + line_snapshots
npx tsx scripts/load-preseason.ts --dir DIR --bootstrap # first load of a season: everything
```

`predictions` and `line_snapshots` have identity primary keys, so an upsert
appends instead of replacing. A second `--bootstrap` duplicates them — which is
why the refresh path skips them and why `--bootstrap` is never scheduled.

**CI** — `backtest.yml` runs the calibration report and `--diagnose-edges` on
every PR touching `src/model/**`, `scripts/backtest.ts`, `scripts/lib/replay.ts`
or `scripts/lib/coaching.ts`. `ci.yml` runs lint/typecheck/test/build on every
PR. `jobs.yml` carries the scheduled data jobs plus the `preseason-preview`,
`preseason-check`, `preseason-refresh` and `preseason-bootstrap` dispatch tasks.

`preseason-refresh` also runs on a daily 11:00 UTC cron across Aug 1–27. It runs
`--check` first and loads nothing unless every input is live, so it is safe to
let it retry unattended; a declined run exits 0 rather than going red every
morning for three weeks. The window stops on the 27th because openers are the
last weekend of August — after that the ratings belong to `ratings-update`, and
`load-preseason.ts` refuses a season with final games anyway.

**Note on workflow runs:** PRs opened by an app token do not trigger Actions.
Closing and reopening the PR as a human does.
