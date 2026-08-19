import Link from "next/link";
import { notFound } from "next/navigation";
import { AdjustmentsPanel, type AdjustmentView } from "../../components/AdjustmentsPanel";
import { AppNav } from "../../components/AppNav";
import { GameStatusPanel, type AdminGameView } from "../../components/GameStatusPanel";
import { InviteForm } from "../../components/InviteForm";
import { PitchPanel } from "../../components/PitchPanel";
import { WagersPanel, type AdminWagerView } from "../../components/WagersPanel";
import {
  NotificationsPanel,
  type AudienceOption,
  type SendRow,
  type TriggerSetting,
} from "../../components/NotificationsPanel";
import { fetchAdminGames, fetchCfbdCallsThisMonth, fetchCurrentSeasonWeek } from "../../lib/queries";
import { createClient } from "../../lib/supabase/server";
import { pushConfigured } from "../../lib/push";
import { createServiceClient } from "../../lib/supabase/service";
import { DEFAULT_TZ, kickHeading } from "../../lib/kick";
import { partitionAdminGames } from "../../lib/void";
import { isCurrentUserAdmin } from "../../lib/admin";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin" };

/**
 * Site administration, on the global `profiles.is_admin` flag.
 *
 * These three panels used to sit at the bottom of /crew, which mixed "I run
 * this website" with "I run this pool" on one screen. With groups they are
 * different jobs held by different people — a group admin picks the week's
 * games; the commissioner mints invites and watches the API budget — so they
 * live apart.
 */
export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  // Not an admin and not a page: no hint that there is something here to find.
  if (!(await isCurrentUserAdmin(supabase))) notFound();

  const { seasonId } = await fetchCurrentSeasonWeek(supabase);
  const service = createServiceClient();

  const [
    { data: allowlist },
    { data: joinedUsers },
    { data: ratingRows },
    { data: adjRows },
    cfbdCalls,
    { data: runRows },
    { data: notifySettings },
    { data: notifySends },
    { data: groupRows },
    { data: recentBets, count: betCount },
    { data: recentPicks, count: pickCount },
    { data: profileRows },
    adminGames,
  ] = await Promise.all([
      service.from("invite_allowlist").select("email").order("created_at"),
      service.auth.admin.listUsers({ perPage: 100 }),
      supabase.from("ratings").select("team_id").eq("season_id", seasonId),
      supabase
        .from("rating_adjustments")
        .select("id, team_id, points, reason, source, confirmed_at")
        .eq("season_id", seasonId)
        .order("proposed_at", { ascending: false }),
      fetchCfbdCallsThisMonth(service),
      // job_runs is deny-all (0024); the freshness card reads it through the
      // service client behind the is_admin gate, like the tables above.
      service
        .from("job_runs")
        .select("job, started_at, status, error")
        .order("started_at", { ascending: false })
        .limit(80),
      // Push. notification_sends is own-rows-only under RLS; the console reads
      // everyone's through the service client, behind the is_admin gate above.
      service.from("notification_settings").select("kind, enabled, lead_minutes, title, body"),
      service
        .from("notification_sends")
        .select("id, kind, subject, title, status, detail, sent_at, profiles(display_name)")
        .order("sent_at", { ascending: false })
        .limit(20),
      service.from("groups").select("id, name").order("name"),
      // ADM-1's reach: every user's rows, not just the operator's. `bets` is
      // world-readable under RLS but `picks` is not (0021), and both are read
      // through the service client for one consistent story behind the
      // is_admin gate above — same reasoning as job_runs.
      service
        .from("bets")
        .select("id, user_id, description, placed_at, result, voided_at", { count: "exact" })
        .order("placed_at", { ascending: false })
        .limit(20),
      service
        .from("picks")
        .select("id, user_id, game_id, market, side, locked_at, result", { count: "exact" })
        .order("locked_at", { ascending: false })
        .limit(20),
      service.from("profiles").select("id, display_name"),
      // Unfiltered by status on purpose: dead games have to be listed so they
      // can be restored (P1-1).
      fetchAdminGames(supabase, seasonId),
    ]);

  // Flatten the send log for the panel; the joined profile is one name.
  const sendLog: SendRow[] = (
    (notifySends ?? []) as unknown as (Omit<SendRow, "who"> & {
      profiles: { display_name: string } | null;
    })[]
  ).map(({ profiles, ...row }) => ({ ...row, who: profiles?.display_name ?? "unknown" }));

  const audiences: AudienceOption[] = [
    { value: "me", label: "Just me" },
    { value: "everyone", label: "Everyone with a device" },
    ...((groupRows ?? []) as { id: string; name: string }[]).map((g) => ({
      value: String(g.id),
      label: g.name,
    })),
  ];

  const joinedEmails = new Set(
    (joinedUsers?.users ?? []).map((u) => u.email?.toLowerCase()).filter(Boolean),
  );
  const invited = (allowlist ?? []).map((a: { email: string }) => ({
    email: a.email,
    joined: joinedEmails.has(a.email.toLowerCase()),
  }));

  // Latest run per job, with a per-job "overdue" horizon. This is the absence
  // check: an errored run is loud in the row's status, a run that never
  // happened is only visible as a timestamp that fell behind its cadence.
  const OVERDUE_HOURS: Record<string, number> = {
    "refresh-lines": 26,
    "sync-games": 30,
    "ratings-update": 8 * 24,
    freeze: 8 * 24,
    "scoreboard-loop": 8 * 24,
  };
  // OPS-4. `recordJobRun` now writes `canceled` when the runner signals it, so
  // a row still reading `running` long after it started means the process was
  // killed hard enough not to get a word in. Anything not `error` used to
  // render green, which meant a dead loop showed as healthy here — the one
  // place someone would look. The longest job is the ~63-minute scoreboard
  // loop, so three hours is unambiguous rather than tuned.
  const STALE_RUNNING_H = 3;
  type RunRow = { job: string; started_at: string; status: string; error: string | null };
  const latestRun = new Map<string, RunRow>();
  for (const r of (runRows ?? []) as RunRow[]) {
    if (!latestRun.has(r.job)) latestRun.set(r.job, r);
  }
  // Server component: this renders once per request, so reading the clock is
  // the intended behaviour rather than an unstable render.
  // eslint-disable-next-line react-hooks/purity
  const renderedAt = Date.now();
  const jobHealth = [...latestRun.values()]
    .map((r) => {
      const ageH = (renderedAt - Date.parse(r.started_at)) / 3600_000;
      const horizon = OVERDUE_HOURS[r.job];
      return {
        ...r,
        ageH,
        state:
          r.status === "error"
            ? ("error" as const)
            : r.status === "running" && ageH > STALE_RUNNING_H
              ? ("stale" as const)
              : horizon !== undefined && ageH > horizon
                ? ("overdue" as const)
                : ("ok" as const),
      };
    })
    .sort((a, b) => a.job.localeCompare(b.job));

  const ratedIds = new Set((ratingRows ?? []).map((r: { team_id: number }) => r.team_id));
  const { data: teamRows } = await supabase
    .from("teams")
    .select("id, school")
    .in("id", [...ratedIds])
    .order("school");
  const ratedTeams = (teamRows ?? []) as Array<{ id: number; school: string }>;
  const schoolById = new Map(ratedTeams.map((t) => [t.id, t.school]));

  // Labels for the void control. Its own lookup rather than reusing
  // `schoolById`, which only covers rated teams — an FCS buy game's visitor
  // has no rating row and would render as "#2579".
  const gameTeamIds = [
    ...new Set(adminGames.flatMap((g) => [g.home_team_id, g.away_team_id])),
  ];
  const { data: gameTeamRows } = await supabase
    .from("teams")
    .select("id, abbreviation, school")
    .in("id", gameTeamIds);
  const abbrById = new Map(
    ((gameTeamRows ?? []) as Array<{ id: number; abbreviation: string | null; school: string }>).map(
      (t) => [t.id, t.abbreviation ?? t.school],
    ),
  );
  // ADM-1's list. Bets and picks are interleaved by time so the operator sees
  // "what did I just do" rather than two lists to reconcile. Picks borrow the
  // same abbrById the void control built — a pick with no matching game (a
  // different season, say) still renders, labelled by id, because a row you
  // cannot name is exactly the kind you most want to be able to delete.
  const nameById = new Map(
    ((profileRows ?? []) as Array<{ id: string; display_name: string | null }>).map((p) => [
      p.id,
      p.display_name ?? "unknown",
    ]),
  );
  const gameById = new Map(adminGames.map((g) => [g.id, g]));
  const gameLabel = (id: number): string => {
    const g = gameById.get(id);
    if (!g) return `game ${id}`;
    return `${abbrById.get(g.away_team_id) ?? `#${g.away_team_id}`} @ ${abbrById.get(g.home_team_id) ?? `#${g.home_team_id}`}`;
  };
  const stamp = (iso: string | null): string =>
    iso ? kickHeading(iso, DEFAULT_TZ) : "unknown time";

  const wagerRows: AdminWagerView[] = [
    ...((recentBets ?? []) as Array<{
      id: number;
      user_id: string;
      description: string;
      placed_at: string;
      result: string | null;
      voided_at: string | null;
    }>).map((b) => ({
      id: b.id,
      kind: "bet" as const,
      who: nameById.get(b.user_id) ?? "unknown",
      what: b.description,
      when: stamp(b.placed_at),
      at: b.placed_at,
      result: b.voided_at ? "void" : b.result,
      voided: b.voided_at !== null,
    })),
    ...((recentPicks ?? []) as Array<{
      id: number;
      user_id: string;
      game_id: number;
      market: string;
      side: string;
      locked_at: string | null;
      result: string | null;
    }>).map((p) => ({
      id: p.id,
      kind: "pick" as const,
      who: nameById.get(p.user_id) ?? "unknown",
      what: `${gameLabel(p.game_id)} — ${p.market} ${p.side}`,
      when: stamp(p.locked_at),
      at: p.locked_at ?? "",
      result: p.result,
      voided: p.result === "void",
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 20);

  const { open: openGames, dead: deadGames } = partitionAdminGames(adminGames);
  const toGameView = (g: (typeof adminGames)[number]): AdminGameView => ({
    id: g.id,
    label: `${abbrById.get(g.away_team_id) ?? `#${g.away_team_id}`} @ ${abbrById.get(g.home_team_id) ?? `#${g.home_team_id}`}`,
    kickoff: g.start_ts ? kickHeading(g.start_ts, DEFAULT_TZ) : "TBD",
    kickedOff: g.start_ts !== null && Date.parse(g.start_ts) <= renderedAt,
    status: g.status,
  });
  const adjustments: AdjustmentView[] = (adjRows ?? []).map(
    (a: {
      id: number;
      team_id: number;
      points: number;
      reason: string;
      source: string;
      confirmed_at: string | null;
    }) => ({
      id: a.id,
      teamId: a.team_id,
      school: schoolById.get(a.team_id) ?? `#${a.team_id}`,
      points: Number(a.points),
      reason: a.reason,
      source: a.source,
      confirmed: a.confirmed_at !== null,
    }),
  );

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <h1 className="text-2xl">Admin</h1>
        {/* The nav's account button now lands admins here rather than on /me,
            so this is the only route to display name, favourites and sign-out. */}
        <p className="mb-4 mt-1 text-xs text-dim">
          <Link href="/me" className="text-accent underline-offset-2 hover:underline">
            Account settings
          </Link>{" "}
          — display name, favourite teams, sign out.
        </p>
        <p className="mb-6 text-sm text-dim">
          Site-wide. Group formats are set by each group&rsquo;s own admin.
        </p>

        {/* Above Invites on purpose: sending the pitch is the step that comes
            before adding an address, and the two are one job. */}
        <PitchPanel />

        <section className="card mb-4 p-4">
          <h2 className="mb-1 text-sm text-accent">Invites</h2>
          <p className="mb-3 text-xs text-chalk/60">
            Enter an email, get a one-tap sign-in link to text them — no email delivery needed.
          </p>
          <InviteForm />
          {invited.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1">
              {invited.map((i) => (
                <li key={i.email} className="stat flex justify-between text-xs">
                  <span className="text-chalk/80">{i.email}</span>
                  <span className={i.joined ? "text-win" : "text-chalk/40"}>
                    {i.joined ? "joined" : "invited"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {cfbdCalls !== null && (
          <section className="card mb-4 flex items-center justify-between p-4">
            <div>
              <h2 className="text-sm text-accent">CFBD budget</h2>
              <p className="mt-1 text-xs text-dim">
                Metered API calls this month. The scoreboard loop throttles at 80% and stops at 95%
                on its own.
              </p>
            </div>
            <p className="stat text-right text-xl font-semibold">
              <span
                className={
                  cfbdCalls >= 27_000
                    ? "text-loss"
                    : cfbdCalls >= 22_500
                      ? "text-edge"
                      : "text-chalk"
                }
              >
                {cfbdCalls.toLocaleString()}
              </span>
              <span className="text-sm text-dim"> / 30,000</span>
            </p>
          </section>
        )}

        <NotificationsPanel
          settings={(notifySettings ?? []) as TriggerSetting[]}
          sends={sendLog}
          audiences={audiences}
          configured={pushConfigured()}
        />

        <WagersPanel wagers={wagerRows} total={(betCount ?? 0) + (pickCount ?? 0)} />

        <section className="card mb-4 p-4">
          <h2 className="mb-1 text-sm text-accent">Game status</h2>
          <p className="mb-3 text-xs text-chalk/60">
            League Rule #4: a postponed or canceled game voids every open pick and bet on it,
            immediately. CFBD publishes no cancellation signal, so this is the only thing that
            writes those statuses. Restoring puts the game back on the slate but does not
            un-void — the line has moved, so members re-pick.
          </p>
          <GameStatusPanel open={openGames.map(toGameView)} dead={deadGames.map(toGameView)} />
        </section>

        <section className="card mb-4 p-4">
          <h2 className="mb-1 text-sm text-accent">Jobs</h2>
          <p className="mb-3 text-xs text-chalk/60">
            Last run per scheduled job. Red is a failed run; amber means the job hasn&rsquo;t run
            inside its expected cadence, or started and never finished — the two failure modes
            that never send an error anywhere.
          </p>
          {jobHealth.length === 0 ? (
            <p className="text-xs text-dim">
              No runs recorded yet — rows appear as the scheduled jobs fire.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {jobHealth.map((j) => (
                <li key={j.job} className="stat flex justify-between gap-3 text-xs">
                  <span className="text-chalk/80">{j.job}</span>
                  <span
                    className={
                      j.state === "error"
                        ? "text-loss"
                        : j.state === "overdue" || j.state === "stale"
                          ? "text-edge"
                          : "text-chalk/40"
                    }
                    title={j.error ?? undefined}
                  >
                    {j.state === "error"
                      ? "failed · "
                      : j.state === "stale"
                        ? "never finished · "
                        : j.state === "overdue"
                          ? "overdue · "
                          : ""}
                    {j.ageH < 1
                      ? `${Math.max(1, Math.round(j.ageH * 60))}m ago`
                      : j.ageH < 48
                        ? `${Math.round(j.ageH)}h ago`
                        : `${Math.round(j.ageH / 24)}d ago`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-4">
          <h2 className="mb-1 text-sm text-accent">Rating adjustments</h2>
          <p className="mb-3 text-xs text-chalk/60">
            Dock or credit a team before Thursday&apos;s freeze — QB out, suspension, chaos. Active
            adjustments are added to that team&apos;s rating when predictions are priced. Removing
            one never rewrites already-frozen predictions.
          </p>
          <AdjustmentsPanel teams={ratedTeams} adjustments={adjustments} />
        </section>
      </main>
    </>
  );
}
