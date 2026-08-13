# The CFB Slate

A college football ratings, edges, pick'em, and bet-tracking site for the crew. Full product spec — including the prediction model, league rules, and the honesty layer — lives in [`docs/SPEC.md`](docs/SPEC.md).

**Stack:** Next.js (App Router) on Vercel · Supabase (Postgres, Auth, pg_cron + Edge Functions) · CollegeFootballData API · Open-Meteo · Anthropic API.

## Setup

1. Copy `.env.example` to `.env.local` and fill in keys:
   - **CFBD**: register at [collegefootballdata.com/key](https://collegefootballdata.com/key). **Tier 1+ is required**, because the scoreboard and weather endpoints are entitlements the free tier does not grant. It is not about call volume — a full cold 2023–25 backtest backfill is 16 calls. We run Tier 2 (30,000/mo) against ~10,000 of expected use.
   - **Supabase**: create a project, then apply every file in `supabase/migrations/` in order (via `supabase db push` or the SQL editor). Applying only `0001` leaves the integrity lockdown, groups and per-group picks out — the app will not work.
   - **Anthropic**: for the LLM layer (team verdicts, three questions, scoped news scan).
2. `npm install`
3. `npm run dev`

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm test` | Model and app unit tests (vitest) |
| `npm run db:test` | Applies every migration to a throwaway Postgres and asserts the RLS policies, grants and security-definer guards (needs local Postgres binaries) |
| `npm run backtest` | Point-in-time backtest over 2023–2025 (needs `CFBD_API_KEY`; add `-- --cached` to reuse fetched data, `-- --tune` to grid-search parameters) |
| `npm run probe:cfbd` | What the CFBD key's **tier** grants, endpoint by endpoint (11 calls, read-only). Distinguishes DENIED (buy a tier) from EMPTY (wait for CFBD to publish) — a distinction `build-preseason.ts --check` cannot make, because the tier-gated endpoints are the ones the preseason build never touches. Also runs as the `cfbd-probe` Actions task, and alongside the daily August `preseason-refresh`. |

## Repo layout

```
docs/SPEC.md                     the build spec (v2, amended + verified)
supabase/migrations/             schema + RLS (picks hidden until kickoff, append-only ledger)
src/lib/cfbd.ts                  the ONLY module that talks to CFBD
src/lib/supabase/                server/browser Supabase clients
src/model/ratings.ts             prediction model (pure functions, versioned params)
scripts/backtest.ts              lookahead-guarded replay + calibration report
```

## Principles (short version)

- Predictions are frozen and timestamped; the Receipts page is a feature.
- The ledger is append-only and unhideable by design.
- CLV — measured against our own captured closing lines — is the arbiter of whether anyone's edge is real.
- ATS trends are shown for fun and never fed to the model.
