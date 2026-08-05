import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * One-time login, then never again: every request silently refreshes the
 * session and re-sets auth cookies with the longest lifetime browsers honor
 * (~400 days). The session only ends if the user clears cookies or switches
 * devices — nothing in the app ever expires it.
 *
 * The site is public to browse — no login redirect. Signing in is only needed
 * to save picks / log bets, enforced by RLS and the server actions, not by
 * page-level gates (migration 0011 grants anon read access).
 */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

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
            response.cookies.set(name, value, { ...options, maxAge: COOKIE_MAX_AGE });
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
