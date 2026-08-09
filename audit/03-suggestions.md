# 03 — What's missing

Separate from defects. Each item: **value** / **cost** / **needs data we don't
have?**

The question behind most of these is the one the prompt posed: *why open this at
11am Saturday instead of a sportsbook app?* A sportsbook has better lines, a
faster app, and more markets. It has no memory of what you said on Wednesday, no
idea who else is on your side, and no interest in whether you were right. That
asymmetry is the whole product, and most of what follows is a way of pressing on
it.

---

## Ship before Week 1

### 1. The daily homepage (`/` by day) — §7, already spec'd
Monday = results + receipts, Wednesday = lines + edges, Saturday = chronological
slate. Everything needed already exists on other pages; `/` currently redirects.
This is the direct expression of the prime directive and it is the cheapest way
to make the site feel like it knows what day it is.
**Value:** the app answers "what matters right now" instead of always answering
"here is the slate." **Cost:** half a day. **Data:** none.

### 2. "You are 2 of 3 picks in — 4 hours to lock"
`min_picks_per_week` ships and is displayed on the board, but only there. A
single line at the top of `/` and `/slate`, counting down to the week's next
kickoff, converts a rule into a prompt. The #1 reason a pick'em league dies in
week 3 is one person forgetting on Saturday morning.
**Value:** highest retention-per-hour item in this list. **Cost:** 2 hours.
**Data:** none.

### 3. A job-health strip on `/admin` (this is F-08's fix, listed here because it's also a feature)
`job_runs` table + "ratings-update: 6h ago ✅ · refresh-lines: 14m ago ✅ ·
freeze: **3 days ago** ⚠". Without it, the answer to "how would anyone find out
if a cron died in week 3" is: they wouldn't, until the leaderboard was already
wrong.
**Value:** turns the entire class of silent data corruption into something
glanceable. **Cost:** 3 hours. **Data:** none.

### 4. Close staleness, shown not hidden
Store `close_captured_at` beside every closing number and render "close captured
11 min before kickoff" or "⚠ 4h 20m before kickoff". Related to F-05, but the
*product* move is the disclosure, not the extra cron: a site whose thesis is
honesty should say when its own measurement is weak.
**Value:** protects the credibility of the one metric everything now rests on.
**Cost:** half a day. **Data:** none — `captured_at` is already stored.

### 5. A one-screen "how to read this" for a new crew member
The prompt asks how someone understands the numbers on day one. Right now
`/rules` explains the league and nothing explains the model. One page: what a
rating is (points vs an average FBS team on a neutral field), why an "edge" is
information and not a bet — with the 49.2% number stated plainly — what CLV
means and why it's the scoreboard, and what "frozen" means on a card.
**Value:** the difference between numbers that persuade and numbers that get
ignored. It is also the honesty layer's missing half: you cannot audit a claim
you don't understand. **Cost:** half a day, mostly writing. **Data:** none.

### 6. Empty states that are about August
It is August 9th. The empty state *is* the app right now, and it will be again
every offseason. Instead of blank tables: "Week 0 kicks off in 20 days. 138
preseason ratings are loaded. Lines post around Aug 20." A countdown and an
inventory of what exists beats a spinner over nothing.
**Value:** the first impression for every crew member you invite this month.
**Cost:** 3 hours. **Data:** none.

### 7. Pick receipt on save
When a pick saves, show "UNC +6.5 locked · Sat 2:30pm · you're the 3rd in".
Failure mode the prompt named — "a pick that didn't save" — is the fastest way
to lose trust in a pick'em, and the current UI's silence after a successful RPC
is indistinguishable from a swallowed error on flaky stadium wifi.
**Value:** removes a whole category of "I definitely picked that" arguments.
**Cost:** 2 hours. **Data:** none.

---

## In-season

### 8. Disagreement digest — the group-chat killer
Wednesday: "4 of you are on Georgia −7. Chase is alone on the under. The model
disagrees with the market on 3 games this week." One block, on the homepage.
The prompt asks what makes the group argue *in* the app rather than in the group
chat. The answer is that the app knows something the chat doesn't: who is
actually on which side, with what number, and what their record on that kind of
pick is.
**Value:** the single strongest reason to open this instead of the book's app.
**Cost:** 1 day. **Data:** none — `MatchupCard` already computes the split.

### 9. One-line comment per pick
Not a chat. One 140-character reason attached to a pick, visible after kickoff
(or immediately, per the group's blind setting). "Backup QB, they're fading."
Sunday it sits next to the result.
**Value:** this is what makes a *losing* week worth logging — the prompt's
question. A loss with a stated reason is a data point; a loss without one is
just a loss. It also feeds the reason-tag audit with prose. **Cost:** 1 day
(one table, one RLS policy mirroring `picks`, one input). **Data:** none.

### 10. "Your week in one card" — Sunday morning
Auto-generated: record, units, CLV, best call, worst call, and the one line that
moved most against you. Shareable via the existing `ShareButton`.
**Value:** the ritual that brings people back on the *dead* day. A losing week
with +0.4 average CLV reads as "you were right about the price" — which is
exactly the story the model's own demotion says is the honest one. **Cost:**
1 day. **Data:** none.

### 11. Moneyline CLV in cents
Spec'd (§5.3), currently null. `ml_home`/`ml_away` are already captured on every
snapshot and already reduced by `consensusFromSnapshots`.
**Value:** closes a stated spec gap; makes dog-hunting measurable. **Cost:**
2 hours. **Data:** none — already stored.

### 12. Line-move alerts on games you're in
"Your UNC +6.5 is now +4.5." Web push, or just a badge on next open.
**Value:** the one thing a sportsbook app genuinely does better today, and the
data to beat it is already in `line_snapshots`. **Cost:** half a day for a
badge, 2 days for real push (needs a service worker — see F-31). **Data:** none.

### 13. Injury/news scan → proposed adjustments (F-10's fix as a feature)
The confirm UI, the RLS, the freeze wiring and the ±14 clamp all exist. Only the
proposer is missing, and `generate-questions.ts` is a working template for the
Anthropic + Zod pattern.
**Value:** the largest unbuilt piece of *model* value in the repo, and it points
straight at the soft market §5.1 names first (backup QBs). **Cost:** 1 day.
**Data:** needs Anthropic web search — available.

### 14. Reason-tag audit, but as a verdict
`/ledger` already computes W-L, ROI and CLV by reason tag. Say the conclusion
out loud once there's a sample: "Your `model_edge` bets are +4.2u on 31 wagers.
Your `feel` bets are −6.8u on 44." §5.3 already promises "most bettors have one
profitable angle and four leaks" — print the leak.
**Value:** the most useful sentence the site can produce about a person.
**Cost:** 3 hours. **Data:** none, but needs ~30 graded bets to mean anything —
which is why it's in-season, not Week 1.

### 15. Weather in the total (F-09's fix)
Fetched, displayed, never priced. Gate with a `--tune-weather` run per
`AGENTS.md`.
**Value:** one of the few remaining edges the data already supports.
**Cost:** half a day incl. the tuner. **Data:** none.

---

## Later / stretch

### 16. Key-number edge flags
Replace `|edge| ≥ 2` with "did we land on the opposite side of 3 / 7 / 10 from
the market". More informative and cheaper. Must clear `--diagnose-edges` first.
**Cost:** half a day + gate run. **Data:** none.

### 17. Per-team tempo (F-19)
Unblocks real pace-aware totals and derivative markets (§5.2). Needs a
plays/game ingest and a tuner run; also requires fixing the `hfa/2`-outside-
`tempoFactor` algebra at `ratings.ts:566-568` at the same time.
**Cost:** 1 day. **Data:** CFBD has it — new ingest.

### 18. Futures tracker with weekly mark-to-market
§5.3, still open from the last audit (#40). Win totals logged in August, marked
weekly against the model's own projected wins.
**Value:** gives the August work a season-long scoreboard, and August win totals
are on §5.1's soft list. **Cost:** 2 days. **Data:** CFBD publishes season win
totals — new ingest.

### 19. Rooting guide (§4)
"You need Clemson to lose and the Iowa game to stay under." Reads from favourite
teams, open bets, and the playoff picture.
**Cost:** 1 day. **Data:** none for the bets half; the playoff half needs #20.

### 20. Playoff race / bowl projections (§4)
**Cost:** 3+ days. **Data:** needs conference tiebreak rules encoded by hand —
no API source. Genuinely expensive; correctly deferred.

### 21. Offline shell (F-31)
A service worker caching the current slate. "A stadium with no signal" is a real
use case for this specific product and it currently shows a blank page.
**Cost:** 1 day. **Data:** none.

### 22. Season-long model-vs-crew scoreboard
Run the model as a 16th member of every group. It is the honest end state of a
model demoted to information: let it be a voice in the argument with a public
record, rather than an oracle with an asterisk.
**Value:** turns the site's most uncomfortable finding — the model doesn't beat
the close — into its most interesting recurring feature. **Cost:** half a day
(the predictions are already frozen and graded). **Data:** none.

---

## Two things I'd deliberately *not* build

- **Real-time chat.** The group already has one. What the app has that the chat
  doesn't is *structure* — a pick with a number, a reason, and a result. #9 and
  #8 capture that; a chat box would just move the group chat somewhere worse.
- **More markets** (props, alt lines, first-half). §5.2 is honest that this is
  real modelling work, not a formula tweak, and the base model does not yet beat
  the close on the two markets it already prices. Adding surface area before
  then is how a site stops being trusted.
