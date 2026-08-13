# UI/UX Audit — The CFB Slate

**Workstream:** UI/UX · phone, one-handed, bar wifi, Saturday morning.
**Date:** 2026-08-09 · Launch: Week 0 slate, Aug 29 (20 days).
**Method:** every route in `src/app/` and every component in `src/components/` read in full; contrast ratios computed from the actual `globals.css` token values in both themes (script, WCAG relative-luminance); sign conventions re-derived from first principles against the grader, live-status, and CLV modules. I have not rendered pages in a browser; anything below that depends on a render says so.

**Summary.** The remediation the prior audit claims (`audit/AUDIT-2026-08.md`) is real: bottom nav with `aria-current`, 44px odds cells, ticker/sticky stacking, safe-area handling, reduced-motion kill switch, loading/error boundaries, anon API access, URL-persisted filters — all verified in code and marked below. The product's Saturday-morning surfaces are genuinely good. But the newest seam — the bet slip → ledger → grader pipeline — carries a **P0 sign-convention bug**: the slip stores away spread lines in the bettor's perspective while the grader, the live-status chips and the CLV module all read `line_taken` as home-perspective, so roughly half of all spread bets logged from the odds cells will be **silently graded wrong, shown "losing" while covering, and assigned inverted CLV — permanently, in an append-only ledger**. This is the same class of bug the project has now hit three times (five `pickSideLabel` copies, the jobs-core CLV inversion), and two *more* un-deduplicated pick-label copies survive on the game page. The groups pages — the product's newest, most-used Saturday surface — also render every kickoff time in Central Time with no label while the slate renders viewer-local, and offer no way to navigate weeks at all.

---

## Findings table

Ranked by "how many people hit this on Saturday morning."

| ID | Sev | Type | Status | One-line | Evidence |
|----|-----|------|--------|----------|----------|
| UX-01 | **P0** | Bug | **NEW** | Bet slip stores away-spread `line_taken` side-perspective; grader/live-status/CLV read home-perspective → away spread bets misgraded, mislabeled live, CLV inverted, forever (append-only) | `src/components/slate/GameCard.tsx:689,717-719` → `src/app/actions/bets.ts:118` vs `scripts/lib/jobs-core.ts:564-567`, `src/lib/live-status.ts:30`, `src/lib/clv.ts:46-49` |
| UX-02 | **P1** | Bug | **NEW** | Game page crew-picks list is the "sixth copy" of pick formatting: away picks show the sign flipped, straight-up picks render as "ABBR PK" | `src/app/game/[id]/page.tsx:425-430` |
| UX-03 | **P1** | Bug | **NEW** | GameHeader "Your action" chip prints away pick line raw (sign flipped) on the live game page | `src/components/game/GameHeader.tsx:310-317` |
| UX-04 | **P1** | Design | **NEW** | All groups surfaces + ledger bet form render kickoffs in CT, unlabeled, server-side — slate/game are viewer-local; same game shows two different times | `src/app/groups/[slug]/page.tsx:304`, `MatchupCard.tsx:68`, `groups/[slug]/settings/page.tsx:87`, `ledger/page.tsx:63` |
| UX-05 | **P1** | Design | **NEW** | No week navigation anywhere in groups: board takes `?week=` but renders no control; members can't reach last week's results or next week's board | `src/app/groups/[slug]/page.tsx:162-196` (nav block, no week UI) |
| UX-06 | P2 | Bug | STILL OPEN (partial fix) | Light-mode contrast: accent `#a97b0c` = **3.80:1** on white (section headings, links, active states); PickedChip **3.16:1**; `chalk/50–55` = 3.33–3.88; win/loss chips 4.18/4.45. Dark: `/35–/45` = 2.95–4.07 | `globals.css:58`, usages passim; ratios computed below |
| UX-07 | P2 | Bug | **NEW** | Blind groups: board's "N picks in" counts only RLS-visible rows, understating the count the week page gets from `group_game_pick_count` | `src/app/groups/[slug]/page.tsx:305,343-347` |
| UX-08 | P2 | Design | STILL OPEN | Sub-44px touch targets remain: star ~25px, pin ~21px, BetSlip remove ~22px, units input 28px, `void` text link — audit item 16 fixed odds cells only | `GameCard.tsx:468-481,334-349`, `BetSlip.tsx:127-141`, `VoidBetButton.tsx:9-19` |
| UX-09 | P2 | Design | **NEW** | Slate staleness cue (`fetchedAt` clock + spinner) is `hidden sm:flex` — invisible on every phone; refresh failures are silently swallowed | `SlateView.tsx:401-404,137-138` |
| UX-10 | P2 | Design | **NEW** | PickButtons ~38px tall (under floor) and no optimistic/pending affordance beyond 50% opacity on *all* buttons — on 3G the tap "does nothing" for the full round-trip | `PickButtons.tsx:113-128,246-259` |
| UX-11 | P2 | Spec div | **NEW** | `/rules` Rule 3 says picks "visible to the whole crew at all times" — contradicted by the 0023 hidden-until-kickoff blind shipped Aug 9 | `src/app/rules/page.tsx:31-34` |
| UX-12 | P2 | Design | STILL OPEN (#46) | No `opengraph-image` anywhere — links pasted into the group chat get no card, for a product distributed by group text | repo-wide: no `opengraph-image.*` route |
| UX-13 | P2 | Design | STILL OPEN (partial #30) | PWA: manifest good, but icons are SVG-only and there is no `apple-icon` — iOS Add-to-Home-Screen gets a screenshot tile | `src/app/manifest.ts:14-17`; `src/app/` has only `favicon.ico`, `icon.svg` |
| UX-14 | P2 | Design | **NEW** | Groups have no first-run pointer from the picking surfaces users start on: `/slate` cards' pick state silently depends on an active-group cookie; the empty crew line on cards says nothing | `src/lib/groups.ts` (cookie), `GameCard` crew line renders null with no group |
| UX-15 | P3 | Bug | STILL OPEN (changelog item, confirmed + extended) | `#5b6472` hardcoded fallback (light-mode `--push`) in **8** places, not 6 — add `GameHeader.tsx:191-192`; plus `#9aa1ad` in `WinProbBar.tsx:20` | `TeamMark.tsx:20`, `GameCard.tsx:118-119,449,615-616,649-650`, `WinProbBar.tsx:19-20`, `GameHeader.tsx:191-192` |
| UX-16 | P3 | Bug | **NEW** | WeekConfigForm's orphan warning can't count picks orphaned by turning a market off (dead-code ternary `? 0 : 0`); words-only warning | `WeekConfigForm.tsx:84-90` |
| UX-17 | P3 | Design | **NEW** | Three different week ranges: slate selector 1–16+post, group pages accept 1–20, settings week strip renders 1–15 only — admin can't reach week 16 from the UI | `SlateView.tsx:621`, `groups/[slug]/page.tsx:58`, `groups/[slug]/settings/page.tsx:120` |
| UX-18 | P3 | Design | STILL OPEN | `/ratings` rows still aren't links to team pages; `/teams` still has no search (136 teams) | `RatingsTable.tsx:169-211`, `TeamsGrid.tsx` (no query input) |
| UX-19 | P3 | Design | STILL OPEN | Login page is a dead end: no nav, no link back to the public slate | `LoginForm.tsx:33-75` |
| UX-20 | P3 | Design | **NEW** | Receipts has a private `fmtLine` (renders "+3.0") diverging from `fmtSpread` ("+3") — the formatter-copy pattern again | `receipts/page.tsx:225-229` vs `slate.ts:300-304` |
| UX-21 | P3 | Design | **NEW** | Ledger "today"/share-day keyed to CT; a Pacific bettor's Friday-night bet files under Saturday | `ledger/page.tsx:143-146` |
| UX-22 | P3 | Design | **NEW** | MatchupCard push results are invisible (no icon, no colour — sr-only text only), vs ResultChip's icon+colour rule | `MatchupCard.tsx:270-297` |
| UX-23 | P3 | Design | **NEW** | Slate empty state says "The slate fills in when data ingestion runs" — engineer-speak on the single most-hit empty state of launch week | `SlateView.tsx:499-502` |
| UX-24 | P3 | Bug | **NEW** | Group week page passes raw `line_at_pick` (possibly a numeric *string* from PostgREST) into `pickSideLabel`; a stored "0" renders "0" not "PK"; every other caller wraps `Number()` first | `groups/[slug]/week/[week]/page.tsx:306-310` vs `:135` |
| UX-25 | P3 | Design | **NEW** | `profiles.timezone` still dead schema — not on `/me`, not read anywhere | `me/page.tsx:22-26`, `ProfileSettings.tsx` |

**Verified fixed (do not re-litigate):** bottom nav in thumb zone with 4 primary + More sheet, `aria-current` in all three navs (`nav-items.ts`, `BottomNav.tsx:64,99`, `NavTabs.tsx:23`); no dead/`ready:false` tabs; 44px odds cells (`GameCard.tsx:791`, `h-11 w-11`); reduced-motion global kill covers aura drift, score flash/pop, live-dot, shimmer, red-zone pulse and all transitions (`globals.css:528-536` + drift gated on `no-preference` at `:331`); ticker anon (`api/ticker/route.ts` — no auth), slate anon (`api/slate/route.ts:15-20`); ticker publishes `--ticker-h` and slate control bar offsets by it (`ScoreTicker.tsx:25-34`, `SlateView.tsx:376`); BetSlip clears bottom nav + home indicator (`BetSlip.tsx:89`); body reserves bottom-nav space only when the bar exists (`globals.css:118-122`); root `loading.tsx`/`error.tsx`/`not-found.tsx` cover every route, slate has its own skeleton; receipts season-scoped with a designed pre-Week-1 empty state (`receipts/page.tsx:33-37,179-181`); filters/sort/week mirrored to the URL (`SlateView.tsx:210-225`); `/rules`, `/me` with sign-out, `/rankings`, `/standings`, `/recap` all exist; `generateMetadata` on game and team pages (`game/[id]/page.tsx:49-74`, `team/[id]/page.tsx:19-34`); ratings sticky header + `aria-sort` + scale explainer above the table (`RatingsTable.tsx:132-155`); BetForm has real labels (`BetForm.tsx:198-221`); `/slate/preview` 404s in production (`slate/preview/page.tsx:12`); moneyline formatting `+150/−110` via `fmtMoneyline`; `−0` handled (`lineForSide`, `clv.ts flip`); pushes included in records (`records.ts:172-176`).

---

## 1. UX-01 (P0): the bet slip's spread lines are graded with the wrong sign

Every module that *reads* `bets.line_taken` treats it as **home-perspective**:

- Grader: `scripts/lib/jobs-core.ts:564` — `coverMargin = b.side === "home" ? margin + line : -margin - line`. For an away bet this only settles correctly if `line` is the *home* line.
- Live status: `src/lib/live-status.ts:30` — same formula. Its own test pins the convention: *"away +6.5, down 4"* is exercised as `liveSpreadStatus("away", -6.5, 24, 20)` (`src/lib/slate-live.test.ts:156-161`) — the away bettor's +6.5 is passed as home-perspective **−6.5**.
- CLV: `src/lib/clv.ts:41-49` — doc comment says outright: *"`lineTaken` and `close` are both home-perspective."*

But the odds cells *write* it **side-perspective**: `GameCard.tsx:689` computes `teamSpread = side === "home" ? spread : -spread` and `:717-719` puts that into the slip selection; `actions/bets.ts:118` inserts it verbatim (`line_taken: b.line`). Home bets happen to agree (home-perspective = side-perspective). Away bets are stored negated.

**Worked example.** Alabama −6.5 at home; consensus `spread = −6.5`. You tap the away cell: label "VAN +6.5" (correct), stored row: `side='away', line_taken=+6.5`. Final: Alabama 30–27, `margin = +3`. Vandy +6.5 **covers** (3 < 6.5).

- Grader: `coverMargin = −margin − line = −3 − 6.5 = −9.5` → **`result='loss'`, `payout_units = −units`**. The correct home-perspective input (−6.5) gives `−3 + 6.5 = +3.5` → win.
- Live chip during the game (Bama 21–17): `liveSpreadStatus("away", +6.5, 21, 17)` → `−4 − 6.5 = −10.5` → the card, the ledger row and the aura say **"Down 10.5 ATS" / red / losing** while the bet is covering by 2.5. `tintFor` (live-status.ts:242-247) inherits it, so the Liquid Glass verdict colour — the flagship Aug 8 feature — is wrong for these bets.
- CLV: close moves to −8. True away CLV: took +6.5, close offers +8 → **−1.5**. Computed: `spreadClv("away", +6.5, −8) = flip(6.5 − (−8)) = −14.5`. Wrong by an order of magnitude, and `closing_line` (home-perspective −8) is stored beside a side-perspective `line_taken` in the same row.

The **display** layer meanwhile assumes side-perspective — `fmtBetLine` (`ledger/page.tsx:19-24`) and `betPrefix` (`GameCard.tsx:875-880`) print `line_taken` raw, which is only right for what the slip currently stores. So the two halves of the product disagree about what the column means; whichever convention you standardize on, the other half must be converted.

`BetForm` manual entry has the same hole with no defensible answer at all: the "Line" field (`BetForm.tsx:129-138`, placeholder "-3.5") never states a convention. A bettor logging "Vandy +6.5" types `6.5` — their number — and gets misgraded per the above.

**No data is corrupted yet** (zero graded bets, same situation as the Aug 7 CLV fix), which is exactly why this is P0 *now*: the grader writes `result` once and skips non-null results, and the ledger is append-only by design — wrong grades persist forever, on the page whose brand is "receipts culture." Fix is small: convert at the write (`logSlipBets`) or the read (grader + live-status callers), state the convention in `db-types.ts`, and add the missing test that pins slip-write → grader-read round-trip for an away bet.

## 2. UX-02/03 (P1): the "sixth copy" the changelog warned about already exists — twice

The Aug 9 entry: *"All five now call one function \[`pickSideLabel`\]… so the away-spread sign fix can't be forgotten in a sixth copy."* Two sixth copies survive, both on `/game/[id]` — the page people open from the group chat:

- **Crew picks list**, `game/[id]/page.tsx:425-430`: renders `p.side === "away" ? \`${away.abbr} ${fmtSpread(Number(p.line_at_pick))}\`` — the raw home-perspective number. Your buddy took NCSU **+4.5** (stored −4.5); the list shows "**NCSU −4.5**". This is precisely the bug `lineForSide` was written to kill (`slate.ts:70-84`). Worse: straight-up picks fall into the same branch — `Number(null) = 0`, `fmtSpread(0) = "PK"` — so a winner pick renders "**OSU PK**" instead of "OSU to win". Your *own* picks on the same page use `pickSideLabel` (`:77-79`), so the two lists on one card can disagree about the same game.
- **GameHeader "Your action" chip**, `GameHeader.tsx:310-317`: `myPick.side === "away" ? \`${away.abbr} ${fmtSpread(myPick.line)}\`` — raw again, on the live surface, during the game. (The *status* underneath is computed correctly — `statusForPick` gets the home-perspective line it expects — so the chip shows the right colour with the wrong number, e.g. green "NCSU −4.5 · Covering by 2.5".)

Both are one-line fixes (call `pickSideLabel`). Add a lint-able convention note, because three occurrences of this exact bug in one month is a pattern, not an accident.

## 3. UX-04 (P1): groups run on Central Time, unlabeled

`docs/DESIGN.md` says glanceable; the prior audit's "two timezone behaviors" was marked fixed via `tzLabel`/viewer-local. The slate and game header are viewer-local (client re-render via `useViewerTz` — `SlateView.tsx:54`, `GameHeader.tsx:74`). But the entire groups product — shipped after that fix — is server-rendered in `DEFAULT_TZ` with **no label**:

- Board game rows: `kickParts(g.startTs, DEFAULT_TZ)` — `groups/[slug]/page.tsx:304`
- Matchup cards: `MatchupCard.tsx:68`
- Admin week config: `settings/page.tsx:87`
- Ledger's bet-form game labels: `ledger/page.tsx:63`

A Pacific-time member sees "Sat 11:00" on the board and "9:00 AM PT" on the slate for the same game, with nothing telling them the board is CT. On the *picking* surface, where the number next to a game gates "can I still get my pick in," that's not cosmetic. (Receipts also uses CT but labels it `tzLabel(DEFAULT_TZ)` — `receipts/page.tsx:193` — which is the acceptable version.) Fix: either a client re-render like the slate, or at minimum append `tzLabel(DEFAULT_TZ)`. `profiles.timezone` (UX-25) remains dead schema that could have answered this server-side.

## 4. UX-05 (P1): you cannot navigate weeks inside a group

The board reads `?week=` (`groups/[slug]/page.tsx:57-58`) but renders no way to change it — the nav row (`:162-196`) has "Week {week} picks", "Set the week" (admin), the join code and Share. The week grid page has no prev/next either. The only week UI in the entire groups product is the settings strip, which is admin-only and stops at 15 (UX-17). Concretely: on Sunday of Week 2, a member who wants "how did we do last week" — the single most predictable Sunday question for a pick'em pool — has to hand-edit the URL. Fix-size S: a prev/next pair or the slate's `WeekSelect` on the board and week pages.

## 5. UX-06 (P2): contrast, measured against the actual tokens

Computed from `globals.css` values, text composited over the glass card surface (`color-mix(surface 74%, bg)` dark / 86% light). The Aug 8 changelog's cover-strip numbers **reproduce exactly** (light covering/losing/bubble = 5.23/5.40/4.80; dark 6.53/4.64/7.30) — that fix is real. What the pass didn't cover:

**Dark (default, the Saturday-night theme):**
| Style | Ratio | Verdict | Where it's load-bearing |
|---|---|---|---|
| `text-chalk/35` | 2.95:1 | fail | refresh clock, search placeholder, "Model" grade label (`GameCard.tsx:1081`) |
| `text-chalk/40` | 3.47:1 | fail | summary-strip labels 10px, "WATCH"/"/100" 9-10px, ProjStat/CalStat/EdgeStat labels, receipts+groups table headers |
| `text-chalk/45` | 4.07:1 | fail (borderline) | odds column labels "SPREAD/TOTAL/MONEY" 10.5px (`GameCard.tsx:667`), watch band "Filler" |
| `text-chalk/50`, `/55`, `text-dim` | 4.73 / 5.47 / 7.02 | pass | — |

**Light (one tap away; `docs/DESIGN.md` calls light "the variant"):**
| Style | Ratio | Verdict |
|---|---|---|
| `--accent` #a97b0c on surface | **3.80:1** | fail — and it is everywhere: every `text-accent` section heading (14px), active nav tab, active pick button, "Sign in" links, group switcher |
| PickedChip (accent on accent/15) | **3.16:1** | fail |
| `text-chalk/55` (all table headers) | 3.88:1 | fail |
| `text-chalk/50` ("Kickoff — no pick made", ledger empty row) | 3.33:1 | fail |
| win/loss chip text on /12 tint | 4.18 / 4.45 | fail (marginal) |
| edge on card | 4.44:1 | fail (marginal) |

The dark failures are mostly uppercase *labels* (arguably decorative, but 9–10px at 3.4:1 in a bar is invisible); the light failures include primary interactive text. The prior audit's "light accent reads mud" was never re-toned. Recommended floor: chalk/50 minimum for any text in dark, a darker light-mode accent (~`#8a6509` reaches 4.9:1 on white), and the same `color-mix(... , var(--text))` idiom the cover strips already use for the chip tints. Fix-size S–M (token edits + a render check).

## 6. Navigation — verified current state

- **BottomNav** (`md:hidden`, fixed, `--bottom-nav-h` 64px + safe-area): Slate, Edges, Ledger, Groups + More; `SECONDARY_ITEMS` (Rankings, Ratings, Standings, Teams, Receipts) in a bottom sheet with Escape handling and focus move (`BottomNav.tsx:23-34`). Active state = `aria-current="page"` + inset accent bar; the More button only lights when a sheet route is current (`:119-128`). Detail routes map correctly (`/game`→Slate, `/crew`,`/rules`→Groups, `/recap`→Receipts — `nav-items.ts:20-30`). The prior audit's "9 tabs scroll horizontally" concern is **resolved**.
- One judgment call worth flagging: **Edges holds a permanent thumb-zone slot** while the Aug 7 verdict demoted edges to information (49.2% ATS). The four slots are the product's four most valuable tabs on a Saturday; Edges is arguably the fifth-most against Receipts/Rankings, and giving demoted information a permanent primary slot slightly contradicts the demotion. Owner call, not a defect.
- Desktop `NavTabs`: 9 tabs, no scroll at `md+`, same active treatment. Consistent on every route except `/login` (deliberate; but see UX-19 — the login page has no way *into* the public site).
- `/crew` and `/crew/week/[n]` are clean redirects into groups (`crew/page.tsx`, `crew/week/[week]/page.tsx`) — old links keep working. Good.

## 7. Week selector & back button

- `WeekSelect` (`SlateView.tsx:600-636`): weeks 1–16 + "Bowls & CFP", current week dotted. **Week 0**: there is no week-0 concept anywhere in the data model; the changelog treats Aug 29 as week 1 ("the single pick was on week 1, which kicks off on Aug 29"), consistent with CFBD's convention of filing week-zero games under week 1. So the selector is not missing anything — **but nobody has verified against live data that the Aug 29 games land in a selector-reachable week.** One-line pre-launch check: confirm `games.week` for the Aug 29–30 slate. If CFBD delivers them as `week: 0`, the selector, `?week=` validation (`>= 1` everywhere) and the group pages all exclude the launch slate. That would be a launch-day P0; verify now while it's free.
- URL state: `?week=`/`?st=post` honored server-side (`slate/page.tsx:23-37`) and mirrored with `replaceState` (`SlateView.tsx:210-225`) along with all filters — shareable slates work; refresh keeps your view. **Fixed-verified** (prior audit item 19).
- Back button not traversing week changes: I agree with the "deliberate" call — a `<select>` is a control, not a navigation, and history spam from six week flips would be worse. The real cost is small and real: your *first* in-slate week change rewrites the entry, so Back exits the slate instead of returning to the week you started on. `pushState` for week only (filters keep `replaceState`) would fix that if it ever bites; not launch work.

## 8. Tables at 375px

| Surface | Treatment | Verdict |
|---|---|---|
| Ratings (136 rows) | `max-h-[75vh] overflow-auto` panel, **sticky header** (`RatingsTable.tsx:142-144`), conference hidden below `sm`, percentile drawn as underline not a column | Good. 6 cols today (split hidden by honesty gate); 8 when Off/Def appear — expect tightness but scrolls in-panel |
| Ledger history | 7-col table in `overflow-x-auto` card (`ledger/page.tsx:286`) | Scrolls; acceptable. No sticky header; description truncates at 16rem |
| Receipts | 6-col per-week tables in `overflow-x-auto` (`receipts/page.tsx:198`) | Scrolls; fine |
| Game page market/systems | `overflow-x-auto` (`game/[id]/page.tsx:460`) | Fits 375 anyway (4 cols) |
| Group week grid | **Card layout** (MatchupCard), no table | Best-in-repo; the Aug 9 390×844 render pass shows |
| Group standings | 4-col table, no overflow wrapper (`groups/[slug]/page.tsx:199-246`) | Names + 3 numeric cols fits 375 until a long display name meets "+12.5"; `max-w` truncation on the name cell would be cheap insurance |

## 9. Feedback & latency on bar wifi

- **PickButtons** (`PickButtons.tsx`): `useTransition`, no optimistic state. Between tap and server-action-plus-revalidate (easily 2–5s on bar wifi), all the row's buttons dim to 50% and *nothing else happens* — no spinner, no provisional highlight. Users will re-tap; the second tap after settle is a *removal* (tap-your-side removes), so slow-network double-taps can silently undo the pick they just made. Errors do render (`:199`). Recommend: optimistic `aria-pressed`/highlight via `useOptimistic`, per-button pending, and buttons at ≥44px (currently ~38px: `py-2` + `text-sm`). P2 but it's *the* interaction of the product.
- **BetSlip**: "Logging…" label + disabled, success toast, error text — adequate. Units input 28px tall and remove buttons ~22px (UX-08).
- **VoidBetButton**: native `confirm()` — a real confirm step for the destructive action, fine; but the trigger is a ~14px text link (UX-08).
- **Slate refresh**: silent `catch {}` (`SlateView.tsx:137`) is the right call for polls, but the only staleness cue — the `fetchedAt` clock with the spinner — is `hidden sm:flex` (`:401`), i.e. hidden on **every phone**. On flaky wifi during a live slate, a phone shows old scores with no "as of" anywhere (UX-09). Show the clock on mobile, or flash a "reconnecting" pip when consecutive refreshes fail.

## 10. Loading, error, empty states

- Boundaries: root `loading.tsx` (nav shell + skeleton), root `error.tsx` ("Fumble on the play" + retry — a Supabase outage no longer white-screens), `not-found.tsx`, plus `slate/loading.tsx` with card skeletons. All verified present; every route inherits the root pair. Note `error.tsx` renders no `AppNav`, so a data error also drops navigation — minor.
- Empty states, checked against the *actual* launch-week reality (stale 2026.2.0 ratings, totals/Off-Def hidden by gate): ratings explains its hidden columns in plain words (`RatingsTable.tsx:224-229` — exemplary); receipts pre-freeze copy is designed; rankings, edges, groups (no group / week not set / no games / nobody-in-yet / blind "Hidden") all designed and specific; fresh ledger fine. Two misses: slate's "The slate fills in when data ingestion runs" (UX-23 — say "Schedules land in the offseason as they're announced" or similar), and the team page silently omits the verdict block while its own meta description promises "the verdict" (`team/[id]/page.tsx:32,261-262`).
- The honesty-gate surfaces (totals suppressed for pre-2026.3.0 rows) are correctly wired on both the slate (`queries.ts:431-439`) and game page (`game/[id]/page.tsx:177-179`) — showing less, not wrong. Verified.

## 11. Live states

- Card differentiation pregame/live/final/dead: verified (`card-live` ring, `card-final` desaturation, dead games sink in sort, aura strength 0.42 live-position / 0.14 pregame-position / 0.30 teams / 0.12 final / 0 dead — `GameCard.tsx:143-151`). Chroma/motion separation of team vs verdict colours is implemented as the changelog describes (`globals.css:319-335`).
- `aria-live` score announcements exist on cards **only when you have a pick** (`GameCard.tsx:201-206`) and on the game header always (`GameHeader.tsx:241-247`). Defensible (announcing 60 games is worse), worth knowing.
- Ticker: anon-accessible, viewer-local times (browser-implicit `Intl` — `ScoreTicker.tsx:119-122`), publishes `--ticker-h`. Items are ~26px tall — under target floor, but they're a strip of dense links; acceptable, noted.
- Cover strip semantics (word = side of the number, tier = colour/aura) match the Aug 8 spec. The **matchup card with real names remains unverified** exactly as the changelog says — first real Saturday should include a look.

## 12. Number formatting

`fmtSpread` reach is now near-total (ledger fixed, verified). Remaining inconsistencies: receipts' private `fmtLine` prints one decimal always ("+3.0" where the rest of the site says "+3", "PK" duplicated — UX-20); explicit `+` on positive CLV/units verified everywhere I looked (ledger stats, receipts, group standings, pick chips); null vs 0: ungraded picks render nothing (fixed Aug 9, verified `week/[week]/page.tsx:291-298`), null CLV renders "–" with a title explaining why (`receipts/page.tsx:264`), `−0` guarded in `lineForSide`/`clv.flip`. UX-24: the week page is the one caller passing possibly-string `line_at_pick` unconverted.

## 13. Sharing & PWA

- `ShareButton` is genuinely right for the product (native share sheet, text-only payload so the picks survive the iMessage preview, clipboard fallback, "just placed" from session store). `generateMetadata` on game/team verified.
- **UX-12**: no OG image. For a group-text product, every shared `/game/…` link renders as bare text in iMessage. Changelog open item #46; it is the highest-leverage remaining share improvement and it's additive.
- **UX-13**: `manifest.ts` is correct (standalone, `/slate` start URL, theme colours) but icons are `icon.svg` only. iOS ignores SVG manifest icons and looks for `apple-touch-icon`; there is none (`src/app/` has only `favicon.ico`/`icon.svg`, `public/` is empty). Result: the crew member who does "Add to Home Screen" — the exact spec §8 behavior — gets a screenshot-thumbnail tile. One 180×180 PNG (`app/apple-icon.png`) plus 192/512 PNGs in the manifest closes it. Also `viewport.themeColor` keys off `prefers-color-scheme` while the app themes via `data-theme` — a light-toggled user on a dark-OS phone gets a dark status bar over a light page (cosmetic).

## 14. Groups first-run (the commissioner path)

Create → name → visibility → admin lands on the board → "Week N isn't set up yet → Choose the games and bet types" → settings with mode/markets/min-picks and orphan warnings → join code one tap from the board header. This flow is genuinely good (all controls ≥44px, `min-h-11` throughout the group forms). Gaps: UX-05 (week navigation), UX-07 (blind board count), UX-16 (orphan count for dropped markets), UX-11 (rules page contradicts the blind), and discoverability from the other direction (UX-14): a member whose entry point is the slate or a game page gets pick state scoped by an invisible active-group cookie — with two groups, which group the slate's odds-cell rings refer to is stated nowhere on the slate. A one-line "picks: {group name}" chip near the filter bar would close it.

## 15. Focus states

Card overlay links have explicit `focus-visible` outlines (`GameCard.tsx:182`, `edges/page.tsx:101`). Buttons (PickButton, OddsCell, DayTab, FilterToggle, sort headers) rely on the UA default ring — present, since nothing suppresses it globally; acceptable per the quality floor, not styled. The weak spots are inputs/selects using `focus:outline-none` with only `focus:border-accent/60` as the indicator (`SlateView.tsx:437,694`, `BetForm.tsx:53`, `BetSlip.tsx:133`) — a 1px border tint change at 60% alpha is a marginal focus indicator, and in light mode that accent is the 3.80:1 colour (UX-06). Restore a visible ring on focus for form fields. P3.

---

## For 00-SUMMARY.md

- **P0 · UX-01 — Bet slip / BetForm spread `line_taken` convention mismatch**: slip writes side-perspective, grader + live chips + CLV read home-perspective → away spread bets silently misgraded and mislabeled, persisted in the append-only ledger; zero rows affected *today*, must land before the first graded bet. **(S — convert at write or read + one round-trip test)**
- **P1 · UX-02/03 — Two surviving un-deduplicated pick-label copies** on `/game/[id]` (crew list, GameHeader "Your action") show away picks with flipped sign and straight-up as "PK". **(S — call `pickSideLabel`)**
- **P1 · UX-04 — Groups + ledger render kickoffs in unlabeled CT** while slate/game are viewer-local; same game, two times, on the picking surface. **(S–M — client tz re-render or `tzLabel` suffix)**
- **P1 · UX-05 — No week navigation in groups** (board/week pages URL-only); the Sunday "last week" flow doesn't exist. **(S — WeekSelect/prev-next on board + week page)**
- **P1-adjacent pre-launch check — confirm the Aug 29 slate lands in `week >= 1`** in the games table; every selector and route validates `week >= 1`, so a CFBD `week: 0` delivery would make the launch slate unreachable. **(verification only)**
- P2 highlights for the exec list if space allows: light-mode accent 3.80:1 + chip tints under 4.5 (UX-06, S–M); phone-invisible staleness cue (UX-09, S); PickButtons optimistic/pending + 44px (UX-10, S); iOS home-screen icon missing (UX-13, S); `/rules` contradicts the pick blind (UX-11, S).
