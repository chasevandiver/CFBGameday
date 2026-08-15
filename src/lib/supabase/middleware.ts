import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * One-time login, then never again: the session refreshes silently and the auth
 * cookies carry the longest lifetime browsers honour (~400 days). Nothing in
 * the app ever expires a session.
 *
 * The site is public to browse — no login redirect. Signing in is only needed
 * to save picks / log bets, enforced by RLS and the server actions, not by
 * page-level gates (migration 0011 grants anon read access).
 *
 * ## Why this file got smaller (AUTH-2, 2026-08-15)
 *
 * Owner report: "it's not keeping me logged in on a device forever anymore."
 * The cause was not here — Supabase's refresh-token rotation was revoking whole
 * token families when an already-used token got replayed ("Possible abuse
 * attempt" in the auth logs, three of them in one evening). But this proxy was
 * feeding it: it ran `supabase.auth.getUser()` on **every** matched request,
 * including each 30-second `/api/ticker` and `/api/slate` poll, and those routes
 * then call `getUser()` again themselves. Measured in the live auth logs:
 * **629 `/user` calls in a single hour**, each from a different Vercel instance
 * with no shared lock, and a 108-request storm against `/token` once a family
 * had been revoked.
 *
 * Two changes, both about doing less:
 *
 *   * `/api/*` is out of the matcher (see `src/proxy.ts`). Those routes build
 *     their own server client from the same cookies and can set cookies on
 *     their own responses, so the proxy's pass was pure duplication — two
 *     GoTrue round trips per poll instead of one.
 *   * A request carrying no Supabase auth cookie does not construct a client at
 *     all. Signed-out browsing is most of the traffic and none of it has a
 *     session to refresh.
 *
 * Neither is the fix for the logouts — turning rotation off is, and that is a
 * project setting, not code. These reduce how often the app can trip it, and
 * they are worth doing on their own: a network round trip to the auth server on
 * every request is a cost with nothing bought.
 */

/**
 * Does this request carry a Supabase session at all?
 *
 * The cookie is `sb-<project-ref>-auth-token`, optionally chunked with a
 * `.0`/`.1` suffix. Matched by shape rather than by building the name from the
 * project URL, so a project rename cannot silently turn this into "nobody is
 * ever signed in" — the failure mode of getting it wrong should be doing the
 * work, not skipping it.
 */
const hasAuthCookie = (request: NextRequest): boolean =>
  request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!hasAuthCookie(request)) return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            /* `options` as @supabase/ssr wrote them, not overridden.
               This used to force `maxAge` to 400 days on every cookie in the
               batch — including the `maxAge: 0` deletions ssr emits to clear a
               stale chunk or to sign out, which turned "delete this" into "keep
               this empty cookie for 400 days". The override was also redundant:
               ssr's own DEFAULT_COOKIE_OPTIONS has set `maxAge` to 400 days
               since 0.10 (`dist/main/utils/constants.js`), which is where the
               400 in the docstring above now comes from. */
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Refreshes the token when needed; do not run logic between client creation
  // and getUser() (per @supabase/ssr guidance).
  await supabase.auth.getUser();

  return response;
}
