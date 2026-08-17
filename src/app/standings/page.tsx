import Link from "next/link";
import { AppNav } from "../../components/AppNav";
import { required } from "../../lib/db-result";
import type { TeamRow } from "../../lib/db-types";
import { isSport, type Sport } from "../../lib/league";
import { fetchCurrentSeasonWeek } from "../../lib/queries";
import {
  foldRecords,
  formatRecord,
  NFL_DIVISION_ORDER,
  winPct,
  type FinalForStandings,
  type TeamRecord,
} from "../../lib/standings";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Standings" };

interface StandingRow {
  team: TeamRow;
  rec: TeamRecord;
  rating: number | null;
}

/**
 * Conference standings, derived from final games (conference_game flag), with
 * the model's rating alongside — the races the whole season is about, absent
 * from the site until now (audit §9). Sport-aware since R2-A1: `?sport=nfl`
 * renders division standings (teams.conference holds "AFC West"), no rating
 * column (ratings are CFB-only), ties counted half per NFL convention.
 */
export default async function StandingsPage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string }>;
}) {
  const { sport: sportParam } = await searchParams;
  const sport: Sport = isSport(sportParam) ? sportParam : "cfb";

  const supabase = await createClient();
  const { seasonId } = await fetchCurrentSeasonWeek(supabase, sport);

  const [teamsRes, finalsRes, ratingsRes] = await Promise.all([
    sport === "nfl"
      ? supabase.from("teams").select("*").eq("sport", "nfl")
      : supabase.from("teams").select("*").eq("classification", "fbs"),
    supabase
      .from("games")
      .select(
        "home_team_id, away_team_id, home_points, away_points, conference_game, season_type",
      )
      .eq("season_id", seasonId)
      .eq("status", "final"),
    // Ratings are CFB-only; for the NFL the read is skipped, not empty-tolerated.
    sport === "nfl"
      ? Promise.resolve(null)
      : supabase.from("latest_ratings").select("team_id, overall").eq("season_id", seasonId),
  ]);
  // Teams and finals are what this page IS — a standings table missing teams
  // or results is not a standings table with gaps, it is a lie. See db-result.ts.
  const teams = required<TeamRow>(teamsRes, "teams").filter((t) => t.conference !== null);
  const finals = required<FinalForStandings>(finalsRes, "final games");
  const rating = new Map(
    ratingsRes === null
      ? []
      : required<{ team_id: number; overall: number }>(ratingsRes, "ratings").map((r) => [
          r.team_id,
          Number(r.overall),
        ]),
  );

  const rec = foldRecords(finals, sport);

  const byConference = new Map<string, StandingRow[]>();
  for (const t of teams) {
    const r = rec.get(t.id) ?? { w: 0, l: 0, t: 0, confW: 0, confL: 0, confT: 0 };
    const arr = byConference.get(t.conference!) ?? [];
    arr.push({ team: t, rec: r, rating: rating.get(t.id) ?? null });
    byConference.set(t.conference!, arr);
  }
  for (const arr of byConference.values()) {
    arr.sort(
      (a, b) =>
        winPct(b.rec.confW, b.rec.confL, b.rec.confT) -
          winPct(a.rec.confW, a.rec.confL, a.rec.confT) ||
        b.rec.confW - a.rec.confW ||
        winPct(b.rec.w, b.rec.l, b.rec.t) - winPct(a.rec.w, a.rec.l, a.rec.t) ||
        (b.rating ?? -Infinity) - (a.rating ?? -Infinity),
    );
  }
  const conferences =
    sport === "nfl"
      ? NFL_DIVISION_ORDER.filter((d) => byConference.has(d))
      : [...byConference.keys()].sort();

  const tabClass = (active: boolean) =>
    `rounded-full px-3 py-1 text-sm ${
      active ? "bg-accent/15 text-accent" : "text-chalk/60 hover:text-chalk"
    }`;

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h1 className="text-2xl">Standings</h1>
          <nav aria-label="League" className="flex gap-1">
            <Link href="/standings" className={tabClass(sport === "cfb")}>
              College
            </Link>
            <Link href="/standings?sport=nfl" className={tabClass(sport === "nfl")}>
              NFL
            </Link>
          </nav>
        </div>
        <p className="mb-5 text-sm text-dim">
          {sport === "nfl"
            ? "Division races from final scores. Ties count half; preseason doesn’t count at all."
            : "Conference races from final scores; the rating column is the model’s number, so you can see who’s winning a league and who’s actually good."}
        </p>

        {conferences.length === 0 ? (
          <div className="card px-6 py-12 text-center">
            <p className="display text-lg text-chalk/80">No teams loaded yet</p>
            <p className="mt-1 text-sm text-dim">Standings fill in once reference data syncs.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {conferences.map((conf) => (
              <section key={conf} className="card overflow-hidden">
                <h2 className="border-b border-chalk/8 px-4 py-2.5 text-sm text-accent">{conf}</h2>
                <table className="stats w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-[10.5px] uppercase tracking-wider text-chalk/55">
                      <th className="py-1.5 pl-4 pr-2 font-semibold">Team</th>
                      <th className="px-2 py-1.5 text-right font-semibold">
                        {sport === "nfl" ? "Div" : "Conf"}
                      </th>
                      <th
                        className={`py-1.5 text-right font-semibold ${
                          sport === "nfl" ? "pl-2 pr-4" : "px-2"
                        }`}
                      >
                        Overall
                      </th>
                      {sport !== "nfl" && (
                        <th className="py-1.5 pl-2 pr-4 text-right font-semibold">Rating</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {byConference.get(conf)!.map((r) => (
                      <tr key={r.team.id} className="border-t border-chalk/5">
                        <td className="py-1.5 pl-4 pr-2">
                          {/* min-w-0: a flex child defaults to min-width:auto,
                              so the truncate below could not actually shrink
                              and the three right-hand columns got squeezed
                              instead at 375px. title gives the full name back
                              to anyone who loses it to the ellipsis (UX-28). */}
                          <Link
                            href={`/team/${r.team.id}`}
                            title={r.team.school}
                            className="flex min-w-0 items-center gap-2 font-sans text-chalk hover:text-accent"
                          >
                            {r.team.logo_url && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={r.team.logo_url}
                                alt=""
                                className="h-4 w-4 shrink-0"
                                loading="lazy"
                              />
                            )}
                            <span className="truncate">{r.team.school}</span>
                          </Link>
                        </td>
                        <td className="px-2 py-1.5 text-right text-chalk">
                          {formatRecord(r.rec.confW, r.rec.confL, r.rec.confT)}
                        </td>
                        <td
                          className={`py-1.5 text-right text-chalk/70 ${
                            sport === "nfl" ? "pl-2 pr-4" : "px-2"
                          }`}
                        >
                          {formatRecord(r.rec.w, r.rec.l, r.rec.t)}
                        </td>
                        {sport !== "nfl" && (
                          <td className="py-1.5 pl-2 pr-4 text-right text-chalk/70">
                            {r.rating === null
                              ? "–"
                              : `${r.rating > 0 ? "+" : ""}${r.rating.toFixed(1)}`}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
