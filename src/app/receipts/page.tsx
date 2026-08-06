import Link from "next/link";
import { AppNav } from "../../components/AppNav";
import type { GameRow, PredictionRow, TeamRow } from "../../lib/db-types";
import { DEFAULT_TZ, kickDateLong, kickParts, tzLabel } from "../../lib/kick";
import { fetchCurrentSeasonWeek } from "../../lib/queries";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Receipts" };

interface Receipt {
  game: GameRow;
  pred: PredictionRow;
  home: TeamRow;
  away: TeamRow;
  /** Model's ATS lean vs the market line at freeze; null when no market line. */
  lean: "home" | "away" | null;
  /** win/loss/push once the game is final and a lean existed. */
  atsResult: "win" | "loss" | "push" | null;
  /** Straight-up: did the model's favorite win? Null until final. */
  suCorrect: boolean | null;
}

export default async function ReceiptsPage() {
  const supabase = await createClient();
  const { seasonId } = await fetchCurrentSeasonWeek(supabase);

  // Scoped to the current season (audit bug #7: this used to fetch every
  // frozen prediction ever and merge same-numbered weeks across seasons).
  const { data: predRows } = await supabase
    .from("predictions")
    .select("*")
    .eq("frozen", true)
    .eq("season_id", seasonId)
    .order("created_at", { ascending: false });
  const frozen = (predRows ?? []) as PredictionRow[];

  // Newest frozen row per game is the standing prediction; older rows from
  // prior model versions stay in the table as history but don't render.
  const newestByGame = new Map<number, PredictionRow>();
  for (const p of frozen) {
    if (!newestByGame.has(p.game_id)) newestByGame.set(p.game_id, p);
  }
  const gameIds = [...newestByGame.keys()];

  const { data: gameRows } = gameIds.length
    ? await supabase.from("games").select("*").in("id", gameIds)
    : { data: [] };
  const games = (gameRows ?? []) as GameRow[];
  const teamIds = [...new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const { data: teamRows } = teamIds.length
    ? await supabase.from("teams").select("*").in("id", teamIds)
    : { data: [] };
  const teams = new Map(((teamRows ?? []) as TeamRow[]).map((t) => [t.id, t]));

  const receipts: Receipt[] = [];
  for (const g of games) {
    const pred = newestByGame.get(g.id);
    const home = teams.get(g.home_team_id);
    const away = teams.get(g.away_team_id);
    if (!pred || !home || !away) continue;

    const edge = pred.edge === null ? null : Number(pred.edge);
    // edge = model spread − market spread (Vegas convention): negative means
    // the model likes home more than the market does.
    const lean = edge === null || edge === 0 ? null : edge < 0 ? "home" : "away";

    let atsResult: Receipt["atsResult"] = null;
    let suCorrect: Receipt["suCorrect"] = null;
    if (g.status === "final" && g.home_points !== null && g.away_points !== null) {
      const margin = g.home_points - g.away_points;
      suCorrect = Number(pred.home_win_prob) >= 0.5 ? margin > 0 : margin < 0;
      if (lean !== null && pred.vegas_spread !== null) {
        const coverMargin = margin + Number(pred.vegas_spread); // >0 = home covered
        atsResult =
          coverMargin === 0
            ? "push"
            : (coverMargin > 0) === (lean === "home")
              ? "win"
              : "loss";
      }
    }
    receipts.push({ game: g, pred, home, away, lean, atsResult, suCorrect });
  }

  // Group by week, kickoff order inside each
  const byWeek = new Map<number, Receipt[]>();
  for (const r of receipts) {
    const arr = byWeek.get(r.game.week) ?? [];
    arr.push(r);
    byWeek.set(r.game.week, arr);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);
  for (const w of weeks) {
    byWeek.get(w)!.sort((a, b) => (a.game.start_ts ?? "").localeCompare(b.game.start_ts ?? ""));
  }

  // Calibration over graded games (spec §2.5): SU favorites, ATS leans, flagged edges
  const graded = receipts.filter((r) => r.suCorrect !== null);
  const suWins = graded.filter((r) => r.suCorrect).length;
  const atsGraded = receipts.filter((r) => r.atsResult === "win" || r.atsResult === "loss");
  const atsWins = atsGraded.filter((r) => r.atsResult === "win").length;
  const flagged = atsGraded.filter((r) => r.pred.edge_flag !== null);
  const flaggedWins = flagged.filter((r) => r.atsResult === "win").length;

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        <h1 className="text-2xl">Receipts</h1>
        <p className="mb-5 mt-1 text-sm text-dim">
          Every prediction frozen Thursday night, timestamped, never edited. The model answers
          for its number here.
        </p>

        {graded.length > 0 && (
          <section className="card mb-5 p-4">
            <h2 className="mb-3 text-sm text-accent">Calibration</h2>
            <div className="stat grid grid-cols-1 gap-2 text-center text-xs sm:grid-cols-3">
              <CalStat
                label="Model favorites SU"
                value={`${suWins}–${graded.length - suWins}`}
                sub={`${Math.round((suWins / graded.length) * 100)}% straight up`}
              />
              <CalStat
                label="Model leans ATS"
                value={atsGraded.length ? `${atsWins}–${atsGraded.length - atsWins}` : "–"}
                sub={
                  atsGraded.length
                    ? `${Math.round((atsWins / atsGraded.length) * 100)}% vs close-at-freeze`
                    : "no graded leans yet"
                }
              />
              <CalStat
                label="Flagged edges ATS"
                value={flagged.length ? `${flaggedWins}–${flagged.length - flaggedWins}` : "–"}
                sub={flagged.length ? "needs >52.4% to matter" : "no graded flags yet"}
              />
            </div>
          </section>
        )}

        {weeks.length === 0 && (
          <p className="card p-6 text-sm text-dim">
            No frozen predictions yet — the first batch locks Thursday night before Week 1.
          </p>
        )}

        {weeks.map((w) => {
          const rows = byWeek.get(w)!;
          const stamp = rows[0]?.pred.created_at;
          return (
            <section key={w} className="card mb-4 overflow-hidden">
              <header className="flex items-baseline justify-between border-b border-chalk/8 px-4 py-2.5">
                <h2 className="text-sm text-accent">Week {w}</h2>
                {stamp && (
                  <span className="stat text-xs text-dim">
                    frozen {kickDateLong(stamp, DEFAULT_TZ)} {kickParts(stamp, DEFAULT_TZ).time}{" "}
                    {tzLabel(DEFAULT_TZ)} · {rows[0].pred.model_version}
                  </span>
                )}
              </header>
              <div className="overflow-x-auto">
                <table className="stats w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-[10.5px] uppercase tracking-wider text-chalk/40">
                      <th className="py-2 pl-4 pr-3 font-semibold">Game</th>
                      <th className="py-2 pr-3 text-right font-semibold">Model</th>
                      <th className="py-2 pr-3 text-right font-semibold">Market</th>
                      <th className="py-2 pr-3 text-right font-semibold">Edge</th>
                      <th className="py-2 pr-4 text-right font-semibold">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <ReceiptRow key={r.game.id} r={r} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </main>
    </>
  );
}

function fmtLine(n: number | null): string {
  if (n === null) return "–";
  if (n === 0) return "PK";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
}

function ReceiptRow({ r }: { r: Receipt }) {
  const { game: g, pred, home, away } = r;
  const edge = pred.edge === null ? null : Number(pred.edge);
  const final = g.status === "final" && g.home_points !== null && g.away_points !== null;
  return (
    <tr className="border-t border-chalk/5">
      <td className="py-2 pl-4 pr-3">
        <Link
          href={`/game/${g.id}`}
          className="font-sans text-chalk underline-offset-2 hover:text-accent hover:underline"
        >
          {away.abbreviation ?? away.school} @ {home.abbreviation ?? home.school}
        </Link>
      </td>
      <td className="py-2 pr-3 text-right text-chalk">
        {home.abbreviation ?? home.school} {fmtLine(Number(pred.spread))}
      </td>
      <td className="py-2 pr-3 text-right text-dim">
        {fmtLine(pred.vegas_spread === null ? null : Number(pred.vegas_spread))}
      </td>
      <td className="py-2 pr-3 text-right">
        {edge === null ? (
          <span className="text-dim">–</span>
        ) : (
          <span className={pred.edge_flag ? "font-semibold text-edge" : "text-chalk"}>
            {fmtLine(edge)}
            {pred.edge_flag === "BIG_EDGE" ? " ★" : pred.edge_flag === "EDGE" ? " ✦" : ""}
          </span>
        )}
      </td>
      <td className="py-2 pr-4 text-right">
        {final ? (
          <span className="text-chalk">
            {g.away_points}–{g.home_points}
            {r.atsResult && (
              <span
                className={`ml-2 text-xs font-semibold uppercase ${
                  r.atsResult === "win"
                    ? "text-win"
                    : r.atsResult === "loss"
                      ? "text-loss"
                      : "text-push"
                }`}
              >
                {r.atsResult}
              </span>
            )}
          </span>
        ) : (
          <span className="text-dim">
            {g.start_ts ? kickDateLong(g.start_ts, DEFAULT_TZ) : "TBD"}
          </span>
        )}
      </td>
    </tr>
  );
}

function CalStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg bg-elev px-2 py-2.5 ring-1 ring-inset ring-chalk/8">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-chalk/40">{label}</p>
      <p className="mt-0.5 text-base font-semibold text-chalk">{value}</p>
      <p className="text-[10px] text-dim">{sub}</p>
    </div>
  );
}
