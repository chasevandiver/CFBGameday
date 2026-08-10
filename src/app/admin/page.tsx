import { notFound } from "next/navigation";
import { AdjustmentsPanel, type AdjustmentView } from "../../components/AdjustmentsPanel";
import { AppNav } from "../../components/AppNav";
import { InviteForm } from "../../components/InviteForm";
import { fetchCfbdCallsThisMonth, fetchCurrentSeasonWeek } from "../../lib/queries";
import { createClient } from "../../lib/supabase/server";
import { createServiceClient } from "../../lib/supabase/service";

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

  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  // Not an admin and not a page: no hint that there is something here to find.
  if (!me?.is_admin) notFound();

  const { seasonId } = await fetchCurrentSeasonWeek(supabase);
  const service = createServiceClient();

  const [{ data: allowlist }, { data: joinedUsers }, { data: ratingRows }, { data: adjRows }, cfbdCalls, { data: runRows }] =
    await Promise.all([
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
    ]);

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
        <p className="mb-6 text-sm text-dim">
          Site-wide. Group formats are set by each group&rsquo;s own admin.
        </p>

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

        <section className="card mb-4 p-4">
          <h2 className="mb-1 text-sm text-accent">Jobs</h2>
          <p className="mb-3 text-xs text-chalk/60">
            Last run per scheduled job. Red is a failed run; amber means the job hasn&rsquo;t run
            inside its expected cadence — the failure mode that never sends an error anywhere.
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
                        : j.state === "overdue"
                          ? "text-edge"
                          : "text-chalk/40"
                    }
                    title={j.error ?? undefined}
                  >
                    {j.state === "error" ? "failed · " : j.state === "overdue" ? "overdue · " : ""}
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
