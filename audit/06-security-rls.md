# 06 — Security & RLS (adversarial)

**Scope:** every migration 0001–0023 judged in FINAL state, the SQL test harness
(`scripts/db-test.sh` + `supabase/tests/*.sql`), the four Supabase client wrappers,
all six server actions, all three API routes, `/crew`, `/admin`, `/ledger`, the
dead edge function, and `.github/workflows`.

## Summary

The three headline holes the Aug-2026 audit found — self-serve `is_admin`
escalation, bet forgery, and pick forgery — are **fixed and the fixes hold in the
final migration state.** `0013` closed them with a column grant (profiles), a
BEFORE-UPDATE trigger + insert sanitiser (bets), and a `SECURITY DEFINER`
`make_pick()` with table writes revoked (picks). The groups work (`0020`–`0023`)
did **not** reopen any of them: it revokes all direct writes on the four new
tables and funnels every mutation through `SECURITY DEFINER` RPCs, every one of
which sets `search_path = public` and guards on `is_group_admin`/`is_group_member`.
I re-derived each attack from the SQL and traced it to the exact policy/grant/
trigger that stops it (table below).

The residual findings are all lower-severity and mostly NEW: a **24-bit join code
with no rate limit is the only gate on private-group membership** despite a
comment calling it "not a security boundary" (SEC-01); **removal is not durable**
— a removed member, including a removed *admin who returns as admin*, can rejoin
with the known code (SEC-02); and — the one that matters for a 20-day runway —
**two of the three `0013` fixes have no regression test at all** (SEC-03). The DB
suite exercises picks, groups, and the blind thoroughly, but nothing asserts the
profiles column grant or the bets void-only trigger, so a future migration that
re-grants `UPDATE` on `profiles` would silently reopen admin escalation with a
green test run. Everything else (deny-all tables, service-role inventory,
null-user handling, secret hygiene) is clean.

## Findings

| ID | Sev | Type | Status | One-line | Evidence |
|----|-----|------|--------|----------|----------|
| SEC-01 | P2 | design | NEW | Private-group join code is 6 hex chars (~24 bits), no rate limit; guessing it auto-joins and unlocks members-only picks | `0020_groups.sql:370,385-413` |
| SEC-02 | P3 | design | NEW | Removed member rejoins instantly via known code; a removed admin returns **as admin** (role never cleared) | `0020_groups.sql:407-409,448-469` |
| SEC-03 | P1 | design | NEW | No DB test for two of three `0013` fixes (profiles column grant, bets void-only trigger); silent-regression risk | `supabase/tests/` (no `bets.sql`/`profiles.sql`) |
| SEC-04 | verified | — | FIXED-verified | `UPDATE profiles SET is_admin=true` blocked by column grant; no later migration re-widens | `0013:26-28` |
| SEC-05 | verified | — | FIXED-verified | `UPDATE bets SET result='win'` and voiding a graded loss both blocked by `enforce_bet_void_only` | `0013:34-63` |
| SEC-06 | verified | — | FIXED-verified | Pick line/units/owner forgery blocked: direct writes revoked, `make_pick()` computes line server-side | `0013:92`, `0021:221-268` |
| SEC-07 | verified | — | FIXED-verified | Service-role chain (`/admin` → `auth.admin.listUsers`) gated on `is_admin`; dead once SEC-04 holds | `admin/page.tsx:27-51` |
| SEC-08 | P3 | design | NEW | `profiles` (incl. `is_admin`, `favorite_team_ids`) world-readable to anon regardless of group | `0001:307`, `0011:21` |
| SEC-09 | P3 | bug | NEW | `/ledger` `.eq("user_id", "")` for anon relies on a swallowed uuid-cast error to return empty | `ledger/page.tsx:41` |
| SEC-10 | P3 | design | NEW | `0018` re-created picks insert/update policies that are dead letters (grants stay revoked) — confusing, harmless | `0018:18-38` |
| SEC-11 | P3 | design | NEW | `removeAdjustment`/`confirmAdjustment` have no app-level admin check; RLS makes them silent no-ops for non-admins | `actions/adjustments.ts:57-81` |
| SEC-12 | P3 | design | NEW | Dead edge fn bakes CFBD key + `__JOBS_SECRET__` as string literals and compares secret non-constant-time | `supabase/functions/jobs/index.ts:19-20,45` |
| SEC-13 | P3 | design | STILL OPEN (by design) | TBD kickoff (`start_ts` null) makes a game permanently un-pickable and hidden until a real time is set | `0021:200`, `0023:26-31` |

Deny-all tables, `createServiceClient` inventory, `search_path` hardening, and
secret bundling are all clean — detailed under "Verified secure" below.

---

## Per-table attack matrix

Every attack is written as the SQL a **malicious authenticated crew member**
(role `authenticated`, valid `auth.uid()`) would run through PostgREST/`.rpc()`.

### `profiles`

| Policy/grant | Attack | Result | Fix if broken |
|---|---|---|---|
| `update own profile` policy (`0018:14-16`) + column grant (`0013:26-28`) | `update profiles set is_admin=true where id=auth.uid()` | **BLOCKED** by column grant — `UPDATE` on `profiles` was revoked and re-granted only on `(display_name, favorite_team_ids, timezone)`; `is_admin` is not in the list, so the column reference is denied before RLS is consulted | n/a |
| same | `update profiles set display_name='x' where id=auth.uid()` | ALLOWED (intended) | n/a |
| `read profiles` (`0001:307`) + `anon read profiles` (`0011:21`) | `select is_admin, display_name from profiles` (as anon) | **EXPLOITABLE-by-design** (SEC-08): every profile is world-readable including `is_admin`. Low-sensitivity, but admin identity and favourite teams are enumerable | scope read policy to group co-membership, or drop `is_admin` from the anon-visible columns via a view |

No migration after `0013` touches the `profiles` grants. `0018` re-creates the
policy verbatim (init-plan wrapping) but adds **no** column grant, so the
restriction stands. **Verified by reading SQL; NOT covered by any DB test.**

### `bets`

| Policy/grant/trigger | Attack | Result |
|---|---|---|
| `void own bets` (`0018:44-46`) + `enforce_bet_void_only` (`0013:34-63`) | `update bets set result='win', payout_units=99 where id=B and user_id=auth.uid()` (B ungraded) | **BLOCKED** by trigger: `new.result='win'` is `distinct from 'void'` → `raise 'bets are append-only'` |
| same | Void a graded loss to erase it: `update bets set result='void', voided_at=now() where id=B` (B already `result='loss'`) | **BLOCKED** by trigger: `old.result is not null` → `raise 'settled or voided bets cannot be changed'`. This is the key line — grading (win/loss/push, set by service role) **locks the row against user voids**, so a loss can't be laundered |
| same | Un-void: `update bets set voided_at=null where id=B` (B `result='void'`) | **BLOCKED**: `old.result='void'` is not null → same raise |
| `enforce_bet_insert_clean` (`0013:65-86`) | `insert into bets (..., result, payout_units) values (..., 'win', 99)` | **BLOCKED (sanitised)**: trigger forces `result/clv/closing_line/payout_units/voided_at := null`, `placed_at := now()` for `authenticated`/`anon` |
| `revoke delete` (`0001:355`) | `delete from bets where id=B` | **BLOCKED** at grant level |
| `insert own bets` (`0018:41-42`) | `insert into bets (..., user_id) values (..., <someone else>)` | **BLOCKED** by `with check (user_id = auth.uid())` |

Worked money example of why the graded-loss lock matters: a bettor logs
"Michigan -3.5" at 1u/-110. Grader sets `result='loss', payout_units=-1.0`.
Season units = -1.0. If the user could void it, the row would drop from
`tally()` (`ledger/page.tsx:119-121` filters `result && result!=='void'`) and the
record would silently become 0-0 / +0.0 — a rewritten ledger, which is the whole
product thesis. The `old.result is not null` guard is what prevents this. The
app's `voidBet` (`actions/bets.ts:132-148`) hits the same trigger, so an attempt
to void a graded bet returns the trigger's error rather than succeeding.

**Verified by reading SQL; NOT covered by any DB test** (SEC-03).

### `picks`

| Policy/grant/RPC | Attack | Result |
|---|---|---|
| `revoke insert,update` (`0013:92`), `revoke delete` (`0021:268`) | `insert into picks (..., line_at_pick) values (..., -99)` | **BLOCKED** at grant level (test `picks.sql:263-265` asserts this) |
| `make_pick()` (`0021:143-228`) | Forge line via RPC | **BLOCKED**: `line_at_pick` is computed from `line_snapshots` consensus server-side; caller supplies only group/game/market/side |
| `make_pick()` ownership | Pick for another user | **BLOCKED**: row is inserted with `(select auth.uid())`, not a caller argument |
| `make_pick()` membership | `make_pick(<group I'm not in>, ...)` | **BLOCKED**: `if not is_group_member(...) then raise` (test `picks.sql:204-205`) |
| `make_pick()` board check | Pick a game not on the group's week board | **BLOCKED**: `group_week_game_ids(...)` membership check (test `picks.sql:251-252`) |
| `make_pick()` market check | Pick a market the group turned off | **BLOCKED**: `p_market = any(cfg.markets)` (test `picks.sql:209-210`) |
| `make_pick()`/`remove_pick()` kickoff | Pick/remove after kickoff or on TBD | **BLOCKED**: `g.start_ts is null or g.start_ts <= now()` → raise (test `picks.sql:221-224`) |

The `0018`-recreated `insert/update/delete own pick` policies (`0018:18-38`) are
**dead letters** (SEC-10): the underlying `INSERT/UPDATE` grants were revoked in
`0013` and `DELETE` in `0021`, and a policy without a grant denies. Harmless but
confusing — a reviewer could mistake the policies for the live write path.
**Well covered by `supabase/tests/picks.sql`.**

### `predictions`, `line_snapshots`

| Grant | Attack | Result |
|---|---|---|
| `revoke update,delete on predictions` (`0001:353`) | `update predictions set edge=99` or update `close_spread`/`clv` (added `0019`) | **BLOCKED**: table-level `UPDATE` revoke covers columns added later; no column grant exists. Only service role (grader) writes `close_spread`/`clv` |
| `revoke update,delete on line_snapshots` (`0001:354`) | `update`/`delete` a snapshot to move a line | **BLOCKED** at grant level |

`0019` adds three columns and correctly relies on the pre-existing table-level
revoke (changelog confirms this was checked against the live DB). Append-only
holds. **Verified by reading SQL; no dedicated DB test asserts these revokes** —
they'd need a live cluster or an added `has_table_privilege` assertion.

### `rating_adjustments`

Admin-only for select/insert/update/delete via `is_admin` policies
(`0006`, `0018:48-62`). A non-admin insert raises (RLS); a non-admin
update/delete affects **0 rows and returns success** because the server actions
don't re-check (SEC-11, `actions/adjustments.ts:57-81`). Outcome is correct
(nothing changes) but the silent `ok:true` is a poor signal.

### `groups`, `group_members`, `group_week_config`, `group_week_games`

All four have `insert/update/delete` revoked from `authenticated,anon`
(`0020:320-323`); every write is a `SECURITY DEFINER` RPC.

| RPC | Non-admin/non-member attack | Result |
|---|---|---|
| `set_group_week_config` (`0022:24`) | member sets the week's games/markets | **BLOCKED**: `if not is_group_admin() then raise` (test `groups.sql:174-177`) |
| `regenerate_join_code` (`0020:523`) | member rotates the code | **BLOCKED**: `is_group_admin` guard |
| `archive_group` (`0020:509`) | member archives | **BLOCKED**: `is_group_admin` guard |
| `set_group_role`/`remove_group_member` | member promotes self / removes others | **BLOCKED**: `is_group_admin` guard (test `groups.sql:329-330`) |
| direct `update groups set name=...` | any member | **BLOCKED** at grant level (test `groups.sql:113-114`) |
| read a private group's config/picks | non-member | **BLOCKED**: `is_group_visible(id)` = `visibility='public' OR is_group_member` (tests `groups.sql:89-90`, `picks.sql:271-272`) |

The last-admin invariant is enforced twice (RPC guard + deferred constraint
trigger `group_members_keep_admin`), and the trigger backstop is tested by
bypassing the RPC (`groups.sql:319-324`). **Well covered.**

---

## Detailed NEW findings

### SEC-01 (P2, design) — join code is the private-group boundary, and it's ~24 bits with no rate limit

`0020_groups.sql:370` mints the code as
`upper(substr(replace(gen_random_uuid()::text,'-',''),1,6))` — **6 uppercase hex
characters**. Alphabet is `0-9A-F` (16 symbols), so the space is 16⁶ =
**16,777,216 ≈ 2²⁴**. `join_group(p_code)` (`0020:385-413`) accepts any
authenticated caller, looks the code up, and **auto-joins with no admin
approval**. There is no attempt counter anywhere in the SQL or the actions.

Consequence: joining a *private* group makes you a member, and membership is
exactly what `is_group_visible` gates — so a successful guess unlocks the group's
roster and its members-only picks (including picks under the "hidden until
kickoff" blind, since the blind only hides *others'* picks from members, and a
member reads the count via `group_game_pick_count`). Arithmetic: at a modest 100
guesses/sec against a single targeted private group, expected hits at ~2²³ tries
≈ **~23 hours**; broad enumeration to land in *any* private group is far cheaper.

The code carries the comment "routing, not a security boundary"
(`0020:35`) — but with private visibility it **is** the only boundary on
membership. Fix (S): add a per-IP/per-user rate limit on `join_group`, and widen
the code to ≥10 chars or use a larger alphabet (10 base32 chars ≈ 2⁵⁰). At this
product's scale the real-world risk is bounded, hence P2 not P1, but the comment
is misleading and should not be trusted by a future maintainer.

### SEC-02 (P3, design) — removal isn't durable; a removed admin returns as admin

`remove_group_member` (`0020:448-469`) and `leave_group` set `removed_at` but
**never change `role`**. `join_group` (`0020:407-409`) does
`insert ... values (..., 'member') on conflict (group_id,user_id) do update set
removed_at = null` — the `on conflict` branch **only clears `removed_at`; it
leaves `role` untouched.** So:

1. An admin removes a co-admin who misbehaves. The co-admin's row keeps
   `role='admin'`, just hidden by `removed_at`.
2. The removed co-admin re-runs `join_group(code)` with the still-valid code →
   `removed_at` cleared, `role` still `'admin'`. They're back, **as an admin**.

Even for plain members, removal is undone the moment they re-enter the code;
durable removal requires the admin to *also* `regenerate_join_code`, which
nothing prompts. The `0020:406` comment ("Rejoining restores... the role you
left holding") shows this is intended for voluntary `leave_group`, but it applies
identically to involuntary `remove_group_member`, which is a governance hole.
Fix (S): have `remove_group_member` set `role='member'` (or a `banned` flag), and
have `join_group`'s conflict branch reset `role='member'`.

### SEC-03 (P1, design) — two of three `0013` fixes have zero regression tests

`scripts/db-test.sh` (a genuinely good harness — it spins a real Postgres,
applies all migrations, and impersonates `authenticated`/`anon`/service via the
`00_shim.sql` role + `auth.uid()` shim, so revoked grants are tested for real)
runs exactly three suites: `groups.sql`, `hidden-picks.sql`, `picks.sql`.

There is **no `bets.sql` and no `profiles.sql`.** The picks lockdown (`0013`
item 3) is covered end-to-end, but:

- **`profiles` `is_admin` column grant (item 1)** — nothing asserts that
  `UPDATE profiles SET is_admin=true` fails. A future migration doing
  `grant update on profiles to authenticated` (or a broad
  `grant all on all tables`) would reopen full self-serve admin escalation —
  which then unlocks the entire `/admin` service-role surface (SEC-07) — with a
  **green** `npm run db:test`.
- **`bets` void-only trigger + insert sanitiser (item 2)** — nothing asserts
  that a graded loss can't be voided or that `result='win'` can't be forged.

The shim's `alter default privileges ... grant all on tables to
anon, authenticated` (`00_shim.sql:24-25`) faithfully reproduces Supabase's
permissive default, so a `bets.sql`/`profiles.sql` suite modelled on `picks.sql`
would catch exactly these regressions. This is the highest-leverage item in my
workstream because a silent re-widening is precisely the "silent failure" the
brief ranks above loud ones. Fix (M): add two suites asserting the column grant
and the trigger transitions, mirroring `picks.sql`'s `pg_temp.raises` pattern.

### SEC-08 / SEC-09 / SEC-10 / SEC-11 / SEC-12 / SEC-13

- **SEC-08** — `profiles` is `using(true)` for both `authenticated` (`0001:307`)
  and `anon` (`0011:21`); groups never re-scoped it. Anyone (signed out) can
  enumerate every user's `display_name`, `favorite_team_ids`, and `is_admin`.
  Low sensitivity and consistent with the "public site" decision, but with
  per-group privacy now a feature it's an inconsistency worth a decision. Fix (S).

- **SEC-09** — `/ledger` runs `.eq("user_id", user?.id ?? "")`
  (`ledger/page.tsx:41`). For a signed-out visitor this sends `user_id=eq.` (empty
  string) against a `uuid` column; PostgREST/Postgres raises `22P02 invalid input
  syntax for type uuid: ""`, which supabase-js returns in `error` — **swallowed**
  here (`{ data }` destructure ignores `error`), so `bets=[]` and the page renders
  an empty ledger. No crash, no leak, but it's load-bearing undocumented behaviour;
  a short-circuit `if (!user) return <empty>` is cleaner. Fix (S). *(The exact
  error code should be confirmed against a live PostgREST; the reasoning is from
  Postgres uuid-cast semantics.)*

- **SEC-10** — covered above; dead policies from `0018:18-38`. Fix (S): drop them.

- **SEC-11** — covered above; add explicit `is_admin` checks to the adjustment
  actions so non-admins get a clear "Commissioner only" instead of silent
  `ok:true`. Fix (S).

- **SEC-12** — `supabase/functions/jobs/index.ts` is dead (never deployed; the
  live scheduler is `.github/workflows/jobs.yml`, which sources secrets from
  `${{ secrets.* }}` correctly, `jobs.yml:101-105`). But its deploy pattern
  substitutes `__JOBS_SECRET__`/`__CFBD_KEY__` into **string literals baked into
  the bundle** (`index.ts:19-20`) and compares the request secret with `!==`
  (`index.ts:45`, non-constant-time). A landmine if anyone revives it: run the
  substitution, commit, and real keys land in git. It also still carries the
  inverted CLV formula (changelog, deliberate). Fix (S): delete it, or add a
  header warning. No current exposure — the repo holds only placeholders.

- **SEC-13** — a game with `start_ts = null` (CFBD "TBD") is treated as
  **locked** for picking (`make_pick` `0021:200`) and **hidden** by the blind
  (`picks_revealed` `0023:26-31`). Both are the safe/documented choice, but the
  combined effect is a game that literally **cannot be picked** until a real
  kickoff time is loaded — which for Week 0/1 TBD slots could strand a game off
  every board. Behaviour, not a hole; flagged so it's a conscious call before
  Aug 29. Confirmed in SQL and asserted (`picks.sql:213-214`, `hidden-picks.sql:133-142`).

---

## Verified secure (attacked, found sound)

- **`createServiceClient()` inventory** — imported in exactly two places:
  `admin/page.tsx:7` (server component, gated `if (!me?.is_admin) notFound()`
  at `:35`) and `actions/invites.ts:5` (server action, gated
  `if (!profile?.is_admin)` at `:38`). `service.ts` reads
  `SUPABASE_SERVICE_ROLE_KEY` (no `NEXT_PUBLIC_` prefix → server-only). No
  client component imports it. The `/admin` → `auth.admin.listUsers({perPage:100})`
  chain (`admin/page.tsx:43`) is dead unless SEC-04 is broken.

- **Deny-all tables** — `invite_allowlist`, `api_call_log`,
  `venue_coord_overrides` have RLS on and **no policies** (`0001:282,291,292`);
  `0011` did not add anon read for them. `invite_allowlist`/`api_call_log` are
  read only via the **service** client (`admin/page.tsx:42,50`,
  `queries.ts:594-603`, `invites.ts:43`); `venue_coord_overrides` is never read
  in `src/`. No anon/RLS-key path touches them.

- **`SECURITY DEFINER` hardening** — every definer function sets
  `search_path = public`: `handle_new_user` (`0002`, + execute revoked in
  `0003`), `make_pick`/`remove_pick`/`enforce_bet_*` (`0013`,`0021`),
  `is_group_member`/`is_group_admin`/`is_group_visible`/`create_group`/
  `join_group`/`leave_group`/`remove_group_member`/`set_group_role`/
  `archive_group`/`regenerate_join_code`/`set_group_week_config`/
  `freeze_group_week`/`enforce_group_has_admin` (`0020`), `update_group`
  (`0022`,`0023`), `picks_revealed`/`group_game_pick_count` (`0023`). The two
  intentional `SECURITY INVOKER` helpers (`group_week_game_ids` and the views in
  `0015`) are documented as such and rely on caller RLS. `freeze_group_week`
  execute is revoked from `authenticated` too (service-role only) and the suite
  asserts it (`groups.sql:289-297`).

- **Secret hygiene** — grep of `src/` finds no `NEXT_PUBLIC_` on anything
  sensitive (only `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` and `NEXT_PUBLIC_SITE_URL`).
  `CFBD_API_KEY`/`ANTHROPIC_API_KEY`/`SUPABASE_SERVICE_ROLE_KEY` live in
  `lib/cfbd.ts`, `lib/anthropic.ts`, `lib/supabase/service.ts`, none imported by
  any `src/` client or server-rendered page (only `scripts/`). `next.config.ts`
  is empty (no `env` leak). `proxy.ts` (Next 16's renamed middleware) only
  refreshes the session — no secret handling.

- **Null-user handling per authenticated route** — `/admin` `notFound()` for
  non-users and non-admins (`admin/page.tsx:27,35`); `/crew` redirects
  (`crew/page.tsx`); `/ledger` renders empty (SEC-09); API routes
  (`api/slate`, `api/ticker`, `api/game/[id]`) all use the RLS client and treat
  `user` as nullable, returning public data. No route trusts a null user for a
  privileged read. There is no page-level auth gate by design (`0011` public
  browse); the security boundary is RLS + the RPCs, which is the correct posture
  given the findings above.

**Provenance:** SEC-04/05/06 and the whole attack matrix are verified by reading
the final-state SQL. The picks lockdown, group membership/visibility, freeze
clock, and the blind are additionally asserted by the DB suite
(`picks.sql`, `groups.sql`, `hidden-picks.sql`). The profiles column grant, the
bets trigger, and the predictions/line_snapshots revokes are verified **by SQL
reading only** (SEC-03 — no suite covers them). The exact PostgREST error in
SEC-09 would need a live PostgREST to confirm byte-for-byte.

---

## For 00-SUMMARY.md

- **P1 — SEC-03 (M):** Add `bets.sql` + `profiles.sql` DB test suites. Two of the
  three `0013` integrity fixes (bets void-only trigger, profiles `is_admin`
  column grant) have **no regression test**; a future `grant` migration would
  silently reopen admin escalation / bet forgery with a green `db:test`.
- **P2 — SEC-01 (S):** Rate-limit `join_group` and widen the join code beyond
  6 hex chars (~24 bits). It is the only gate on private-group membership, and
  membership unlocks members-only (incl. blinded) picks; the "not a security
  boundary" comment is wrong for private groups.
- *(P3 backlog, one-liners for completeness):* SEC-02 removed admins rejoin as
  admin (S); SEC-08 profiles world-readable incl. `is_admin` (S); SEC-09 ledger
  empty-string uuid query (S); SEC-10 dead 0018 pick policies (S); SEC-11 silent
  no-op adjustment actions (S); SEC-12 dead edge fn key/secret handling (S);
  SEC-13 TBD games un-pickable (decision needed).
- **Headline reassurance:** the three original vulnerabilities
  (is_admin escalation, bet forgery, pick forgery) are **fixed and hold in the
  final migration state**; groups (0020–0023) did not reopen them.
