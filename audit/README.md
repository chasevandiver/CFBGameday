# `audit/` — the history, and how to read an ID

**Nothing in this directory is open. For what is still open, read
[`docs/STATUS.md`](../docs/STATUS.md).**

Fourteen point-in-time documents from four audit passes in August 2026. They are
kept intact and are **not edited to look better in hindsight** — only to stop
being wrong about their own status, and to fix a path when a file moves. Where
one of them contradicts `docs/STATUS.md`, STATUS is right: its rows were decided
by reading code, these were decided on the day.

They are worth keeping for one reason. They record *why* a finding exists and
what the evidence was, which no checklist preserves — and in two places they
record a pass getting it wrong, which is worth more than a clean document.

## Resolving an ID

`docs/STATUS.md` cites findings as `NN:XX-N` — `04:DQ-13`, `09:P-16`,
`05:N9`, `07:OPS-11`. **The leading number is the file.** `04:DQ-13` is finding
DQ-13 in `04-data-quality.md`.

| # | File | Owns |
|---|---|---|
| 00 | `00-SUMMARY.md` | The Aug 9 pass, summarised |
| 01 | `01-feature-inventory.md` | `F-NN` — what exists vs what SPEC promises, and the "Phase 1 is ~92% built" figure (its own §, line 229, with the reasoning) |
| 02 | `02-model-correctness.md` | `M-NN` — model bugs and dead code |
| 03 | `03-model-improvements.md` | `M-N` — proposed model work, mostly still open in STATUS §4 |
| 04 | `04-data-quality.md` | `DQ-NN` — inputs, proxies, and what the numbers actually measure |
| 05 | `05-clv-and-grading.md` | `N-NN`, `C-N` — the grader, CLV, the append-only tables |
| 06 | `06-security-rls.md` | `SEC-NN` — RLS, grants, the definer functions |
| 07 | `07-ops-observability.md` | `OPS-NN` — jobs, alerting, the dead-man checks |
| 08 | `08-ui-ux.md` | `UX-NN` |
| 09 | `09-performance.md` | `P-NN` — query and page performance. `09:P-16` is the load rehearsal |
| 10 | `10-gap-analysis.md` | `G-NN` — gaps between the product and the spec |

Two ID collisions to know about, because both use bare letters:
`P-NN` from `09-performance.md` is **not** `P0/P1/P2-N` from
`KICKOFF_READINESS.md`, and `M-N` appears in both 02 and 03.

## The four passes, oldest first

| Date | File | What it was |
|---|---|---|
| Aug 6 | `AUDIT-2026-08.md` | Full product audit — 18 bugs, a 46-item checklist, a score card. Its checkboxes were brought true on 08-12. |
| Aug 9 | `00`–`10` | Eleven parallel workstream reports. The source of every `NN:XX-N` ID above. |
| Aug 10 | `CHECKLIST.md` | The Package A–C remediation program that ran off the Aug 9 reports. A completed record: 75 boxes, all checked, two of them honestly partial and re-opened under new IDs. |
| Aug 11–12 | `KICKOFF_READINESS.md` | Week 0 readiness. P0/P1/P2 severity analysis, a live backtest re-run, and a day-by-day plan to Aug 29. Revised twice on 08-12 as evidence came in. |

## What none of them caught

Recorded here because it is the honest measure of what an audit is worth. Three
defects were found on 2026-08-13 by reading the code again, after four passes
had signed off:

- **The notification crons were declared and never routed.** Six crons resolved
  to `task=unknown` and exited 1. Zero notifications had ever been sent, and
  Week 0's picks-due nudge would not have gone out.
- **`make_pick` never cleared `result`.** A comment had promised since 0013 that
  a member re-picks a revived game; the grader filters on `result is null`, so
  that pick would never have been graded, in any season.
- **Nine failure emails had arrived unread**, including the one
  `KICKOFF_READINESS` P1-8 asked about. The channel worked. Nobody was reading
  it.

The pattern in all three: each component was verified at its own level and the
seam between them was not testable by any of those verifications. A push was
proved on a real iPhone; a cron was proved by reading YAML; nothing proved the
cron reached the push.
