# 00 — Inventory

Built by reading every file under `src/`, `scripts/`, `supabase/`, the configs,
and `docs/SPEC.md` in full. Status column is what the **code** does, not what a
commit message or `docs/AUDIT-2026-08.md` claims.

**Legend:** ✅ complete · 🟡 partial · 🟥 stub/dead · ⬜ spec'd but missing

## Toolchain baseline (actually run, 2026-08-09)

| Command | Result |
|---|---|
| `npm ci` | 477 packages, clean (`node_modules/` was absent on checkout) |
| `npm run build` | **exit 0** — 31 routes, 10 prerendered, TS check passes |
| `npm run lint` | **exit 0**, no warnings |
| `npm test` | **301 passed / 301**, 21 files, 6.06s |
| `npm run db:test` | **90 passed / 0 failed**, 23 migrations on a throwaway PG 16 |

The tree is green. Nothing below is a build break; everything is a behaviour
finding.

---

## Routes (`src/app`)

| Route | Kind | Status | Note |
|---|---|---|---|
| `/` | static | ✅ | `redirect("/slate")` — **the spec's Mon/Wed/Sat homepage modes (§7) do not exist** |
| `/slate` | dynamic | ✅ | the product's centre of gravity |
| `/slate/preview` | static | 🟥 | `notFound()` in production; dev-only mock harness |
| `/game/[id]` | dynamic | ✅ | read-only for picks by owner decision |
| `/ratings` | dynamic | ✅ | Off/Def columns gated on `splitInformative` |
| `/rankings` | dynamic | ✅ | human polls |
| `/teams`, `/team/[id]` | dynamic | 🟡 | automated tier only; LLM tier partial (see §3 below) |
| `/edges` | dynamic | ✅ | correctly framed as information, not bets |
| `/ledger` | dynamic | ✅ | incl. reason-tag audit |
| `/crew`, `/crew/week/[week]` | dynamic | ✅ | legacy site-wide crew view, now shadowed by groups |
| `/groups`, `/groups/[slug]`, `/groups/[slug]/week/[week]`, `/groups/[slug]/settings` | dynamic | ✅ | the real pick'em surface |
| `/receipts` | dynamic | 🟡 | SU/ATS/flagged/CLV strip; **no win-prob calibration bucket table (§2.5)** |
| `/recap`, `/recap/[week]` | dynamic | ✅ | |
| `/standings` | dynamic | ✅ | |
| `/rules` | static | ✅ | League Rules incl. `min_picks_per_week` |
| `/me`, `/login`, `/auth/confirm` | dynamic | ✅ | magic link + `token_hash` exchange |
| `/admin` | dynamic | ✅ | `notFound()` for non-admins, server-side |
| `/api/slate`, `/api/ticker`, `/api/game/[id]` | route | ✅ | all `no-store`, all **unauthenticated and unrated-limited** |
| `/manifest.webmanifest`, `/icon.svg` | static | 🟡 | installable; **no service worker, no offline, SVG-only icons** |

Every page carries `export const dynamic = "force-dynamic"` — 23 of them.

## Server actions (`src/app/actions`)

| Action | Status | Enforcement |
|---|---|---|
| `picks.makePick` / `removePick` | ✅ | thin wrapper over `make_pick` / `remove_pick` RPC — correct, the RPC is the boundary |
| `bets.logBet` / `logSlipBets` | 🟡 | validates reason tag, units>0, game exists; **does not bound `odds` or `units`** |
| `bets.voidBet` | 🟥 | **no kickoff/final guard — see F-01** |
| `adjustments.add/confirm/remove` | ✅ | admin enforced by RLS, not by the action (correct layering) |
| `invites.inviteCrewMember` | ✅ | re-checks `is_admin` server-side before touching the service client |
| `groups.*` | ✅ | wrappers over security-definer RPCs |
| `profile.*` | ✅ | column grants limit the writable set |

## Lib modules (`src/lib`)

`clv` ✅ · `consensus` ✅ · `grade` ✅ · `records` ✅ · `queries` ✅ · `slate` ✅ ·
`season` ✅ · `kick` ✅ · `live-status` ✅ · `rankings` ✅ · `rating-scales` ✅ ·
`share-text` ✅ · `groups` ✅ · `ticker` ✅ · `client-store` ✅ ·
`use-games-realtime` ✅ · `session-picks` ✅ · `db-types` 🟡 (hand-written; generated
types still open) · `supabase/{client,server,service,middleware}` ✅ ·
`cfbd` 🟡 (**no retry, no timeout, no 429 handling**) · `anthropic` ✅

## Model (`src/model`)

| Piece | Status | Note |
|---|---|---|
| `preseasonRating` | ✅ | matches §2.1 |
| `churnAdjustment` | ✅ | restructured 2026.4.0; honest about the missing defensive metric |
| `coachingAdjustment` (enum) | 🟥 | exported, **never called** — `build-preseason` uses the continuous version |
| `coachingAdjustmentContinuous` | 🟡 | identity (0/0), unconverged, documented |
| `luckCorrection` | ✅ | |
| `updateFromResult` | 🟡 | **also caps the prediction**; §2.2 caps only the actual margin |
| `updateSubRatings` | ✅ | off+def deltas sum to the overall delta — invariant holds |
| `priorWeight` / `blendWithPrior` | ✅ | knots match §2.2 |
| `paramsForWeek` | 🟡 | identity (`priorSigmaExtra = 0`), tested and rejected |
| `priceGame` | 🟡 | correct except **tempo is a constant 70 everywhere** |
| `blendedHfa` | 🟥 | **defined but never called** — `build-preseason` inlines the same formula |
| `suggestedStake` | 🟥 | dead — only tests reference it; §5.4 in the spec is stale |
| `splitInformative` / `hasCalibratedTotals` | ✅ | the honesty gates, correctly shared |

## Scripts

| Script | Status | Note |
|---|---|---|
| `backtest.ts` (+ 11 tuners, `--diagnose-edges`) | ✅ | lookahead-clean; see `02-model-and-clv.md` |
| `lib/replay.ts` | 🟡 | clean replay, but **`homeTeamHfa: params.baseHfa`** — never exercises `team_hfa` |
| `lib/jobs-core.ts` | 🟡 | 8 jobs; postponement/void path missing |
| `lib/coaching.ts`, `lib/idle.ts` | ✅ | |
| `build-preseason.ts` | 🟡 | `SEASON = 2026` still hardcoded; HFA estimator is the F-02 defect |
| `load-preseason.ts` | ✅ | FK order from the emit counter, refuses a played season |
| `refresh-lines.ts` | 🟥 | **week pointer pins on a never-played game — F-03** |
| `sync-games.ts` | 🟡 | can overwrite live state; never writes `postponed`/`canceled` |
| `scoreboard-loop.ts` | ✅ | adaptive cadence + monthly budget brake — genuinely good |
| `generate-questions.ts` / `generate-verdicts.ts` | 🟡 | Zod-validated output; **no admin review queue (§3)** |
| `seed-fixtures.ts`, `load-json.ts`, `db-test.sh` | ✅ | |
| *news/injury scan* | ⬜ | **spec §8 daily 7am job does not exist** |
| *calibration report job* | 🟡 | computed on `/receipts` at request time, not scheduled |

## Tables & RLS (`supabase/migrations`, 23 files — note **`0004` is missing**)

| Table | RLS on | Write path | Status |
|---|---|---|---|
| `seasons`, `teams`, `venues`, `rivalries` | ✅ | service role only | ✅ |
| `venue_coord_overrides`, `invite_allowlist`, `api_call_log` | ✅ | deny-all + service role | ✅ |
| `games` | ✅ | service role; realtime publication | ✅ |
| `line_snapshots` | ✅ | insert has no policy → denied; `update/delete` revoked | ✅ append-only |
| `weather_forecasts` | ✅ | service role | ✅ |
| `ratings`, `preseason_components`, `team_hfa`, `system_ratings`, `poll_rankings` | ✅ | service role | ✅ |
| `predictions` | ✅ | service role; `update/delete` revoked from anon+authenticated | ✅ append-only |
| `profiles` | ✅ | column grants: `display_name`, `favorite_team_ids`, `timezone` only | ✅ no self-escalation |
| `picks` | ✅ | **all direct writes revoked**; `make_pick` / `remove_pick` RPC only | ✅ |
| `bets` | ✅ | insert sanitised by trigger; update limited to void by trigger | 🟡 **void window — F-01** |
| `rating_adjustments` | ✅ | admin-only policies (select/insert/update/delete) | ✅ |
| `team_verdicts`, `game_questions` | ✅ | service role | ✅ |
| `groups`, `group_members`, `group_week_config`, `group_week_games` | ✅ | all writes revoked; 10 security-definer RPCs | ✅ |
| views `line_consensus`, `latest_ratings` | n/a | `security_invoker = true` | ✅ |

**Every table listed in a migration has `ENABLE ROW LEVEL SECURITY` actually
issued.** I checked each `create table` against a matching `alter table … enable
row level security`; there are no gaps. `season_id` is present on every domain
table except `groups`, which is a documented deliberate exception (a group spans
seasons; the season lives on `group_week_config` and `picks`).

## Scheduled jobs (`.github/workflows/jobs.yml`)

Spec §8 says pg_cron → Edge Functions. **Reality is GitHub Actions.**
`supabase/functions/jobs/index.ts` (710 lines) is undeployed, drifted, and still
carries the inverted CLV sign — dead code by explicit decision.

| Spec job | Exists | Scheduled | Idempotent | Gap |
|---|---|---|---|---|
| Refresh lines 3–4×/day | ✅ | `0 3,12,17,22 * * *` | append-only | week pointer pins (F-03) |
| Hourly Saturdays | ✅ | `0 13-23 * * 6` | ✅ | |
| Burst poll pre-kickoff | 🟡 | `*/10 15-23 * * 6`, `*/10 0-3 * * 0` | ✅ | **Saturday only — F-05** |
| Ratings update Sun 8am ET | ✅ | `0 13 * * 0` | ✅ stateless replay | no void path (F-04) |
| Weather Sat 6am local | 🟡 | `0 10 * * 6` (single UTC time) | ✅ | never priced (F-09) |
| Injury/news LLM scan | ⬜ | — | — | **missing entirely** |
| Live scoreboard | ✅ | hourly loop launches | ✅ | best piece of ops in the repo |
| Snapshot opening lines | ✅ | folded into refresh-lines (`spread_open`) | ✅ | |
| Freeze predictions Thu night | 🟡 | `0 3 * * 5` | horizon-guarded | **Thursday games excluded — F-06** |
| Calibration report | 🟡 | on-page | n/a | not scheduled, no bucket table |
| Freeze group weeks | ✅ | chained onto lines refreshes | ✅ | |

**Failure handling: none.** No alerting, no dead-man's switch, no
`api_call_log`-style record of job outcomes. `refresh-lines && run-job
freeze-groups` is chained with `&&`, so a lines failure silently skips the
group freeze.

## Spec features with no implementation

- Homepage day-modes (§7)
- Injury/news scan + admin confirm loop (§4, §8) — the *confirm* half exists,
  nothing proposes
- LLM admin review queue before publish (§3)
- Rooting guide (§4)
- Playoff race tracker / bowl projections (§4)
- Futures tracker + weekly mark-to-market (§5.3)
- Derivative markets, pace/half-split model (§5.2) — explicitly Phase 2
- Betting %/money % splits (§5.5) — explicitly Phase 2
- Per-team tempo estimate (§2.1) — hardcoded 70
- Weather in the model (§2.3)
- Moneyline CLV in cents (§5.3) — stored null by decision
- ¼-Kelly sizing (§5.4) — removed on evidence; **the spec was never updated**
