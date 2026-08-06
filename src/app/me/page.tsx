import { redirect } from "next/navigation";
import { AppNav } from "../../components/AppNav";
import { ProfileSettings, type FavTeam } from "../../components/ProfileSettings";
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

  const [{ data: profile }, { data: teamRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, favorite_team_ids")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("teams")
      .select("id, school, conference, logo_url")
      .eq("classification", "fbs")
      .order("school"),
  ]);

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
      </main>
    </>
  );
}
