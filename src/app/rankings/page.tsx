import Link from "next/link";
import { AppNav } from "../../components/AppNav";
import type { PollRankingRow, TeamRow } from "../../lib/db-types";
import { fetchCurrentSeasonWeek } from "../../lib/queries";
import { pollDisplayName, pollShortName } from "../../lib/rankings";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Rankings" };

const POLL_ORDER = ["Playoff Committee Rankings", "AP Top 25", "Coaches Poll"];

/**
 * The human polls — synced daily since day one but never displayed (audit §9:
 * "not even a top-25 rankings page"). Movement vs last week, first-place
 * votes, and the model's dissent on every row.
 */
export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ poll?: string }>;
}) {
  const supabase = await createClient();
  const { seasonId } = await fetchCurrentSeasonWeek(supabase);
  const { poll: pollParam } = await searchParams;

  const [{ data: pollRows }, { data: ratingRows }] = await Promise.all([
    supabase
      .from("poll_rankings")
      .select("week, season_type, poll, team_id, rank, points, first_place_votes")
      .eq("season_id", seasonId),
    supabase
      .from("latest_ratings")
      .select("team_id, overall")
      .eq("season_id", seasonId),
  ]);
  const rows = (pollRows ?? []) as PollRankingRow[];

  const available = POLL_ORDER.filter((p) => rows.some((r) => r.poll === p));
  if (available.length === 0) {
    return (
      <Shell activePoll={null} available={[]}>
        <div className="card px-6 py-12 text-center">
          <p className="display text-lg text-chalk/80">No rankings yet</p>
          <p className="mt-1 text-sm text-dim">
            Polls land here once the daily sync runs — AP and Coaches from week 1, the CFP
            committee from late October.
          </p>
        </div>
      </Shell>
    );
  }

  const short = (p: string) => pollShortName(p) ?? p;
  const activePoll =
    available.find((p) => short(p).toLowerCase() === (pollParam ?? "").toLowerCase()) ??
    available[0];

  const pollRowsAll = rows.filter((r) => r.poll === activePoll);
  const latestWeek = Math.max(...pollRowsAll.map((r) => r.week));
  const current = pollRowsAll
    .filter((r) => r.week === latestWeek)
    .sort((a, b) => a.rank - b.rank);
  const prev = new Map(
    pollRowsAll.filter((r) => r.week === latestWeek - 1).map((r) => [r.team_id, r.rank]),
  );

  const teamIds = current.map((r) => r.team_id);
  const [{ data: teamRows }, { data: finals }] = await Promise.all([
    supabase.from("teams").select("*").in("id", teamIds),
    supabase
      .from("games")
      .select("home_team_id, away_team_id, home_points, away_points")
      .eq("season_id", seasonId)
      .eq("status", "final"),
  ]);
  const teams = new Map(((teamRows ?? []) as TeamRow[]).map((t) => [t.id, t]));

  const records = new Map<number, { w: number; l: number }>();
  for (const g of (finals ?? []) as Array<{
    home_team_id: number;
    away_team_id: number;
    home_points: number | null;
    away_points: number | null;
  }>) {
    if (g.home_points === null || g.away_points === null || g.home_points === g.away_points)
      continue;
    const winner = g.home_points > g.away_points ? g.home_team_id : g.away_team_id;
    const loser = winner === g.home_team_id ? g.away_team_id : g.home_team_id;
    records.set(winner, { w: (records.get(winner)?.w ?? 0) + 1, l: records.get(winner)?.l ?? 0 });
    records.set(loser, { w: records.get(loser)?.w ?? 0, l: (records.get(loser)?.l ?? 0) + 1 });
  }

  // model rank for the dissent column
  const modelRank = new Map<number, number>();
  [...((ratingRows ?? []) as Array<{ team_id: number; overall: number }>)]
    .sort((a, b) => Number(b.overall) - Number(a.overall))
    .forEach((r, i) => modelRank.set(r.team_id, i + 1));

  return (
    <Shell activePoll={activePoll} available={available} week={latestWeek}>
      <div className="card overflow-x-auto">
        <table className="stats w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-chalk/10 text-left text-[10.5px] uppercase tracking-wider text-chalk/55">
              <th className="py-2 pl-4 pr-2 font-semibold">#</th>
              <th className="px-2 py-2 font-semibold">Team</th>
              <th className="px-2 py-2 text-right font-semibold">Record</th>
              <th className="px-2 py-2 text-right font-semibold" title="Movement vs last week">
                Δ
              </th>
              <th className="px-2 py-2 text-right font-semibold">Points</th>
              <th className="py-2 pl-2 pr-4 text-right font-semibold" title="Where the model has them">
                Model
              </th>
            </tr>
          </thead>
          <tbody>
            {current.map((r) => {
              const t = teams.get(r.team_id);
              const was = prev.get(r.team_id);
              const move = was === undefined ? null : was - r.rank;
              const rec = records.get(r.team_id);
              const m = modelRank.get(r.team_id);
              return (
                <tr key={r.team_id} className="border-b border-chalk/5 last:border-0">
                  <td className="stat py-2 pl-4 pr-2 text-chalk/60">{r.rank}</td>
                  <td className="px-2 py-2">
                    <Link
                      href={`/team/${r.team_id}`}
                      className="flex items-center gap-2 font-sans text-chalk hover:text-accent"
                    >
                      {t?.logo_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={t.logo_url} alt="" className="h-5 w-5 shrink-0" loading="lazy" />
                      )}
                      <span className="truncate">{t?.school ?? `#${r.team_id}`}</span>
                      {r.first_place_votes !== null && r.first_place_votes > 0 && (
                        <span className="stat shrink-0 text-[10.5px] text-dim">
                          ({r.first_place_votes})
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-right text-chalk/80">
                    {rec ? `${rec.w}-${rec.l}` : "–"}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {move === null ? (
                      <span className="chip bg-accent/15 text-accent">NEW</span>
                    ) : move > 0 ? (
                      <span className="text-win">▲{move}</span>
                    ) : move < 0 ? (
                      <span className="text-loss">▼{-move}</span>
                    ) : (
                      <span className="text-chalk/40">·</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right text-chalk/60">{r.points ?? "–"}</td>
                  <td className="py-2 pl-2 pr-4 text-right">
                    {m === undefined ? (
                      <span className="text-chalk/40">–</span>
                    ) : (
                      <span
                        className={
                          m - r.rank >= 8
                            ? "text-loss"
                            : m - r.rank <= -8
                              ? "text-win"
                              : "text-chalk/80"
                        }
                        title={`Model has them #${m}`}
                      >
                        #{m}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-dim">
        Δ is movement vs last week&rsquo;s poll; parentheses are first-place votes. The Model
        column is this site&rsquo;s own rating rank — red when the poll is 8+ spots higher than
        the model, green when the model is higher. Polls are context only and never feed the
        model.
      </p>
    </Shell>
  );
}

/**
 * The page frame — and the answer to "whose rankings am I looking at?".
 *
 * All three polls are always listed, including the ones that have not
 * published yet: a tab row that grows from one chip to three over October is
 * a page that looks broken in September and different every month. The ones
 * with no data are shown inert, with the reason, which is also how a reader
 * learns the CFP committee doesn't rank anybody until late October.
 */
function Shell({
  children,
  activePoll,
  available,
  week,
}: {
  children: React.ReactNode;
  activePoll: string | null;
  available: string[];
  week?: number;
}) {
  const short = (p: string) => pollShortName(p) ?? p;
  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h1 className="text-2xl">
            {activePoll === null ? "Rankings" : pollDisplayName(activePoll)}
          </h1>
          <p className="stat text-xs text-dim">
            {activePoll === null ? "human polls" : `poll rankings${week === undefined ? "" : ` · week ${week}`}`}
          </p>
        </div>
        <div className="scroll-thin -mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {POLL_ORDER.map((p) => {
            const has = available.includes(p);
            const active = p === activePoll;
            const className = `stat inline-flex min-h-9 shrink-0 items-center rounded-full border px-3.5 text-xs font-medium transition-colors ${
              active
                ? "border-accent bg-accent/15 text-accent"
                : has
                  ? "border-chalk/20 text-dim hover:border-chalk/50 hover:text-chalk"
                  : "border-chalk/10 text-chalk/25"
            }`;
            return has ? (
              <Link
                key={p}
                href={`/rankings?poll=${short(p).toLowerCase()}`}
                aria-current={active ? "page" : undefined}
                className={className}
              >
                {pollDisplayName(p)}
              </Link>
            ) : (
              <span
                key={p}
                className={className}
                title={
                  p === "Playoff Committee Rankings"
                    ? "The committee's first rankings land in late October"
                    : "Not published yet this season"
                }
              >
                {pollDisplayName(p)}
                <span className="sr-only"> — not published yet</span>
              </span>
            );
          })}
        </div>
        {children}
      </main>
    </>
  );
}
