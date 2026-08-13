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

**`MODEL_VERSION` 2026.5.0** (`src/model/ratings.ts`) — 2026.4.1 plus the
market-anchored tier recentre in the preseason build (Aug 12, below), which
removes a measured +9.8-point cross-classification lean from the 2026 openers.

⚠️ **In the code, not yet in production.** As of 2026-08-07 the database serves
`ratings` at **2026.2.0** — the site is running a model four versions behind
this table. `team_hfa` rows are derived from `baseHfa` at build time, so the
`2.3 → 3.0` fix in particular does nothing until `build-preseason.ts` is re-run
and reloaded — and the tier recentre likewise only reaches production through a
rebuild.

That reload is now automatic: the `preseason-refresh` job (below) retries every
morning in August and loads on the first day `--check` reports READY. Nothing to
run by hand. See Open items for what it is waiting on.

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
| `fcsTopRating` / `fcsOtherRating` | **−30 / −30** | **Identity** — machinery built, pending `--tune-fcs`. Equal values make the bucket unobservable, so this reproduces the flat −30 exactly. Were −25/−35 from Spec §2.1 and read by nothing. |
| `returningProdWeight` | **6** | Fitted `--tune-churn`, interior point not argmin |
| `talentReloadStrength` | **1** | Fitted `--tune-churn` |
| `priorSigmaExtra` | 0 | **Identity** — tested, rejected |
| `newHcIntercept` / `newHcSlope` | 0 / 0 | **Identity** — unconverged, not shipped |
| `epaWeight` | 0 | **Identity** — tested, rejected |
| `PRESEASON_TILT_CARRY` | 0.4 | Fitted (env var in `build-preseason.ts`) |
| tier recentre | market-anchored | Fitted **rule** `--tune-tier-recenter` (build-time step in `build-preseason.ts`, not a constant — the shift is re-fit to each August's week-1 lines) |

"Identity" means the machinery exists and is tested, but reproduces the previous
model exactly. Each is documented in place so it isn't rediscovered.

---

## Decisions log

Twelve experiments, each with a decision rule fixed **before** the run. Four
shipped; one (`--tune-fcs`) has its rule registered and has not been run yet.

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
| `--diagnose-tiers` (chain grid) | Cross-tier G5-signed edge, wks 1–4: bare chain **+7.08 (t=14.8)**; best variant (0.7·finals+0.3·talent) still **+4.81 (t=10.6)**. On the 2026 wk-1 market all six constructions land **+9.7…+10.4** — incl. α=0 (pure SP+ baseline) and FCS −25/−35. | Rejected as fixes: **no prior-chain construction moves the 2026 number.** `REPLAY_SHARE` stays 0.5 (re-tested, not re-litigated). Root cause isolated to pool-LEVEL regression, not the blend. |
| `--tune-fcs` | **Not yet run** — the flag, the bucket rule and the pre-registered criteria landed 2026-08-13; the run is queued for after Week 0. Closest existing number: `--diagnose-tiers` scored FCS −25/−35 as two of its six constructions and **none of the six moved the 2026 cross-tier figure** (all landed +9.7…+10.4). That was a different question — pool level, not FBS-vs-FCS accuracy — so it does not settle this one, but it is the reason not to assume the spec's values are right. | Pending. Both params ship at −30 (identity), so nothing depends on the answer. Gate 0 is a two-sample \|t\| ≥ 2 between the buckets' vs-actual bias at the flat anchor; failing it ships nothing and answers Q4 **on evidence** rather than by deferral. |
| `--tune-tier-recenter` | Market-anchored: wks 2–4 cross-tier edge (out-of-fit) **+5.41 → +0.78 (t=1.5)**; wks 1–4 bias vs actual **−6.31 (t −4.7) → −1.57 (t −1.2)**; P4vP4 +0.51 unmoved; pooled MAE **13.22 → 13.14**, NLL **0.4994 → 0.4956**; worst bucket 2.7. Static δ=4 matches on 2023–25 but under-corrects 2026 by ~6 (fits: +4.4 '24, +4.7 '25, **+10.4 '26**). | **Shipped (2026.5.0).** All four pre-registered criteria passed; market-anchored chosen over a constant because the offseason P4/G5 divergence is accelerating. |

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

`docs/STATUS.md`, `docs/AUDIT-2026-08.md`. No code.

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
`docs/AUDIT-2026-08.md`'s §16 bug table, its §23 status table, *and* its 46 raw
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
- `docs/AUDIT-2026-08.md` §23 carried its 08-07 reconciliation into 08-10
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

`docs/AUDIT-2026-08.md` had 18 numbered bugs and a 46-item checklist, all showing
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
- **2026 talent is unpublished**, which is what the rebuild is waiting on.
  `build-preseason` silently falls back to 2025, so a build today would carry
  **no incoming recruiting class**. `--check` catches this and refuses; the
  daily `preseason-refresh` job retries until CFBD publishes. **No manual step
  is required** — but if it is still red by ~Aug 26, that is worth looking at,
  because the openers are Aug 29.
- **`supabase/functions/jobs/index.ts` is dead and drifted** — never deployed,
  and behind `scripts/lib/jobs-core.ts`. Left untouched deliberately.
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
