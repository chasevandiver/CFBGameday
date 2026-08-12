import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "../../components/AppNav";
import { ProfileSettings, type FavTeam } from "../../components/ProfileSettings";
import { PushSettings } from "../../components/PushSettings";
import type { TeamRow } from "../../lib/db-types";
import { createClient } from "../../lib/supabase/server";

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

  const [{ data: profile }, { data: teamRows }, { data: prefRows }, { data: defaultRows }] =
    await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, favorite_team_ids, is_admin")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("teams")
      .select("id, school, conference, logo_url")
      .eq("classification", "fbs")
      .order("school"),
    supabase.from("notification_prefs").select("kind, enabled").eq("user_id", user.id),
    supabase.from("notification_settings").select("kind, default_enabled"),
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
        />
        <PushSettings prefs={prefs} defaults={defaults} />
        {profile?.is_admin && (
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
