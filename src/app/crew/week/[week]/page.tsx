import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_GROUP_COOKIE, resolveActiveGroup } from "../../../../lib/groups";
import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

/** The weekly grid moved under the group that owns it. */
export default async function CrewWeekRedirect({
  params,
}: {
  params: Promise<{ week: string }>;
}) {
  const { week } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { active } = await resolveActiveGroup(
    supabase,
    user?.id ?? null,
    (await cookies()).get(ACTIVE_GROUP_COOKIE)?.value ?? null,
  );
  const n = Number(week);
  const safe = Number.isInteger(n) && n >= 1 && n <= 20 ? n : null;
  redirect(active && safe ? `/groups/${active.slug}/week/${safe}` : "/groups");
}
