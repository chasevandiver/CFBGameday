import Link from "next/link";
import { notFound } from "next/navigation";
import { AppNav } from "../../../components/AppNav";
import { flipHeadline, flipWhen } from "../../../lib/cover";
import type {
  CoverFlipRow,
  GameRow,
  PickRow,
  PredictionRow,
  TeamRow,
} from "../../../lib/db-types";
import { fetchCurrentSeasonWeek, fetchProfiles } from "../../../lib/queries";
import { formatRecord, tallyBy } from "../../../lib/records";
import { fmtPct } from "../../../lib/slate";
import { createClient } from "../../../lib/supabase/server";
import { isValidWeek } from "../../../lib/week-range";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
  return { title: `Week ${week} recap` };
}

const abbrOf = (t: TeamRow | undefined): string =>
  t?.abbreviation ?? t?.school.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase() ?? "?";

/**
 * The Sunday page: model report card, biggest upsets, rating movers, and the
 * crew's CLV leaders for one week — the recap the weekly rhythm was missing.
 */
export default async function RecapPage({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  if (!isValidWeek(week)) notFound();

  const supabase = await createClient();
  const { seasonId } = await fetchCurrentSeasonWeek(supabase);

  const { data: gameRows } = await supabase
    .from("games")
    .select("*")
    .eq("season_id", seasonId)
    .eq("week", week)
    .eq("season_type", "regular");
  const games = ((gameRows ?? []) as GameRow[]).filter(
    (g) => g.status === "final" && g.home_points !== null && g.away_points !== null,
  );
  const gameIds = games.map((g) => g.id);
  const gameById = new Map(games.map((g) => [g.id, g]));

  const [predsRes, teamsRes, picksRes, ratingsRes, profiles, flipsRes] = await Promise.all([
    gameIds.length
      ? supabase
          .from("predictions")
          .select("*")
          .eq("frozen", true)
          .in("game_id", gameIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    gameIds.length
      ? supabase
          .from("teams")
          .select("id, school, abbreviation, logo_url")
          .in("id", [...new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]))])
      : Promise.resolve({ data: [] }),
    gameIds.length
      ? supabase.from("picks").select("*").in("game_id", gameIds).not("result", "is", null)
      : Promise.resolve({ data: [] }),
    supabase
      .from("ratings")
      .select("team_id, week, overall")
      .eq("season_id", seasonId)
      .in("week", [week, week + 1]),
    fetchProfiles(supabase),
    // Late swings caught live by the scoreboard poll (0026) — oldest first,
    // so the last one in a game is the one that stuck.
    gameIds.length
      ? supabase
          .from("cover_flips")
          .select("*")
          .in("game_id", gameIds)
          .order("detected_at", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  const teams = new Map(((teamsRes.data ?? []) as TeamRow[]).map((t) => [t.id, t]));
  const predByGame = new Map<number, PredictionRow>();
  for (const p of (predsRes.data ?? []) as PredictionRow[]) {
    if (!predByGame.has(p.game_id)) predByGame.set(p.game_id, p);
  }

  // ---- model report card (frozen rows only) ----
  let suW = 0;
  let suL = 0;
  let atsW = 0;
  let atsL = 0;
  let flaggedW = 0;
  let flaggedL = 0;
  for (const [gid, pred] of predByGame) {
    const g = gameById.get(gid);
    if (!g) continue;
    const margin = (g.home_points as number) - (g.away_points as number);
    if (margin !== 0) {
      const homeFav = Number(pred.home_win_prob) >= 0.5;
      if (homeFav === margin > 0) suW++;
      else suL++;
    }
    const edge = pred.edge === null ? null : Number(pred.edge);
    if (edge !== null && edge !== 0 && pred.vegas_spread !== null) {
      const lean = edge < 0 ? "home" : "away";
      const coverMargin = margin + Number(pred.vegas_spread);
      if (coverMargin !== 0) {
        const won = (coverMargin > 0) === (lean === "home");
        if (won) atsW++;
        else atsL++;
        if (pred.edge_flag) {
          if (won) flaggedW++;
          else flaggedL++;
        }
      }
    }
  }

  // ---- biggest upsets: winners the frozen model gave < 35% ----
  const upsets = games
    .map((g) => {
      const pred = predByGame.get(g.id);
      if (!pred) return null;
      const margin = (g.home_points as number) - (g.away_points as number);
      if (margin === 0) return null;
      const homeWon = margin > 0;
      const winProb = homeWon
        ? Number(pred.home_win_prob)
        : 1 - Number(pred.home_win_prob);
      if (winProb >= 0.35) return null;
      return { g, winProb, winnerId: homeWon ? g.home_team_id : g.away_team_id };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.winProb - b.winProb)
    .slice(0, 6);

  // ---- rating movers: week+1 vs week ----
  const ratings = (ratingsRes.data ?? []) as Array<{
    team_id: number;
    week: number;
    overall: number;
  }>;
  const before = new Map(
    ratings.filter((r) => r.week === week).map((r) => [r.team_id, Number(r.overall)]),
  );
  const movers = ratings
    .filter((r) => r.week === week + 1 && before.has(r.team_id))
    .map((r) => ({ teamId: r.team_id, delta: Number(r.overall) - (before.get(r.team_id) as number) }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 8);
  const moverTeamIds = movers.map((m) => m.teamId).filter((id) => !teams.has(id));
  if (moverTeamIds.length > 0) {
    const { data: extraTeams } = await supabase
      .from("teams")
      .select("id, school, abbreviation, logo_url")
      .in("id", moverTeamIds);
    for (const t of (extraTeams ?? []) as TeamRow[]) teams.set(t.id, t);
  }

  // ---- crew: CLV leaders + records for the week ----
  const picks = (picksRes.data ?? []) as PickRow[];
  const nameById = new Map(profiles.map((p) => [p.id, p.display_name]));
  const crew = [...tallyBy(picks, (p) => p.user_id).entries()]
    .filter(([, t]) => t.decided > 0)
    .map(([uid, t]) => ({ name: nameById.get(uid) ?? "?", ...t }))
    // The recap ranks the week by wins, not by the season leaderboard's units —
    // "who went 6-1" is the story of a Saturday. CLV breaks the tie.
    .sort((a, b) => b.wins - a.wins || (b.avgClv ?? -Infinity) - (a.avgClv ?? -Infinity));

  // ---- bad beats: late swings, decisive flip marked ----
  const flips = (flipsRes.data ?? []) as CoverFlipRow[];
  const flipsByGame = new Map<number, CoverFlipRow[]>();
  for (const f of flips) {
    if (!gameById.has(f.game_id)) continue;
    const arr = flipsByGame.get(f.game_id) ?? [];
    arr.push(f);
    flipsByGame.set(f.game_id, arr);
  }

  const noData = games.length === 0;

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl">Week {week} recap</h1>
          <div className="flex items-center gap-3 text-xs">
            {week > 1 && (
              <Link href={`/recap/${week - 1}`} className="text-dim hover:text-chalk">
                ← week {week - 1}
              </Link>
            )}
            <Link href={`/crew/week/${week}`} className="text-accent underline-offset-2 hover:underline">
              Pick grid
            </Link>
            <Link href="/receipts" className="text-dim hover:text-chalk">
              Receipts
            </Link>
          </div>
        </div>
        <p className="mb-5 text-sm text-dim">
          {games.length} finals · model graded on frozen numbers only.
        </p>

        {noData ? (
          <div className="card px-6 py-12 text-center">
            <p className="display text-lg text-chalk/80">Nothing final for week {week} yet</p>
            <p className="mt-1 text-sm text-dim">The recap writes itself as games go final.</p>
          </div>
        ) : (
          <>
            {/* Report card */}
            <section className="card mb-4 p-4">
              <h2 className="mb-3 text-sm text-accent">Model report card</h2>
              <div className="stat grid grid-cols-3 gap-2 text-center text-xs">
                <Card label="Favorites SU" value={suW + suL ? `${suW}–${suL}` : "–"} />
                <Card label="Leans ATS" value={atsW + atsL ? `${atsW}–${atsL}` : "–"} />
                <Card
                  label="Flagged edges"
                  value={flaggedW + flaggedL ? `${flaggedW}–${flaggedL}` : "–"}
                  sub={flaggedW + flaggedL ? "needs >52.4%" : "none graded"}
                />
              </div>
            </section>

            {/* Upsets */}
            {upsets.length > 0 && (
              <section className="card mb-4 p-4">
                <h2 className="mb-3 text-sm text-accent">Biggest upsets</h2>
                <ul className="flex flex-col gap-2">
                  {upsets.map(({ g, winProb, winnerId }) => (
                    <li key={g.id} className="stat flex items-center justify-between gap-2 text-sm">
                      <Link
                        href={`/game/${g.id}`}
                        className="min-w-0 truncate font-sans text-chalk underline-offset-2 hover:text-accent hover:underline"
                      >
                        {abbrOf(teams.get(winnerId))} beat{" "}
                        {abbrOf(
                          teams.get(
                            winnerId === g.home_team_id ? g.away_team_id : g.home_team_id,
                          ),
                        )}{" "}
                        {Math.max(g.home_points as number, g.away_points as number)}–
                        {Math.min(g.home_points as number, g.away_points as number)}
                      </Link>
                      <span className="shrink-0 text-dim">model had {fmtPct(winProb)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {flipsByGame.size > 0 && (
              <section className="card mb-4 p-4">
                <h2 className="mb-1 text-sm text-accent">Bad beats &amp; backdoors</h2>
                <p className="mb-3 text-xs text-chalk/60">
                  Cover swings from the 4th quarter on, caught live as they happened. The last
                  one in a game is the one that stuck.
                </p>
                <ul className="flex flex-col gap-3">
                  {[...flipsByGame.entries()].map(([gid, list]) => {
                    const g = gameById.get(gid) as GameRow;
                    const homeAbbr = abbrOf(teams.get(g.home_team_id));
                    const awayAbbr = abbrOf(teams.get(g.away_team_id));
                    return (
                      <li key={gid} className="flex flex-col gap-1">
                        <Link
                          href={`/game/${gid}`}
                          className="stat text-sm text-chalk underline-offset-2 hover:text-accent hover:underline"
                        >
                          {awayAbbr} {g.away_points}&ndash;{g.home_points} {homeAbbr}
                        </Link>
                        {list.map((f, i) => {
                          const decisive = i === list.length - 1;
                          return (
                            <div
                              key={f.id}
                              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pl-3 text-xs"
                            >
                              <span className={decisive ? "text-chalk" : "text-chalk/55"}>
                                {flipHeadline(f, homeAbbr, awayAbbr)}
                              </span>
                              <span className="stat text-dim">{flipWhen(f.period, f.clock)}</span>
                              {decisive && (
                                <span
                                  className={`chip ${f.winner_changed ? "bg-accent/12 text-accent" : "bg-loss/12 text-loss"}`}
                                >
                                  {f.winner_changed ? "wild finish" : "backdoor"}
                                </span>
                              )}
                              {f.last_play && (
                                <span className="w-full text-chalk/45">{f.last_play}</span>
                              )}
                            </div>
                          );
                        })}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* Movers */}
            {movers.length > 0 && (
              <section className="card mb-4 p-4">
                <h2 className="mb-3 text-sm text-accent">Rating movers</h2>
                <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {movers.map((m) => (
                    <li key={m.teamId} className="stat flex items-center justify-between text-sm">
                      <Link
                        href={`/team/${m.teamId}`}
                        className="min-w-0 truncate font-sans text-chalk hover:text-accent"
                      >
                        {teams.get(m.teamId)?.school ?? `#${m.teamId}`}
                      </Link>
                      <span className={m.delta > 0 ? "text-win" : "text-loss"}>
                        {m.delta > 0 ? "▲" : "▼"}
                        {Math.abs(m.delta).toFixed(1)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Crew */}
            {crew.length > 0 && (
              <section className="card mb-4 p-4">
                <h2 className="mb-3 text-sm text-accent">Crew week</h2>
                <ul className="flex flex-col gap-1.5">
                  {crew.map((c) => (
                    <li key={c.name} className="stat flex items-center justify-between text-sm">
                      <span className="font-sans text-chalk">{c.name}</span>
                      <span className="text-dim">
                        {formatRecord(c)}
                        {c.avgClv !== null && (
                          <span className={c.avgClv > 0 ? "text-win" : c.avgClv < 0 ? "text-loss" : ""}>
                            {" "}
                            {/* not fmtSpread: a 0.00 average is "0.00", never "PK" */}
                            · CLV {c.avgClv > 0 ? "+" : ""}
                            {(Math.round(c.avgClv * 100) / 100).toFixed(2)}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-elev px-2 py-2.5 ring-1 ring-inset ring-chalk/8">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-chalk/55">{label}</p>
      <p className="mt-0.5 text-base font-semibold text-chalk">{value}</p>
      {sub && <p className="text-[10px] text-dim">{sub}</p>}
    </div>
  );
}
