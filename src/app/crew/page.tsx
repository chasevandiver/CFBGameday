import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_GROUP_COOKIE, resolveActiveGroup } from "../../lib/groups";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * /crew is now /groups. The old URL is in people's history and on the ledger's
 * footer copy, so it forwards rather than 404s — into the group you were last
 * looking at when there is one, and to the list when there isn't.
 */
export default async function CrewRedirect() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { active } = await resolveActiveGroup(
    supabase,
    user?.id ?? null,
    (await cookies()).get(ACTIVE_GROUP_COOKIE)?.value ?? null,
  );
  redirect(active ? `/groups/${active.slug}` : "/groups");
}
