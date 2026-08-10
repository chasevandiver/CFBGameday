# 10 — Gap Analysis: what the spec itself is missing

This workstream asks whether `docs/SPEC.md` is missing things, independent of
build status. Judged against the current repo (2026-08-09), not the early-August
snapshot the audit request was drafted from — several seed ideas turn out to be
partially built already (the Aug 9 groups work shipped a who's-on-which-side
matchup view; `model_version` renders on Receipts). The bias requested — **finish
what exists over starting what doesn't** — is applied hard: of thirteen proposals,
only two are recommended before Aug 29, and both are under an hour of work.

One framing note: the biggest "gaps" found by this audit are not features at all.
They are *operational honesty* gaps — the spec §8 specifies eight scheduled jobs
and zero words about what happens when one silently doesn't run, and it defines a
closing line without defining the policy for a *missed* close. Those two spec
omissions produce the product's worst silent-failure modes (see
`07-ops-observability.md` and `05-clv-and-grading.md`) and they belong in the
spec as requirements, not in a wish list.

## Summary table

| # | Proposal | In spec? | Already built? | Effort | When |
|---|---|---|---|---|---|
| G1 | Responsible-gambling footer + no-money disclaimer | No | No — zero hits for any disclaimer in `src/` | XS | **Pre-Aug-29** |
| G2 | Data-freshness stamps ("lines as of 11:42a") | No (spec gap) | No | S | **Pre-Aug-29** |
| G3 | Job-run ledger + dead-man's switch | No (spec gap) | No (see 07) | M | Pre-Week-2 (P1 via ops workstream) |
| G4 | Stale-close policy: CLV null-with-reason, "CLV unavailable" in UI | Spec defines close, not the miss | Partially (grader nulls; no UI reason) | S | Pre-Week-2 (see 05) |
| G5 | Prediction attribution ("why this number") | No | No | M | In-season |
| G6 | Model changelog page keyed to `model_version` | No | `docs/CHANGELOG.md` exists; Receipts shows version (`src/app/receipts/page.tsx:194`) | S | In-season |
| G7 | Crew-vs-model disagreement roll-up | No | Half: per-game sides view shipped Aug 9 (`src/components/group/MatchupCard.tsx`) | S | In-season |
| G8 | Fade-the-crew tracking | No | No (no graded picks exist yet) | S | In-season, after Week 3 sample |
| G9 | Bad-beat / backdoor-cover log | No | Ingredients exist (`src/lib/slate.ts:328` `atsResult`, scoreboard poll) | M | In-season |
| G10 | Weekly digest (Thursday slate / Sunday receipts) | No | No push infra (PWA push is open item #38) | M–L | In-season |
| G11 | Pick-deadline nudge | Rule #6 exists; nudge doesn't | Display half shipped: "2 of 3 picks in" (migration `0022`) | M (needs push) | In-season |
| G12 | Ledger CSV export | No | No | S | In-season |
| G13 | Season archive UI | `season_id` everywhere by spec | No UI; `build-preseason.ts` still hardcodes `SEASON = 2026` | M | Offseason |

---

## Pre-Aug-29 (the only two)

### G1 — Responsible gambling + disclaimer footer · XS

**What:** One footer line in `src/app/layout.tsx`: no money moves through this
site, entertainment for a private group, 1-800-GAMBLER. **Why this product:** it
tracks real bets in real units for real bettors; the omission is the kind you
only notice when you wish you hadn't, and it costs fifteen minutes. Grep
evidence: no "gamble", "disclaimer", or hotline string anywhere in `src/`.
**Abandon if:** never — there is no downside case.

### G2 — Data-freshness stamps · S

**What:** Every surface showing a line prints when that line was captured; every
scoreboard surface prints last-poll time. The data already exists —
`line_snapshots.captured_at` flows through `src/lib/consensus.ts` — nothing
renders it. **Why this product:** on a betting product, a four-hours-stale
spread presented as current is a correctness failure, not a polish issue; it is
also the only user-visible symptom of the silent job-death failure mode in
`07-ops-observability.md`, which makes it the cheapest monitoring the product
can have — 15 users glancing at a timestamp is a distributed dead-man's switch.
**Spec change:** add to §7 quality floor. **Abandon if:** it can't be done
without layout shift (it can — reserve the space).

## Spec-level requirements the spec forgot (built elsewhere in this audit)

### G3 — Job observability (`job_runs` + absence alerting) · M

§8 schedules eight jobs and never says how a missed run is detected. The
concrete design (a `job_runs` table written by `scripts/run-job.ts`, plus a
scheduled check that alerts when an *expected* run is absent, not merely when a
run errors) is specified in `07-ops-observability.md`. Listed here because it
should be added to SPEC §8 as a requirement — otherwise it will be treated as
optional forever. The GitHub-Actions-scheduler reality (jobs.yml, not pg_cron)
makes this more urgent, not less: Actions crons skip silently under load and are
disabled entirely after 60 days of repo inactivity — an offseason trap this
year-round product will hit next February.

### G4 — The missed-close policy · S

§5.3 defines the closing line as the last pre-kickoff snapshot but never says
what happens when the burst poll misses a game. A Tuesday snapshot silently
graded as Saturday's close produces plausible, wrong CLV — worse than no CLV.
The policy belongs in the spec: **a close older than N hours at kickoff grades
as CLV-null with a stored reason, and the UI says "CLV unavailable (no closing
snapshot)" rather than rendering a dash.** Current code status and the exact
gap are in `05-clv-and-grading.md`.

## In-season (default to after, held)

### G5 — Prediction attribution ("why this number") · M

Expandable breakdown per game: rating differential + HFA (base vs team-blend
share) + each situational adjustment = model spread. **Why:** this group will
argue with the model — that's §2.6's stated purpose — and "the model says −6.5"
is unarguable-with until it decomposes. It is also the fastest in-season
debugging tool: the Week-3 morning a number looks insane, the breakdown says
which component did it. **Why not pre-launch:** frozen `predictions` rows store
outputs, not components; doing this honestly means freezing the decomposition
too (schema change to a table that is deliberately append-only), and doing it
dishonestly (recompute live against current ratings) would show a breakdown
that doesn't match the frozen number — exactly the kind of quiet lie this
product defines itself against. Design the column set now, ship with the first
in-season model retune. **Abandon if:** the decomposition can't be made to sum
exactly to the frozen spread.

### G6 — Model changelog page · S

`model_version` is stamped on every prediction and already rendered on Receipts
(`src/app/receipts/page.tsx:194`); `docs/CHANGELOG.md` is a genuinely excellent
decision log — in a git repo the crew will never open. A `/model` page that
renders the changelog's "Current state" table + decisions log, keyed by
version, makes "the model was 8-3" falsifiable by *which* model. Mostly a
markdown-rendering exercise. **Abandon if:** the crew demonstrably doesn't read
it by November — it costs nothing to keep, so realistically never.

### G7 — Crew disagreement roll-up · S

The Aug 9 matchup card already answers "who's on which side" per game. The
missing halves: (a) a sort/filter for "most split games" and (b) "crew consensus
vs model lean" — both computable from data already fetched on the group week
page. Cheap because the hard rendering work shipped; it's a sort key and a
badge. **Abandon if:** with ≤8 active pickers the "consensus" is 3-2 votes —
check the real group size after Week 2 before building.

### G8 — Fade-the-crew tracking · S

"Is group consensus a contrarian indicator" — a `tallyBy` over graded picks
grouped by consensus-side (the machinery in `src/lib/records.ts:140` is exactly
this shape). Honest, funny, on-brand. **Hold until ~Week 4:** zero graded picks
exist today, and n<50 will produce a confident wrong answer the group will
quote all season. Pre-register the cutoff (e.g. n≥60 decided picks) in the
spirit of the repo's own gating discipline.

### G9 — Bad-beat / backdoor-cover log · M

Auto-detect late cover flips: `atsResult` (`src/lib/slate.ts:328`) evaluated
against the live score each scoreboard poll; a flip inside the final N minutes
of game clock gets logged with timestamp and score. Highest fun-per-line in the
product and pure receipts culture. Needs a small table (game, flipped_at,
from→to, final margin vs spread) written by the scoreboard job — the poll loop
(`scripts/scoreboard-loop.ts`) already sees every transition. **Abandon if:**
poll granularity (2–5 min) proves too coarse to catch flips credibly — check
against Week 1's actual transition data before building UI.

### G10 — Weekly digest · M–L

Thursday (frozen slate + edges) and Sunday (results, receipts, movers). The
group will stop opening the site unprompted by week 3; the digest is the
habit loop. But there is no push channel (PWA push is unbuilt, open item #38)
and no email infra. **Cheapest v1 that matches how this group actually
communicates:** a "copy digest" share-text button (the `src/lib/share-text.ts`
pattern already exists) the commissioner pastes into the group chat Thursday
night — zero infra, ships in an evening, and tests whether the content is wanted
before building delivery. **Abandon the push version if:** the pasted digest
gets no reaction for three straight weeks.

### G11 — Pick-deadline nudge · M

Rule #6's display half shipped Aug 9 (`min_picks_per_week`, migration `0022`:
"2 of 3 picks in" on the board, deliberately displayed-not-enforced). The nudge
half needs a delivery channel, so it inherits G10's dependency and its answer:
fold the "N of you haven't picked" line into the Thursday digest text rather
than building notifications for it.

### G12 — Ledger CSV export · S

A server route streaming the caller's own bets/picks as CSV. People want their
history; it is also the only user-controlled backup of the thing this product
says is sacred, and it quietly de-risks the free-tier backup story
(`07-ops-observability.md`). RLS already scopes the query. **Abandon if:**
never — S effort, permanent value.

### G13 — Season archive · M, offseason

`season_id` is on every table by spec; no UI reaches a past season, and
`scripts/build-preseason.ts:60`'s `SEASON = 2026` hardcode (known partial #36)
plus the seasons-table rollover are the real work. Nothing about this matters
before January. Do it as the first offseason task, when 2026 becomes the test
fixture.

## Seed ideas examined and *not* proposed

- **"Homepage by day"** (Mon results / Wed lines / Sat slate) — already in spec
  §7, so out of scope here; inventory status in `01-feature-inventory.md`.
- **Glossary/onboarding for CLV, edge, units** — real gap for a *general*
  product, but the stated audience is 5–15 serious bettors who know these
  words. A one-line `title`/footnote where "CLV" first appears on Receipts is
  enough; not worth a feature. Revisit only if the group grows.
- **Live odds capture** — the changelog correctly labels this a data gap (no
  mid-game snapshots exist), and in-play pricing is a different product. Phase
  2 of the Odds API integration already covers the honest version.

## For 00-SUMMARY.md

- **P1 · G2 freshness stamps (S)** — only user-visible defense against the
  silent-stale-data failure mode; pre-Aug-29.
- **P1 · G4 missed-close policy (S)** — spec addition + small code change;
  pairs with 05's findings.
- **P2 · G1 disclaimer footer (XS)** — fifteen minutes, do it in the launch
  polish pass.
- Everything else in this file is deliberately post-launch; the spec's real
  gaps are operational (G3/G4), not feature-shaped.
