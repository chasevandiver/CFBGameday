import Link from "next/link";
import { AppNav } from "../../components/AppNav";
import { summarizeClv } from "../../lib/clv";
import type { GameRow, PredictionRow, TeamRow } from "../../lib/db-types";
import { DEFAULT_TZ, kickDateLong, kickParts, tzLabel } from "../../lib/kick";
import { required } from "../../lib/db-result";
import { fetchCurrentSeasonWeek } from "../../lib/queries";
import { fmtSpread } from "../../lib/slate";
import { createClient } from "../../lib/supabase/server";
import { isDeadStatus } from "../../lib/void";

/** Edge is a disagreement, not a line — it never reads "PK". */
const fmtEdge = (n: number | null): string =>
  n === null ? "–" : `${n > 0 ? "+" : ""}${n.toFixed(1)}`;

export const dynamic = "force-dynamic";

export const metadata = { title: "Receipts" };

/**
 * The slices this page reads (09:P-13). Derived with `Pick` from the real row
 * types rather than hand-declared, so a renamed or dropped column fails here
 * instead of arriving as undefined at render time.
 */
type ReceiptPred = Pick<
  PredictionRow,
  | "game_id"
  | "clv"
  | "created_at"
  | "edge"
  | "edge_flag"
  | "home_win_prob"
  | "model_version"
  | "spread"
  | "vegas_spread"
>;
type ReceiptGame = Pick<
  GameRow,
  | "id"
  | "week"
  | "start_ts"
  | "status"
  | "home_points"
  | "away_points"
  | "home_team_id"
  | "away_team_id"
>;
type ReceiptTeam = Pick<TeamRow, "id" | "school" | "abbreviation">;

interface Receipt {
  game: ReceiptGame;
  pred: ReceiptPred;
  home: ReceiptTeam;
  away: ReceiptTeam;
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
  // 09:P-13 (partial). Three `select("*")` reads over a whole season is the
  // bulk of this page's cost — ~840 predictions plus their games plus every
  // team by December. These are the columns the render and the calibration
  // block below actually consume, checked against the file rather than
  // guessed. Pagination itself is a separate question and an owner decision;
  // see 09:P-13 in docs/STATUS.md for why it is not obviously right.
  const predRes = await supabase
    .from("predictions")
    .select(
      "game_id, clv, created_at, edge, edge_flag, home_win_prob, model_version, spread, vegas_spread",
    )
    .eq("frozen", true)
    .eq("season_id", seasonId)
    .order("created_at", { ascending: false });
  // Receipts ARE the frozen predictions; a failed read rendering as "nothing
  // frozen yet" would misreport the one thing this page exists to prove
  // (db-result.ts).
  const frozen = required<ReceiptPred>(predRes, "frozen predictions");

  // Newest frozen row per game is the standing prediction; older rows from
  // prior model versions stay in the table as history but don't render.
  const newestByGame = new Map<number, ReceiptPred>();
  for (const p of frozen) {
    if (!newestByGame.has(p.game_id)) newestByGame.set(p.game_id, p);
  }
  const gameIds = [...newestByGame.keys()];

  const gamesRes = gameIds.length
    ? await supabase
        .from("games")
        .select(
          "id, week, start_ts, status, home_points, away_points, home_team_id, away_team_id",
        )
        .in("id", gameIds)
    : { data: [], error: null };
  const games = required<ReceiptGame>(gamesRes, "games");
  const teamIds = [...new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const teamsRes = teamIds.length
    // Two fields per team, not nine: this page prints a name and an
    // abbreviation and never draws a crest.
    ? await supabase.from("teams").select("id, school, abbreviation").in("id", teamIds)
    : { data: [], error: null };
  const teams = new Map(required<ReceiptTeam>(teamsRes, "teams").map((t) => [t.id, t]));

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

  // CLV over every graded lean, not just the flagged ones: flagging at |edge|≥2
  // throws away most of the sample, and CLV is measurable on any disagreement.
  // Graded by the Sunday job (scripts/lib/jobs-core.ts), null until then.
  const clv = summarizeClv(receipts.map((r) => (r.pred.clv === null ? null : Number(r.pred.clv))));

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl">Receipts</h1>
          <span className="flex items-baseline gap-3">
            <Link
              href="/model"
              className="text-xs font-medium text-accent underline-offset-2 hover:underline"
            >
              The model →
            </Link>
            <Link
              href="/recap"
              className="text-xs font-medium text-accent underline-offset-2 hover:underline"
            >
              Week in review →
            </Link>
          </span>
        </div>
        <p className="mb-5 mt-1 text-sm text-dim">
          Every prediction frozen Thursday night, timestamped, never edited. The model answers
          for its number here.
        </p>

        {graded.length > 0 && (
          <section className="card mb-5 p-4">
            <h2 className="mb-3 text-sm text-accent">Calibration</h2>
            <div className="stat grid grid-cols-1 gap-2 text-center text-xs sm:grid-cols-2 lg:grid-cols-4">
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
              <CalStat
                label="Closing line value"
                value={
                  clv.avg === null ? "–" : `${clv.avg > 0 ? "+" : ""}${clv.avg.toFixed(2)} pts`
                }
                sub={
                  clv.n === 0
                    ? "graded Sunday after kickoff"
                    : `beat the close ${clv.beat}/${clv.n}` +
                      (clv.flat > 0 ? ` · ${clv.flat} landed on it` : "")
                }
                tone={clv.avg === null ? undefined : clv.avg > 0 ? "win" : clv.avg < 0 ? "loss" : undefined}
              />
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-dim">
              CLV is the honest measure here. The leans are information, not bets — flagged edges
              went 49.2% against the close in the 2023–25 backtest, under the 52.4% that breaks
              even. What&rsquo;s worth knowing is whether the market moves toward the model after
              Thursday, and that answer arrives in one season where a win rate would take several.
              Positive means it did. A dash in the CLV column means no closing snapshot was
              captured near that kickoff — those games stay ungraded rather than being measured
              against a days-old line.
            </p>
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
                      <th className="py-2 pr-3 text-right font-semibold">CLV</th>
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


function ReceiptRow({ r }: { r: Receipt }) {
  const { game: g, pred, home, away } = r;
  const edge = pred.edge === null ? null : Number(pred.edge);
  const clv = pred.clv === null ? null : Number(pred.clv);
  const final = g.status === "final" && g.home_points !== null && g.away_points !== null;
  // A postponed or canceled game has no kickoff left to be graded after, so the
  // pending wording below was a promise that never comes due. The frozen row
  // itself is deliberately left open — see P1-1b in docs/STATUS.md; this only
  // stops the receipt describing it wrongly.
  const dead = isDeadStatus(g.status);
  const clvNote = final
    ? "no closing snapshot near kickoff"
    : dead
      ? "never played — no closing line"
      : "graded after kickoff";
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
        {home.abbreviation ?? home.school} {fmtSpread(Number(pred.spread))}
      </td>
      <td className="py-2 pr-3 text-right text-dim">
        {fmtSpread(pred.vegas_spread === null ? null : Number(pred.vegas_spread))}
      </td>
      <td className="py-2 pr-3 text-right">
        {edge === null ? (
          <span className="text-dim">–</span>
        ) : (
          <span className={pred.edge_flag ? "font-semibold text-edge" : "text-chalk"}>
            {fmtEdge(edge)}
            {pred.edge_flag === "BIG_EDGE" ? " ★" : pred.edge_flag === "EDGE" ? " ✦" : ""}
          </span>
        )}
      </td>
      <td className="py-2 pr-3 text-right">
        {clv === null ? (
          <span
            className="text-dim"
            title={clvNote}
          >
            –
          </span>
        ) : (
          <span className={clv > 0 ? "text-win" : clv < 0 ? "text-loss" : "text-push"}>
            {clv > 0 ? "+" : ""}
            {clv.toFixed(1)}
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

function CalStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  /** Colors the headline number. Left off, it stays neutral chalk. */
  tone?: "win" | "loss";
}) {
  return (
    <div className="rounded-lg bg-elev px-2 py-2.5 ring-1 ring-inset ring-chalk/8">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-chalk/40">{label}</p>
      <p
        className={`mt-0.5 text-base font-semibold ${
          tone === "win" ? "text-win" : tone === "loss" ? "text-loss" : "text-chalk"
        }`}
      >
        {value}
      </p>
      <p className="text-[10px] text-dim">{sub}</p>
    </div>
  );
}
