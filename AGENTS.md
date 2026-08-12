<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- Everything below is hand-written and survives `next dev`: the generator
     (node_modules/next/dist/server/lib/generate-agent-files.js) replaces only
     the region between the BEGIN/END markers above. -->

# Project context

Two live documents, then the history.

- **`docs/STATUS.md` — what's left. The only file with unchecked boxes.**
  Every open item in the repo, one list, with its original audit ID, the
  evidence that decided it, and its date. Blocking work, decisions owed,
  post-launch queue, deliberate deferrals, and the residuals that are recorded
  rather than queued. **A box is checked in the commit that lands the fix.** If
  work isn't in this file, it isn't tracked — add it there, don't start a new
  list.
- **`docs/CHANGELOG.md` — what shipped, and what was tried and rejected.**
  Running log, plus a decisions table recording every gated experiment
  *including the rejections*, each with the number that decided it. Several
  plausible-sounding model ideas (per-play efficiency, blending in SP+,
  widening early-season sigma) have already been tested and rejected on
  evidence. Check there before proposing one.
- `docs/SPEC.md` — what we're building and why.
- `docs/BRAND.md` — Brand System v1.0: the Slate S, the palette, the launch
  surfaces. The `§` numbers in `src/lib/brand.ts`, `scripts/build-brand-assets.ts`
  and `app/manifest.ts` point here. Identity only — DESIGN.md still governs
  behaviour, and what has actually shipped from it is in `docs/STATUS.md`
  (BRAND-1…BRAND-7).
  **The icon is supplied artwork, not code.** `public/brand/slate-icon-source.png`
  is the master; `npm run brand` only resamples, crops and composites it. Do not
  redraw the mark — that was tried twice and neither attempt held up next to the
  original.
- `docs/DESIGN.md` — design rules for this product. Read before any UI work.
  Says which of the installed design skills owns what, and carries the
  product-specific constraints those skills can't know (glanceable, no layout
  shift, thumb zone). Also defines the two modes — exploration vs.
  implementation — and the token rules that are hard in the second.

The audits are history, kept intact and not edited to look better in hindsight.
Read them for *why* a finding exists; read `docs/STATUS.md` for whether it is
still open. `docs/AUDIT-2026-08.md` (Aug 6 product audit, 18 bugs + 46-item
checklist), `audit/KICKOFF_READINESS.md` (Aug 11–12 Week 0 readiness, P0/P1/P2),
`audit/CHECKLIST.md` (the completed Package A–C program), `audit/00`–`10` (the
workstream reports the `NN:XX-N` IDs come from).

## Model changes

The model is gated. Every parameter in `DEFAULT_PARAMS` is either fitted by a
`backtest.ts --tune-*` flag or sits at an identity default that reproduces the
previous version exactly. Do not change one without running its tuner and
recording the result in the changelog — including when the answer is "no".
