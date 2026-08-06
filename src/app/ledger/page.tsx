import { AppNav } from "../../components/AppNav";
import { BetForm, type BetFormGame } from "../../components/BetForm";
import { LiveStatusChip } from "../../components/slate/chips";
import { VoidBetButton } from "../../components/VoidBetButton";
import { REASON_TAG_LABELS, type BetRow, type TeamRow } from "../../lib/db-types";
import { kickParts, DEFAULT_TZ } from "../../lib/kick";
import { statusForBet, type LiveBetStatus } from "../../lib/live-status";
import { fetchBetFormGames, fetchCurrentSeasonWeek } from "../../lib/queries";
import { fmtSpread, fmtTotal } from "../../lib/slate";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Ledger" };

/** Spread-style lines get their sign ("-3.5"/"PK"); totals render bare. */
function fmtBetLine(b: BetRow): string {
  if (b.line_taken === null) return "–";
  const n = Number(b.line_taken);
  if (b.bet_type === "total" || b.bet_type === "team_total") return fmtTotal(n);
  return fmtSpread(n);
}

const abbrOf = (t: TeamRow | undefined): string =>
  t?.abbreviation ?? t?.school.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase() ?? "?";

export default async function LedgerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { seasonId } = await fetchCurrentSeasonWeek(supabase);

  const [{ data }, { data: weekGames }] = await Promise.all([
    supabase
      .from("bets")
      .select("*")
      .eq("season_id", seasonId)
      .eq("user_id", user?.id ?? "")
      .order("placed_at", { ascending: false }),
    fetchBetFormGames(supabase, seasonId),
  ]);
  const bets = (data ?? []) as BetRow[];

  // this week's games for the bet form, so bets link to a game for grading
  const gameRows = (weekGames ?? []) as Array<{
    id: number;
    start_ts: string | null;
    home_team_id: number;
    away_team_id: number;
  }>;
  const formTeamIds = [...new Set(gameRows.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const { data: formTeams } =
    formTeamIds.length > 0
      ? await supabase.from("teams").select("*").in("id", formTeamIds)
      : { data: [] };
  const teamById = new Map(((formTeams ?? []) as TeamRow[]).map((t) => [t.id, t]));
  const formGames: BetFormGame[] = gameRows.map((g) => {
    const homeAbbr = abbrOf(teamById.get(g.home_team_id));
    const awayAbbr = abbrOf(teamById.get(g.away_team_id));
    const kick = g.start_ts ? kickParts(g.start_ts, DEFAULT_TZ) : null;
    return {
      id: g.id,
      label: `${awayAbbr} @ ${homeAbbr}${kick ? ` · ${kick.day} ${kick.time}` : ""}`,
      homeAbbr,
      awayAbbr,
    };
  });

  // live status for open bets tied to an in-progress game (snapshot at page load)
  const openGameIds = [
    ...new Set(
      bets
        .filter((b) => !b.result && !b.voided_at && b.game_id !== null)
        .map((b) => b.game_id as number),
    ),
  ];
  const { data: openGames } =
    openGameIds.length > 0
      ? await supabase
          .from("games")
          .select("id, status, home_points, away_points")
          .in("id", openGameIds)
      : { data: [] };
  const liveGameById = new Map(
    ((openGames ?? []) as Array<{
      id: number;
      status: string;
      home_points: number | null;
      away_points: number | null;
    }>)
      .filter((g) => g.status === "in_progress")
      .map((g) => [g.id, g]),
  );
  const liveStatusFor = (b: BetRow): LiveBetStatus | null => {
    if (b.result || b.voided_at || b.game_id === null) return null;
    const g = liveGameById.get(b.game_id);
    if (!g) return null;
    return statusForBet(
      {
        id: b.id,
        betType: b.bet_type,
        side: b.side,
        line: b.line_taken === null ? null : Number(b.line_taken),
      },
      g.home_points ?? 0,
      g.away_points ?? 0,
    );
  };

  const graded = bets.filter((b) => b.result && b.result !== "void");
  const wins = graded.filter((b) => b.result === "win").length;
  const losses = graded.filter((b) => b.result === "loss").length;
  const pushes = graded.filter((b) => b.result === "push").length;
  const units = graded.reduce((a, b) => a + (b.payout_units ?? 0), 0);
  const staked = graded
    .filter((b) => b.result !== "push")
    .reduce((a, b) => a + b.units, 0);
  const withClv = graded.filter((b) => b.clv !== null);
  const avgClv =
    withClv.length > 0 ? withClv.reduce((a, b) => a + (b.clv as number), 0) / withClv.length : null;

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <h1 className="mb-6 text-2xl">Ledger</h1>

        {/* Season dashboard */}
        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Record"
            value={
              graded.length
                ? `${wins}-${losses}${pushes > 0 ? `-${pushes}` : ""}`
                : "–"
            }
          />
          <Stat
            label="Units"
            value={graded.length ? `${units >= 0 ? "+" : ""}${units.toFixed(1)}` : "–"}
            tone={units > 0 ? "gold" : units < 0 ? "flag" : undefined}
          />
          <Stat
            label="ROI"
            value={staked > 0 ? `${((units / staked) * 100).toFixed(1)}%` : "–"}
          />
          <Stat
            label="Avg CLV"
            value={avgClv === null ? "–" : `${avgClv > 0 ? "+" : ""}${avgClv.toFixed(2)}`}
            tone={avgClv !== null && avgClv > 0 ? "gold" : undefined}
          />
        </section>

        {/* Entry */}
        <section className="mb-8 rounded border border-chalk/10 bg-surface p-4">
          <h2 className="mb-3 text-sm text-gold">Log a bet</h2>
          <BetForm seasonId={seasonId} games={formGames} />
        </section>

        {/* History */}
        <section className="overflow-x-auto rounded border border-chalk/10 bg-surface">
          <table className="stats w-full text-sm">
            <thead>
              <tr className="border-b border-chalk/20 text-left text-xs uppercase text-chalk/50">
                <th className="px-3 py-2">Bet</th>
                <th className="px-3 py-2">Tag</th>
                <th className="px-3 py-2 text-right">Line</th>
                <th className="px-3 py-2 text-right">Units</th>
                <th className="px-3 py-2 text-right">CLV</th>
                <th className="px-3 py-2 text-right">Result</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {bets.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-chalk/50">
                    No bets logged yet this season.
                  </td>
                </tr>
              )}
              {bets.map((b) => (
                <tr
                  key={b.id}
                  className={`border-b border-chalk/5 last:border-0 ${b.voided_at ? "opacity-40" : ""}`}
                >
                  <td className="max-w-[16rem] truncate px-3 py-2 font-sans">{b.description}</td>
                  <td className="px-3 py-2 text-xs text-chalk/60">
                    {REASON_TAG_LABELS[b.reason_tag as keyof typeof REASON_TAG_LABELS] ?? b.reason_tag}
                  </td>
                  <td className="px-3 py-2 text-right">{fmtBetLine(b)}</td>
                  <td className="px-3 py-2 text-right">{b.units}</td>
                  <td
                    className={`px-3 py-2 text-right ${
                      b.clv === null ? "" : b.clv > 0 ? "text-win" : b.clv < 0 ? "text-loss" : ""
                    }`}
                  >
                    {b.clv === null ? "–" : `${b.clv > 0 ? "+" : ""}${b.clv}`}
                  </td>
                  <td className="px-3 py-2 text-right uppercase">
                    {b.result ??
                      (() => {
                        const status = liveStatusFor(b);
                        return status ? (
                          <LiveStatusChip prefix="" status={status} />
                        ) : (
                          <span className="text-chalk/40">open</span>
                        );
                      })()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!b.voided_at && !b.result && <VoidBetButton betId={b.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <p className="mt-3 text-xs text-chalk/50">
          The ledger is append-only — bets can be voided, never deleted. Everyone&rsquo;s season
          numbers show on the Crew page.
        </p>
      </main>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "gold" | "flag" }) {
  return (
    <div className="rounded border border-chalk/10 bg-surface p-3">
      <p className="text-xs uppercase text-chalk/50">{label}</p>
      <p className={`stat mt-1 text-xl ${tone === "gold" ? "text-gold" : tone === "flag" ? "text-flag" : ""}`}>
        {value}
      </p>
    </div>
  );
}
