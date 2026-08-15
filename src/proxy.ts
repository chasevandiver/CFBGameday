import { type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

// Next 16 renamed the middleware convention to proxy (middleware.ts is
// deprecated); behavior is unchanged — every request refreshes the session.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  /* Everything except static assets, images — and `/api/*` (AUTH-2).
     Every route under /api builds its own server client from these same
     cookies and can set cookies on its own response, so running the session
     refresh here as well meant two GoTrue round trips for every one of the
     30-second `/api/ticker` and `/api/slate` polls. In the live auth logs that
     was 629 `/user` calls in an hour. See lib/supabase/middleware.ts. */
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
