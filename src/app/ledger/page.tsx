import { AppNav } from "../../components/AppNav";
import { BetForm, type BetFormGame } from "../../components/BetForm";
import { LiveStatusChip } from "../../components/slate/chips";
import { ShareButton } from "../../components/ShareButton";
import { VoidBetButton } from "../../components/VoidBetButton";
import { REASON_TAGS, REASON_TAG_LABELS, type BetRow, type TeamRow } from "../../lib/db-types";
import { kickParts, tzLabel, DEFAULT_TZ } from "../../lib/kick";
import { statusForBet, type LiveBetStatus } from "../../lib/live-status";
import { fetchBetFormGames, fetchCurrentSeasonWeek } from "../../lib/queries";
import { formatRecord, tally, tallyBy } from "../../lib/records";
import { fmtSpread, fmtTotal, lineForSide } from "../../lib/slate";
import { createClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Ledger" };

/**
 * Spread-style lines get their sign ("-3.5"/"PK"); totals render bare.
 * `line_taken` is stored home-perspective; the ledger shows the number the
 * bettor's ticket actually reads, so away sides convert through `lineForSide`.
 */
function fmtBetLine(b: BetRow): string {
  if (b.line_taken === null) return "–";
  const n = Number(b.line_taken);
  if (b.bet_type === "total" || b.bet_type === "team_total") return fmtTotal(n);
  return fmtSpread(b.side ? lineForSide(b.side, n) : n);
}

const abbrOf = (t: TeamRow | undefined): string =>
  t?.abbreviation ?? t?.school.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase() ?? "?";

export default async function LedgerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { seasonId, week } = await fetchCurrentSeasonWeek(supabase);

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
      label: `${awayAbbr} @ ${homeAbbr}${kick ? ` · ${kick.day} ${kick.time} ${tzLabel(DEFAULT_TZ)}` : ""}`,
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

  // Bets grade at their real American odds, so `payout_units` is passed through
  // rather than synthesized — the one place the shared tally does not apply the
  // flat -110 of pick'em. A null payout on a graded bet means the grader has not
  // reached it, and `records` derives one; that only bites for the manual
  // bet_types the grader never touches (moneyline, futures), which is a known
  // gap in jobs-core, not something to paper over here.
  const graded = bets
    .filter((b) => b.result && b.result !== "void")
    .map((b) => ({ ...b, payoutUnits: b.payout_units }));
  const overall = tally(graded);
  const { units, avgClv } = overall;

  // Reason-tag audit (spec §5.3): W-L, units, ROI, CLV by tag — most bettors
  // have one profitable angle and four leaks. The ledger's marquee feature.
  const byTag = tallyBy(graded, (b) => b.reason_tag);
  const tagRows = REASON_TAGS.filter((tag) => byTag.has(tag))
    .map((tag) => ({ tag, ...byTag.get(tag)! }))
    .sort((a, b) => b.units - a.units);

  // cumulative units, oldest → newest, for the season curve
  const curve = [...graded]
    .sort((a, b) => a.placed_at.localeCompare(b.placed_at))
    .reduce<number[]>((acc, b) => {
      acc.push((acc[acc.length - 1] ?? 0) + (b.payout_units ?? 0));
      return acc;
    }, []);

  // Share, sourced from bets rather than picks: same formatter, same four
  // modes, different ledger. Today's bets are the ones placed today — a bet
  // has a placed_at of its own, unlike a pick, which is tied to a kickoff.
  const dayKey = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TZ }).format(new Date(iso));
  const todayKey = dayKey(new Date().toISOString());
  const todayBets = bets.filter((b) => dayKey(b.placed_at) === todayKey);
  const gradedToday = todayBets
    .filter((b) => b.result && b.result !== "void")
    .map((b) => ({ ...b, payoutUnits: b.payout_units }));

  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl">Ledger</h1>
          {user && (
            <ShareButton
              context={{
                groupName: "Ledger",
                userName: "My bets",
                week,
                day: new Intl.DateTimeFormat("en-US", {
                  timeZone: DEFAULT_TZ,
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                }).format(new Date()),
                today: todayBets.map((b) => ({
                  key: String(b.id),
                  market: "spread" as const,
                  side: b.side ?? "home",
                  line: null,
                  homeAbbr: "",
                  awayAbbr: "",
                  // A bet's description is what the bettor typed; there is no
                  // honest way to rebuild a team and a number from it.
                  text: `${b.description}${b.units === 1 ? "" : ` (${b.units}u)`}`,
                })),
                dayRecord: tally(gradedToday),
                weekRecord: overall,
                lifetimeRecord: overall,
              }}
            />
          )}
        </div>

        {/* Season dashboard */}
        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Record"
            value={graded.length ? formatRecord(overall) : "–"}
          />
          <Stat
            label="Units"
            value={graded.length ? `${units >= 0 ? "+" : ""}${units.toFixed(1)}` : "–"}
            tone={units > 0 ? "gold" : units < 0 ? "flag" : undefined}
          />
          <Stat
            label="ROI"
            value={overall.roi === null ? "–" : `${(overall.roi * 100).toFixed(1)}%`}
          />
          <Stat
            label="Avg CLV"
            value={avgClv === null ? "–" : `${avgClv > 0 ? "+" : ""}${avgClv.toFixed(2)}`}
            tone={avgClv !== null && avgClv > 0 ? "gold" : undefined}
          />
        </section>

        {/* Season curve */}
        {curve.length >= 2 && (
          <section className="card mb-6 p-4">
            <h2 className="mb-2 text-sm text-accent">Season curve</h2>
            <UnitsCurve points={curve} />
            <p className="mt-1.5 text-[10.5px] text-dim">
              Cumulative units, bet by bet, oldest to newest.
            </p>
          </section>
        )}

        {/* Reason-tag audit (spec §5.3) */}
        {tagRows.length > 0 && (
          <section className="card mb-6 overflow-x-auto">
            <h2 className="border-b border-chalk/8 px-4 py-2.5 text-sm text-accent">
              Where your edge actually is
            </h2>
            <table className="stats w-full text-sm">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wider text-chalk/55">
                  <th className="py-2 pl-4 pr-3 font-semibold">Tag</th>
                  <th className="px-3 py-2 text-right font-semibold">Record</th>
                  <th className="px-3 py-2 text-right font-semibold">Units</th>
                  <th className="px-3 py-2 text-right font-semibold">ROI</th>
                  <th className="py-2 pl-3 pr-4 text-right font-semibold">CLV</th>
                </tr>
              </thead>
              <tbody>
                {tagRows.map((r) => (
                  <tr key={r.tag} className="border-t border-chalk/5">
                    <td className="py-2 pl-4 pr-3 font-sans text-chalk">
                      {REASON_TAG_LABELS[r.tag]}
                    </td>
                    <td className="px-3 py-2 text-right text-chalk/80">{formatRecord(r)}</td>
                    <td
                      className={`px-3 py-2 text-right ${r.units > 0 ? "text-win" : r.units < 0 ? "text-loss" : ""}`}
                    >
                      {r.units >= 0 ? "+" : ""}
                      {r.units.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right text-chalk/80">
                      {r.roi === null ? "–" : `${(r.roi * 100).toFixed(0)}%`}
                    </td>
                    <td
                      className={`py-2 pl-3 pr-4 text-right ${
                        r.avgClv === null
                          ? ""
                          : r.avgClv > 0
                            ? "text-win"
                            : r.avgClv < 0
                              ? "text-loss"
                              : ""
                      }`}
                    >
                      {r.avgClv === null
                        ? "–"
                        : `${r.avgClv > 0 ? "+" : ""}${r.avgClv.toFixed(2)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-4 py-2 text-[10.5px] text-dim">
              Positive CLV with a losing record is variance; negative CLV with a winning record
              is luck on a timer. Trust the CLV column.
            </p>
          </section>
        )}

        {/* Entry */}
        <section className="card mb-8 p-4">
          <h2 className="mb-3 text-sm text-accent">Log a bet</h2>
          <BetForm seasonId={seasonId} games={formGames} />
        </section>

        {/* History */}
        <section className="card overflow-x-auto">
          <table className="stats w-full text-sm">
            <thead>
              <tr className="border-b border-chalk/20 text-left text-xs uppercase text-chalk/55">
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
          The ledger is append-only — bets can be voided, never deleted. It is yours alone: group
          boards run on pick&rsquo;em picks, so you can pick a game here you would never bet, and
          bet one nobody put on the board.
        </p>
      </main>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "gold" | "flag" }) {
  return (
    <div className="card p-3">
      <p className="text-xs uppercase text-chalk/55">{label}</p>
      <p className={`stat mt-1 text-xl ${tone === "gold" ? "text-win" : tone === "flag" ? "text-loss" : ""}`}>
        {value}
      </p>
    </div>
  );
}

/** Cumulative-units line, server-rendered SVG — no chart lib, no client JS. */
function UnitsCurve({ points }: { points: number[] }) {
  const w = 320;
  const h = 64;
  const pad = 4;
  const all = [0, ...points];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (all.length - 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2);
  const d = all.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="h-16 w-full"
      role="img"
      aria-label={`Cumulative units over ${points.length} graded bets, currently ${last >= 0 ? "+" : ""}${last.toFixed(1)}`}
    >
      <line x1={pad} x2={w - pad} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeWidth="1" strokeDasharray="3 3" />
      <path
        d={d}
        fill="none"
        stroke={last >= 0 ? "var(--win)" : "var(--loss)"}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
