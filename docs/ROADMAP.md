# The Slate — Every Day of the Season

**What this is:** a vision document — the answer to "how does this become the
site people open every day of the football season?" It is ideas, argued and
sequenced, **not a tracker**. `docs/STATUS.md` remains the only file with
unchecked boxes; an idea from here that gets adopted is added there with an ID,
and until that happens it is not queued. Where an idea already has an ID
(F3, F4/F5/F6, NFL-26, AUTH-3, …), this document cites it rather than minting
a new one.

Nothing here touches the model. The model is gated (`AGENTS.md`), and the
changelog's decisions table already killed most of the obvious model ideas —
see §8.

The document has two parts. **Part I (§1–9)** orchestrates what already
exists — the backlog, sequenced around the daily habit. **Part II (§10–15)**
is what to *add*: ideas sourced from outside — what fans say existing apps
get wrong, and the exact mechanics behind the niche tools people actually
check daily (Immaculate Grid, the Playoff Machine, Scorigami, Guess the
Lines, ESPN Streak, Circa Survivor) — mapped onto data The Slate already
stores.

---

## The thesis: seven days, seven questions

The site's prime directive (SPEC): *answer "what matters right now?" every
time it's opened.* The unlock is that once the NFL landed, **the football week
has a genuine answer all seven days** — the site doesn't need manufactured
content, it needs to lead with the right question per day:

| Day | The question | What answers it |
|---|---|---|
| **Mon** | How did I do? Who won the week? | Graded results, receipts vs. the close, CLV, pick'em weekly winner, survivor casualties — then MNF live at night |
| **Tue** | What moved? | AP/Coaches poll movement + model dissent, ratings deltas, last week's recap |
| **Wed** | What's the board? | Lines posted, picks open, edges-as-information, picks-due status per group |
| **Thu** | Who's playing tonight? | CFB Thursday card + TNF, picks lock at kickoff, the frozen receipts land |
| **Fri** | Who's playing tonight? | CFB Friday card, last call on Saturday picks |
| **Sat** | The slate. | Sixty games, live, chronological, watchability-sorted |
| **Sun** | The other slate. | NFL windows live, survivor sweat, then Sunday grading |

Everything below serves that table. The habit isn't built by more features —
it's built by the site being *right about what day it is*, by one push a day
worth tapping, and by the crew's stakes (picks, bets, streaks, survivor lives)
being visible everywhere. The crew is the moat: nobody opens a stats site
daily, but everybody checks the group chat.

---

## 1. The seven-day rhythm — day-aware home (F4/F5/F6, SPEC §7)

The single highest-leverage build in the backlog, and it's already specced:
*"Homepage by day: Mon = results + receipts · Wed = lines + edges · Sat =
chronological slate."* The hub (`HomeHub`) already exists and already answers
"what have I got riding, where do I stand" — this extends it to lead with the
day's question from the table above, both leagues, before anything else.

Concretely:

- **A "today" block at the top of the hub** that changes by day-of-week and
  season state: Monday it's your graded card and the weekly winner; Wednesday
  it's "lines are up, 3 picks due Saturday, 2 due Sunday"; game days it's the
  live/next-up strip for whichever league is playing.
- **The hub stays a pass-through** (per the Aug 10 decision that made it) —
  this is one block, not a feed. Two seconds to the answer, then you tap
  through or put the phone down.
- Season-state aware from day one: the same mechanism later drives
  championship week, bowls, and the NFL playoffs (SPEC §9 calendar modes)
  instead of hard-coding "Saturday = CFB."

Why first: it converts every existing surface (recap, receipts, ledger,
rankings, groups) into a *daily* reason to open the site without building any
new data. It's pure orchestration of what's already there.

## 2. Stakes and storylines — why today's games matter to *you*

- **Playoff race tracker (F5).** From mid-October, the question behind every
  slate is "what does this do to the race?" CFP picture for CFB; division +
  seeding picture for the NFL (the division data is already in
  `teams.conference` — "AFC West and friends"). Even a first version that just
  badges slate cards with "CFP implications" / "loser is out" changes how the
  slate reads late in the season.
- **Rooting guide (F4).** The site already knows your favorites, your picks,
  your bets, and your survivor life. "Who am I rooting for at 2:30?" is a
  computable answer: *Auburn +3 (your pick), Bills ML (your bet, survivor),
  and you need Baylor to lose for the West.* This is the feature that makes a
  casual crew member open the site on a Saturday they didn't bet.
- **Morning intel (F3).** The injury/news LLM scan is already specced and
  budgeted (scoped to teams playing that week, ~30/day, Batch API). A short
  daily "what changed overnight" read — QB statuses, lines that moved on news
  — is the Tuesday–Friday morning open. This is the one genuinely *new*
  content producer worth building; everything else in this doc recombines
  existing data.
- **Small levers already queued:** biggest-line-move slate sort (F10, needs
  real movement data), ratings sparklines (F9), rivalry/trophy game surfacing
  (data already shipped). Cheap texture that makes Tuesday and Wednesday feel
  alive.

## 3. The crew is the moat — social pressure loops

- **Picks-due social proof.** "5 of 8 in" on the group card beats any
  reminder copy. Pairs with the queued groups first-run pointer (UX-14) and
  the Thursday copy-digest ShareButton (G10-v1) — the digest is how slate
  talk escapes into the group chat and pulls people back in.
- **Crown the winner loudly.** Weekly winners exist; make Monday *about* them
  — hub block, push, and a share card. Losers open the site to argue.
- **Streaks and records.** Pick streaks, best week, season head-to-head — the
  numbers people bring up at the bar. Derivable from graded picks already in
  Postgres.
- **Survivor drama.** Who's alive, who's on the clock, who died Sunday — the
  hub should treat a survivor elimination as a headline, not a row.
- **The honesty features are social features.** The tail/fade audit and the
  Sunday calibration report (07:OPS-8b, queued, needs a season of graded data)
  answer the only argument that matters: *is anyone here actually good?*
  Surfaced weekly, that's a ritual.
- **Discipline:** G7/G8/G11 (crew disagreement roll-up, fade-the-crew, pick
  nudge) stay held exactly as STATUS.md says — they need a pre-registered
  sample of graded picks before they can say anything true. Don't front-run
  the evidence for a social widget.

## 4. One push a day worth tapping

Push is the difference between "site I like" and "site I check daily" — and
it's also where the repo's hardest lesson lives. PUSH-11 (fixed Aug 14): the
crons were declared and the sends were proved, but *nothing proved the cron
reached the push* — zero notifications had ever been sent. The audit README
calls this exact seam out. So:

- **Step zero is proof, not features.** One scheduled push, fired by the real
  scheduler, landing on a real iPhone and a real Android (this is also
  BRAND-4's install pass, and OPS-1b's "who gets the failure email" test).
  Until that's proved, everything in this section is theory.
- **A strict budget: at most one scheduled push per day**, plus live events
  only for games you have stakes in. The per-user, per-kind prefs already
  exist. The Slate is a program, not a sportsbook app (BRAND §16) — the day
  push feels like marketing, people turn it off and the channel is dead.
- **The daily push follows the rhythm table:** Mon "you went 3–2, Marcus took
  the week" · Wed "lines are up, picks due Sat" · Thu–Sun picks-due /
  bad-beat / results-graded, all of which exist as kinds today. Later, upset
  watch: a team you picked/bet/favorited is losing as a big favorite, or an
  upset flips your survivor math.

## 5. NFL fully native (NFL-26 and the parity gaps)

The rhythm argument *is* the NFL-26 answer: Sunday and Monday can't be
first-class days if the NFL has no standings and no recap. Recommendation:
**yes, both carry the NFL** —

- **Standings** is nearly free: the division data already powers the slate's
  conference filter; the page just currently filters `classification = 'fbs'`
  by accident of history, not decision.
- **Recap** already has NFL grading and CLV to read; Monday's "how did the
  crew do" is cross-league in the ledger and should be cross-league here.
- Close the small parity gaps that make the NFL feel like a guest: demo data
  (NFL-6), watchdog coverage (NFL-22), and — if weather is ever wanted — the
  manual stadium-coordinates fallback table SPEC already prescribes for CFB
  covers all 30 NFL venues in one static file.
- **Keep the discipline: no NFL model.** "Scores, lines and bets — not a
  second model" (SPEC §10.5). NFL cards render the market and the absence of
  a lean, and that's a feature: it's the honest version.

## 6. Game-day excellence — the hours people are already here

Live infrastructure is already strong (30s CFB loop, 10s NFL edge function,
Supabase realtime, live win prob, cover-flip detection). What's missing is
*attention routing* across a 12-hour window:

- **"What to flip to."** Watchability is defined (SPEC §7) and already a sort;
  promote it to a live TV-guide strip — the three games most worth watching
  *right now*, by window (noon/afternoon/primetime/late), with the live win
  prob and your stakes badged. Red-zone and one-score-in-Q4 states feed it.
- **Upset watch as a surface, not just a push:** ranked favorites trailing
  late, survivor-relevant games tightening, cover flips as they happen (the
  detection already runs; give it a home beyond the recap).
- This is polish on the existing loop — no new pollers, no cadence changes;
  the scoreboard budget discipline stays exactly as is.

## 7. Growth without becoming a product

The audience is ~5–15 friends by design. "Ultimate" here means *the crew's
whole football life runs through it*, not scale. Still, friction is real:

- **Join-code signup (AUTH-3, shape (b) — the recommendation already on
  file).** A group code both admits you to the site and lands you in the
  group. The commissioner stops typing emails; `/welcome` plus a code becomes
  the entire onboarding.
- **PWA install proved on real devices (BRAND-4)** — the icon on the home
  screen is half the daily habit. The row test vs. DraftKings/ESPN is the bar.
- **Self-serve groups** already exist; with AUTH-3 they compound — anyone in
  the crew can spin up a survivor pool for their office without touching the
  admin.

## 8. What we won't do — the ledger of rejections

The changelog's decisions table is the site's spine; this roadmap inherits it.
Not proposed here, with the numbers that decided them:

| Idea | Why not | The number |
|---|---|---|
| Bet the model's edges | Edges are information, not bets | 49.2% ATS (n=1801) vs 52.4% break-even; encompassing b₁ = 0.035 (t=0.84) vs market 0.987 (t=22.81) |
| Per-play efficiency in ratings | Tested, rejected | 0.010 MAE best case; NLL degraded 0.5005 → 0.5095 |
| Blend in SP+ / weekly Elo | Tested, rejected | 50/50 worse than model alone (−0.069); holdout weight 0.138 vs 0.15 bar |
| Widen early-season σ | Tested, rejected | Wks 1–4 NLL 0.3972 → 0.3992 (worse) |
| Preseason anchors, coaching penalty | Rejected / unconverged | ΔNLL 0.0026 vs 0.003 bar; optimum pinned at grid edge |
| An NFL model | By design | "Scores, lines and bets — not a second model" (SPEC §10.5) |
| Intraday line-move polling | Owner decision, Aug 2026 | Lines barely move intraday; the close is the only number CLV grades against |
| Email capture / public funnel | Declined twice | It's a site you're invited to, not one that markets to you |
| Engagement dark patterns | BRAND §16 | No casino language, no streak-bait, no fake urgency. One honest push a day. |

And two standing constraints: the PWA stays cache-free by design (push only),
and any model idea this roadmap inspires goes through its `--tune-*` gate and
gets its result recorded in the changelog — including "no."

## 9. Sequencing — honest to the calendar

- **Now → Aug 29 (Week 0): nothing from this document.** The blockers own the
  runway — OPS-4, DQ-14, the load rehearsal (09:P-16), the Aug 26 hard
  checkpoint, the Aug 28 freeze. A launch that survives a 60-game Saturday is
  worth more than any feature here.
- **September (Weeks 1–4):** prove push end-to-end (§4 step zero, BRAND-4),
  then the day-aware hub (§1), then NFL standings/recap (§5). By the end of
  September the seven-day table should be real.
- **October:** stakes — playoff race tracker as the races become real (F5),
  rooting guide (F4), morning intel (F3). Social analytics (G7/G8/G11,
  calibration report) turn on only when the graded-pick sample says they can.
- **November:** rivalry week and championship-week mode — the calendar-mode
  machinery from §1 earns its keep; the race tracker becomes the main event.
- **December–January:** bowls with the opt-out tracker, CFP + NFL playoffs as
  first-class modes, season archive and `SEASON` rollover (G13/F18).
- **Offseason:** portal carousel mode (SPEC §9), the season archive as the
  crew's record book, and AUTH-3 so next August the crew onboards itself.

---

# Part II — Beyond the Backlog

Everything in Part I recombines what's built or queued. Part II is the new
material, and it earns its place by research rather than brainstorm: one pass
over what fans and bettors complain existing apps lack (app-store reviews,
complaint boards, tracker comparisons), one pass over the cult-favorite niche
tools to extract *why* people check them daily. Five mechanics kept showing
up, and every idea below is one of them wearing The Slate's data:

1. **A losable asset** — streaks, survivor lives. Protecting something beats
   winning something as a daily trigger.
2. **A spoiler-free shareable artifact** — the emoji grid, the win-prob
   squiggle. The output must be postable to a chat where others haven't
   played yet.
3. **Scoring beyond correctness** — rarity and contrarian credit prevent
   ties, and ties kill conversation.
4. **Manufactured rooting interest** — Scorigami and the Playoff Machine make
   you care about games you have no stake in. That's what fills the dead 60%
   of a Saturday.
5. **A fixed-cadence drop with a name on it** — the SP+ vs. Sagarin natural
   experiment: same-quality math, but one lands every Tuesday with a human
   who argues back, and only that one is an event.

## 10. The daily game layer

The manufactured habit — games that exist only inside the crew, built
entirely from data already in Postgres.

- **Guess the Lines — the Tuesday ritual.** Before the week's lines post,
  everyone submits their own spread for the marquee games; auto-scored
  against the stored opening line; a season-long "sharpest eye" leaderboard,
  separate from pick'em. Simmons and Cousin Sal have run this format for
  eighteen years because it's a skill test with zero risk and immediate,
  precise scoring — you're not betting, you're proving you understand the
  market, which is a higher-status claim. It is the single best fit in this
  document: the lines pipeline already stores the open, the receipts culture
  already believes in being graded, and it gives Tuesday a reason to exist.
- **The Streak — the year-round one.** One curated matchup a day, either
  league (any sport in the offseason); a correct pick extends the streak, a
  miss resets it to zero. ESPN ran this for thirteen years because a
  14-game streak is a possession — people come back to *protect* it, not to
  extend it. Deliberately 365 days: this is the only feature in the whole
  roadmap that survives the offseason by design.
- **Guess the Game — the daily puzzle.** Progressive reveal of a game from
  history (final score → spread → year → conference → teams), same puzzle
  for everyone at 8am, a spoiler-free emoji result string built for the
  group chat, and rarity-style scoring so two people who both solved it
  still have something to argue about. The Immaculate Grid lesson: scarcity
  of attempts plus a shareable failure is what makes a puzzle a habit.

All free-to-play inside the crew, and framed that way — the brand voice
rules hold (no "lock of the week" copy, no casino urgency; BRAND §16).

## 11. Scenario & rooting engines

The Playoff Machine mechanic — agency over anxiety — pointed at the pool
instead of the playoffs.

- **The Pool Machine.** Toggle the remaining slate's outcomes and watch the
  group leaderboard re-sort live, with an auto-generated line per member:
  "you need these 3 results to pass Kevin." The NYT playoff simulator's
  killer feature is that it hands you a watchlist — a reason to care about a
  game you'd otherwise skip. This extends the playoff race tracker (F5,
  Part I §2) from information into agency.
- **Win-the-pool %.** One live number per member that moves as games grade,
  with delta pushes: "your title odds fell 14 points when Texas covered."
  A single number attached to identity beats any standings table — it's the
  screenshot, the argument, and the reason to check back after every final.
- **The rarity radar — crew Scorigami.** Alerts for never-before-seen crew
  events: the first time all eight of you lose the same pick, a member's
  first 6-0 week, a score no game in the DB has ever produced. The Scorigami
  bot's real trick is forecasting the *possibility* mid-game — it turns
  garbage time into must-watch. Same trick, crew-sized.
- **Pool swing charts.** After the day's games grade, an auto-generated
  chart of each member's win-the-pool % through the day — the emotional
  receipt of a Saturday, made to be screenshotted. Win-probability charts
  are retrospective content masquerading as live tools; the share moment is
  post-game.

## 12. Game-day utilities

The validated pain-point wins — the things fans loudly say the big apps
don't do, that The Slate is already positioned to do.

- **Where-to-watch, actually resolved.** "Which channel/service has this
  game" is now a Senate-hearing-level grievance, and no official source
  answers it. `games.tv` is already stored, rendered, and filterable — the
  extension is streaming-service resolution and a crew viewing plan for the
  day: every game anyone has action on, where to find it, conflicts flagged.
- **The whip-around.** CFB RedZone doesn't exist as a TV product (Fox is
  blocking it) — but the data version is buildable today: auto-surface the
  highest-leverage live game right now, from the existing watchability
  score, live win prob, and crew stakes. This sharpens Part I §6 from a
  sorted list into a single always-current answer. *(Adopted 2026-08-20 as
  the Jumbotron's rotation — `/jumbotron`, STATUS R5-A. The ranking recipe
  here is `jumbotronRank` almost verbatim.)*
- **Crew splits before lock.** Ticket % vs. units % across the crew, per
  game, shown before kickoff — "you're with the group" or "you're fading
  seven people." The reason people check betting splits isn't prediction,
  it's self-location; computed from picks and bets already in Postgres.

## 13. Rituals with a voice

The SP+ vs. Sagarin lesson, applied: The Slate already computes honest
numbers on a schedule — what's missing is the *event*.

- **The Tuesday Drop.** The weekly ratings update becomes a named moment:
  fixed time, biggest movers highlighted, the model's dissent from the polls
  stated plainly, and one auto-written paragraph that defends the number.
  Ratings that are argued with get checked; ratings that sit in a table get
  visited twice a season.
- **The Monday Program.** An LLM-written weekly column about *the crew* —
  who won, the bad beats, who's on a heater, whose CLV says it's real, the
  survivor obituaries — generated from graded data by the batch layer that
  already writes team verdicts. On-site section, not a push (a Sunday digest
  push was declined 2026-08-12 — PUSH-5 — and stays declined). No commercial
  app can build this: their content is about the sport; this is about you.
- **The record book.** Automated season awards and all-time crew records —
  best week, worst beat, longest streak, sharpest line-guesser — feeding the
  season archive (G13/F18) so every season ends as a document worth keeping.
  *(Partially adopted 2026-08-20: The Slate Wrapped — `/wrapped`, STATUS
  R5-C — is the per-viewer season retrospective; the crew-wide book and the
  archive remain here.)*

## 14. Supporting builds

Smaller pieces from the earlier pass that enable the above, kept brief:

- **Grade everything the ledger accepts.** `team_total`, `first_half`, and
  `future` are valid bet types today but nothing grades or marks them; add
  grading for the first two and weekly mark-to-market for futures (revisits
  §23 #40/F7, "not built by choice"). Then parlay legs — one ledger row,
  many legs, graded as their AND. The ledger can't be the crew's book of
  record while it can't hold the bets people actually make.
- **The player layer.** Passing/rushing/receiving lines on box scores (CFBD
  player game stats are on the tier already paid for; ESPN's NFL box score
  is free) — the biggest content gap versus the apps the crew still has to
  open.
- **Reactions, not a chat room.** One-tap reactions on bets, picks, and
  bad beats. The conversation stays in the group chat; the receipts get to
  feel it.
- **Calendar feeds.** Subscribe-once .ics: your teams' kickoffs (with TV),
  picks deadlines, survivor deadlines. The Slate inside the phone's
  calendar, no push required.
- **Seasonal pool formats.** Confidence pick'em, bowl pools, CFP + NFL
  playoff brackets, and Super 6-style six-question slates with a rollover
  pot — free-to-play, brand-voice compliant. December and January get their
  own games.

## 15. Sequencing the additions

Nothing before Aug 29 — same rule as Part I. Then, interleaved with Part I's
waves:

- **September:** Guess the Lines and the Tuesday Drop — the two cheapest
  ritual wins, both pure orchestration of the lines and ratings pipelines.
- **October:** the Pool Machine, win-the-pool %, and crew splits, as
  standings become worth simulating.
- **November:** the whip-around and the rarity radar, in time for rivalry
  season's chaos.
- **December–January:** brackets and bowl formats, the record book, and the
  Monday Program's season retrospective.
- **Offseason:** the Streak and the daily puzzle carry the site until next
  August.

---

The test for every item, all season — both parts: *does this help someone
answer "what matters right now?" in under two seconds, on a phone, on that
day of the week?* If not, it doesn't ship — no matter how good it demos.
