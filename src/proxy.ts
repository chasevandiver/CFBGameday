import { type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

// Next 16 renamed the middleware convention to proxy (middleware.ts is
// deprecated); behavior is unchanged — every request refreshes the session.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Everything except static assets and images
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
