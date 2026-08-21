import { NextResponse } from "next/server";
import { fetchOpenPickCount } from "../../../lib/picks-due";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * How many picks the signed-in viewer still owes. The home hub computes this
 * server-side (it is a card there, not a badge), so this route exists for any
 * client that wants it without a page render — and it calls the same
 * `fetchOpenPickCount`, so the two can never disagree.
 *
 * Signed out is `{ open: 0 }` rather than a 401: the site is public to browse
 * (migration 0011) and a count is not worth an error path.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return NextResponse.json({ open: await fetchOpenPickCount(supabase, user?.id ?? null) });
}
