import { AppNav } from "../../components/AppNav";
import { RatingsTable, type RatingRow } from "../../components/RatingsTable";
import type { TeamRow } from "../../lib/db-types";
import { fetchCurrentSeasonWeek } from "../../lib/queries";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

interface DbRating {
  team_id: number;
  week: number;
  overall: number;
  offense: number;
  defense: number;
}

interface DbComponents {
  team_id: number;
  churn_adjustment: number | null;
  luck_correction: number | null;
}

export default async function RatingsPage() {
  const supabase = await createClient();
  const { seasonId } = await fetchCurrentSeasonWeek(supabase);

  const { data: allRatings } = await supabase
    .from("ratings")
    .select("team_id, week, overall, offense, defense")
    .eq("season_id", seasonId)
    .order("week", { ascending: false });
  const ratings = (allRatings ?? []) as DbRating[];

  // Latest week per team + the week before it for movement arrows
  const latestWeek = ratings.length > 0 ? Math.max(...ratings.map((r) => r.week)) : 0;
  const current = ratings.filter((r) => r.week === latestWeek);
  const previous = new Map(
    ratings.filter((r) => r.week === latestWeek - 1).map((r) => [r.team_id, r]),
  );

  const teamIds = current.map((r) => r.team_id);
  const [teamsRes, compsRes] = await Promise.all([
    supabase.from("teams").select("*").in("id", teamIds),
    supabase
      .from("preseason_components")
      .select("team_id, churn_adjustment, luck_correction")
      .eq("season_id", seasonId),
  ]);
  const teams = new Map(((teamsRes.data ?? []) as TeamRow[]).map((t) => [t.id, t]));
  const comps = new Map(
    ((compsRes.data ?? []) as DbComponents[]).map((c) => [c.team_id, c]),
  );

  const rows: RatingRow[] = current.flatMap((r) => {
    const team = teams.get(r.team_id);
    if (!team) return [];
    const prev = previous.get(r.team_id);
    const comp = comps.get(r.team_id);
    return [
      {
        teamId: r.team_id,
        school: team.school,
        abbreviation: team.abbreviation,
        conference: team.conference,
        color: team.color,
        logoUrl: team.logo_url,
        overall: Number(r.overall),
        offense: Number(r.offense),
        defense: Number(r.defense),
        delta: prev ? Number(r.overall) - Number(prev.overall) : null,
        churn: comp?.churn_adjustment !== null && comp ? Number(comp.churn_adjustment) : null,
        luck: comp?.luck_correction !== null && comp ? Number(comp.luck_correction) : null,
      },
    ];
  });

  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        <div className="mb-6 flex items-baseline justify-between">
          <h1 className="text-2xl">Ratings</h1>
          <p className="stat text-xs text-chalk/50">
            {latestWeek === 0 ? "preseason" : `through week ${latestWeek}`} · model 2026.1.0
          </p>
        </div>
        <RatingsTable rows={rows} />
      </main>
    </>
  );
}
