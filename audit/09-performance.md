# Workstream 9 — Performance

**Auditor scope:** data layer, render path, polling/realtime, bundle, and quota headroom for ~15
users bursting on Saturday mornings over bar wifi, on Vercel Hobby + Supabase free tier.
**Verified against the repo as of 2026-08-09** (`main` at `3794ca6`). All byte/latency figures
below are back-of-envelope estimates with stated assumptions — nothing in this report was measured
against production, which is itself finding P-16.

## Summary

The prior audit's structural claims mostly check out: `line_consensus` and `latest_ratings`
(migration 0015) exist and are used, the 0018 hot-path indexes match the actual query shapes
almost everywhere, the 30-second poll is now an adaptive 30/90/180s visibility-gated poll, and the
client bundle is genuinely lean (no chart libs, self-hosted fonts, tree-shaken icons). But the
headline "consensus reduced in Postgres fixed the structural problem" is only **half true**: the
same `fetchSlateView` that reads the consensus view still ships the **raw 7-day
`line_snapshots` history for every game of the week on every poll tick** — roughly 12–15k rows
(~1.1 MB) per tick on a 60-game Saturday, reduced to 24 sparkline points per game *after* the
transfer. Combined with three other full-season sub-queries that grow linearly all season, one
Saturday of nominal polling burns ~1.5 GB of Supabase egress against a ~5 GB/month free-tier cap,
and a realtime hiccup (30s fallback polling) can blow the cap in a single afternoon. Separately,
the scoreboard loop rewrites every live *and already-final* row every 30 seconds unconditionally,
fanning out realtime messages at a rate that plausibly exceeds the free tier's monthly message
quota in two Saturdays. Neither failure is loud: Supabase throttling looks like a mysteriously
broken site in mid-season. Both are cheap to fix, and neither requires touching the model or the UI.

## Findings table

| ID | Severity | Type | Status | One-line | Evidence |
|---|---|---|---|---|---|
| P-1 | **P1** | design weakness | **NEW** (partial regression of a "fixed" item) | Poll path ships raw week-wide `line_snapshots` history (~1.1 MB/tick) that's reduced to 24 points/game in JS; projected to exhaust Supabase free egress mid-season | `src/lib/queries.ts:152-156`, `supabase/migrations/0015_consensus_views.sql:1-13` |
| P-2 | **P1** | design weakness | **NEW** | Scoreboard loop unconditionally rewrites live **and final** rows every 30s → realtime UPDATE fan-out ≈ 1M+ messages per Saturday vs ~2M/month free quota | `scripts/lib/jobs-core.ts:88-107`, `scripts/scoreboard-loop.ts:126`, `src/lib/use-games-realtime.ts:52-56` |
| P-3 | P2 | design weakness | NEW | `system_ratings` fetched for all weeks of the season per tick, reduced to latest in JS — ~5,000 rows (~350 KB) by week 14; no `latest_systems` view | `src/lib/queries.ts:210-215` |
| P-4 | P2 | design weakness | STILL OPEN | Whole-season `poll_rankings` + whole-season finals scan on every slate tick; both grow linearly through December | `src/lib/queries.ts:183-187`, `192-196` |
| P-5 | P2 | design weakness | STILL OPEN | `/game/[id]` still does `profiles.select("*")` — full table, all columns | `src/app/game/[id]/page.tsx:134` |
| P-6 | P2 | design weakness | STILL OPEN | `fetchTeamAtsSeason` re-fetches `line_snapshots.select("*")` for every final either team has played, per game-page view (~700 KB by November) | `src/lib/queries.ts:514-518` |
| P-7 | — | — | **FIXED-verified** | `line_consensus` + `latest_ratings` views exist, are `security_invoker`, and are actually consumed; 0018 indexes match query shapes | `0015_consensus_views.sql:19-49`, `0018_perf_advisors.sql:68-75`, `queries.ts:151,189-191` |
| P-8 | — | — | **FIXED-verified** | "30s poll re-runs the pipeline per client" → now adaptive: 180s with realtime connected, 30s only when live *without* realtime, 90s otherwise; visibility-gated | `src/components/slate/SlateView.tsx:186-195` |
| P-9 | P2 | design weakness | NEW | Blind-group week page fires one `group_game_pick_count` RPC per hidden game — 60 parallel RPCs on a full-slate blind group | `src/app/groups/[slug]/week/[week]/page.tsx:114-127` |
| P-10 | P3 | design weakness | NEW | Group board runs three overlapping `picks` queries per render (season crew picks inside `fetchSlateView`, season tallies, week `select("*")`) | `src/app/groups/[slug]/page.tsx:67-71,74-80,88-92`; `queries.ts:198-205` |
| P-11 | P2 | design weakness | STILL OPEN | Everything is `force-dynamic` (20 pages + 3 routes); weekly-static pages can't take `revalidate` because `createClient()` reads `cookies()`; every page pays a 3-query serial season/week pointer | all `page.tsx`; `src/lib/season.ts:36-55`, `queries.ts:554-566` |
| P-12 | P3 | design weakness | NEW | `/ratings` fetches every week of every team (~2,040 rows by week 15) to derive latest + previous | `src/app/ratings/page.tsx:31-35` |
| P-13 | P3 | design weakness | STILL OPEN | Receipts renders the whole season in one document, no pagination (~840 predictions + games + teams by December) | `src/app/receipts/page.tsx:32-38` |
| P-14 | P3 | design weakness | NEW | 120 third-party logo `<img>`s per 60-game slate (espncdn URLs, no `next/image`); fine on wifi, slow on 3G; fonts/bundle otherwise clean | `src/components/slate/TeamMark.tsx:36-46`, `src/app/layout.tsx:2-20`, `package.json` |
| P-15 | P3 | design weakness | NEW | `/api/ticker` runs 5 queries per 60s per client on **every** route (ticker mounts in AppNav), incl. the 3-query pointer chain | `src/components/ScoreTicker.tsx:49-51`, `src/app/api/ticker/route.ts:20-27` |
| P-16 | **P1** | process | STILL OPEN | Nothing has been load-tested under a real 60-game Saturday; cheapest rehearsal plan below | — |
| P-17 | P3 | design weakness | NEW | Anon viewers may never get realtime (no session → `setAuth` never called); if anon realtime doesn't deliver, signed-out clients sit on the worst-case 30s poll all Saturday | `src/lib/use-games-realtime.ts:42-47`, `SlateView.tsx:189` |

No P0. At 15 users nothing here breaks Week 0 on its own; P-1/P-2 are P1 because they exhaust
monthly quotas silently by mid-September, and silent failures rank above loud ones.

---

## 1. The prior audit's claims, re-verified

**Claim: "line_consensus + latest_ratings views (0015) fixed the snapshot-shipping problem."**
Half true. `line_consensus` (`0015_consensus_views.sql:19-35`) does push the *consensus* reduction
into Postgres, and `fetchSlateView` consumes it (`queries.ts:150-151`). `latest_ratings`
(`0015:37-42`) likewise replaces the every-week ratings fetch (`queries.ts:188-191`). **But the
sparkline history query directly below it re-fetches the raw snapshots anyway:**

```ts
// src/lib/queries.ts:152-156
supabase
  .from("line_snapshots")
  .select("game_id, provider, spread, captured_at")
  .in("game_id", gameIds)
  .gte("captured_at", historyStart),   // trailing 7 days — the WHOLE week's rows
```

The columns are slimmed (4 of 10) and the window is 7 days, but the 7-day window contains
essentially every snapshot the week has, and `consensusHistory` (`queries.ts:48-75`) throws away
everything but the trailing 24 consensus *changes* per game — after the rows crossed the wire.
The migration's own comment (`0015:1-7`) describes exactly this failure mode as the thing it fixed.
It fixed it for the consensus number; the history path re-created it at ~60% scale.

**Worked row count for a 60-game Saturday** (from the actual cron schedules,
`.github/workflows/jobs.yml:50-57`, and `scripts/refresh-lines.ts`):

- Daily full-week runs `0 3,12,17,22 * * *`: 4/day × 7 days in window = **28 captures**
- Saturday hourly `0 13-23 * * 6`: **11 captures**
- Burst `*/10 15-23 * * 6` + `*/10 0-3 * * 0` (only games within 100 min of kickoff,
  `refresh-lines.ts:20,55-67`): ~**10 captures/game**
- ≈ 49 captures × ~4–6 books per game (CFBD typical; one row per provider per capture,
  `refresh-lines.ts:70-85`) ≈ **200–290 rows per game**
- × 60 games ≈ **12,000–17,000 rows per slate fetch**, at ~85–95 bytes of JSON each
  (`{"game_id":401628476,"provider":"DraftKings","spread":-6.5,"captured_at":"2026-08-29T15:10:00+00:00"}`)
  ≈ **1.0–1.6 MB Supabase→Vercel per tick.**

This happens on every page load of `/slate`, `/edges`, both group pages, **and every poll tick**
(`/api/slate` calls the same `fetchSlateView`, `src/app/api/slate/route.ts:41-48`).

**Claim: "hot-path indexes (0018)."** Verified, and checked against the live query shapes — see §5.

**Claim: "the 30s poll re-runs the 12-query pipeline per client."** Improved since. The interval is
now `connected ? 180_000 : anyLive ? 30_000 : 90_000` and skips hidden tabs
(`SlateView.tsx:186-195`). The pipeline it re-runs, however, has grown from 12 to **16 queries**
(groups-era additions: crew picks, profiles, systems, rivalries — `queries.ts:146-220`), plus the
per-request preamble (§2). The *shape* criticism stands: the heal poll re-runs the entire
first-render pipeline when realtime already carries the only fields that change between ticks.

## 2. Per-route query census (round trips to Supabase, current code)

Every page also pays the preamble: `auth.getUser()` (1 HTTP to Supabase Auth) +
`fetchCurrentSeasonWeek` = `seasons` (1) + `fetchCurrentSlate` (1–2, **sequential**,
`season.ts:36-55`). That is 3–4 serial round trips before any page-specific work.

| Route | Queries | Sequential stages | Notes |
|---|---|---|---|
| `/slate` (`slate/page.tsx`) | ~21 | 5 (auth → pointer×2 → group resolve → games → parallel 15) | `fetchSlateView` = 1 + 15-way `Promise.all` (`queries.ts:146`) |
| `/api/slate` per poll tick | ~20–22 | 5 | identical pipeline + cookie/group resolution (`api/slate/route.ts:17-48`) |
| `/api/ticker` per 60s tick | 5 | 4 | pointer chain + games + teams (`api/ticker/route.ts:20-63`); mounts on **every** route via AppNav |
| `/game/[id]` | ~21 | 6 (auth → game → parallel 11 → trends×2 → group resolve → groupWeek×3) | plus 2 more in `generateMetadata` (`game/[id]/page.tsx:54-63`); prior audit counted 9 — groups made it heavier, but the page renders once and live-polls a 1-row endpoint (`api/game/[id]/route.ts`) — good |
| `/groups/[slug]` (board) | ~24 | 5 | `fetchSlateView` (16) + groupWeek (3) + members + join code + 2 picks queries + 1 sequential week-picks `select("*")` (`groups/[slug]/page.tsx:60-92`) |
| `/groups/[slug]/week/[n]` | ~24 + N | 5 + blind stage | **N = one `group_game_pick_count` RPC per blind game** (`week/[week]/page.tsx:114-127`) — 60 parallel RPCs on a full-slate blind group (P-9) |
| `/ratings` | 5 | 3 | full-season ratings scan (P-12) |
| `/receipts` | 4 | 4 (preds → games → teams sequential) | full-season, unpaginated (P-13) |
| `/recap/[week]` | 7–8 | 3 | well-scoped (2-week ratings window, week's games only) — the good pattern |
| `/standings`, `/teams`, `/rankings` | 4–5 | 3 | reasonable |
| `/ledger` | 5–6 | 4 | bounded bet-form window (audit #18 fix confirmed, `queries.ts:573-588`) |

The crew-fetches-season-picks hypothesis from the prompt: `/crew` is now a redirect
(`crew/page.tsx:13-24`). Its replacement, the group board, fetches the group's season picks
**three ways at once** (P-10): `fetchSlateView`'s internal season-wide crew query
(`queries.ts:198-205`), the standings query (`groups/[slug]/page.tsx:67-71`), and a week
`select("*")` (`:88-92`). At 15 users × ~3 picks × 14 weeks ≈ 600 rows each this is
correctness-safe and small — it's 2 wasted queries and ~100 KB, not a fire.

## 3. Saturday arithmetic: the two quota clocks

Assumptions, stated: 15 users; each averages 4 hours with the slate open during a 12-hour
Saturday window; Vercel and Supabase co-located US-East; Supabase free tier ≈ **5 GB egress/month,
2M realtime messages/month, 200 concurrent realtime connections, 500 MB database** — these are my
best knowledge as of early 2026 and **must be re-verified against the current pricing page**;
they change.

**Egress (P-1).** Nominal case — realtime connects, poll heals at 180s:
15 clients × 4 h × 20 ticks/h = **1,200 ticks** × ~1.25 MB (history 1.1 MB + the §4 growers)
≈ **1.5 GB per Saturday**. September has 4 Saturdays ≈ **6 GB > 5 GB cap** — and that's before
game-page views (P-6: ~0.7 MB each by November) and the ticker. Degraded case — realtime
doesn't connect (P-17, plausible for anon viewers) so live games poll at 30s: 15 × 4 h × 120
ticks/h × 1.25 MB ≈ **9 GB in one afternoon**. When the cap trips, Supabase throttles: the site
doesn't error loudly, it just gets slow, on the day the product exists for. Silent failure.

Database size is also on this clock: ~15k snapshot rows/week × ~150 B stored ≈ 2–3 MB/week —
fine for the 500 MB cap; egress is the binding constraint, not storage.

**Realtime messages (P-2).** `scoreboardJob` runs an unconditional `.update()` for every
`in_progress` **and `final`** game on the day's board, every 30 s while anything is live
(`jobs-core.ts:88-107`; `scoreboard-loop.ts:126` — `waitMs = state === "live" ? liveMs : 120_000`,
default `liveMs` 30 s). A game that went final at noon is rewritten identically every 30 s until
the loop windows end (~04:00 UTC Sunday, `jobs.yml:66-68`) — and every rewrite is a WAL record,
which is a realtime UPDATE event delivered to **every matching subscription**. The subscription
filter is `week=eq.N` only (`use-games-realtime.ts:52-56`), so every Saturday event goes to every
client; and a client on `/slate` holds **two** channels (SlateView + ScoreTicker both call
`useGamesRealtime`).

Worked example, mid-afternoon: 20 live + 20 finals = 40 UPDATEs per 30 s tick = 4,800 events/h.
15 clients × ~1.5 channels avg ≈ 22 subscriptions → 4,800 × 22 ≈ **106k messages/hour** →
10-hour Saturday ≈ **1.06M messages**, vs ~2M/month free. **Two Saturdays ≈ the monthly quota.**
When it trips, realtime silently stops → every client falls to the 30 s poll → the egress clock
(above) runs 6× faster. The two failure modes compound.

Cheap fixes, in order of leverage: (1) skip the write when nothing changed (compare
`home_points/status/clock` before update — finals stop emitting entirely, roughly halving events);
(2) share one channel per client (ticker and slate on the same page duplicate every event);
(3) filter the subscription to `status=eq.in_progress` deliveries if acceptable.

There is no Postgres connection-pool risk: supabase-js speaks PostgREST over HTTP; 15 clients ×
serverless never hold direct connections.

## 4. The queries that grow all season (on every tick)

Four sub-queries in the poll path scale with the season, not the week
(60-game week, 136 teams, week-14 state):

| Query | Week 1 | Week 14 | Evidence |
|---|---|---|---|
| `line_snapshots` history (7-day window) | ~12–15k rows / ~1.1 MB | same (window-bounded) — the constant whale | `queries.ts:152-156` |
| `system_ratings` all weeks, JS-reduced to latest | ~360 rows | 3 systems × ~130 teams × 14 wks ≈ **5,000 rows / ~350 KB** | `queries.ts:210-215` |
| `poll_rankings` whole season | ~75 rows | 3 polls × 25 × 14 ≈ **1,050 rows / ~85 KB** | `queries.ts:192-196` |
| season finals (records) | 0 rows | ~800 rows / ~100 KB | `queries.ts:183-187` |

The fix for the second is the exact move 0015 already made for `ratings`: a `latest_systems`
`distinct on (season_id, system, team_id) … order by week desc` view. The game page has the same
JS-reduce pattern (`game/[id]/page.tsx:144-149`) but for 2 teams — harmless there. The polls query
needs only the latest poll week (its own comment explains why it can't filter by team, but it
*can* filter to `week = (select max(week))` in a view). The history query should either move to a
view (`row_number() over (partition by game_id) <= 24`-shaped) or drop out of the poll path
entirely — see §7.

`profiles.select("*")` on the game page (`game/[id]/page.tsx:134`) is the prompt's question,
verified **STILL OPEN**: full table, all columns (including `favorite_team_ids`, admin flags),
where the page needs `id, display_name` for a handful of pick rows. Trivial at 15 users; it's the
unbounded shape that's wrong, and `fetchSlateView` shows the right one (`queries.ts:206` —
slim columns, still all rows).

## 5. Index-to-query match (migrations 0001/0014/0015/0018/0019/0021 vs `queries.ts`)

Verified shape by shape — this part of the prior audit's "fixed" claim holds:

- `line_snapshots .in(game_id).gte(captured_at)` → `(game_id, captured_at desc)` ✓ (`0015:48-49`)
- `line_consensus` view's `distinct on (game_id, provider) … order captured_at desc` →
  `(game_id, provider, captured_at desc)` ✓ (`0001:99`)
- `predictions .in(game_id).order(created_at)` → `(game_id, frozen, created_at desc)` ✓ (`0001:173`);
  receipts' `.eq(frozen).eq(season_id)` → `(season_id, frozen, created_at desc)` ✓ (`0014:15-16`);
  Sunday grader → partial index `predictions_ungraded` ✓ (`0019:42-44`)
- `picks` by `(group_id, user_id, game_id, market)` unique ✓ (`0021:110-111`), by
  `(group_id, season_id)` ✓ (`0021:112`), by `game_id` ✓ (`0018:68`)
- `bets` by game/user ✓ (`0018:69-70`); `system_ratings (season_id, team_id)` ✓ (`0018:73`);
  `games` by season/week ✓ (`0001:81`) and by team ✓ (`0018:71-72`); `poll_rankings` PK leads with
  `(season_id, season_type)` ✓ (`0008:14`); `weather_forecasts` PK `game_id` ✓; `latest_ratings`
  view rides the `ratings` PK `(season_id, team_id, week)` ✓ (`0001:129`)

Unindexed shapes found, none material at this scale (named for completeness):
- `games .eq(season_id).eq(status,'final')` and `fetchCurrentSlate`'s OR-filter
  (`season.ts:36-44`) have no status index — resolved by scanning the season's ~1,700 rows behind
  the `season_id` index. Fine.
- `api_call_log .gte(called_at)` count (`queries.ts:598-601`) has no `called_at` index —
  admin/job path only.

RLS `initplan` fixes (`(select auth.uid())`) confirmed present (`0018:14-62`).

## 6. Client: bundle, fonts, images

- **Dependencies are clean** (`package.json`): no recharts/chart.js — `Sparkline` and
  `MovementChart` are hand-rolled SVG; icons are named `lucide-react` imports (tree-shaken by
  Next's default `optimizePackageImports`); no barrel-import traps found. `@anthropic-ai/sdk` and
  `zod` are script/server-side. `next.config.ts` is empty (`:1-7`) — nothing harmful, nothing
  tuned.
- **Fonts** (`layout.tsx:2-20`): three families via `next/font/google` — self-hosted, so no
  third-party font requests; `latin` subsets; Barlow 3 weights + Plex Mono 3 weights + Archivo ≈
  7–8 woff2 files ≈ ~120–160 KB. `display` defaults to `swap`. Acceptable; dropping a Plex Mono
  weight would be the only trim worth considering.
- **Team marks** (P-14): `TeamMark.tsx:36-46` renders raw `<img src={team.logo_url}>` —
  CFBD/ESPN CDN URLs, `loading="lazy"`, no `next/image`. A 60-game slate is ~120 third-party image
  requests (~5–15 KB each, ≈ 1–1.5 MB if fully scrolled). On bar wifi with lazy loading this is
  tolerable; on throttled 3G it's the long tail after LCP. Not worth `next/image` (Hobby image
  optimization has its own quota); worth knowing it's the largest client-side transfer.
- `SlateView` is big (~750 lines) but its weight is data, not dependencies; the initial
  `SlateData` for 60 games rides the RSC payload (~250–400 KB, dominated by the 24-point
  histories and team objects duplicated per game).

## 7. Estimated TTFB/LCP for `/slate`, and the single biggest lever

Assumptions: Vercel Hobby Node function, cold start ~0.8–1.5 s for an app this size; Supabase
same-region, ~25–50 ms per REST round trip warm; auth ~50–100 ms; throttled 3G = 1.6 Mbps down /
150 ms RTT.

| | Server time | TTFB | LCP (first cards, 3G) |
|---|---|---|---|
| Warm | 5 serial stages (~250–400 ms) + parallel batch gated on the ~1.1 MB history transfer (~300–600 ms) + render ≈ **0.7–1.2 s** | ~0.9–1.4 s | ~**4–5 s** (HTML/RSC ~350 KB ≈ 2 s + CSS/JS ~250 KB + font swap) |
| Cold | + 0.8–1.5 s init | ~1.8–2.8 s | ~**6–7 s** |

**The single biggest latency lever is the same as the biggest egress lever: get the snapshot
history out of the request path.** It gates the parallel batch (the batch finishes when its
slowest member does), it's ~70% of the payload Supabase has to serialize per tick, and its
consumer is a 56×18 sparkline. Either reduce it in a view (24 points/game leave the database
instead of 200+ rows/game) or — better — split the poll: realtime + a slim `/api/slate-live`
(live columns + `line_consensus`, 2 queries, ~50 KB) for the 30–180 s heal, with the full
pipeline only on navigation/week-change. That one change cuts tick cost ~95% and moves the
Saturday egress projection from ~1.5 GB to ~75 MB. Second lever: cache the
season/week pointer (`fetchCurrentSeasonWeek`) for 60 s in-module — it's 3 serial round trips on
every page, API tick, and ticker tick, answering a question that changes a few times a week.

The `force-dynamic` inventory (P-11): 20 pages + 3 API routes. For live surfaces it's correct.
For `/teams`, `/ratings`, `/rankings`, `/standings`, and past-week `/recap/[n]` (immutable once
graded) it buys nothing — but note the trap: these pages don't read auth (nav auth state is a
client island, `AuthButton.tsx:1-26`), yet `createClient()` unconditionally reads `cookies()`,
which forces dynamic rendering regardless. Making them cacheable means a cookie-free anon
Supabase client + `export const revalidate = 300`, not just deleting the `force-dynamic` line.
At 15 users this is a P2 nicety; it matters mostly as cold-start avoidance (a cached page is
served without a function invocation at all).

## 8. Load rehearsal before Aug 29 (P-16)

The prior audit's "unproven under a real 60-game Saturday" stands — nothing has been measured.
Cheapest realistic rehearsal, ~half a day, no new infra:

1. **Seed a Saturday.** Extend `scripts/seed-fixtures.ts` (exists, currently 8 games/16 teams)
   with a one-off flag to write ~60 games and **synthetic snapshot density**: 49 captures × 5
   providers × 60 games ≈ 14.7k `line_snapshots` rows timestamped across a trailing week, ~25
   games `in_progress`. Run against a Supabase branch or the local `db-test` Postgres +
   `next start`.
2. **Measure the whale.** `curl -so /dev/null -w '%{size_download} %{time_starttransfer}\n'`
   against `/api/slate` and `/slate`. This single number validates or kills P-1. Record it in the
   changelog like a tuner result.
3. **Concurrency.** `npx autocannon -c 15 -d 60` on `/api/slate` — 15 connections is the entire
   user base polling simultaneously, i.e. strictly worse than reality. Record p50/p95 and
   error count. Repeat -c 30 for headroom.
4. **Realtime.** Run `scoreboard-loop.ts --minutes 5` against the seeded DB with ~10 subscribed
   tabs (or a 20-line ws script); read the message counter from the Supabase dashboard and
   extrapolate ×120 for a Saturday. Also settles P-17 (does an anon, token-less subscription
   receive events at all?).
5. **Acceptance bars** (pre-registered, per house style): `/api/slate` p95 < 1.5 s at 15
   connections; tick payload < 300 KB (post-fix); projected Saturday realtime messages < 500k;
   projected Saturday egress < 500 MB.

## For 00-SUMMARY.md

- **P-1 (P1, M):** Slate poll ships raw week-wide `line_snapshots` (~1.1 MB/tick, `queries.ts:152-156`); ~1.5 GB egress per nominal Saturday (9 GB if realtime fails) vs ~5 GB/month Supabase free cap — silent mid-season throttle. Fix: history view or slim live-poll endpoint.
- **P-2 (P1, S):** Scoreboard loop rewrites live+final rows unconditionally every 30 s (`jobs-core.ts:88-107`) → ~1M realtime messages per Saturday vs ~2M/month free quota; two Saturdays ≈ quota, then realtime dies silently and polling costs 6×. Fix: skip no-op writes; share one channel per client.
- **P-16 (P1, S):** Zero load evidence before a 60-game Saturday; run the seeded `autocannon` + realtime rehearsal in §8 and record the numbers before Aug 29.
