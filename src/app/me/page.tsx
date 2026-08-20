import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "../../components/AppNav";
import { CalendarSettings } from "../../components/CalendarSettings";
import { FunModeSettings } from "../../components/FunModeSettings";
import { ProfileSettings, type FavTeam } from "../../components/ProfileSettings";
import { PushSettings } from "../../components/PushSettings";
import { TicketStubs } from "../../components/TicketStubs";
import type { TeamRow } from "../../lib/db-types";
import { createClient } from "../../lib/supabase/server";
import { isCurrentUserAdmin } from "../../lib/admin";
import { tzOf } from "../../lib/kick";
import { seasonYearOf } from "../../lib/league";
import { fetchCurrentSeasonWeek } from "../../lib/queries";
import { stubsFor, type StubPickRow } from "../../lib/stubs";

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
  const [
    { data: profile },
    { data: teamRows },
    { data: prefRows },
    { data: defaultRows },
    isAdmin,
    // First visit mints the feed token, later visits return it (0054). A null
    // (RPC missing/failing) hides the card rather than rendering a dead URL.
    { data: calendarToken },
  ] = await Promise.all([
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
    supabase.rpc("ensure_calendar_token"),
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

  // Fun Mode's ticket stubs (FUN-7): the viewer's picks this season, folded
  // into per-week stubs on read (lib/stubs.ts). Week rides in on the game —
  // picks don't carry one of their own. Cheap either way; the component
  // renders nothing unless the toggle is on.
  const { seasonId } = await fetchCurrentSeasonWeek(supabase, "cfb");
  const [{ data: stubPickRows }, { data: postseasonFinal }] = await Promise.all([
    supabase
      .from("picks")
      .select("result, games(week)")
      .eq("user_id", user.id)
      .eq("season_id", seasonId),
    // R5-C: once bowl season is producing finals, the Wrapped teaser shows.
    supabase
      .from("games")
      .select("id")
      .eq("season_id", seasonId)
      .eq("season_type", "postseason")
      .eq("status", "final")
      .limit(1),
  ]);
  const stubs = stubsFor(
    ((stubPickRows ?? []) as unknown as { result: StubPickRow["result"]; games: { week: number } | null }[])
      .filter((r) => r.games !== null)
      .map((r) => ({ week: r.games!.week, result: r.result })),
  );

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
        <FunModeSettings />
        <TicketStubs stubs={stubs} year={seasonYearOf(seasonId)} />
        {(postseasonFinal ?? []).length > 0 && (
          <section className="card mt-6 p-4">
            <h2 className="mb-1 text-sm text-accent">The Slate Wrapped</h2>
            <p className="text-xs text-dim">
              Your season, one fact per card — it opens the night the national championship goes
              final.
            </p>
            <Link
              href="/wrapped"
              className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-chalk/15 px-3 text-sm font-medium text-chalk hover:border-chalk/30"
            >
              See where it stands
            </Link>
          </section>
        )}
        {typeof calendarToken === "string" && <CalendarSettings token={calendarToken} />}
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
