import { AppNav } from "../../components/AppNav";
import { RatingsTable, type RatingRow } from "../../components/RatingsTable";
import { MODEL_VERSION, splitInformative } from "../../model/ratings";
import { required } from "../../lib/db-result";
import type { TeamRow } from "../../lib/db-types";
import { fetchCurrentSeasonWeek } from "../../lib/queries";
import { pickPollRanks, pollShortName } from "../../lib/rankings";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Ratings" };

interface DbRating {
  team_id: number;
  week: number;
  overall: number;
  offense: number | null;
  defense: number | null;
}

interface DbComponents {
  team_id: number;
  churn_adjustment: number | null;
  luck_correction: number | null;
}

export default async function RatingsPage() {
  const supabase = await createClient();
  const { seasonId } = await fetchCurrentSeasonWeek(supabase);

  // 09:P-12. The page needs two weeks — the latest, and the one before it for
  // the movement arrows — and used to read the whole season to find them: one
  // row per team per week, ~2,040 by week 15 to use ~276 of them.
  //
  // Ask which week is latest first, then fetch only those two. That is a second
  // round trip in exchange for dropping ~87% of the rows by November, and the
  // first query is a single indexed row. At week 0 the two shapes cost the
  // same; the trade only gets better as the season runs.
  const latestWeekRes = await supabase
    .from("ratings")
    .select("week")
    .eq("season_id", seasonId)
    .order("week", { ascending: false })
    .limit(1)
    .maybeSingle();
  // A read error must not render as "no teams yet" — that is a real and
  // different state (db-result.ts). Thrown here rather than through
  // `required()`, which takes an array and this is a `maybeSingle`; the message
  // matches so both failures read the same in a log. An empty table arrives as
  // data null with no error, which is the genuine empty case and falls through.
  if (latestWeekRes.error) {
    throw new Error(`ratings failed to load: ${latestWeekRes.error.message}`);
  }
  const latestWeek = latestWeekRes.data?.week ?? 0;

  const ratingsRes = await supabase
    .from("ratings")
    .select("team_id, week, overall, offense, defense")
    .eq("season_id", seasonId)
    // week 0 has no predecessor; `in` on [0, -1] is harmless and keeps the
    // query one shape rather than two.
    .in("week", [latestWeek, latestWeek - 1]);
  const ratings = required<DbRating>(ratingsRes, "ratings");

  const current = ratings.filter((r) => r.week === latestWeek);
  const previous = new Map(
    ratings.filter((r) => r.week === latestWeek - 1).map((r) => [r.team_id, r]),
  );

  // The halves are only two measurements when results have differentiated them.
  // Preseason rows (and anything written before 2026.3.0) carry overall/2 twice
  // — see SPLIT_COLS in RatingsTable, and audit bug #11.
  const half = (r: DbRating) => ({
    offense: r.offense === null ? Number(r.overall) / 2 : Number(r.offense),
    defense: r.defense === null ? Number(r.overall) / 2 : Number(r.defense),
  });
  const showSplit = splitInformative(current.map(half));

  const teamIds = current.map((r) => r.team_id);
  const [teamsRes, compsRes, pollsRes] = await Promise.all([
    // The six columns the row mapper below reads, not all nine — this pulls
    // every FBS team, so mascot/classification/alt_color were ~138 rows of
    // payload nothing rendered. Its two siblings in this Promise.all were
    // already narrowed (P2-6).
    supabase
      .from("teams")
      .select("id, school, abbreviation, conference, color, logo_url")
      .in("id", teamIds),
    supabase
      .from("preseason_components")
      .select("team_id, churn_adjustment, luck_correction")
      .eq("season_id", seasonId),
    supabase
      .from("poll_rankings")
      .select("week, poll, team_id, rank")
      .eq("season_id", seasonId)
      .eq("season_type", "regular"),
  ]);
  type RatingTeam = Pick<
    TeamRow,
    "id" | "school" | "abbreviation" | "conference" | "color" | "logo_url"
  >;
  const teams = new Map(required<RatingTeam>(teamsRes, "teams").map((t) => [t.id, t]));
  const comps = new Map(
    ((compsRes.data ?? []) as DbComponents[]).map((c) => [c.team_id, c]),
  );
  const { poll, byTeam: pollRanks } = pickPollRanks(
    (pollsRes.data ?? []) as Array<{ week: number; poll: string; team_id: number; rank: number }>,
  );
  const pollName = pollShortName(poll);

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
        ...half(r),
        delta: prev ? Number(r.overall) - Number(prev.overall) : null,
        churn: comp?.churn_adjustment !== null && comp ? Number(comp.churn_adjustment) : null,
        luck: comp?.luck_correction !== null && comp ? Number(comp.luck_correction) : null,
        pollRank: pollRanks.get(r.team_id) ?? null,
        poll: pollName,
      },
    ];
  });

  // With no rows the table still renders: sortable column headers over an
  // empty tbody, a scale explainer ending "...among all 0", and a footnote
  // explaining why a column that isn't there is hidden (P1-5). None of that is
  // an error state — it is a first run, before `preseason-refresh` has loaded
  // anything — so it gets the same treatment as /rankings and /standings: say
  // what is missing and when it arrives.
  const empty = rows.length === 0;

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        <div className="mb-6 flex items-baseline justify-between">
          <h1 className="text-2xl">Ratings</h1>
          {/* "preseason" is only honest once there are ratings to describe.
              Empty, it claimed a state the page was not in. */}
          <p className="stat text-xs text-chalk/50">
            {empty
              ? `model ${MODEL_VERSION}`
              : `${latestWeek === 0 ? "preseason" : `through week ${latestWeek}`} · model ${MODEL_VERSION}`}
          </p>
        </div>
        {empty ? (
          <div className="card px-6 py-12 text-center">
            <p className="display text-lg text-chalk/80">No ratings yet</p>
            <p className="mt-1 text-sm text-dim">
              The preseason build lands here once CFBD publishes this season&rsquo;s talent and
              returning production — the refresh job retries every morning through August. In-season
              numbers update every Sunday after grading.
            </p>
          </div>
        ) : (
          <RatingsTable rows={rows} showSplit={showSplit} />
        )}
      </main>
    </>
  );
}
