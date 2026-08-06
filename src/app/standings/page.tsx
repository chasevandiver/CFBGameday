import Link from "next/link";
import { AppNav } from "../../components/AppNav";
import type { TeamRow } from "../../lib/db-types";
import { fetchCurrentSeasonWeek } from "../../lib/queries";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Standings" };

interface StandingRow {
  team: TeamRow;
  confW: number;
  confL: number;
  w: number;
  l: number;
  rating: number | null;
}

/**
 * Conference standings, derived from final games (conference_game flag), with
 * the model's rating alongside — the races the whole season is about, absent
 * from the site until now (audit §9).
 */
export default async function StandingsPage() {
  const supabase = await createClient();
  const { seasonId } = await fetchCurrentSeasonWeek(supabase);

  const [{ data: teamRows }, { data: finals }, { data: ratingRows }] = await Promise.all([
    supabase.from("teams").select("*").eq("classification", "fbs"),
    supabase
      .from("games")
      .select("home_team_id, away_team_id, home_points, away_points, conference_game")
      .eq("season_id", seasonId)
      .eq("status", "final"),
    supabase.from("latest_ratings").select("team_id, overall").eq("season_id", seasonId),
  ]);
  const teams = ((teamRows ?? []) as TeamRow[]).filter((t) => t.conference !== null);
  const rating = new Map(
    ((ratingRows ?? []) as Array<{ team_id: number; overall: number }>).map((r) => [
      r.team_id,
      Number(r.overall),
    ]),
  );

  const rec = new Map<number, { w: number; l: number; confW: number; confL: number }>();
  const bump = (id: number, field: "w" | "l" | "confW" | "confL") => {
    const r = rec.get(id) ?? { w: 0, l: 0, confW: 0, confL: 0 };
    r[field] += 1;
    rec.set(id, r);
  };
  for (const g of (finals ?? []) as Array<{
    home_team_id: number;
    away_team_id: number;
    home_points: number | null;
    away_points: number | null;
    conference_game: boolean;
  }>) {
    if (g.home_points === null || g.away_points === null || g.home_points === g.away_points)
      continue;
    const winner = g.home_points > g.away_points ? g.home_team_id : g.away_team_id;
    const loser = winner === g.home_team_id ? g.away_team_id : g.home_team_id;
    bump(winner, "w");
    bump(loser, "l");
    if (g.conference_game) {
      bump(winner, "confW");
      bump(loser, "confL");
    }
  }

  const byConference = new Map<string, StandingRow[]>();
  for (const t of teams) {
    const r = rec.get(t.id) ?? { w: 0, l: 0, confW: 0, confL: 0 };
    const arr = byConference.get(t.conference!) ?? [];
    arr.push({
      team: t,
      confW: r.confW,
      confL: r.confL,
      w: r.w,
      l: r.l,
      rating: rating.get(t.id) ?? null,
    });
    byConference.set(t.conference!, arr);
  }
  const pct = (w: number, l: number) => (w + l === 0 ? 0 : w / (w + l));
  for (const arr of byConference.values()) {
    arr.sort(
      (a, b) =>
        pct(b.confW, b.confL) - pct(a.confW, a.confL) ||
        b.confW - a.confW ||
        pct(b.w, b.l) - pct(a.w, a.l) ||
        (b.rating ?? -Infinity) - (a.rating ?? -Infinity),
    );
  }
  const conferences = [...byConference.keys()].sort();

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        <h1 className="mb-1 text-2xl">Standings</h1>
        <p className="mb-5 text-sm text-dim">
          Conference races from final scores; the rating column is the model&rsquo;s number, so
          you can see who&rsquo;s winning a league and who&rsquo;s actually good.
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
                      <th className="px-2 py-1.5 text-right font-semibold">Conf</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Overall</th>
                      <th className="py-1.5 pl-2 pr-4 text-right font-semibold">Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byConference.get(conf)!.map((r) => (
                      <tr key={r.team.id} className="border-t border-chalk/5">
                        <td className="py-1.5 pl-4 pr-2">
                          <Link
                            href={`/team/${r.team.id}`}
                            className="flex items-center gap-2 font-sans text-chalk hover:text-accent"
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
                          {r.confW}-{r.confL}
                        </td>
                        <td className="px-2 py-1.5 text-right text-chalk/70">
                          {r.w}-{r.l}
                        </td>
                        <td className="py-1.5 pl-2 pr-4 text-right text-chalk/70">
                          {r.rating === null
                            ? "–"
                            : `${r.rating > 0 ? "+" : ""}${r.rating.toFixed(1)}`}
                        </td>
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
