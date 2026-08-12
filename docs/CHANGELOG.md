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

**`MODEL_VERSION` 2026.4.1** (`src/model/ratings.ts`) — 2026.4.0 (PR #12,
2026-08-07) plus the centered team-HFA blend (Aug 10, below).

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

No model change; no decisions-table row. `DEFAULT_PARAMS` is untouched.

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

- **CLV has no data yet.** Built and migrated, but the first values arrive the
  Sunday after Week 1 — the grader has nothing to grade until games are final.
  The path is unexercised against real rows until then.
- **Production is three model versions behind.** `ratings` in the database are
  `2026.2.0`; the code is `2026.4.1` (`src/model/ratings.ts:56`). Everything
  since — the tilt carry, the churn restructure, `baseHfa` 3.0, the centered
  team-HFA blend — is dark until a rebuild lands.
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
  share images (#46) closed on 08-10. Five more are partial — see the status
  table in `docs/AUDIT-2026-08.md` §23 for exactly which piece each is missing,
  and `audit/CHECKLIST.md` for what is actually queued.
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
