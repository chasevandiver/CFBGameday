import { AppNav } from "../../components/AppNav";
import { TeamsGrid, type TeamCard } from "../../components/TeamsGrid";
import type { TeamRow } from "../../lib/db-types";
import { fetchCurrentSeasonWeek } from "../../lib/queries";
import { pickPollRanks, pollShortName } from "../../lib/rankings";
import { createClient } from "../../lib/supabase/server";
import { MODEL_VERSION } from "../../model/ratings";

export const dynamic = "force-dynamic";

export const metadata = { title: "Teams" };

export default async function TeamsPage() {
  const supabase = await createClient();
  const { seasonId } = await fetchCurrentSeasonWeek(supabase);

  const { data: ratingRows } = await supabase
    .from("latest_ratings")
    .select("team_id, overall")
    .eq("season_id", seasonId);
  const latest = new Map<number, number>(
    (ratingRows ?? []).map((r: { team_id: number; overall: number }) => [
      r.team_id,
      Number(r.overall),
    ]),
  );

  const [{ data: teamRows }, { data: pollRows }] = await Promise.all([
    supabase.from("teams").select("*").in("id", [...latest.keys()]),
    supabase
      .from("poll_rankings")
      .select("week, poll, team_id, rank")
      .eq("season_id", seasonId)
      .eq("season_type", "regular"),
  ]);
  const teams = (teamRows ?? []) as TeamRow[];
  const { poll, byTeam: pollRanks } = pickPollRanks(
    (pollRows ?? []) as Array<{ week: number; poll: string; team_id: number; rank: number }>,
  );
  const pollName = pollShortName(poll);

  const cards: TeamCard[] = teams
    .map((t) => ({
      id: t.id,
      school: t.school,
      mascot: t.mascot,
      conference: t.conference,
      logo: t.logo_url,
      rating: latest.get(t.id) ?? 0,
      rank: 0,
      pollRank: pollRanks.get(t.id) ?? null,
      poll: pollName,
    }))
    .sort((a, b) => b.rating - a.rating)
    .map((t, i) => ({ ...t, rank: i + 1 }));

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <div className="mb-5 flex items-baseline justify-between">
          <h1 className="text-2xl">Teams</h1>
          <p className="stat text-xs text-dim">{cards.length} FBS · model {MODEL_VERSION}</p>
        </div>
        <TeamsGrid teams={cards} />
      </main>
    </>
  );
}
