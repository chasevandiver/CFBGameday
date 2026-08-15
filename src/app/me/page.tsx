import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "../../components/AppNav";
import { ProfileSettings, type FavTeam } from "../../components/ProfileSettings";
import { PushSettings } from "../../components/PushSettings";
import type { TeamRow } from "../../lib/db-types";
import { createClient } from "../../lib/supabase/server";
import { isCurrentUserAdmin } from "../../lib/admin";
import { tzOf } from "../../lib/kick";

export const dynamic = "force-dynamic";

export const metadata = { title: "Account" };

/** Display name, server-side favorite teams, sign out — the product had none
 *  of these surfaces (audit: favorite_team_ids was dead schema). */
export default async function MePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // SEC-08b: `is_admin` is no longer in the `authenticated` column grant (0050),
  // so it is asked for as a boolean rather than selected. This site was the
  // tenth and last — and the one a `select("is_admin")` grep does not find,
  // because it was a name inside a multi-column list. Left as it was, 0050
  // would have made this page throw rather than degrade.
  const [{ data: profile }, { data: teamRows }, { data: prefRows }, { data: defaultRows }, isAdmin] =
    await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, favorite_team_ids, timezone")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("teams")
      .select("id, school, conference, logo_url")
      .eq("classification", "fbs")
      .order("school"),
    supabase.from("notification_prefs").select("kind, enabled").eq("user_id", user.id),
    supabase.from("notification_settings").select("kind, default_enabled"),
    isCurrentUserAdmin(supabase),
  ]);

  // An absent pref row means "never touched"; the kind's default decides.
  const prefs: Record<string, boolean> = {};
  for (const row of (prefRows ?? []) as { kind: string; enabled: boolean }[]) {
    prefs[row.kind] = row.enabled;
  }
  const defaults: Record<string, boolean> = {};
  for (const row of (defaultRows ?? []) as { kind: string; default_enabled: boolean }[]) {
    defaults[row.kind] = row.default_enabled;
  }

  const teams: FavTeam[] = ((teamRows ?? []) as TeamRow[]).map((t) => ({
    id: t.id,
    school: t.school,
    conference: t.conference,
    logo: t.logo_url,
  }));

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <h1 className="mb-6 text-2xl">Account</h1>
        <ProfileSettings
          displayName={profile?.display_name ?? ""}
          favoriteIds={profile?.favorite_team_ids ?? []}
          teams={teams}
          timezone={tzOf(profile?.timezone)}
        />
        <PushSettings prefs={prefs} defaults={defaults} />
        {isAdmin && (
          <p className="mt-6 text-xs text-dim">
            <Link href="/admin" className="text-accent underline-offset-2 hover:underline">
              Site admin
            </Link>{" "}
            — invites, API budget, rating adjustments.
          </p>
        )}
      </main>
    </>
  );
}
