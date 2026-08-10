# 00 — Executive Summary

**The CFB Slate · full product, UI/UX & model audit · 2026-08-09 · 20 days to Week 0.**

Ten workstream reports follow this file. Every finding cites `file:line`; every
sign, probability, and money claim is worked numerically in its report. Where the
audit brief's hypotheses were written against the early-August snapshot, each
was re-verified against current code — a large fraction were real, and were
already found and fixed by the Aug 6–9 remediation work (the prior audit's
status tables in `docs/AUDIT-2026-08.md` held up under re-verification). What
follows is what is true **today**.

**Verdict up front: this ships on Aug 29.** Phase 1 is ~92% built
(`01-feature-inventory.md`), the RLS integrity layer holds under adversarial
re-derivation (`06`), CLV's sign convention is correct and tested (`05`), and
the model's honesty layer (edges demoted to information on the strength of
β₂ = 0.035, t = 0.84) is the most intellectually honest thing in the product.
But two P0s stand between today and a launch that doesn't quietly corrupt the
season — one in the bet slip, one in operations — and a family of sign-display
bugs would put wrong numbers on the flagship surfaces from Week 1.

## P0 / P1 table

| # | Sev | Finding (one line) | Evidence | Fix |
|---|---|---|---|---|
| A1 | **P0** | Bet slip + BetForm store **side-perspective** `line_taken` while grader + CLV read **home-perspective** → every away spread bet misgrades and gets wrong CLV, silently, in the append-only ledger (zero rows affected today; first grading run is Sun Aug 30) | `GameCard.tsx:689` → `actions/bets.ts:118` vs `jobs-core.ts:564`; `08-ui-ux.md` UX-01 | S |
| A2 | **P0** | Production serves the **2026.2.0** preseason build: churn = portal-stars-only (0/138 returning-production matches, verified in live DB), coaching 0, HFA from 2.3, Sac State/NDSU at the −8 talent constant ranked 94/108. Self-heals only if CFBD publishes 2026 talent before the Aug 27 cron window — **hard human check Aug 26** + fallback decision | `04-data-quality.md` DQ-1; `01` F1 | S (vigilance + one decision) |
| B1 | P1 | `team_hfa` is inflated ~+1.9 at the mean (raw home/away margins, FCS buy games; spec says residuals) — the imminent refresh rebuilds it at base 3.0 ⇒ mean ≈ 3.96 ⇒ **≈ −0.9 home bias on every priced game**, invisible to the backtest (replay never uses `team_hfa`). Must land **before** the refresh goes green | `build-preseason.ts:514-523`; `03` M-1 | S |
| B2 | P1 | Edges page "Model lean" prints away leans with the home-perspective sign ("AWAY −4.5" when the bettor holds +4.5) — the sixth copy of the away-sign bug; `lineForSide` exists and isn't called | `edges/page.tsx:132`; `02` M-01 | S |
| B3 | P1 | Game page Systems table negates SP+/FPI/Elo into home-positive while its own footnote and the Model row use market convention — the two rows show opposite signs for the same lean | `game/[id]/page.tsx:255,599`; `02` M-02 | S |
| B4 | P1 | Two more un-deduplicated pick-label copies on `/game/[id]` flip away-pick signs (crew list, "Your action") | `08` UX-02/03 | S |
| B5 | P1 | `/edges` still prints cover prob at model weight 1.0 (normal CDF "62%") three lines under its own "49.2% vs the close" disclaimer — drop it or reprice at w=0.034 | `ratings.ts:581`, `edges/page.tsx:123-128`; `03` M-2 | S |
| C1 | P1 | SQL and JS half-point snapping disagree on negative quarter-points (Postgres `round(-6.5)`=−7, JS `Math.round(-6.5)`=−6 → −3.5 vs −3.0): phantom ±0.5 CLV on unmoved lines, two "consensus" values across paths | `consensus.ts:29` vs `0015:23-26`, `0021:207`; `05` N1 | S |
| C2 | P1 | No closing burst on Thu/Fri nights → weeknight closes are 1.5–5 h stale and silently banked, starting Sep 4 | `jobs.yml:56-57`; `05` N2 | S |
| D1 | P1 | No job_runs table, no dead-man's switch, failure emails unverified (workflow committed by the bot) — every job death is silent to the operator | `07` OPS-1 | S/M |
| D2 | P1 | Scoreboard crons cover **no Sunday/Monday games** — Week 1's Labor Day slate gets no live scores | `jobs.yml`; `07` OPS-2 | S |
| D3 | P1 | No "lines as of" stamp anywhere; slate header's clock is page-fetch time; stale data is indistinguishable from fresh | `07` OPS-3, `10` G2 | S/M |
| D4 | P1 | `preseason-refresh` can decline (exit 0) every day through Aug 27 and strand launch on 2026.2.0 with zero escalation — make declines loud after Aug 20 | `07` OPS-4 | S |
| E1 | P1 | `--check` passes a partially-published talent file; −8 defaults counted nowhere; feeds an unattended auto-load — the 2026.2.0 bug class at partial scale | `build-preseason.ts:363-385,253`; `04` DQ-2 | S |
| F1 | P1 | No DB regression tests for `bets` void-only trigger or `profiles.is_admin` column grant — a future migration reopens ledger forgery/admin escalation with green `db:test` | `06` SEC-03 | M |
| G1 | P1 | Verdicts LLM batch is dispatch-only and never run — fire it (and confirm `ANTHROPIC_API_KEY`) or team pages launch without the LLM tier | `01` F2 | S |
| G2 | P1 | First real freeze→grade→CLV→receipts run happens Sun Aug 30 — schedule a supervised watch | `01` F17 | S |
| H1 | P1 | Groups + ledger render kickoffs in unlabeled CT while slate/game are viewer-local — same game, two times, on the picking surface | `08` UX-04 | S–M |
| H2 | P1 | No week navigation on group board/week pages (URL-only) — the Sunday "last week" flow doesn't exist | `08` UX-05 | S |
| H3 | P1 | Pre-launch check: every selector validates `week >= 1`; if CFBD delivers Aug 29 as `week: 0`, the launch slate is unreachable — verify against real rows | `08` | verify |
| I1 | P1 | Slate poll ships raw week-wide `line_snapshots` (~1.1 MB/tick) → ~1.5 GB egress per Saturday vs ~5 GB/mo free cap — silent mid-season throttle | `queries.ts:152-156`; `09` P-1 | M |
| I2 | P1 | Scoreboard loop rewrites live+final rows unconditionally every 30 s → ~1M realtime messages/Saturday vs 2M/mo quota; realtime then dies silently | `jobs-core.ts:88-107`; `09` P-2 | S |
| I3 | P1 | Zero load evidence before a 60-game Saturday — run the seeded rehearsal in `09` §8 and record numbers | `09` P-16 | S |

Everything else is P2/P3 and lives in the workstream files. Notable
reassurances, all re-verified: CLV sign correct in all four cases with the away
case worked from first principles (`05`); the three original RLS holes stay
closed through migration 0023 (`06`); storage blowout is a myth (~45 MB/season);
grading, freeze, weather, scoreboard, and calibration all exist and are
scheduled (`01`, contra the audit brief's fears).

## The single most important sentence

**The shop already measured its own edge and the answer is ~zero: b₁ = 0.035
(t = 0.84) for the model vs 0.987 (t = 22.81) for the market (n = 2611), and
flagged edges went 49.2% ATS against the close** — so the product's value is
disagreement bookkeeping and CLV honesty, not picking winners; accordingly
**no model-accuracy work belongs in the next 20 days** (`03`). The only model
work that matters now is correctness-protecting: B1, B2/B3, B5.

## 20-day plan (evenings/weekends, one person + Claude Code)

- **Aug 10–11 — Ledger integrity (the P0).** A1: convert `line_taken` to
  home-perspective at write (slip + BetForm) with a round-trip grading test;
  C1: unify snapping (one rounding rule, three sites) + test. These two guard
  the numbers the group will argue about in January.
- **Aug 12–13 — Sign-display batch.** B2, B3, B4 (route every label through
  `lineForSide` / drop the systems-table negation), B5 (remove cover prob from
  `/edges`). All S; one PR; render-check at 390×844.
- **Aug 14–16 (weekend) — Ops hardening.** D1 job_runs + dead-man ping; D4
  loud-decline after Aug 20; D2 Sun/Mon scoreboard crons; C2 Thu/Fri burst
  crons; D3 "lines as of" stamp.
- **Aug 17–18 — Preseason-pipeline guards (before the refresh can land).**
  B1 centered team_hfa blend + test; E1 `--check` talent-coverage gate.
- **Aug 19–20 — Perf + rehearsal.** I2 no-op write skip; I1 slim the poll
  payload (view or trimmed endpoint); I3 seeded load rehearsal, record numbers.
- **Aug 21–23 (weekend) — Product seams.** F1 bets/profiles DB tests; H1
  timezone labels; H2 groups week nav; G1 fire the verdicts batch; H3 week-0
  verification once CFBD's Week 0 rows sync; responsible-gambling footer
  (`10` G1, 15 min).
- **Aug 24–25 — Buffer / P2 batch** (contrast fixes, pick-button pending
  states, DQ-3 talent fallback) — only if the buffer survives.
- **Aug 26 — HARD CHECKPOINT.** Is `preseason-refresh` green? If yes: verify
  the loaded top 25 against the seven smell tests in `04`. If no: decide —
  manual build on 2025 talent (documented, with the churn column labeled) vs
  launching on 2026.2.0 with a visible "preseason ratings pending" note.
  Do not let this decision get made by silence.
- **Aug 27–28 — Dress rehearsal.** Real group created, real members invited,
  Week 0 board configured, freeze dry-run, phones in hands.
- **Aug 29 — Week 0. Aug 30 —** supervised watch of the first grading run
  (G2): confirm results, CLV signs, and null-CLV reasons on real rows.

## The three questions, answered plainly

**1. If we shipped exactly today's build on Aug 29:**
*Users would notice:* preseason ratings that undersell the model (2026.2.0 —
even off/def splits hidden by the honesty gate, no totals, churn that is
secretly just portal stars); the edges page showing "AWAY −4.5" leans that
contradict the game page; SP+ and Model rows disagreeing in sign in the same
table; no live scores on Labor Day Sunday/Monday; kickoff times that differ
between the group board and the slate.
*Users would NOT notice — and that's the dangerous list:* away bets from the
slip grading wrong and poisoning the append-only ledger from the first Sunday;
±0.5 phantom CLV from the snapping mismatch; a ~−0.9 home bias silently
arriving *with* the "fix" the moment the preseason refresh lands; stale
Friday lines being banked as Saturday closes on weeknight games; and any
scheduled job dying with nobody told.

**2. The single most likely way this produces wrong numbers for a full
season:** the `line_taken` convention mismatch (A1). It corrupts an
append-only table, it self-conceals (the ledger displays the raw stored
number, so every row *looks* right), roughly half of all spread bets are away
sides, and the group's CLV — the product's stated arbiter of truth — degrades
into plausible noise. The runner-up is B1, which would misprice every game by
~a point on the home side while the backtest keeps reporting zero bias,
because the backtest never exercises `team_hfa`.

**3. What to cut from Phase 1 to protect slate/pick'em/ledger:** the
injury/news LLM scan (the manual admin-adjustment path covers launch), the
rooting guide, the playoff race tracker, the futures tracker, team-page LLM
depth beyond the one verdicts batch, OG share images, and *all*
model-accuracy work (β₂ ≈ 0 says there is nothing there to chase this month).
None of these are on the critical path; every one of them is severable; and
the spec itself designated the LLM tier as the slip item. What is **not**
cuttable: the grading/CLV pipeline fixes, the sign-display family, and the
Aug 26 checkpoint — those are the product.
