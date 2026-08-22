# The CFB Slate — Blind First-Time-User UX Audit

**Method:** A real Chromium browser driven against the live production site
(`https://cfb-gameday.vercel.app`) as a stranger who had never seen the product.
Every finding below comes from actual clicking, typing, refreshing, and resizing —
not from reading the code. Only *after* the walkthrough did I open the repository
to explain *why* the friction exists. Screenshots referenced by filename live in
`./shots/`.

**Date:** 2026-08-22 · Season state at time of audit: **Week 0 / preseason** (this
matters — most "live" surfaces are legitimately empty, and I've tried to separate
"empty because it's August" from "empty because it's broken").

**Scope covered:** landing (`/` and `/welcome`), the demo (`/demo`, `/demo/slate`),
slate (CFB + NFL), a game detail page, ratings, teams + a team page, rankings,
standings, ledger, groups, games/arcade, six-pack, receipts, model, recap, edges,
jumbotron, login, and the bet slip — on desktop (1440) and mobile (390/393/430).

---

## 1. First Impression

**Within 5 seconds:** "This is a serious college-football numbers site for people
who bet." The monospaced, stencil-`S` wordmark, the deep near-black theme, the live
NFL score ticker, and the *"No money moves through this site … call 1-800-GAMBLER"*
footer together read as a real, opinionated sports product — not a side project.
The branding is cohesive and confident. It looks legitimate and trustworthy on
sight. That is a genuinely strong opening and rarer than it sounds.

**But the very first screen works against that first impression.** The root page
(`/`, signed out — `shots/01-landing-fold.png`) leads with **"YOUR GROUPS → You're
not in a group yet. Create one and you're its admin, or join with a code."** A
stranger who has not yet learned what the product *is* is being asked to think about
groups and admin codes. The clearest explanation of the product — the excellent
`/welcome` page — is reachable only through a small, easy-to-miss link at the bottom:
*"New here? What this is →"*. The page that should be the front door is one link
below the fold.

So the honest first impression is split:

- **Craft and trust: high.** It feels finished and designed by someone with taste.
- **"What is this and what do I do first": muddy** on the actual landing screen. The
  value proposition exists and is stated beautifully — just not where a first-timer
  lands.

Nothing looked broken. Nothing was aggressively over-stuffed. The main confusion was
ordering: I was shown *my group status* before I was told *what the site does*.

---

## 2. The User Journey (chronological, with friction)

### 2.1 Landing on `/`
- **I tried to:** understand the product and find the primary action.
- **I expected:** a one-line "here's what this is" and a "show me."
- **What happened:** I got a group-empty-state card first, then a "WEEK 0 · 8 games
  on the board · Go to the slate →" card (good), then a "This is where your Saturday
  lives" card with a *second* "Sign in" and the "New here? What this is →" link.
- **Confusing because:** three stacked cards all essentially say "sign in," and the
  explainer is last. The strong CTA ("Go to the slate") competes with two "Sign in"
  buttons and a "Start or join a group" button on one screen.
- **Severity:** Medium-High (it's the first screen).

### 2.2 `/welcome` — the page that should be first
- Clicking "New here? What this is" lands on a genuinely excellent marketing page
  (`shots/02-what-this-is.png`, `shots/02d-welcome-s4.png`): a tight headline, a
  4-stat strip ("136 teams rated… 0 predictions edited after the fact. Ever."), a
  "one week on the Slate" Wed→Sun timeline, and per-feature cards (Edges, Ratings,
  Rankings, Teams, Groups, Ledger). **This removed all my confusion in about 20
  seconds.** The friction is purely that I had to hunt for it.

### 2.3 The demo — the best thing in the funnel
- "Live demo" → `/demo` (`shots/03-demo-landing.png`) → "the real product running on
  invented games and invented money." This is the single strongest conversion asset:
  I could explore the whole product with populated data before committing anything.
  **Excellent.** (One bug lives here — see 2.8.)

### 2.4 The slate (`/slate`)
- `shots/06-slate-signedout.png`. Clear, dense-but-legible game cards grouped by
  window (Noon / Afternoon / Primetime), each with spread/total/moneyline, SP+/FPI,
  and a "FILLER 45"-type chip. Filters (conference, network, spread, Ranked, My bets,
  My picks, Sort) sit in a row up top. Filters persist to the URL (`?ranked=1`) and
  survive refresh — good.
- **Friction — the "FILLER" chip.** Every pregame card shows a chip like **"FILLER
  45"** or "Good 72." As a stranger I had no idea what this meant; it reads like
  leftover developer placeholder text. (It's actually a *watchability* score band —
  see 3/10 and Phase 10 — but nothing on screen tells me that.) **Severity: Medium.**

### 2.5 Game detail (`/game/…`)
- `shots/07-game-detail-full.png`. Strong page: line-movement chart ("open −35.5 →
  now −37"), a SYSTEMS table reconciling SP+/FPI to the model with a plain-English
  paragraph, box score placeholder ("Fills in from kickoff"), "Your pick — Sign in to
  pick," and "Crew picks — Nobody else has picked this one yet." Clear, honest empty
  states. No friction of note.

### 2.6 Ratings / Teams / Standings
- Ratings (`shots/08-ratings.png`): sortable table, an inline "Rating is points better
  than an average FBS team…" legend (great — this is exactly the context betting
  numbers usually lack), OFF/DEF/ΔWK/CHURN/LUCK columns.
- Team page (`shots/19-team-detail.png`): the best page on the site — rating broken
  into 2025 base / talent / churn / coaching / luck / tier, SP+/FPI comparison, and a
  full schedule with a win-probability bar per game. **This is a real differentiator.**
  - **Small friction:** it prints `Honesty notes: ol_share=0.5 · turnover_margin=0`
    and "The Verdict — Not written yet." The first reads like leaked debug output to a
    lay fan (it's intentional transparency; it just looks dev-ish).
- Standings (`shots/08-standings.png`): conference tables with a rating column. Fine.
  All records show 0-0 (correct for Week 0).

### 2.7 Ledger (`/ledger`)
- `shots/08-ledger.png`. A clean "Log a bet" form (bet text, optional game link,
  type/side/line/odds, units, confidence, book) plus a Bets / Group-picks toggle and
  RECORD / UNITS / ROI / AVG CLV tiles. This is a proper bet-tracking tool. Signed
  out, everything shows "—" and "No bets logged yet," which is honest but means a
  first-timer can't feel the value without signing in.

### 2.8 The bet slip (from the demo slate)
- Clicking any odds button ("ALA −2.5 spread — add to bet slip") opens a floating
  **Bet Slip** with per-leg unit stakes, a per-leg confidence dropdown ("Bet of the
  Century → Lean"), Clear, **Text**, **Image**, and "Log N bets." (`shots/12-demo-slip-2.png`)
  This is more polished than I expected and better than most competitors' slip UX.
- **Text share works:** it copied a cleanly formatted slip to the clipboard.
- **Image share is broken in the demo:** the button flips to **"Could not share"**
  (`shots/14-slip-image.png`). Root cause confirmed in the API (Phase 10): the image
  renderer returns **401 "Sign in to share,"** so for signed-out users — i.e. exactly
  the prospects the demo exists to convert — the advertised "share your slip as an
  image" feature always fails. **Severity: High** (it's a headline feature failing in
  the conversion surface).
- Logging bets in the demo correctly shows **"2 bets — demo, not saved"** — great
  non-destructive handling.

### 2.9 Sign-in
- `/login` (`shots/10-login.png`) is **magic-link email only**: enter email → "Send my
  link." No password, no OAuth. Clean and modern, but it means a stranger must hand
  over an email address before experiencing any signed-in feature (picks, real ledger,
  groups). The demo softens this a lot, but the "try the real thing" path has a hard
  email gate with no Google/Apple option. **Severity: Medium.**

### 2.10 A confusing signed-out state
- On the slate, toggling **"My picks"** or **"My bets"** while signed out doesn't
  prompt me to sign in — it applies a filter (`?picks=1`) that matches nothing and
  renders **"NO GAMES MATCH YOUR FILTERS · Loosen a filter or clear the search"**
  (`shots/17-mypicks-signedout.png`). As a stranger this reads as "the site is broken
  / there are no games," not "you need an account to have picks." **Severity: Medium.**

---

## 3. Feature-by-Feature Audit

| Feature | Discoverability | Ease of Use | Clarity | Problems | Recommendation |
|---|---|---|---|---|---|
| Landing `/` | High | High | **Low-Med** | Leads with group empty-state, not "what is this"; explainer below fold | Lead with a one-line value prop + "See a live Saturday"; demote groups |
| `/welcome` explainer | **Low** (buried link) | High | High | Best page in funnel, hardest to reach from `/` | Make it the signed-out `/`, or link it prominently top-of-page |
| Demo | High | High | High | The "Image" share fails (401) | Hide/disable Image share when signed out, or send to sign-in |
| Slate (CFB/NFL) | High | High | Med | "FILLER" chip cryptic; no visible watchability legend; NFL toggle uses `?sport=` (fine) | Rename "Filler"→ e.g. "Skip"/"Low", add a one-line legend |
| Game detail | High | High | High | — | Keep; it's a model page |
| Ratings | High | High | High | Great inline legend | Keep |
| Teams / team page | High | High | High | `Honesty notes: ol_share=0.5…` reads dev-ish | Hide raw proxy tokens behind an info tooltip |
| Rankings | High | High | High | "MODEL #27" vs poll rank contrast is a nice touch | Keep |
| Standings | High | High | High | — | Keep |
| Ledger | High | High | Med | Value invisible until signed in | Show a populated sample ledger when signed out |
| Bet slip | High | High | High | Image share; confidence tiers ("Bet of the Century") are playful but opaque | Fix image; add a tiny tier legend |
| Groups | Med | n/a signed out | High | Good 3-kinds explainer; nothing to do without account | Let people preview a demo group |
| Games / arcade | High | High | High | 7 mini-games; strong idea | Keep; consider surfacing fewer at once |
| Six-Pack | Med | High | High | — | Keep |
| Receipts / model / recap | Med | High | High | "The model" + "Week in review" links only from Receipts header | Keep; consider linking `/model` from nav |
| **Edges** | **Low (desktop)** | High | High | Full page, marketed on `/welcome`, but **no desktop nav link** (mobile "More" only) | Add a desktop entry point or an on-slate "Edges" tab |
| **Jumbotron** | **Low (desktop)** | High | High | TV/takeover view, desktop "More"-only | Fine as overflow, but expose during live windows |
| Login | High | High | High | Email-only, no OAuth | Add Google/Apple sign-in |
| Mobile bottom nav | High | High | High | Names differ from desktop (Edges/Jumbotron appear only here) | Reconcile the two navs' vocabulary |

---

## 4. Top 10 UX Problems (ranked)

**1. Most navigations freeze for 2–4s with no feedback. (Critical)**
- *Impact:* Every jump to Ratings, Teams, Standings, Ledger, Rankings, Receipts, or
  Groups leaves the *previous* page on screen, frozen, for 2–4 seconds before the new
  one appears. No spinner, no skeleton. It repeatedly made me wonder if my click
  registered.
- *Evidence:* Measured cold navigations of 2.2–4.0s across those routes. Phase 10:
  essentially every route is `export const dynamic = "force-dynamic"` (server-rendered
  per request against Supabase) and only **2 of ~35 routes have a `loading.tsx`**
  (`/slate` and `/`). The rest render nothing-new until the server responds.
- *Fix:* Add `loading.tsx` skeletons to the high-traffic routes, and cache the ones
  that only change weekly (ratings/teams/standings/rankings can be ISR/`revalidate`d
  rather than `force-dynamic`).

**2. The demo's "Image" share is broken for the exact users it targets. (High)**
- *Impact:* The demo exists to convert strangers; its slip's "Image" button always
  fails ("Could not share") for signed-out users.
- *Evidence:* `POST /api/share-card` → `401 {"error":"Sign in to share"}`
  (`shots/14-slip-image.png`). The endpoint is auth-gated as a cost control, but the
  button is shown to signed-out demo users anyway.
- *Fix:* In signed-out/demo context, hide the Image button or route it to sign-in;
  or allow a rate-limited unauthenticated render for the demo slip only.

**3. The real front door (`/`) buries the value proposition. (High)**
- *Impact:* A stranger lands on "You're not in a group yet," not on "what this is."
- *Evidence:* `shots/01-landing-fold.png` vs the far clearer `shots/02-what-this-is.png`.
- *Fix:* For signed-out users, make `/` lead with the `/welcome` hero (or redirect),
  and move group/onboarding below.

**4. "My picks" / "My bets" signed out → "NO GAMES MATCH YOUR FILTERS." (Medium-High)**
- *Impact:* Reads as broken/empty rather than "sign in required."
- *Evidence:* `shots/17-mypicks-signedout.png`.
- *Fix:* When these toggles are used signed-out, show a sign-in prompt in place of the
  empty-filter state.

**5. "FILLER" chip is unexplained and looks like placeholder text. (Medium)**
- *Impact:* A core per-game signal (watchability) is unreadable to newcomers and
  literally uses a word that connotes "dev filler."
- *Evidence:* `shots/06-slate-signedout.png`; code: `score >= 80 ? "Must-see" :
  score >= 60 ? "Good" : "Filler"` with the scale only in the `aria-label`.
- *Fix:* Reword "Filler," and add a one-line on-screen legend the first time it appears.

**6. Edges is marketed as core but has no desktop entry point. (Medium)**
- *Impact:* `/welcome` sells "Where we disagree with the market" as a pillar, but on
  desktop there's no nav link — it's reachable only via mobile "More" or by typing the
  URL.
- *Evidence:* `shots/m03-edges.png`; `nav-items.ts` marks it `overflowOnly` (a
  documented decision, UX-33 — edges are "information, not a destination"). The
  decision is defensible; the *mismatch with the marketing* is the problem.
- *Fix:* Either soften the welcome-page prominence, or give Edges a lightweight desktop
  entry (e.g. a tab on the slate) so the promise and the product agree.

**7. Signed-in value is invisible until you sign in. (Medium)**
- *Impact:* Ledger, picks, and groups all show "—"/empty signed out, so the payoff of
  making an account is told, not shown, outside the demo.
- *Evidence:* `shots/08-ledger.png`, `shots/08-groups.png`.
- *Fix:* Show sample-populated versions (like the demo does) on these signed-out pages.

**8. Email-only magic-link with no OAuth. (Medium)**
- *Impact:* A stranger must surrender an email before experiencing the signed-in
  product; no Google/Apple fast path.
- *Evidence:* `shots/10-login.png`.
- *Fix:* Add Google/Apple sign-in; keep magic link as an option.

**9. Dev-ish strings leak into user-facing copy. (Low-Medium)**
- *Impact:* `Honesty notes: ol_share=0.5 · turnover_margin=0`, `model 2026.5.0`, and
  raw parameter names undercut the otherwise-polished feel for lay users.
- *Evidence:* `shots/19-team-detail.png`.
- *Fix:* Move raw tokens behind an info tooltip; keep the human sentence visible.

**10. `/slate` has no `<h1>` and a few filter selects lack accessible names. (Low)**
- *Impact:* Screen-reader/SEO structure on the primary page starts at `<h2>`; 5 native
  `<select>` filters have no label/aria-label.
- *Evidence:* DOM audit — `/slate` `h1` count = 0; conference/network/spread/sort/week
  selects have no `aria-label`.
- *Fix:* Add a visually-hidden `h1` and `aria-label` each filter select.

---

## 5. Things That Are Already Excellent

- **The demo (`/demo`).** "The real product on invented games and invented money" is
  the right way to onboard a skeptical bettor, and it's executed well —
  full navigation, live-ish cards, a working slip, and honest "not saved" toasts.
- **Model transparency is a genuine moat.** `/model` (`shots/09-model.png`) lists
  shipped *and rejected* experiments with the exact number that decided each ("Widen
  early-season sigma — NLL 0.3972 → 0.3992 (worse) — REJECTED"). "Receipts" freezes
  predictions Thursday and never edits them. Nothing on ESPN/Action/DK does this. It
  builds trust the way trust is actually earned.
- **Numbers come with context.** The Ratings legend ("+10 is a playoff side, 0 is
  average, −20 is the bottom of the sport") and the game-detail SP+/FPI reconciliation
  paragraph are exactly the scaffolding casual bettors need and rarely get.
- **The team page** (`shots/19-team-detail.png`) — decomposed rating + win-prob
  schedule — is a standout.
- **The bet slip** — multi-leg, per-leg confidence and units, text/image share, and a
  slate-level "log a bet in a couple taps" — is better than expected.
- **Brand and trust cues.** Cohesive dark identity, monospaced numerics, and a
  responsible-gambling footer on every page. It reads legitimate.
- **Mobile fundamentals are right** (see §6).
- **Honest empty states almost everywhere** ("Nobody else has picked this one yet,"
  "The recap writes itself as games go final," "Fills in from kickoff").

---

## 6. Mobile UX

Tested at 390×844, 393×852, 430×932. **This is the product's strongest surface.**

- **Real bottom tab bar** (Home / Slate / Groups / Ledger / Games / More) —
  `shots/m01-home.png`. Thumb-zone correct, the four things people actually do are the
  four primary tabs, and overflow lives in "More."
- **Tap targets pass:** odds "add to slip" buttons measure 44×44px.
- **No horizontal body overflow** at any of the three widths; the body stays pinned to
  the viewport width.
- **Wide tables scroll inside their own container**, not the page — the Ratings table
  keeps a sticky team column and scrolls stats horizontally (`shots/m06-ratings.png`).
  This is the right pattern and a common failure elsewhere.
- **The bet slip floats above the tab bar** without colliding (`shots/m07-slip.png`).
- **Slate cards reflow to one column** cleanly (`shots/m05-slate.png`).

Mobile nits:
- The filter row on the slate (`All conferences`, `All networks`, …) overflows to the
  right and must be scrolled horizontally; the cut-off "All ne…" is a small
  discoverability cost.
- The desktop nav and the mobile "More" sheet use **different vocabularies** — "Edges"
  and "Jumbotron" appear as labels *only* on mobile, so the two navs teach different
  mental models of what the app contains.
- The 2–4s route transitions (problem #1) hurt more on mobile, where people expect app-
  like instant taps.

**"Would I use this on my phone Saturday morning?"** Yes — the mobile IA and ergonomics
are there. The load-time hitches are the only thing that breaks the app-like feel.

---

## 7. Information Architecture (if I restarted from scratch)

The desktop top nav currently carries **nine** peers: Slate, Groups, Rankings, Ratings,
Standings, Teams, Ledger, Games, Receipts — while two full features (Edges, Jumbotron)
are hidden. That's a flat list where a few things matter far more than the rest.

**Primary nav (what I'd keep one tap away):**
- **Slate** (the board — the reason people open the app)
- **Groups** (picks / crew / pools — the social hook)
- **Ledger** (your bets + record)
- **Games** (the arcade)
- **Ratings/Teams** — as a single "Model" hub

**Fold Rankings + Standings + Ratings + Teams into one "Model" (or "Numbers") section**
with tabs. Right now four separate top-level tabs all answer "who's good?" and compete
for the same attention. A stranger doesn't know whether to look at Rankings vs Ratings
vs Standings — they're closely related views of one dataset.

**Give Edges a real home.** It's pitched as a pillar; either surface it inside the
Slate (an "Edges" view alongside All/Sat/Sun) so it lives where the games live, or make
it a Model-hub tab. Don't market it and then hide it.

**Home screen (signed out):** the `/welcome` hero, a live/next-kickoff strip, and one
"See a live Saturday" CTA — nothing about groups until the visitor knows what the
product is.

**Home screen (signed in):** keep the current hub (`shots/m01-home.png` shows the
shape) — next kickoff, your groups + standings, your open bets, your record. That's the
right signed-in dashboard.

**What competes for attention today:** Rankings/Ratings/Standings/Teams (four tabs, one
job); two "Sign in" buttons plus "Go to the slate" on the signed-out root; the arcade
(7 games) vs the core betting tools.

**Too hard to discover:** Edges (desktop), Jumbotron (desktop), `/model` and `/recap`
(only linked from the Receipts header).

---

## 8. UX Flow: Discover → Understand → Explore → Pick → Track → Review

- **Discover:** *Partial.* The demo and `/welcome` are great, but the actual landing
  screen discovers "groups," not the product.
- **Understand:** *Strong.* Ratings legend, model page, per-team breakdown, and the
  SP+/FPI reconciliation genuinely teach the numbers.
- **Explore:** *Strong.* Slate → game → team is a clean drill-down. Filters persist.
- **Pick / bet:** *Strong once you're in* (the slip is excellent) — but **the model-vs-
  market "edge" step, which should sit between Explore and Pick, is hidden on desktop.**
  The natural question "where does your model disagree with the market?" has a great
  answer (`/edges`) that a desktop user can't find.
- **Track:** *Strong.* The ledger is a real tool (record, units, ROI, CLV, CSV export).
- **Review:** *Strong in concept.* Receipts + recap + wrapped close the loop honestly;
  empty now only because it's Week 0.

**Where the user must mentally stitch pages together:** to go from "which games matter"
(watchability chip on the slate) → "where's the edge" (hidden `/edges`) → "what did the
model say" (`/model`) → "what did I pick" (ledger/groups), the connective tissue is
weak on desktop. The data is all there; the *path* between the six steps isn't sign-
posted, especially the Edge step.

---

## 9. Missing Features a User Would Expect

**Must have**
- **Loading feedback** on navigation (skeletons/spinners) — see problem #1.
- **A working share for the demo slip** (or no broken button) — problem #2.
- **A sign-in prompt** where signed-out users hit gated toggles (My picks/My bets).

**Should have**
- **OAuth (Google/Apple)** alongside magic link.
- **Search** that spans teams *and* games *and* pages (there's a team search on Slate
  and Teams, but no global search; a newcomer expects one).
- **A visible legend** for the watchability chip and the confidence tiers.
- **A desktop entry point for Edges.**
- **Injuries / weather depth** on the game page (weather is hinted via a wind figure;
  fans expect an injury/availability line next to a spread).

**Nice to have**
- Notifications/reminders for pick lock times (the site emphasizes "locks at kickoff").
- Team/game **favoriting that persists** and drives a personalized slate (there are
  star icons on cards; their persistence for signed-out users is unclear).
- Dark/light is already handled (there's a theme toggle) — good.

---

## 10. Quick Wins (small, high-impact)

1. Add `loading.tsx` skeletons to Ratings, Teams, Standings, Ledger, Rankings,
   Receipts, Groups. Biggest perceived-quality gain for the least work.
2. In the demo/signed-out slip, hide or disable the **Image** button (or route it to
   sign-in) so it never shows "Could not share."
3. Replace the signed-out **My picks / My bets** empty-filter result with a "Sign in to
   see your picks" prompt.
4. Rename the **"Filler"** watchability band and add a one-line legend on first
   appearance.
5. On signed-out `/`, lead with the `/welcome` hero copy; move "You're not in a group
   yet" below it.
6. Add a visually-hidden `<h1>` to `/slate` and `aria-label`s to the filter `<select>`s.
7. Hide raw `ol_share=…`/`turnover_margin=…` tokens behind an info tooltip on the team
   page.
8. Add a desktop nav (or on-slate) entry for **Edges**.

## 11. Bigger Improvements (worth planning)

1. **Rendering/caching strategy.** Move weekly-cadence pages (ratings, teams,
   standings, rankings) off `force-dynamic` to ISR/`revalidate`; reserve dynamic
   rendering for genuinely live/per-user surfaces. This is the root cause of the slow
   feel across the app.
2. **Collapse Rankings/Ratings/Standings/Teams into one "Model/Numbers" hub** with
   tabs, freeing top-nav slots and giving a clear "who's good?" destination.
3. **Signed-out sampled data** on Ledger/Groups (as the demo already proves works), so
   the value is shown, not just told.
4. **Make the Edge step first-class in the pick flow** — an Edges view living inside the
   Slate, so Discover → Edge → Pick is one continuous path.
5. **Auth expansion** (OAuth) to lower the cost of trying the real product.

## 12. Technical/UX Crossover (only what affects UX)

- **`force-dynamic` on ~all routes + only 2 `loading.tsx`** → 2–4s blank navigations.
  This is the top UX problem and it's architectural. (Confirmed in `src/app/**`.)
- **`/api/share-card` returns 401 for signed-out users**, but the Image button is
  rendered in the signed-out demo → guaranteed "Could not share." (`route.tsx:95`.)
- **Watchability band label** hard-coded to "Filler" with the scale only in `aria-label`
  (`GameCard.tsx:884`) → on-screen text is uninterpretable without the tooltip.
- **Nav split by design** in `nav-items.ts` (`overflowOnly` for Edges/Jumbotron) is
  intentional and well-documented, but it's the mechanism behind the Edges
  discoverability/marketing mismatch.
- **Logos are `<img loading="lazy">` from an external CDN with a colored-monogram
  fallback** (`TeamMark.tsx`). Behavior is correct (graceful fallback); the only
  artifact is a brief blank-then-populate on first paint. Not worth changing.
- **Accessibility is largely solid**: alt text present, buttons named, `lang="en"`,
  a real "Skip to content" link, and a *visible* keyboard focus ring (Chromium's `auto`
  outline renders despite a near-black `outline-color`). Gaps are the missing `/slate`
  `<h1>` and the unlabeled filter selects.

## 13. Product-Level Verdict

- **Would I use this?** Yes. As a college-football bettor this is closer to what I
  actually want than ESPN or a book's app — one board with the model's number, the
  market's number, the disagreement, my picks, and my record, all honest about itself.
- **Would I understand it without someone explaining it?** *On the demo and `/welcome`,
  yes.* On the raw signed-out `/`, not immediately — the front door talks about groups
  before it says what the product is.
- **Would I trust it?** Yes, and unusually so. The frozen-prediction "Receipts," the
  "rejected experiments with the deciding number" model page, and the "no money moves
  through this site" framing are trust-builders competitors don't attempt.
- **Would I return next Saturday?** Yes — if the load hitches were gone. Right now the
  2–4s no-feedback navigations are the thing that would make me bounce between tabs.
- **Would I recommend it to another CFB bettor?** Yes, with the caveat "start with the
  demo, ignore the first screen."
- **What's preventing it from feeling like a polished commercial product?** Three
  things, in order: (1) perceived performance — the frozen navigations; (2) the funnel
  ordering — the best explainer is buried and the front door leads with groups; and (3)
  small credibility leaks — a broken demo share button, the "FILLER" label, and dev-ish
  strings — that a first-timer over-weights precisely because everything *else* looks so
  finished.

---

## The Three Things I Should Fix First

1. **Give navigation instant feedback.** Add `loading.tsx` skeletons to the core routes
   and move weekly-cadence pages off `force-dynamic` to caching/ISR. The whole app will
   feel twice as fast. *(Problem #1.)*
2. **Fix the front door.** Make the signed-out `/` lead with the `/welcome` value
   proposition (and "See a live Saturday"), not "You're not in a group yet." *(Problem
   #3.)*
3. **Stop the demo from showing a broken feature.** Hide/disable the slip's **Image**
   share for signed-out users (or route it to sign-in) so the conversion surface never
   says "Could not share." *(Problem #2.)*
