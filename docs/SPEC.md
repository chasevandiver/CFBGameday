# The CFB Slate — 2026 College Football Site
## Build Specification (v2 — amended and verified, Aug 2026)

**What this is:** A full-stack college football site for a group of friends who watch everything and bet on it. It combines a prediction model, preseason team intelligence, a Saturday-morning game slate, per-user bet tracking with closing line value (CLV), and a social pick'em layer where each person can develop and audit their own edge.

**Audience:** ~5–15 friends, all heavy CFB watchers and bettors. Mobile-first (phones on couches and in bars).

**Prime directive:** The site should answer "what matters right now?" every time it's opened, and it should run itself via scheduled jobs — not manual refresh buttons.

**Naming:** The site is **The CFB Slate** (formerly working-titled "The Saturday Machine"). Use this name in all UI, branding, PWA manifest, page titles, and docs.

**v2 changes:** This revision folds in verified corrections (API tiers, cron infrastructure, closing-line reality) and fills gaps found in pre-implementation review. Changes are marked **[v2]** where they alter the original document.

---

# 1. Data Sources

| Source | What it provides | Notes |
|---|---|---|
| **CollegeFootballData.com (CFBD) API** | Schedules, scores, rosters, returning production, recruiting rankings, team talent composite, betting lines (multiple books), SP+/Elo/FPI ratings, drive/play data, venue info, live scoreboard | **The backbone.** **[v2] Budget Tier 2–3 ($5–10/mo)** — required because **live scoreboard and weather need Tier 1+**, which is an entitlement, not a quota. *(Amended 2026-08-13: this used to say the free tier's 1,000 calls/mo "won't survive the backtest backfill". It would — a full cold 2023–25 backfill is **16 calls**. Volume was never the constraint; we run Tier 2's 30,000/mo against ~10,000 of expected use.)* |
| **LLM layer (Anthropic API + web search)** | Written team notes, injury/news intel, portal moves, weekly narratives, "three questions" per game | Sits on top of CFBD data. Structured JSON outputs. **[v2]** Use `claude-sonnet-5` via the Batch API (50% off; nothing here is latency-sensitive). Scope the news scan to teams playing that week (~30/day), not all 136 daily — that's the difference between ~$20 and ~$250/season. Total LLM budget: $50–150/season. |
| **Weather API** (Open-Meteo, free, no key) | Game-time forecast: wind, precip, temp per stadium coords | Wind >15mph flags totals. Pull Sat 6am local. **[v2]** CFBD venue lat/long is nullable — keep a manual fallback coordinates table. |
| **The Odds API** (optional upgrade) | Real-time line movement, betting % vs money % splits | **[v2]** Free tier (500 credits/mo) is enough for a dedicated *closing-snapshot* job (~360 credits/season). $30/mo buys real movement history in Phase 2. Requires a team-name mapping table (Odds API names ↔ CFBD school names). |

**Caching rules:** All external API data cached server-side. Page loads never hit external APIs directly. Scheduled jobs (Section 8) do all fetching. **[v2] Hard rule:** exactly one fetcher path (jobs) writes CFBD data to Postgres; nothing else touches the external API.

---

# 2. The Prediction Model

## 2.1 Preseason rating (the prior)

One number per team: points better/worse than an average FBS team on a neutral field.

```
preseason_rating =
    0.70 × final_2025_rating
  + 0.30 × talent_baseline            # regression toward 4-yr recruiting talent composite
  + churn_adjustment                   # see below
  + coaching_adjustment
  + luck_correction
```

**Churn adjustment** (the heart of the preseason work):
- Returning production % (CFBD provides offense/defense splits), weighted: QB continuity counts ~2x, OL returning starts ~1.5x, everything else 1x.
- Net portal impact: incoming transfers scored by prior-school production and level; outgoing scored by snaps/production lost.
- Blue-chip freshman infusion (small effect, mostly depth).
- Typical range: −6 to +6 points.

**Coaching adjustment:** New HC = −1 to −3 (system install cost, varies by hire quality); new OC/DC = −0.5 to −1.5; returning intact staff = 0.

**Luck correction:** Compare 2025 actual wins vs second-order wins (postgame win expectancy). Teams that overachieved via turnover margin (> +8) or close-game records (4-1 or better in one-score games) get regressed down 1–3 points; underachievers regressed up.

**Sub-ratings:** Maintain separate offense and defense efficiency ratings plus a tempo estimate (plays/game) for each team. Overall rating = offense + defense. These feed projected scores and totals.

**[v2] Edge-case rules (new):**
- **FCS opponents:** assigned a generic FCS rating by bucket — `fcsTopRating` / `fcsOtherRating`. FCS teams are excluded from normal rating updates. Without this rule, Week 1 breaks the pipeline. **The bucket** is the FCS team's own average margin against FBS opponents over prior seasons, split at the median of the qualifying population (`src/model/fcs.ts`) — a data-defined split with no free threshold, so the tuner's grid stays two-dimensional. Computed at build time from the replay corpus and materialised on `teams.fcs_avg_margin` (migration 0035), because production holds only the current season and cannot derive it at runtime. *(Amended 2026-08-13. The spec said "two buckets: top-tier ≈ −25, other ≈ −35" for months while the code ran a flat −30 and the two constants were read nowhere — so every fitted parameter in the model was fitted against the flat number. **Both buckets currently ship at −30**, which makes the split machinery real but its output unobservable; `backtest.ts --tune-fcs` carries the pre-registered rule that decides the values, including the branch where the honest answer is "one bucket, on evidence".)*
- **Neutral-site games:** HFA = 0 (CFBD flags neutral site).
- **New FBS entrants / reclassifying teams:** initialized from talent composite alone (no prior-season FBS rating exists).

## 2.2 In-season updating (the learning loop)

After each game:

```
error = actual_margin_capped − predicted_margin
rating_change = K × error        # split between the two teams
```

- **Margin cap:** ±28 points (blowout style points don't triple-count).
- **K-factor:** **0.3**, fitted on a 2023–25 grid. *(This said "start ~0.15–0.20, tune via backtest" until 2026-08-13; the tuning happened long ago and the spec never caught up. Recorded here so it is not re-litigated: the JOINT K/HFA refit preferred K=0.4, which is the **edge of the grid**, and that config bought no margin MAE while degrading win-prob calibration badly — the 0.7–0.8 bucket went from 1.6 points off to 6.2 — and worsened totals MAE 13.09 → 13.19. NLL is one scalar and the product's claims are calibration, totals and margin together. K stays 0.3 with HFA fitted separately. See `src/model/ratings.ts:170-183`.)*
- **Prior decay:** blend preseason prior with results-to-date. Prior weight: 100% week 0 → ~50% week 4 → ~15% week 8 → ~5% by week 12.
- Update offense/defense sub-ratings from points scored/allowed vs opponent-adjusted expectation.

## 2.3 Pricing a game

```
spread = home_rating − away_rating + team_HFA + situational_adjustments
```

- **Team-specific home field:** each team's historical HFA blended 50/50 with the FBS average (~2.3). **[v2]** Computed by a one-time backfill job over 2015–2024 home/away margin residuals.
- **Situational adjustments:**
  - QB out / backup starting: −5 to −7 (manual or LLM-flagged, human-confirmed)
  - Rest disparity (bye vs short week): ±1–2
  - Long travel / body-clock kickoff: −1
  - Weather: wind >15mph reduces total 3–6 pts; heavy precip similar; affects pass-heavy teams more
- **Win probability:** logistic curve, `P(home) = 1 / (1 + e^(−0.101 × spread))`. *(Specced as ≈0.145 and amended 2026-08-13 to the shipped value. The slope is not fitted independently — it is `1.7/σ` at the fitted `marginSigma` of 16.8, so it moves when σ does. `winProbSlope` in `DEFAULT_PARAMS`.)*
- **Projected score:** from offense/defense sub-ratings + combined tempo.
- **Cover probability** vs the actual Vegas line. **[v2]** σ for the margin distribution is *fit during the backtest*, not assumed (expect ≈15–16 for CFB, but let the data say).

## 2.4 Edge flags

- `edge = model_spread − vegas_spread` (home perspective)
- |edge| ≥ 2 → **EDGE** flag; ≥ 4 → **BIG EDGE** flag
- **Consensus flag:** when the model AND SP+ AND FPI AND Elo all disagree with the line in the same direction.
- Display all four systems' numbers side by side on every game card.

## 2.5 Calibration & backtesting (the honesty layer)

- Backtest the full pipeline on 2023–2025 seasons before launch. Tune: K-factor, prior decay, margin cap, HFA blend, regression weights, margin σ.
- **[v2] Bootstrap rule:** seed the earliest backtest season's priors from CFBD historical SP+. **Lookahead-bias guard is a hard requirement:** week-N predictions may only consume ratings/data available before week N. The backtest validates model parameters and calibration vs *stored* lines — it does **not** validate CLV or line movement (no historical intraday movement data exists anywhere; dropped from backtest scope).
- In-season weekly calibration report: do 70% favorites win ~70%? Do flagged edges cover >52.4%? Auto-generated, published on the Receipts page.
- Every prediction is frozen and timestamped when made. No retroactive edits, ever. **[v2] Enforcement, not policy:** append-only `predictions` table written by the Thursday freeze job; the UI reads frozen rows and never recomputes. Every prediction row carries a **`model_version`** — the model will be tuned mid-season, and each prediction must attribute to the version that made it.

## 2.6 What the model is honestly for

Nobody beats the closing spread overall with public data. The realistic goals: (1) be right about *disagreements* often enough, (2) exploit the soft spots (Section 5), (3) give the group a shared baseline to argue with. CLV tracking is the arbiter of whether anyone's edge is real.

---

# 3. Preseason Team Pages (one per FBS team)

The heart of the August product. Each page contains:

1. **Header:** team colors/logo, 2025 record, final 2025 rating, 2026 preseason rating, preseason rank, conference.
2. **Roster Churn Ledger** — departing (with production lost) / incoming (with prior-school stats) / net churn score.
3. **Projected Starting 22 + specialists**, tagged `RETURNING STARTER` / `PORTAL` / `FIRST-YEAR STARTER`, with continuity bar.
4. **Returning production:** offense % and defense % with FBS percentile.
5. **QB Block:** incumbent vs transfer vs open battle; backup quality note.
6. **Trenches Report:** OL returning starts, DL rotation depth.
7. **Coaching:** HC tenure, new coordinators, scheme changes.
8. **Luck Regression Note:** 2025 actual vs second-order wins → "overpriced/underpriced" verdict.
9. **Schedule Map:** all games with projected win probability; model win total vs Vegas → over/under lean.
10. **The Verdict** (LLM-written, model-informed): ceiling, floor, the one thing that decides their season.

**[v2] Data-source reality (biggest scope risk in the spec):** CFBD has **no depth charts, no OL returning-starts counts, no projected starting 22**. Split the page into:
- **Automated tier** (ships first, all 136 teams): churn *score* from returning production + portal entries weighted by prior-year PPA, returning production percentiles, luck note, schedule map, win-total lean.
- **LLM tier** (one-time August batch + admin review queue): starters grid, trenches report, QB block narrative, the Verdict. Generated with web search, reviewed by admin before publish. Prioritize P4 + top-G5 teams; accept gaps at launch. This is the designated slip item — severable without blocking anything else.

Preseason pages freeze at kickoff of week 1 (receipts!) and a live version continues updating.

---

# 4. Regular Season Features

- **Weekly rating updates** (Sunday morning job) with movement tracking.
- **Injury/news tracker:** LLM scans news (**[v2]** scoped to teams playing that week); flagged items proposed as rating adjustments; admin confirms with one tap before they affect lines.
- **Model report card:** weekly ATS record of edge flags, calibration stats, cumulative CLV of model-flagged plays.
- **Pick'em league:** see **[v2] League Rules** below.
- **Rooting guide:** per user's favorite teams — what needs to happen this week.
- **Playoff race tracker:** live scenarios; bowl projections.
- **Line movement:** store opening line + snapshots; show open → current on every card; flag moves ≥ 1.5 pts toward or away from model's side. **[v2]** Openers exist only from when our polling starts; every stored line carries `line_source` + `captured_at`.

## [v2] League Rules (the pick'em rulebook — displayed in-app)

Ambiguity here is the #1 source of arguments in betting groups, so the rules are product:

1. **A pick locks with the line snapshot at the moment it's made** (`line_at_pick`). Line-shopping timing is part of the skill, and it makes per-pick CLV meaningful. Users may hold different numbers on the same game.
2. Picks are editable until kickoff, but **editing re-snapshots the line** to the current number.
3. All pick mutation is enforced at the database layer: no writes where `now() ≥ kickoff_ts`. **[Changed Aug 2026, owner decision]** The crew-wide pre-kickoff blind was removed in migration 0010 — and then, with multiple pools, became **a per-group setting** in 0023: `groups.picks_hidden_until_kickoff`, **default false**, so no existing group changed behaviour. One pool wanting to sweat each other's cards before kickoff is a preference, not a rule. Enforced by the `picks_revealed()` gate in the RLS read policy, which also keeps a TBD kickoff hidden rather than open forever.
4. **Push = no action** (doesn't count in record or units). Postponed/canceled = void. *(Since 2026-08-13 an admin sets those statuses from `/admin`; CFBD publishes no cancellation signal, so nothing else can. The void applies immediately and again on the Sunday grading pass. Restoring a game does not un-void — the line has moved — so members re-pick.)*
5. Season leaderboard: record, units, ROI, CLV. **Tiebreaker: ROI, then average CLV.**
6. Minimum picks per week and units conventions are league settings (defaults: 3 picks/week minimum to stay on the leaderboard, 1 unit per pick unless specified).

---

# 5. Betting Layer

## 5.1 Where CFB markets are soft (permanent "Edges" page)
- G5 games and FCS matchups; weekday MACtion
- September lines before the market learns new rosters (pairs with churn analysis). **[amended Aug 2026]** Originally called "the site's biggest structural edge"; the edge investigation (`docs/CHANGELOG.md`) demoted that claim. The defensible version: our numbers are priced *before* the market finishes learning rosters, and the market drifts toward our side after the opener (avg CLV +0.27 in the 4+ bucket) — not by enough to beat −110, but the disagreement is real and CLV is how we'd know. The value is disagreement selection verified by CLV, not raw accuracy.
- Backup QB situations; big-spread backdoor dynamics; small-conference totals; August win totals

## 5.2 Derivative markets
Price from sub-ratings + tempo: team totals, first-half lines, alternate lines. **[v2]** Requires a pace/half-split model beyond the base sub-ratings — Phase 2, flagged as real modeling work, not a formula tweak.

## 5.3 Ledger (per user)
- Log: date, game, pick, line taken, odds, units, book (optional), **reason tag** (fixed list: model edge, travel/rest, weather, revenge, QB news, feel, tail, fade)
- **CLV per bet** = line_taken − closing_line (your side's perspective).
- **[v2] Closing line definition:** CFBD stores only opener + one current line — **no movement history, no explicit close**. Our closing line = **last snapshot in our own append-only `line_snapshots` table before kickoff**, against a **declared canonical book** (consensus; user's actual book stored as metadata). A pre-kickoff **burst poll (every 5–10 min in the final 90 minutes per kickoff wave)** keeps the closing proxy honest. Totals bets grade vs closing total; moneyline CLV is measured in cents.
- Season dashboard: record, units, ROI, avg CLV, cumulative units curve.
- **Reason-tag audit:** W-L, ROI, CLV *by reason tag*. Most bettors have one profitable angle and four leaks.
- **Futures tracker:** win totals and playoff/champ futures logged in August, marked to market weekly.
- Numbers are unhideable by design. **[v2] Enforcement:** bets are append-only with `voided_at` (no hard deletes) — schema, not policy.

## 5.4 Bet sizing guide
- Fractional Kelly (¼ Kelly), hard-capped at 2 units, displayed on every flagged game.

## 5.5 Market intelligence (Phase 2, needs odds feed)
- Betting % vs money % splits; look-ahead lines.

---

# 6. Game Cards

(unchanged from v1 — header, tale of the tape, unit-vs-unit grid, numbers row, projected score, Three Questions, situational flags, style clash, history/rivalry module, venue effects, fun-trends box walled off from the model, crew corner)

**[v2]** Rivalry/trophy data has no API source — small manual seed table (series, trophy name, streak).

---

# 7. Site Design Language

**Identity:** stadium-scoreboard-meets-ledger. Deep field green (#08251C / #0E3B2C), chalk white (#F4EFE2), goalpost gold (#E8B93D), penalty-flag orange (#E4572E) for edges. Display type: varsity block (Graduate). Body: Archivo. All numbers in IBM Plex Mono. Dense stat tables.

**Navigation:** Week selector as primary nav; score ticker strip; tabs: Slate · Ratings · Teams · Game Cards · Ledger · Groups · Receipts. *(`Crew` until 2026-08-13. One crew became many pools, so `/crew` is a redirect into `/groups` — kept rather than 404'd because the old URL is in people's history and in the ledger's footer copy.)*

**Slate UX:** default sort kickoff time; toggles for watchability / biggest edge / biggest line move; Noon–Afternoon–Primetime–Late groupings; live/final card states; "my picks" filter; local-timezone kickoffs.

**[v2] Watchability defined** (v1 sorted by it but never defined it):
```
watchability = w1·closeness(spread) + w2·(sum of team ratings) + w3·total + w4·stakes(rankings/playoff) + w5·rivalry_flag
```
Weights tuned by feel; displayed as a 0–100 score.

**Ratings UX:** movement arrows, sortable columns, conference chips, sparklines.

**Homepage by day:** Mon = results + receipts · Wed = lines + edges · Sat = chronological slate.

**Quality floor:** responsive to 375px, visible focus, reduced motion, dark theme native.

---

# 8. Operations & Automation

**[v2] Infrastructure correction:** Vercel cron on the Hobby plan is limited to once daily (Jan 2026 change) — it cannot run this table. Vercel hosts the app only.

**[Amended 2026-08-13] All jobs run on GitHub Actions**, not on Supabase pg_cron → Edge Functions. The pg_cron path was written and never deployed; it drifted four model versions behind `scripts/lib/jobs-core.ts` and was deleted, so `scripts/` + `.github/workflows/jobs.yml` is the whole scheduler. The tradeoff Actions brings, and which every schedule below is built around: **cron can lag 5–30 minutes**, so each close pass is scheduled ~40 min before its kickoff wave and a post-kickoff snapshot is never selected as the close.

| Job | Schedule |
|---|---|
| Refresh betting lines | 2× daily for display, plus one close pass ~40 min before each kickoff wave. **[Amended 2026-08-13]** The **burst poll is dispatch-only** — `refresh-lines-burst` exists and is in the dispatch list, and deliberately has no cron (owner decision, Aug 2026: lines barely move intraday, nobody here bets the moves, and the only number that matters is the close, because that is what CLV is graded against). Running it every 5–10 min through every wave would multiply call volume for a number nothing reads. |
| Update ratings from results | Sunday 8am ET |
| Weather pull | Saturday 6am local per stadium |
| Injury/news LLM scan | Daily 7am, scoped to teams playing that week; admin confirms |
| Live scoreboard poll | **[v2]** Every 2–5 min on game days (client polls our DB — no websockets project) |
| Snapshot opening lines | When lines first post |
| Freeze weekly predictions | Thursday night (receipts) |
| Calibration report | Sunday after rating update |

**[v2] Pick locking is NOT a cron job** — enforced in the data layer: mutations rejected and visibility granted by `now() vs kickoff_ts` checks (RLS + server).

**Accounts:** **[v2]** Supabase magic-link auth + invite allowlist table + `admin` role flag. Write locks (picks immutable after kickoff, ledger rules) enforced via **RLS policies**, never client-side. Pick visibility is **per group** (`picks_hidden_until_kickoff`, default false) — see §4 R3.

**Stack (confirmed):** Next.js on Vercel (Hobby) + Supabase Postgres/Auth + GitHub Actions as the scheduler *(amended 2026-08-13 — no Edge Functions, no pg_cron; see the correction above)*. CFBD + Open-Meteo + Anthropic APIs server-side only. Mobile-first; PWA for home-screen install. **[v2]** `season_id` on every table from day one — this is a year-round, multi-season product. Keep raw play-level data out of Postgres (free tier is 500MB; aggregate during backtest).

**[v2] Cost sheet:** CFBD $5–10/mo · Supabase $0 (Pro $25/mo only if needed) · Vercel $0 · Odds API $0 (Phase 2: $30/mo) · LLM $50–150/season. **Total: ~$6–15/mo.**

---

# 9. Calendar Modes

(unchanged from v1: Preseason / Regular season / Championship week / Bowls with opt-out tracker / Offseason portal-carousel mode)

**[v2]** Bowl opt-outs, portal tracker, and coaching carousel have **no API source** — they are editorial/LLM-curated features by design; don't look for an endpoint.

---

# 10. Build Phases

**Phase 1 — MVP (before Week 1, Sep 5; Week 0 is Aug 29):** full scope retained per owner decision, risk-ordered:
- *Week of Aug 5:* schema + RLS, CFBD client, 2023–2025 backfill, backtest + tuning, 2026 preseason ratings
- *Week of Aug 12:* slate page, basic game cards, auth + invite, pick'em (at-pick line snapshot + kickoff lock), ledger + CLV, pg_cron jobs
- *Week of Aug 19:* team pages (automated tier → LLM tier + admin review), three questions, injury scan + confirm UI, freeze + calibration jobs
- *Buffer (Aug 27–Sep 4):* live states, polish. Team-page LLM review backlog is the designated slip item — never the slate/pick'em/ledger.

**Phase 2 — In-season (Sept–Oct):** full game cards, live states + ticker, movement tracking, reason-tag audit, receipts page, sizing guide, derivative pricing (pace/half-split model).

**Phase 3 — Stretch:** odds feed with splits, notifications/PWA push, bowl mode with opt-outs, offseason portal tracker, per-user rating overlays.

---

# 11. Honest Notes (build these truths into the product)

1. The closing line is sharp; the goal is being right about disagreements and exploiting structurally soft markets, verified by CLV.
2. Classic ATS trends are noise — show them for fun, never feed them to the model.
3. Every prediction frozen and timestamped. The Receipts page is a feature, not a liability.
4. Suggested stakes capped; sizing discipline saves more money than model improvements.
5. The ledger is unhideable by design — that transparency is what keeps a group betting site fun instead of ugly.
