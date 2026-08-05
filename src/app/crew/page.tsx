import { AppNav } from "../../components/AppNav";
import type { PickRow, ProfileRow } from "../../lib/db-types";
import { fetchCurrentSeasonWeek, fetchProfiles } from "../../lib/queries";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

interface Row {
  name: string;
  wins: number;
  losses: number;
  pushes: number;
  units: number;
  roi: number | null;
  avgClv: number | null;
}

export default async function CrewPage() {
  const supabase = await createClient();
  const { seasonId } = await fetchCurrentSeasonWeek(supabase);
  const profiles = await fetchProfiles(supabase);

  // RLS limits visible picks to own + post-kickoff; graded picks are all post-kickoff.
  const { data } = await supabase
    .from("picks")
    .select("*")
    .eq("season_id", seasonId)
    .not("result", "is", null);
  const picks = (data ?? []) as PickRow[];

  const rows: Row[] = profiles.map((p: ProfileRow) => {
    const mine = picks.filter((x) => x.user_id === p.id && x.result !== "void");
    const wins = mine.filter((x) => x.result === "win").length;
    const losses = mine.filter((x) => x.result === "loss").length;
    const pushes = mine.filter((x) => x.result === "push").length;
    // -110 convention: win pays 0.909u per unit staked
    const units = mine.reduce((a, x) => {
      if (x.result === "win") return a + x.units * 0.909;
      if (x.result === "loss") return a - x.units;
      return a;
    }, 0);
    const staked = mine.filter((x) => x.result !== "push").reduce((a, x) => a + x.units, 0);
    const withClv = mine.filter((x) => x.clv !== null);
    return {
      name: p.display_name,
      wins,
      losses,
      pushes,
      units,
      roi: staked > 0 ? units / staked : null,
      avgClv:
        withClv.length > 0
          ? withClv.reduce((a, x) => a + (x.clv as number), 0) / withClv.length
          : null,
    };
  });

  // Leaderboard tiebreaker per League Rules: units → ROI → CLV
  rows.sort(
    (a, b) =>
      b.units - a.units || (b.roi ?? -Infinity) - (a.roi ?? -Infinity) || (b.avgClv ?? -Infinity) - (a.avgClv ?? -Infinity),
  );

  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <h1 className="mb-6 text-2xl">Crew</h1>
        <div className="overflow-x-auto rounded border border-chalk/10 bg-surface">
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
                  <td className="px-3 py-2 text-right">
                    {r.wins}-{r.losses}
                    {r.pushes > 0 ? `-${r.pushes}` : ""}
                  </td>
                  <td
                    className={`px-3 py-2 text-right ${r.units > 0 ? "text-gold" : r.units < 0 ? "text-flag" : ""}`}
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
      </main>
    </>
  );
}
