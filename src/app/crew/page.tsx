import Link from "next/link";
import { AdjustmentsPanel, type AdjustmentView } from "../../components/AdjustmentsPanel";
import { AppNav } from "../../components/AppNav";
import { InviteForm } from "../../components/InviteForm";
import type { PickRow, ProfileRow } from "../../lib/db-types";
import { fetchCfbdCallsThisMonth, fetchCurrentSeasonWeek, fetchProfiles } from "../../lib/queries";
import { byLeagueRules, EMPTY_TALLY, formatRecord, tallyBy, type Tally } from "../../lib/records";
import { createClient } from "../../lib/supabase/server";
import { createServiceClient } from "../../lib/supabase/service";

export const dynamic = "force-dynamic";

export const metadata = { title: "Crew" };

type Row = Tally & { name: string };

export default async function CrewPage() {
  const supabase = await createClient();
  const { seasonId, week } = await fetchCurrentSeasonWeek(supabase);
  const profiles = await fetchProfiles(supabase);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = profiles.find((p) => p.id === user?.id);
  let invited: Array<{ email: string; joined: boolean }> = [];
  let ratedTeams: Array<{ id: number; school: string }> = [];
  let adjustments: AdjustmentView[] = [];
  let cfbdCalls: number | null = null;
  if (me?.is_admin) {
    const service = createServiceClient();
    const [{ data: allowlist }, { data: joinedUsers }, { data: ratingRows }, { data: adjRows }, callCount] =
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
      ]);
    cfbdCalls = callCount;
    const joinedEmails = new Set(
      (joinedUsers?.users ?? []).map((u) => u.email?.toLowerCase()).filter(Boolean),
    );
    invited = (allowlist ?? []).map((a: { email: string }) => ({
      email: a.email,
      joined: joinedEmails.has(a.email.toLowerCase()),
    }));

    const ratedIds = new Set((ratingRows ?? []).map((r: { team_id: number }) => r.team_id));
    const { data: teamRows } = await supabase
      .from("teams")
      .select("id, school")
      .in("id", [...ratedIds])
      .order("school");
    ratedTeams = (teamRows ?? []) as Array<{ id: number; school: string }>;
    const schoolById = new Map(ratedTeams.map((t) => [t.id, t.school]));
    adjustments = (adjRows ?? []).map(
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
  }

  const { data } = await supabase
    .from("picks")
    .select("*")
    .eq("season_id", seasonId)
    .not("result", "is", null);
  const picks = (data ?? []) as PickRow[];

  // week of each graded pick → weekly winners strip
  const pickGameIds = [...new Set(picks.map((p) => p.game_id))];
  const { data: pickGames } = pickGameIds.length
    ? await supabase.from("games").select("id, week").in("id", pickGameIds)
    : { data: [] };
  const weekByGame = new Map(
    ((pickGames ?? []) as Array<{ id: number; week: number }>).map((g) => [g.id, g.week]),
  );
  const nameById = new Map(profiles.map((p) => [p.id, p.display_name]));
  const weeklyWins = new Map<number, Map<string, { w: number; l: number }>>();
  for (const p of picks) {
    if (p.result !== "win" && p.result !== "loss") continue;
    const wk = weekByGame.get(p.game_id);
    if (wk === undefined) continue;
    const users = weeklyWins.get(wk) ?? new Map();
    const rec = users.get(p.user_id) ?? { w: 0, l: 0 };
    if (p.result === "win") rec.w += 1;
    else rec.l += 1;
    users.set(p.user_id, rec);
    weeklyWins.set(wk, users);
  }
  const weeklyWinners = [...weeklyWins.entries()]
    .map(([wk, users]) => {
      const best = Math.max(...[...users.values()].map((r) => r.w));
      if (best === 0) return null;
      const names = [...users.entries()]
        .filter(([, r]) => r.w === best)
        .map(([uid, r]) => ({ name: nameById.get(uid) ?? "?", rec: r }));
      return { week: wk, best, names };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.week - b.week);

  // Picks carry no payout column, so `records` grades them at the flat -110 of
  // League Rules #6. Leaderboard tiebreaker per League Rules #5: units → ROI → CLV.
  const tallies = tallyBy(picks, (p) => p.user_id);
  const rows: Row[] = profiles.map((p: ProfileRow) => ({
    name: p.display_name,
    ...(tallies.get(p.id) ?? EMPTY_TALLY),
  }));
  rows.sort(byLeagueRules);

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl">Crew</h1>
          <p className="flex gap-3 text-xs">
            <Link
              href={`/crew/week/${week}`}
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              Week {week} grid
            </Link>
            <Link
              href="/rules"
              className="font-medium text-dim underline-offset-2 hover:text-chalk hover:underline"
            >
              League rules
            </Link>
          </p>
        </div>

        {weeklyWinners.length > 0 && (
          <section className="card mb-5 px-4 py-3">
            <h2 className="mb-2 text-sm text-accent">Weekly winners</h2>
            <ul className="flex flex-col gap-1">
              {weeklyWinners.map((w) => (
                <li key={w.week} className="stat flex justify-between text-sm">
                  <Link
                    href={`/crew/week/${w.week}`}
                    className="text-dim underline-offset-2 hover:text-chalk hover:underline"
                  >
                    Week {w.week}
                  </Link>
                  <span className="text-chalk">
                    {w.names.map((n) => n.name).join(" & ")}{" "}
                    <span className="text-dim">
                      ({w.best}-{w.names[0].rec.l})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="card overflow-x-auto">
          <table className="stats w-full text-sm">
            <thead>
              <tr className="border-b border-chalk/20 text-left text-xs uppercase text-chalk/50">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2 text-right">Record</th>
                <th className="px-3 py-2 text-right">Units</th>
                <th className="px-3 py-2 text-right">ROI</th>
                <th className="px-3 py-2 text-right">CLV</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.name} className="border-b border-chalk/5 last:border-0">
                  <td className="px-3 py-2 text-chalk/50">{i + 1}</td>
                  <td className="px-3 py-2 font-sans">{r.name}</td>
                  <td className="px-3 py-2 text-right">{formatRecord(r)}</td>
                  <td
                    className={`px-3 py-2 text-right ${r.units > 0 ? "text-win" : r.units < 0 ? "text-loss" : ""}`}
                  >
                    {r.units >= 0 ? "+" : ""}
                    {r.units.toFixed(1)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.roi === null ? "–" : `${(r.roi * 100).toFixed(1)}%`}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.avgClv === null ? "–" : `${r.avgClv > 0 ? "+" : ""}${r.avgClv.toFixed(2)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-chalk/50">
          Graded picks only. Units at −110; CLV = your number vs the closing consensus.
        </p>

        {me?.is_admin && (
          <section className="card mt-8 p-4">
            <h2 className="mb-1 text-sm text-accent">Invite the crew</h2>
            <p className="mb-3 text-xs text-chalk/60">
              Commissioner only. Enter an email, get a one-tap sign-in link to text them — no
              email delivery needed.
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
        )}

        {me?.is_admin && cfbdCalls !== null && (
          <section className="card mt-6 flex items-center justify-between p-4">
            <div>
              <h2 className="text-sm text-accent">CFBD budget</h2>
              <p className="mt-1 text-xs text-dim">
                Metered API calls this month. The scoreboard loop throttles at 80% and stops at
                95% on its own.
              </p>
            </div>
            <p className="stat text-right text-xl font-semibold">
              <span
                className={
                  cfbdCalls >= 27_000 ? "text-loss" : cfbdCalls >= 22_500 ? "text-edge" : "text-chalk"
                }
              >
                {cfbdCalls.toLocaleString()}
              </span>
              <span className="text-sm text-dim"> / 30,000</span>
            </p>
          </section>
        )}

        {me?.is_admin && (
          <section className="card mt-6 p-4">
            <h2 className="mb-1 text-sm text-accent">Rating adjustments</h2>
            <p className="mb-3 text-xs text-chalk/60">
              Dock or credit a team before Thursday&apos;s freeze — QB out, suspension, chaos.
              Active adjustments are added to that team&apos;s rating when predictions are priced.
              Removing one never rewrites already-frozen predictions.
            </p>
            <AdjustmentsPanel teams={ratedTeams} adjustments={adjustments} />
          </section>
        )}
      </main>
    </>
  );
}
