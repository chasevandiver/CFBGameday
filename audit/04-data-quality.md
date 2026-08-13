# 04 — Data Quality of the 2026 Preseason Build

**Scope:** `scripts/build-preseason.ts`, `src/lib/cfbd.ts`, `scripts/lib/coaching.ts` (+ test),
`src/model/ratings.ts` (preseason/churn/luck), `scripts/load-preseason.ts`, `.github/workflows/jobs.yml`,
and — because the preseason ratings ARE the product on Aug 29 — the **live production database**
(project `the-cfb-slate`, read-only SQL, queried 2026-08-09).

**Summary.** The PR #12 fixes are real and verified in code: returning production is now a single,
honestly-labeled offense-only term; the talent field mapping reads CFBD's `team` key; `--check` gates
the load; the daily `preseason-refresh` cron retries through Aug 27. But the production database tells
a sharper story than the prompt assumed. The live ratings are **2026.2.0**, and in that build
**0 of 138 teams matched any returning-production row** (verified by SQL below; confirmed by the
`ebf1836` commit message: "CFBD has not published 2026 returning production yet"). So the infamous
mis-mapped defense term never actually distorted production — it had nothing to distort. What is live
today is arguably worse to describe out loud: a "roster churn" number that is **literally the
transfer-portal star tally and nothing else** (Ohio State and Oregon both sit at churn = −4.00, the
portal term's own clamp), zero coaching, a luck term, and two brand-new FBS programs
(Sacramento State, North Dakota State) rated at exactly the hardcoded −8 talent fallback — which is
not a floor: it places Sacramento State **94th of 138, ahead of ~45 real FBS programs**. The `--check`
gate that decides when the 2026.4.0 refresh auto-loads has real holes: it detects a *fully absent*
talent file but waves through a *partial* one, and it counts nothing about the −8 defaults at all.
On the headline question: the churn adjustment's own tuning numbers say it is statistically
indistinguishable from no churn at all; §5.1's "biggest structural edge" is a hypothesis the shop's
own edge diagnosis has, if anything, already falsified.

---

## Findings table

| ID | Severity | Type | Status | One-line | Evidence |
|---|---|---|---|---|---|
| DQ-1 | **P0** | data state (stale build) | STILL OPEN (refined) | Production serves 2026.2.0: churn = portal stars only (0/138 returning-production matches), coaching 0, HFA 2.3-derived, new FBS entrants at the −8 constant | live DB (`ratings.model_version`, `preseason_components`); `docs/CHANGELOG.md:33-41` |
| DQ-2 | **P1** | bug (silent failure) | NEW | `--check` passes a *partially published* talent file; nothing anywhere counts teams that silently defaulted to −8 | `scripts/build-preseason.ts:152-158,253,363-385` |
| DQ-3 | P2 | design weakness | NEW | Talent fallback is a global constant −8, not a conference/classification mean; it also inflates the churn reload multiplier ×1.44 for exactly the teams whose talent is unknown | `scripts/build-preseason.ts:253`; `src/model/ratings.ts:276-280` |
| DQ-4 | — | bug | **FIXED-verified** | Returning production: one `percentPPA` term, matching CFBD's declared payload (no defensive split exists); absent row → neutral 0.6 and gated | `scripts/build-preseason.ts:258-269`; `src/lib/cfbd.ts:130-146`; `src/model/ratings.ts:231-247` |
| DQ-5 | P3 | bug (mislabel) | NEW | `usage` (an offense metric) is still stored in a column named `returning_prod_def`; nothing reads it today, but the trap that caused the churn bug is preserved in the schema | `scripts/build-preseason.ts:316,567`; `supabase/migrations/0001_core_schema.sql:142` |
| DQ-6 | P2 | design weakness | STILL OPEN | `qbReturns` is a ≥0.5 passing-PPA-share threshold, not a roster fact; wrong sign for transfer-QB upgrades and returning injured starters | `scripts/build-preseason.ts:264`; `src/model/ratings.ts:246,282` |
| DQ-7 | P3 | spec divergence (documented) | STILL OPEN | `olReturningShare` hardcoded 0.5 → the spec's "OL ~1.5x" term is exactly 0; documented in the emitted detail JSON | `scripts/build-preseason.ts:265`; `src/model/ratings.ts:283`; `docs/SPEC.md:45` |
| DQ-8 | P3 | spec divergence (undocumented) | NEW | `blueChipFreshmen` hardcoded 0 → term exactly 0, but **not** listed in `detail.proxies` (unlike ol_share and turnover_margin) | `scripts/build-preseason.ts:267,569` |
| DQ-9 | P3 | design (inert **by design**) | verified | Coaching term is 0 for every team because `newHcIntercept`/`newHcSlope` are 0/0 — an evidence-based identity (tuner unconverged at grid edge), logged at build time, not silently broken | `src/model/ratings.ts:58,178`; `scripts/build-preseason.ts:319-323`; `docs/CHANGELOG.md:79` |
| DQ-10 | P3 | latent gap | NEW | Coach-change detection is gated only on `newHires === 0`; a *subset* of 2026 coach rows passes the gate while missed transitions are warned, not gated (harmless while the term is 0, wrong the day params are fitted) | `scripts/build-preseason.ts:287-288,324-330,370`; `scripts/lib/coaching.ts:197-217` |
| DQ-11 | P3 | spec divergence (documented) | STILL OPEN | `turnoverMargin: 0` hardcoded → both turnover branches of the luck rule are dead code; second-order-wins and one-score branches are live (136/138 nonzero in prod) | `scripts/build-preseason.ts:278`; `src/model/ratings.ts:353-354`; `docs/SPEC.md:52` |
| DQ-12 | P2 | spec divergence | NEW | Portal scoring is star counts (`stars ?? 2`), not the spec's "prior-school production and level / snaps lost" — and it is currently the **only** live churn input in production | `scripts/build-preseason.ts:176-189,266`; `docs/SPEC.md:46` |
| DQ-13 | P3 | verified-safe | NEVER TRUE | `PRESEASON_TILT_CARRY` unset → fitted 0.4 default applies; `""` or garbage → `Number()` gives 0/NaN → tilt silently off, but the `splitInformative` gate stores null totals rather than the constant | `scripts/build-preseason.ts:75,114,532,597,655-658` |
| DQ-14 | P2 | bug (latent) | STILL OPEN (audit #36) | Builder hardcodes `SEASON = 2026` while the loader's "season has started" guard reads `CFB_SEASON` env — set the env to 2027 next year and the guard checks the wrong season while the build still writes 2026 rows | `scripts/build-preseason.ts:60`; `scripts/load-preseason.ts:49,127-135`; `scripts/lib/ingest.ts:6`; `audit/AUDIT-2026-08.md:781` |
| DQ-15 | P3 | bug (local-only) | NEW | `cached()` caches empty responses forever: a local run before CFBD publishes pins `talent-2026.json = []` and never refetches; CI runners are fresh so the scheduled job self-heals | `scripts/lib/replay.ts:92-109` |
| DQ-16 | — | bug | **FIXED-verified** | 2026.1.0/2026.2.0 prediction batches in prod carry `total = 57.0` for all 99 rows each (the constant-total bug, preserved append-only); `hasCalibratedTotals` correctly hides them; the 2026.3.0 batch stores null totals | live DB; `src/model/ratings.ts:54-58` |
| DQ-17 | — | bug | **FIXED-verified** | Talent field mapping (`school` → `team`): pre-2026.2.0 every team silently defaulted to −8, flattening the 30% talent term | `git show ebf1836`; `src/lib/cfbd.ts:148-153` |

---

## 1. What production is actually serving today (DQ-1) — the headline

Read-only SQL against the live project (2026-08-09):

```
ratings:      model_version = 2026.2.0, 138 rows, week 0 only   (code is 2026.4.0)
team_hfa:     avg(blended_hfa) = 3.607  → 0.5·raw + 0.5·2.3, i.e. the OLD baseHfa
preseason_components (season 2026, 138 teams):
  count(returning_prod_off) = 0        ← ZERO teams matched returning production
  count(returning_prod_def) = 0
  coaching_adjustment ≠ 0:  0 teams
  luck_correction ≠ 0:      136 teams
  churn: avg −0.56, min −4.00, max +3.36
  talent_baseline = −8 exactly: Navy, Air Force, Sacramento State, North Dakota State
```

**Refinement of the prompt's fact (b).** The claim "the mis-mapped churn IS what's live" is half
right. Production does predate the PR #12 churn fix — but in the build it is serving, *no* returning
production data existed at all (`ebf1836`'s own commit message: "CFBD has not published 2026
returning production yet"). Under the old formula both offense and "defense" then defaulted to 0.6,
zeroing both ×5 terms, and `qbReturns` was null. So the double-count never fired in production. The
famous symptoms — 28 teams at the ±6 clamp, Alabama ranked 26th — belong to an Aug 7 *development*
build made after the data landed; it was never loaded.

What IS live is a different, quieter failure: **the churn column production shows users is exactly
`clamp(portal_z × 1.5, −4, 4)` and nothing else.** The evidence is on the face of the live table —
Ohio State (rank 2) churn = **−4.00**, Oregon (rank 7) churn = **−4.00**, Northern Illinois (rank
135) churn = **−4.00**: three teams pinned at precisely the portal term's own clamp boundary, which
is only reachable when every other churn input is zero. Alabama sits 18th (churn −1.98, all portal).
Texas Tech is the site's preseason #1 at 20.25.

Arithmetic for a live example — Sacramento State (first-year FBS, no prior rating, no talent row):

```
rating = talentBaseline + churn + luck          (preseasonRating, finalPrev null branch, ratings.ts:222-229)
       = −8 + 0.95 + 0.36 = −6.69  →  rank 94 of 138
```

A program that has never played an FBS season outranks UTEP (−17.47), Charlotte (−20.15), UMass
(−24.52) and ~45 other real FBS teams, on a fabricated constant. North Dakota State: −8 − 1.12 + 0 =
−9.12, rank 108 (its luck is 0 because it has no 2025 FBS games — the one honest zero in the row).
Note the failure the audit brief predicted ("new entrants pinned to a floor") is real but
**inverted**: −8 is not a floor, it is a mid-table gift.

Also verified live: the daily refresh path exists (`jobs.yml:90,125,155-162`), is gated on `--check`,
and a declined run exits 0 by design. Until it lands, everything above is the launch product.
**If `--check` is still NOT READY by ~Aug 26, this becomes a manual P0** (openers Aug 29; the cron
window ends Aug 27; `load-preseason.ts:127-135` refuses a started season).

## 2. The `--check` gate: what it checks, and the holes (DQ-2, DQ-3)

`--check` (`build-preseason.ts:363-385`) runs the full build computation, then tests exactly four
things:

1. `talentIsStale` — but only set when `talent.length === 0` (`:152-158`), i.e. the file is
   *entirely* absent;
2. returning production unmatched for **> 5** teams (`:368-369`);
3. `newHires === 0` — the coach feed is entirely dead (`:370`);
4. **> 15** teams at the ±6 churn clamp (`:371-372`).

What it does NOT check — each of these silently falls back inside the same build it green-lights:

- **Partial talent publication.** If CFBD ships 2026 talent with 100 of ~136 FBS teams (or with a
  renamed school breaking the name join at `:169`), `talentIsStale` stays false and every unmatched
  team takes `talentBaseline.get(team.id) ?? -8` (`:253`). **No count of −8 defaults exists in
  either mode** — the non-check diagnostics (`:387-399`) count missing priors, missing returning
  production, and clamped churn, but never talent defaults. This is precisely the failure class of
  the 2026.2.0 bug (DQ-17: silent −8 for every team) recurring at partial scale, and the refresh
  job **auto-loads to production on the first green morning with no human required to read the
  ranking table** (`jobs.yml:155-162`). Fix is small: count `talentBaseline.has(team.id)` misses
  among FBS teams and fail above a threshold ≥ 1–4 (the service academies may be legitimately
  absent — decide and encode that).
- **The −8 constant itself** (DQ-3). It is global, not conference- or classification-aware
  (−8 = −1.45σ on the z×5.5 scale, clamped ±18 at `:170`). It also feeds the churn reload
  interaction: talentZ = −8/18 = −0.444 → `reload = 1 − 1·(−0.444) = 1.444` (`ratings.ts:276-280`),
  so the returning-production penalty of exactly the teams whose talent is *unknown* is amplified
  44% once returning data flows. Navy and Air Force — real, competent, perennially low-composite
  programs — take the same −8 as a first-year FCS transplant.
- **Partial coach rows** (DQ-10): a school with no 2026 row is treated as intact and *warned*
  (`:324-330`), gated only if the count of new hires is literally zero. ~20–30 FBS jobs turn over
  every year; a feed with half the schools populated passes.
- **SP+ blend coverage**: a team missing from 2025 SP+ silently gets replay-only prior (`:124-130`,
  logged as an aggregate count only).
- **Portal feed empty**: `portalNet` all-zero with the `pStd || 1` guard (`:188-189`) produces
  churn ≡ 0 for everyone, and only check #4 (which needs *clamped* teams) could notice — it
  wouldn't.
- **Lines empty**: week-1 predictions all get `vegas_spread: null`, edge null — silent (`:621-651`).
- **Luck inputs**: games with null `homePostgameWinProbability` fall back to binary W/L
  (`:216-221`) — silent, reasonable, uncounted.

## 3. Input-by-input status

### returningProductionDefense — FIXED-verified (DQ-4), with a residue (DQ-5)

- **Now:** `churnAdjustment` takes ONE `returningProduction` term = `ret?.percentPPA ?? 0.6`
  (`build-preseason.ts:258-264`). The `??  0.6` default equals `AVG_RETURNING` (`ratings.ts:273`),
  so an unmatched team contributes exactly 0 — a neutral, not a bonus — and unmatched teams are
  counted and gated (>5) by `--check`.
- **Against the declared payload:** `CfbdReturningProduction` (`cfbd.ts:130-146`) declares
  `totalPPA/percentPPA` and the passing/rushing/receiving PPA and usage families — every one an
  **offensive** measure. There is no defensive split upstream; there is no real defensive term in
  the model, and the code now says so honestly (`ratings.ts:233-243`). Correctly mapped.
- **Residue (DQ-5):** the build still stores `ret?.usage` under `returning_prod_def`
  (`build-preseason.ts:316,567`; column at `0001_core_schema.sql:142`). Nothing selects that column
  today (verified: `team/[id]/page.tsx:73`, `ratings/page.tsx:59`, `generate-verdicts.ts:72` all
  skip it), but the schema preserves the exact offense-labeled-as-defense confusion that caused the
  original bug. Rename or drop it.

### qbReturns — proxy, with sign-flipping failure modes (DQ-6)

`ret && retPassing !== null ? retPassing >= 0.5 : null` (`build-preseason.ts:264`), worth ±1.0 point
pre-clamp (`ratings.ts:282`). The doc comment claims "primary QB (by prior-season usage) returns"
(`ratings.ts:246`) — the implementation is a share threshold, not a roster fact. Concrete failures:

- **Transfer QB arriving** (the September-edge case par excellence): team loses its starter, lands a
  proven 5-star transfer. `percentPassingPPA ≈ 0.1` → qbReturns = false → **−1**, while the truth
  may be a push or an upgrade. The portal term adds ~+5 stars ≈ +1–2 points, so the net error is
  smaller than −1 but the *QB term itself* has the wrong sign for exactly the teams §5.1 claims to
  price better.
- **Injured starter returning**: a QB who missed 2025 contributes ~0 to 2025 passing PPA → false →
  −1 despite a proven returner (2026's Penn State-style case).
- **False positive**: starter leaves, backup who threw 55% of PPA (mid-season injury seasons) stays
  → true → +1 while the actual QB1 is gone.

Null handling is correct (null → 0 signal). Not gated separately by `--check`, but it rides the
returning-production row so gate #2 covers full absence.

### olReturningShare — hardcoded 0.5, term ≡ 0 (DQ-7)

`olReturningShare: 0.5` (`build-preseason.ts:265`) → `(0.5 − 0.5) × 3 = 0` (`ratings.ts:283`).
Spec §2.1 gives OL ~1.5x weight (`docs/SPEC.md:45`); spec §3 [v2] itself concedes CFBD has no OL
returning-starts data (`docs/SPEC.md:126`). Documented in the emitted `detail.proxies`
(`build-preseason.ts:569`). Inert by documented necessity — fine, as long as no one reads the spec's
weighting as implemented.

### blueChipFreshmen — hardcoded 0, term ≡ 0, and UNdocumented (DQ-8)

`blueChipFreshmen: 0` (`build-preseason.ts:267`) → `min(0 × 0.1, 0.75) = 0` (`ratings.ts:284`).
Unlike OL and turnover margin, it appears in neither the file-header proxy list
(`build-preseason.ts:25-26`) nor `detail.proxies` (`:569`). One-line fix: add
`"blue_chip_freshmen=0"` to both.

### coachingAdjustment — inert BY DESIGN, and the design is documented (DQ-9)

This is the clean case the brief asked to distinguish, and it holds up:

- The machinery is real and tested: `/coaches` fetched 2001→2026 in one call
  (`build-preseason.ts:144-150`), transitions built with camel/snake tolerance, per-year SP+
  centering, most-games-wins attribution for mid-season firings, and point-in-time safety
  (`coaching.ts:66-217`; tests at `coaching.test.ts:34-152` cover each, including
  "no 2026 row → intact, not a guessed hire" at `:146-152`).
- The applied number is `clamp(0 + 0 × quality, −4, 3) = 0` for every team because
  `newHcIntercept = newHcSlope = 0` (`ratings.ts:178,331-340`; `DEFAULT_PARAMS`).
- That zero is **evidence-based**: `--tune-coaching`'s optimum ran to the grid edge (−2.5, then −5
  after widening) with an inert slope — the boundary-optimum diagnostic says the parameter was
  absorbing the "new HC follows a bad season" misspecification the prior already encodes
  (`docs/CHANGELOG.md:79,119-122`).
- It is loudly labeled, not silent: the build prints "adjustment 0 — tuner has not fit newHc params
  yet" (`build-preseason.ts:319-323`) and stores `coach`/`coach_over_perf` in the detail JSON for
  audit (`:570-575`).

Verdict: **not broken — a documented identity**, exactly like `priorSigmaExtra` and `epaWeight`.
Spec §2.1's "New HC = −1 to −3" (`docs/SPEC.md:50`) is therefore a live spec divergence, but one
with a recorded number that killed it. The latent hole is DQ-10 above.

### turnoverMargin — hardcoded 0, half a rule dead (DQ-11)

`turnoverMargin: 0` (`build-preseason.ts:278`) makes both branches
`if (l.turnoverMargin > 8) … if (l.turnoverMargin < -8)` (`ratings.ts:353-354`) unreachable — the
"overachieved via turnover margin" half of spec §2.1's luck rule is dead code; the
second-order-wins core and the one-score-record branch are live (136/138 teams nonzero in prod).
Worked example — 2025 team, +12 TO margin, 9 actual vs 7.4 second-order wins, 3–0 in one-score:
spec expects roughly −(1.6×0.6) − 0.5 (TO) = −1.46 (one-score branch needs n≥5, doesn't fire);
code delivers −0.96. Documented in `detail.proxies` (`:569`). Acceptable v1 proxy; the missing 0.5
is bounded and the clamp is ±3.

### Portal scoring — stars, not production; and currently the whole show (DQ-12)

`const stars = p.stars ?? 2`, net in/out summed by school name, z-scored by RMS, ×1.5, clamped ±4
(`build-preseason.ts:176-189,266`). Spec §2.1 wants incoming transfers "scored by prior-school
production and level" and outgoing "by snaps/production lost" (`docs/SPEC.md:46`). Stars are neither
— and `?? 2` means an unrated walk-on counts as two stars, so volume beats quality: losing four
unrated players (−8) outweighs gaining a 5-star (+5). `CfbdPortalEntry` does carry a `rating` field
(`cfbd.ts:188`) that is finer-grained than stars and is unused. Ordinarily P3 — but per DQ-1 this
term is the *only* nonzero churn input production currently serves, which promotes it: the site's
"churn" column today IS this star tally. No changelog decision row covers the choice.

### talentBaseline fallback — see DQ-2/DQ-3 above

Global −8 constant (`build-preseason.ts:253`), not conference mean; name-join (`:169`) fails silent;
no coverage count in any mode; verified consequences live (Navy/AF/Sac State/NDSU). The 2026-talent
fallback to 2025 (`:152-158`) is length-0-triggered only, correctly flagged by `--check` when it
fires (prompt fact (c) verified), and the daily retry loop is real (`jobs.yml:90,155-162`).

### PRESEASON_TILT_CARRY — verified safe when unset (DQ-13)

`Number(process.env.PRESEASON_TILT_CARRY ?? 0.4)` (`build-preseason.ts:75`). `jobs.yml` sets no such
variable, so the scheduled refresh gets the **fitted 0.4 default — correct**. Degenerate settings:
`""` → `Number("") = 0`; `"abc"` → NaN — both are falsy at the two use sites (`:114,532`), so tilts
silently vanish; `splitInformative` (`:597`) then prices totals as uninformative and stores null,
and the belt-and-braces invariant at `:655-658` throws if a constant total ever tries to ship. Worst
case is silently *missing* totals, never wrong ones. The value used is recorded per-team in
`detail.tilt_carry` (`:575`). No action needed beyond maybe rejecting NaN loudly.

## 4. Headline: is the churn adjustment signal, or noise with a confident number? (§5.1)

Blunt answer: **as a market edge, it is noise; as product hygiene, it earns its keep; and what
production serves today isn't even the real churn term.** Three lines of the shop's own evidence:

1. **The fit says "indistinguishable from zero."** `--tune-churn`: no-churn NLL 0.3964; the old
   shipped setting 0.3968 (worse than nothing); the fitted 6/1.0 setting 0.3940–0.3944. Gain over
   no-churn ≈ 0.002 NLL / 0.19 MAE, **inside 1 SE (~0.25 MAE)** (`ratings.ts:182-196`;
   `docs/CHANGELOG.md:76,129-132`). The likelihood surface was flat across weight 6–10 × reload 1–2
   and the argmin slid to whichever grid edge it was offered — the definition of an unidentified
   parameter. The shipped 6/1.0 is a defensible *interior* choice, and the changelog's own framing
   is the honest one: "a harmful setting was removed", not "churn improved".
2. **Half the inputs are inert or proxied.** Of six `ChurnInputs`: OL ≡ 0 (hardcoded 0.5), blue-chip
   freshmen ≡ 0 (hardcoded 0), QB is a ±1 threshold proxy that mis-signs transfer upgrades (DQ-6),
   portal is a star tally (DQ-12), turnover margin ≡ 0 in the *adjacent* luck term. The load-bearing
   input is one number — `percentPPA`, offense-only — times a fitted weight times a reload
   interaction. That is not "the heart of the preseason work" (spec §2.1's phrase); it is one real
   feature with an entourage.
3. **The edge claim was directly tested and failed.** §5.1 says September roster-churn mispricing
   "pairs with churn analysis — the site's biggest structural edge" (`docs/SPEC.md:161`). The
   encompassing regression gave the model b₁ = 0.035 (t = 0.84) vs the market's 0.987 (t = 22.81);
   flagged edges went 49.2% ATS vs close, n = 1801, below the 52.4% break-even
   (`docs/CHANGELOG.md:82-91`). Every pre-registered tier test failed. If churn conferred a real
   September edge, weeks 1–4 is where b₁ would have shown life. The one genuine crumb — +0.27 CLV
   vs the *opening* line, positive in every bucket — says the market drifts toward the model and
   the close absorbs all of it. The defensible product claim is "our preseason ratings are priced
   before the market finishes learning rosters, and the openers drift our way"; the indefensible one
   is "structural edge". The spec still makes the indefensible one.

And the kicker from Section 1: until `preseason-refresh` lands, the churn number users see is a
portal-star z-score wearing a churn costume — `returningProdWeight = 6` has never multiplied a real
returning-production value in production. A confident-looking number attached to noise is exactly
what the live table is.

## 5. Output sanity-checking (no CFBD key in this environment)

- **No committed build output or fixtures exist**: `git ls-files` shows no `.preseason-json`/JSON
  rows under version control; `.backtest-cache/` is gitignored; `scripts/seed-fixtures.ts` is a
  16-team *fabricated* week-1 slate (`seed-fixtures.ts:1-12`) — useless for rating sanity checks.
  The CI `preseason-preview` task (`jobs.yml:144`) prints the `--top 40` table to the Actions log
  and discards the JSON; past run logs are the only historical build record.
- **However, the live production table was inspectable** (Supabase, read-only) and is quoted
  throughout Section 1 — that is the 2026.2.0 top-25 users see today (Texas Tech #1, Ohio State #2,
  Indiana #3, Notre Dame #4, Georgia #5 … Alabama #18).

**What the owner should run before Aug 26** (locally with `CFBD_API_KEY`, or via the
`preseason-preview`/`preseason-check` workflow_dispatch tasks):

```
npx tsx scripts/build-preseason.ts --check          # must print READY, exit 0
npx tsx scripts/build-preseason.ts --out /tmp/ps --top 40
```

Smell tests to apply to the printed table (`build-preseason.ts:341-356`) — each keyed to a failure
mode found above:

1. **Talent column −8.0 count** (DQ-2/3): grep the full output for `-8.0` in the talent column.
   Expect *at most* the service academies. Sacramento State and NDSU showing −8.0 again means 2026
   talent landed without them and they are still on the fabricated constant. More than ~4 teams at
   −8.0 = partial talent file, do not load.
2. **Churn = ±4.00 exactly** (DQ-1's signature): any team whose churn prints exactly 4.0 or −4.0
   is suspicious — that is the portal clamp, and it dominating means returning production didn't
   join for that team. Churn at ±6.0 for >5 teams = the DQ-4 class of saturation returning.
3. **Talent-rank vs model-rank gaps** (the Alabama test): sort the components mentally — a team in
   the talent top-5 sitting outside the model top-20 (Alabama was 26th under the old bug) with a
   large negative churn is the double-count signature. Also check Ohio State/Oregon: portal-heavy
   blue bloods pinned at churn −4 despite elite rosters.
4. **New FBS entrants**: Sacramento State and North Dakota State should NOT outrank established
   bottom-quartile FBS (UTEP, Charlotte, UMass) unless someone consciously believes that.
5. **`prev 0.0` rows**: the table prints `(p.finalPrev ?? 0)` (`:346`), so a *null* prior renders
   indistinguishably from a true-average 0.0 — cross-check any `0.0` prev against the "N team(s)
   had no prior-season rating" note (`:387-389`).
6. **Coach count**: "N new head coaches detected" should read ~20–30. Single digits = partial feed
   (DQ-10), even though `--check` only trips at zero.
7. **Range/median line** (`:351-356`): range should be roughly +20 to −25 with median near −1;
   a compressed range = a flattened input (the 2026.1.0 talent-bug signature).

---

## For 00-SUMMARY.md

- **P0 (DQ-1)** — Production still serves the 2026.2.0 preseason build: churn = portal-stars-only
  (0/138 returning-production matches, verified in the live DB), coaching 0, HFA from baseHfa 2.3,
  Sacramento State/NDSU at the −8 constant (rank 94/108 of 138). Self-heals only if CFBD publishes
  2026 talent before the Aug 27 cron window closes; **hard calendar check ~Aug 26**, else manual
  build/load decision on stale-talent data. Fix-size: **S** (operational vigilance + a fallback
  decision), already automated in the happy path.
- **P1 (DQ-2)** — `--check` waves through a partially published talent file and counts −8 talent
  defaults nowhere; combined with the unattended auto-load, a partial/renamed talent drop ships
  systematically depressed teams silently (the 2026.2.0 bug class, at partial scale). Fix-size:
  **S** — count unmatched FBS teams in the talent join and fail `--check` above a small threshold;
  print the count in the non-check build too.
- P2 worth batching before Week 2: DQ-3 (−8 constant → classification-aware fallback, **S**), DQ-6
  (qbReturns proxy mis-signs transfer QBs, **M** — needs player-level data), DQ-12 (portal stars vs
  production scoring, **M**; use CfbdPortalEntry.rating as a cheap first step, **S**), DQ-14
  (SEASON hardcode vs env guard mismatch, **S**).
- FIXED-verified for the record: returning-production mapping (DQ-4), talent field mapping (DQ-17),
  constant-57 totals display-gated (DQ-16). Coaching is inert **by design** with the rejection
  number recorded (DQ-9) — do not "fix" it.
