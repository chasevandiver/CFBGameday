<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- Everything below is hand-written and survives `next dev`: the generator
     (node_modules/next/dist/server/lib/generate-agent-files.js) replaces only
     the region between the BEGIN/END markers above. -->

# Project context

- **`docs/CHANGELOG.md` — read this first.** Running log of what shipped, plus a
  decisions table recording every gated experiment *including the rejections*,
  each with the number that decided it. Several plausible-sounding model ideas
  (per-play efficiency, blending in SP+, widening early-season sigma) have
  already been tested and rejected on evidence. Check there before proposing one.
- `docs/SPEC.md` — what we're building and why.
- `docs/DESIGN.md` — design rules for this product. Read before any UI work.
  Says which of the installed design skills owns what, and carries the
  product-specific constraints those skills can't know (glanceable, no layout
  shift, thumb zone). Also defines the two modes — exploration vs.
  implementation — and the token rules that are hard in the second.
- `docs/AUDIT-2026-08.md` — Aug 2026 product audit, **reconciled 2026-08-07**.
  The 18 bugs and the 46-item checklist each carry a status table verified
  against the code. The raw `[ ]` boxes below those tables are the original
  text, kept as the historical record — read the table, not the boxes.

## Model changes

The model is gated. Every parameter in `DEFAULT_PARAMS` is either fitted by a
`backtest.ts --tune-*` flag or sits at an identity default that reproduces the
previous version exactly. Do not change one without running its tuner and
recording the result in the changelog — including when the answer is "no".
