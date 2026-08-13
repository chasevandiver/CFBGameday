/**
 * Make a failed read fail visibly.
 *
 * The defect this exists for: every page in `src/app/` destructured
 * `const { data } = await supabase…` and dropped `error` on the floor. A build
 * pointed at a **non-resolving database** still served HTTP 200 on `/slate`,
 * `/standings`, `/ratings`, `/receipts`, `/recap`, `/rankings`, `/teams`,
 * `/model`, `/ledger` and `/game/[id]` — every one of them rendering as though
 * the season simply had no data in it. `error.tsx` says "a Supabase hiccup gets
 * a retry"; a Supabase hiccup never reached it.
 *
 * That is the same shape as `emptyIsHealthy` on `/scoreboard` and as the backup
 * step that exited 0 with a 20-byte artifact: **an outage and a quiet day
 * produced the same observation.** On a Saturday it is worse than an error
 * page, because an empty slate looks plausible.
 *
 * ## The rule, which is deliberately not "throw on everything"
 *
 * Throw when a failed read would make the page **lie** — when the rows are what
 * the page is *about*. Stay quiet when they are enrichment the page can render
 * honestly without: weather, venue domes, rivalry badges, poll ranks, the
 * other systems' ratings. A single failed decoration should not take down a
 * page that could otherwise render the thing you came for.
 *
 * So `/standings` throws if `teams`, `finals` or `ratings` fail — a standings
 * table missing any of those is not a standings table. It does not throw
 * because a poll rank is missing.
 *
 * ## Empty is not an error
 *
 * `required()` throws on `error`, never on an empty array. Empty is a real and
 * expected state here: `/ratings` before `preseason-refresh` has ever run,
 * `/receipts` before the first freeze, `/recap` for a week nobody played. Those
 * pages have house empty states and should keep using them.
 */

/**
 * `error` is optional because several call sites short-circuit a query they
 * know is pointless — `ids.length ? await supabase… : { data: [] }` — and that
 * synthetic literal is a deliberate skip, not a read that failed. A real
 * PostgREST response always carries the field.
 */
interface PostgrestLike<T> {
  data: T | null;
  error?: { message: string; code?: string; details?: string | null } | null;
}

/**
 * Rows the page is about. Throws on a failed read so the route's error boundary
 * renders; returns `[]` for a successful read that found nothing.
 *
 * `what` names the read in the thrown message, because "TypeError: undefined"
 * three components deep is how the original defect stayed invisible.
 */
export function required<T>(res: PostgrestLike<T[]>, what: string): T[] {
  if (res.error) throw new Error(`${what} failed to load: ${res.error.message}`);
  return res.data ?? [];
}

/**
 * The single-row form, for `.maybeSingle()`. Null is a legitimate answer — the
 * row genuinely is not there — so only `error` throws.
 */
export function requiredOne<T>(res: PostgrestLike<T>, what: string): T | null {
  if (res.error) throw new Error(`${what} failed to load: ${res.error.message}`);
  return res.data;
}
