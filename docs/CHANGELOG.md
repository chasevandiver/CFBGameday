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

**`MODEL_VERSION` 2026.4.0** (`src/model/ratings.ts`), on `main` via PR #12
(2026-08-07).

⚠️ **In the code, not yet in production.** As of 2026-08-07 the database serves
`ratings` at **2026.2.0** — the site is running a model three versions behind
this table. `team_hfa` rows are derived from `baseHfa` at build time, so the
`2.3 → 3.0` fix in particular does nothing until `build-preseason.ts` is re-run
and reloaded.

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

- **CLV has no data yet.** Built and migrated, but the first values arrive the
  Sunday after Week 1 — the grader has nothing to grade until games are final.
  The path is unexercised against real rows until then.
- **Production is three model versions behind.** `ratings` in the database are
  `2026.2.0`; the code is `2026.4.0`. Everything since — the tilt carry, the
  churn restructure, `baseHfa` 3.0 — is dark until a rebuild lands.
- **2026 talent is unpublished**, which is what the rebuild is waiting on.
  `build-preseason` silently falls back to 2025, so a build today would carry
  **no incoming recruiting class**. `--check` catches this and refuses; the
  daily `preseason-refresh` job retries until CFBD publishes. **No manual step
  is required** — but if it is still red by ~Aug 26, that is worth looking at,
  because the openers are Aug 29.
- **`supabase/functions/jobs/index.ts` is dead and drifted** — never deployed,
  and behind `scripts/lib/jobs-core.ts`. Left untouched deliberately.
- **Four audit items remain open**, all additive: futures tracker with weekly
  mark-to-market (#40), generated db types (#44), ⌘K quick-switcher (#45), OG
  share images (#46). Six more are partial — see the status tables in
  `docs/AUDIT-2026-08.md` for exactly which piece each is missing.
- **Off/Def are built but dark**, for the same reason everything else is: the
  production ratings are still 2026.2.0 with even splits. The columns appear on
  their own once the preseason refresh lands.
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
