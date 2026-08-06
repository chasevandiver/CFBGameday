import Link from "next/link";
import { notFound } from "next/navigation";
import { AppNav } from "../../../../components/AppNav";
import type { GameRow, PickRow, TeamRow } from "../../../../lib/db-types";
import { DEFAULT_TZ, kickParts } from "../../../../lib/kick";
import { fetchCurrentSeasonWeek, fetchProfiles } from "../../../../lib/queries";
import { fmtSpread, fmtTotal } from "../../../../lib/slate";
import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
  return { title: `Week ${week} picks` };
}

const abbrOf = (t: TeamRow | undefined): string =>
  t?.abbreviation ?? t?.school.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase() ?? "?";

/**
 * The weekly pick grid — every game down the side, every crew member across
 * the top, who's riding what at a glance. The pick'em staple the site was
 * missing (audit §10).
 */
export default async function CrewWeekPage({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  if (!Number.isInteger(week) || week < 1 || week > 20) notFound();

  const supabase = await createClient();
  const { seasonId, week: currentWeek } = await fetchCurrentSeasonWeek(supabase);
  const profiles = await fetchProfiles(supabase);

  const { data: gameRows } = await supabase
    .from("games")
    .select("*")
    .eq("season_id", seasonId)
    .eq("week", week)
    .eq("season_type", "regular")
    .order("start_ts", { ascending: true });
  const games = (gameRows ?? []) as GameRow[];
  const gameIds = games.map((g) => g.id);

  const teamIds = [...new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const [{ data: teamRows }, picksRes] = await Promise.all([
    teamIds.length
      ? supabase.from("teams").select("id, school, abbreviation").in("id", teamIds)
      : Promise.resolve({ data: [] }),
    gameIds.length
      ? supabase.from("picks").select("*").in("game_id", gameIds)
      : Promise.resolve({ data: [] }),
  ]);
  const teams = new Map(((teamRows ?? []) as TeamRow[]).map((t) => [t.id, t]));
  const picks = (picksRes.data ?? []) as PickRow[];
  const pickBy = new Map<string, PickRow>();
  for (const p of picks) pickBy.set(`${p.user_id}:${p.game_id}`, p);

  // only games somebody picked keep the grid dense on 60-game weeks
  const pickedGameIds = new Set(picks.map((p) => p.game_id));
  const gridGames = games.filter((g) => pickedGameIds.has(g.id));

  // crew members who made at least one pick this week, keyed by activity
  const activeProfiles = profiles.filter((p) =>
    picks.some((x) => x.user_id === p.id),
  );

  const record = (userId: string) => {
    const mine = picks.filter((p) => p.user_id === userId);
    const w = mine.filter((p) => p.result === "win").length;
    const l = mine.filter((p) => p.result === "loss").length;
    const push = mine.filter((p) => p.result === "push").length;
    return { w, l, push, graded: w + l + push > 0 };
  };
  const records = new Map(activeProfiles.map((p) => [p.id, record(p.id)]));
  const bestWins = Math.max(0, ...[...records.values()].filter((r) => r.graded).map((r) => r.w));
  const winners = activeProfiles.filter((p) => {
    const r = records.get(p.id)!;
    return r.graded && r.w === bestWins && bestWins > 0;
  });

  const pickCell = (p: PickRow | undefined, g: GameRow) => {
    if (!p) return <span className="text-chalk/25">–</span>;
    const label =
      p.side === "home"
        ? `${abbrOf(teams.get(g.home_team_id))} ${fmtSpread(Number(p.line_at_pick))}`
        : p.side === "away"
          ? `${abbrOf(teams.get(g.away_team_id))} ${fmtSpread(Number(p.line_at_pick))}`
          : `${p.side === "over" ? "O" : "U"} ${fmtTotal(Number(p.line_at_pick))}`;
    const tone =
      p.result === "win"
        ? "text-win"
        : p.result === "loss"
          ? "text-loss"
          : p.result === "push"
            ? "text-push"
            : "text-chalk";
    return <span className={tone}>{label}</span>;
  };

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl">Week {week} picks</h1>
          <div className="flex items-center gap-2">
            <WeekLink week={week - 1} label="← prev" disabled={week <= 1} />
            <span className="stat text-xs text-dim">
              {week === currentWeek ? "current week" : ""}
            </span>
            <WeekLink week={week + 1} label="next →" disabled={week >= 16} />
          </div>
        </div>
        <p className="mb-5 text-sm text-dim">
          Everyone&rsquo;s card for the week — lines shown are each pick&rsquo;s own snapshot.{" "}
          <Link href="/crew" className="text-accent underline-offset-2 hover:underline">
            Season standings
          </Link>
        </p>

        {winners.length > 0 && (
          <p className="card mb-4 px-4 py-3 text-sm">
            <span className="text-accent">Week {week} lead:</span>{" "}
            <span className="font-medium text-chalk">
              {winners.map((w) => w.display_name).join(" & ")}
            </span>{" "}
            <span className="stat text-dim">
              ({bestWins}-{records.get(winners[0].id)!.l}
              {records.get(winners[0].id)!.push ? `-${records.get(winners[0].id)!.push}` : ""})
            </span>
          </p>
        )}

        {gridGames.length === 0 ? (
          <div className="card px-6 py-12 text-center">
            <p className="display text-lg text-chalk/80">No picks yet for week {week}</p>
            <p className="mt-1 text-sm text-dim">
              Picks land here as the crew makes them on the slate.
            </p>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="stats w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-chalk/10 text-left text-[10.5px] uppercase tracking-wider text-chalk/55">
                  <th className="py-2 pl-4 pr-3 font-semibold">Game</th>
                  {activeProfiles.map((p) => (
                    <th key={p.id} className="px-2 py-2 text-center font-semibold">
                      {p.display_name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gridGames.map((g) => (
                  <tr key={g.id} className="border-b border-chalk/5 last:border-0">
                    <td className="py-2 pl-4 pr-3">
                      <Link
                        href={`/game/${g.id}`}
                        className="font-sans text-chalk underline-offset-2 hover:text-accent hover:underline"
                      >
                        {abbrOf(teams.get(g.away_team_id))} @ {abbrOf(teams.get(g.home_team_id))}
                      </Link>
                      <span className="stat ml-2 text-[10.5px] text-dim">
                        {g.start_ts ? kickParts(g.start_ts, DEFAULT_TZ).day : "TBD"}
                      </span>
                    </td>
                    {activeProfiles.map((p) => (
                      <td key={p.id} className="px-2 py-2 text-center">
                        {pickCell(pickBy.get(`${p.id}:${g.id}`), g)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t border-chalk/15 text-xs">
                  <td className="py-2 pl-4 pr-3 font-semibold uppercase tracking-wider text-chalk/55">
                    Week
                  </td>
                  {activeProfiles.map((p) => {
                    const r = records.get(p.id)!;
                    return (
                      <td key={p.id} className="px-2 py-2 text-center font-semibold text-chalk">
                        {r.graded ? `${r.w}-${r.l}${r.push ? `-${r.push}` : ""}` : "–"}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}

function WeekLink({ week, label, disabled }: { week: number; label: string; disabled: boolean }) {
  if (disabled) return <span className="text-xs text-chalk/25">{label}</span>;
  return (
    <Link
      href={`/crew/week/${week}`}
      className="text-xs font-medium text-dim transition-colors hover:text-chalk"
    >
      {label}
    </Link>
  );
}
