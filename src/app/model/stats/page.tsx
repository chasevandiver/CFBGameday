import Link from "next/link";
import { AppNav } from "../../../components/AppNav";
import type { GameRow, PredictionRow, TeamRow } from "../../../lib/db-types";
import { required } from "../../../lib/db-result";
import {
  calibration,
  closingTotal,
  DISAGREEMENT_CUTS,
  formatRecord3,
  gradeReceipt,
  MATCHUP_CUTS,
  MIN_BUCKET,
  MIN_ROW,
  SPLITS_AFTER,
  splitRows,
  tallyModel,
  TIMING_CUTS,
  TOTAL_CUTS,
  VERSION_CUT,
  WEEK_CUT,
  type GradedReceipt,
  type ModelCutSpec,
  type ModelReceipt,
  type ModelTally,
} from "../../../lib/model-stats";
import { pageAll } from "../../../lib/page-all";
import { fetchCurrentSeasonWeek } from "../../../lib/queries";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Model stats" };

/**
 * The model's season record, and the splits the season has earned (owner
 * request, 2026-09-04: "I want to see how it's doing on a bunch of different
 * buckets"; owner reaction to the first render the same night: "It looks
 * incredibly confusing").
 *
 * The second version is the simple one. One record leads — the leans against
 * the spread, which is the only record that says anything — with straight-up
 * and CLV beneath it and the rest of the numbers in a short list. Every table
 * is two figures wide (record, CLV), and a table appears only once one of its
 * buckets has MIN_BUCKET graded games; before that the section says so in one
 * line instead of printing 0% and 100% on n=1. Five splits show by default;
 * the rest sit behind a fold.
 *
 * This page renders; it does not calculate. `src/lib/model-stats.ts` grades
 * each frozen prediction the way Receipts does and owns every bucket boundary
 * and the sample-size rule. Whole-season read on purpose (09:P-13).
 */

type PredSlice = Pick<
  PredictionRow,
  | "game_id"
  | "season_id"
  | "model_version"
  | "spread"
  | "total"
  | "home_win_prob"
  | "vegas_spread"
  | "open_spread"
  | "close_spread"
  | "edge"
  | "edge_flag"
  | "consensus_flag"
  | "clv"
  | "created_at"
>;
type GameSlice = Pick<
  GameRow,
  | "id"
  | "week"
  | "season_type"
  | "start_ts"
  | "status"
  | "home_points"
  | "away_points"
  | "home_team_id"
  | "away_team_id"
  | "neutral_site"
> & { conference_game: boolean | null };
type TeamSlice = Pick<TeamRow, "id" | "school" | "conference" | "classification">;
interface ConsensusSlice {
  game_id: number;
  total: number | string | null;
  as_of: string | null;
}

/** PostgREST's `.in()` goes in the URL; 300 ids a call is the grader's chunk. */
async function inChunks<T>(ids: number[], fetch: (chunk: number[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 300) out.push(...(await fetch(ids.slice(i, i + 300))));
  return out;
}

const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

const fmtPct = (p: number | null, digits = 0): string =>
  p === null ? "–" : `${(p * 100).toFixed(digits)}%`;
const fmtSigned = (v: number | null, digits = 1): string =>
  v === null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
const clvClass = (v: number | null): string =>
  v === null ? "text-dim" : v > 0 ? "text-win" : v < 0 ? "text-loss" : "text-push";

export default async function ModelStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const supabase = await createClient();
  const { seasonId: currentSeason } = await fetchCurrentSeasonWeek(supabase);

  // Which seasons have receipts at all. Head-only counts, one per CFB season
  // row, so the switcher lists only seasons with something to show.
  const seasonRows = required<{ id: number }>(
    await supabase.from("seasons").select("id").eq("sport", "cfb").order("id", { ascending: false }),
    "seasons",
  );
  const counts = await Promise.all(
    seasonRows.map(async (s) => {
      const { count, error } = await supabase
        .from("predictions")
        .select("id", { count: "exact", head: true })
        .eq("frozen", true)
        .eq("season_id", s.id);
      if (error) throw new Error(`frozen prediction count for ${s.id}: ${error.message}`);
      return { id: s.id, n: count ?? 0 };
    }),
  );
  const withReceipts = counts.filter((c) => c.n > 0).map((c) => c.id);
  const requested = Number((await searchParams).season);
  const seasonId =
    Number.isInteger(requested) && withReceipts.includes(requested) ? requested : currentSeason;

  // Frozen rows, newest first, so the first row per game is the standing
  // prediction — same fold as Receipts.
  // Paged (FREEZE-3): a season is ~900 frozen rows against a 1,000-row ceiling.
  const frozen = await pageAll<PredSlice>((from, to) =>
    supabase
      .from("predictions")
      .select(
        "game_id, season_id, model_version, spread, total, home_win_prob, vegas_spread, open_spread, close_spread, edge, edge_flag, consensus_flag, clv, created_at",
      )
      .eq("frozen", true)
      .eq("season_id", seasonId)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to),
  ).catch((e: Error) => {
    throw new Error(`frozen predictions failed to load: ${e.message}`);
  });
  const newestByGame = new Map<number, PredSlice>();
  for (const p of frozen) if (!newestByGame.has(p.game_id)) newestByGame.set(p.game_id, p);
  const gameIds = [...newestByGame.keys()];

  const [games, consensus] = await Promise.all([
    inChunks(gameIds, async (chunk) =>
      required<GameSlice>(
        await supabase
          .from("games")
          .select(
            "id, week, season_type, start_ts, status, home_points, away_points, home_team_id, away_team_id, neutral_site, conference_game",
          )
          .in("id", chunk),
        "games",
      ),
    ),
    inChunks(gameIds, async (chunk) =>
      required<ConsensusSlice>(
        await supabase.from("line_consensus").select("game_id, total, as_of").in("game_id", chunk),
        "line consensus",
      ),
    ),
  ]);
  const consensusByGame = new Map(consensus.map((c) => [c.game_id, c]));

  const teamIds = [...new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const teams = new Map(
    (
      await inChunks(teamIds, async (chunk) =>
        required<TeamSlice>(
          await supabase.from("teams").select("id, school, conference, classification").in("id", chunk),
          "teams",
        ),
      )
    ).map((t) => [t.id, t]),
  );

  const graded: GradedReceipt[] = [];
  for (const g of games) {
    const p = newestByGame.get(g.id);
    const home = teams.get(g.home_team_id);
    const away = teams.get(g.away_team_id);
    if (!p || !home || !away) continue;
    const c = consensusByGame.get(g.id);
    const r: ModelReceipt = {
      gameId: g.id,
      seasonId,
      week: g.week,
      seasonType: g.season_type,
      modelVersion: p.model_version,
      startTs: g.start_ts,
      status: g.status,
      homePoints: g.home_points,
      awayPoints: g.away_points,
      neutralSite: g.neutral_site,
      conferenceGame: g.conference_game ?? false,
      home,
      away,
      spread: Number(p.spread),
      total: num(p.total),
      homeWinProb: Number(p.home_win_prob),
      vegasSpread: num(p.vegas_spread),
      openSpread: num(p.open_spread),
      closeSpread: num(p.close_spread),
      closeTotal: closingTotal(num(c?.total ?? null), c?.as_of ?? null, g.start_ts),
      edge: num(p.edge),
      edgeFlag: p.edge_flag,
      consensusFlag: p.consensus_flag,
      clv: num(p.clv),
    };
    graded.push(gradeReceipt(r));
  }

  const overall = tallyModel(graded);
  const flagged = tallyModel(graded.filter((r) => r.edgeFlag !== null));
  const versions = new Set(graded.map((r) => r.modelVersion));
  const frozenCount = graded.length;
  const seasons = withReceipts.length > 1 ? withReceipts : [];

  if (overall.n === 0) {
    return (
      <Shell seasonId={seasonId} seasons={seasons}>
        <div className="card px-6 py-12 text-center">
          <p className="display text-lg text-chalk/80">Nothing has graded yet</p>
          <p className="mt-1 text-sm text-dim">
            {frozenCount > 0
              ? `${frozenCount} frozen ${frozenCount === 1 ? "prediction" : "predictions"}. The record fills in as games go final.`
              : "The first receipts lock Thursday night before Week 1."}
          </p>
          <Link href="/receipts" className="mt-4 inline-block text-sm text-accent underline">
            The receipts
          </Link>
        </div>
      </Shell>
    );
  }

  // The record is the leans against the spread: every finished game with a
  // market line produces one. The games without a line (FCS buy games the
  // books never priced) are counted straight-up only, and said so.
  const lined = overall.ats.wins + overall.ats.losses + overall.ats.pushes;
  const unlined = overall.n - lined;
  const closeDecided = overall.atsClose.wins + overall.atsClose.losses;
  const ouDecided = overall.ou.wins + overall.ou.losses;

  const defaults: ModelCutSpec[] = [
    WEEK_CUT,
    DISAGREEMENT_CUTS[0], // edge size
    MATCHUP_CUTS[1], // favourite or dog
    MATCHUP_CUTS[2], // market spread
    MATCHUP_CUTS[3], // tier
  ];
  const more: ModelCutSpec[] = [
    ...DISAGREEMENT_CUTS.slice(1),
    MATCHUP_CUTS[0],
    ...MATCHUP_CUTS.slice(4),
    ...TIMING_CUTS,
    ...(versions.size > 1 ? [VERSION_CUT] : []),
  ];
  const shownDefaults = defaults.map((s) => [s, splitRows(graded, s)] as const).filter(([, r]) => r.show);
  const shownMore = more.map((s) => [s, splitRows(graded, s)] as const).filter(([, r]) => r.show);
  const shownTotals = TOTAL_CUTS.map((s) => [s, splitRows(graded, s)] as const).filter(([, r]) => r.show);
  const cal = calibration(graded).filter((b) => b.n >= MIN_ROW);
  const showCal = cal.some((b) => b.n >= MIN_BUCKET);

  return (
    <Shell seasonId={seasonId} seasons={seasons}>
      {/* The record. One number, the largest thing on the screen. */}
      <section className="card p-4">
        <p className="text-xs uppercase text-chalk/55">Record against the spread</p>
        <p className="stat mt-1 text-4xl text-chalk">{formatRecord3(overall.ats)}</p>
        <p className="stat mt-1 text-xs text-dim">
          {fmtPct(overall.atsPct, 1)} · {lined} {lined === 1 ? "game" : "games"} with a line
          {unlined > 0 && ` · ${unlined} without`}
        </p>
      </section>

      <section className="mt-3 grid grid-cols-2 gap-3">
        <div className="card p-3">
          <p className="text-xs uppercase text-chalk/55">Straight up</p>
          <p className="stat mt-1 text-xl">{`${overall.su.wins}-${overall.su.n - overall.su.wins}`}</p>
          <p className="stat text-[10.5px] leading-tight text-dim">
            {fmtPct(overall.suPct)} of favourites, all {overall.n} games
          </p>
        </div>
        <div className="card p-3">
          <p className="text-xs uppercase text-chalk/55">Closing line value</p>
          <p className={`stat mt-1 text-xl ${clvClass(overall.clv.avg)}`}>
            {overall.clv.avg === null ? "–" : `${fmtSigned(overall.clv.avg, 2)} pts`}
          </p>
          <p className="stat text-[10.5px] leading-tight text-dim">
            {overall.clv.n === 0
              ? "graded Sunday after kickoff"
              : `beat the close ${overall.clv.beat} of ${overall.clv.n}`}
          </p>
        </div>
      </section>

      <p className="mb-6 mt-3 text-[11px] leading-relaxed text-dim">
        Leans are information, not bets: they went 49.2% against the close in the 2023–25
        backtest, under the 52.4% a −110 bet needs.{" "}
        <Link href="/model" className="text-accent underline-offset-2 hover:underline">
          What was tried →
        </Link>
      </p>

      {shownDefaults.length === 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 text-sm text-accent">Splits</h2>
          <p className="card px-4 py-5 text-sm text-dim">
            Splits appear after about {SPLITS_AFTER} graded games, once a bucket has {MIN_BUCKET}{" "}
            in it. {overall.n} so far.
          </p>
        </section>
      ) : (
        <section className="mb-6">
          <h2 className="mb-2 text-sm text-accent">Splits</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {shownDefaults.map(([spec, r]) => (
              <CutTable key={spec.label} spec={spec} rows={r.rows} total={overall.n} />
            ))}
          </div>
        </section>
      )}

      {(shownMore.length > 0 || shownTotals.length > 0 || showCal) && (
        <details className="mb-6 group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm text-accent [&::-webkit-details-marker]:hidden">
            <span className="display">More splits</span>
            <span className="text-xs text-dim group-open:hidden">
              {shownMore.length + shownTotals.length + (showCal ? 1 : 0)} more
            </span>
            <span className="h-px flex-1 bg-chalk/10" aria-hidden />
          </summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {shownMore.map(([spec, r]) => (
              <CutTable key={spec.label} spec={spec} rows={r.rows} total={overall.n} />
            ))}
            {shownTotals.map(([spec, r]) => (
              <TotalTable key={`total-${spec.label}`} spec={spec} rows={r.rows} />
            ))}
            {showCal && <CalibrationTable rows={cal} />}
          </div>
        </details>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-sm text-accent">More numbers</h2>
        <dl className="card divide-y divide-chalk/10 px-4">
          <Row
            label="Vs the closing line"
            value={closeDecided > 0 ? formatRecord3(overall.atsClose) : "–"}
            note={
              closeDecided > 0
                ? `${fmtPct(overall.atsClose.wins / closeDecided, 1)} · break-even is 52.4%`
                : "graded Sunday"
            }
          />
          <Row
            label="Flagged edges"
            value={flagged.ats.wins + flagged.ats.losses + flagged.ats.pushes > 0 ? formatRecord3(flagged.ats) : "–"}
            note={
              flagged.ats.wins + flagged.ats.losses > 0
                ? `${fmtPct(flagged.atsPct, 1)} · went 49.2% in 2023–25`
                : "no graded flags yet"
            }
          />
          <Row
            label="Spread error"
            value={overall.mae === null ? "–" : `${overall.mae.toFixed(1)} pts`}
            note={`average miss · home teams ${overall.bias === null ? "–" : fmtSigned(overall.bias)} vs the number`}
          />
          <Row
            label="Totals"
            value={ouDecided + overall.ou.pushes > 0 ? formatRecord3(overall.ou) : "–"}
            note={
              ouDecided > 0
                ? `${fmtPct(overall.ouPct, 1)} vs the closing total`
                : overall.totalMae === null
                  ? "no totals priced yet"
                  : "no closing totals captured"
            }
          />
          <Row
            label="Graded"
            value={`${overall.n} of ${frozenCount}`}
            note={`frozen predictions · ${versions.size === 1 ? [...versions][0] : `${versions.size} model versions`}`}
          />
        </dl>
      </section>

      <p className="mb-8 text-[10.5px] leading-relaxed text-dim">
        Final games only. The record is the model&rsquo;s lean against the consensus it was
        priced against Thursday night, the same line Receipts grades; games the books never
        priced count straight-up only. Buckets under {MIN_ROW} games fold into
        &ldquo;Other.&rdquo;
      </p>
    </Shell>
  );
}

function Row({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5">
      <dt className="text-sm text-chalk/85">{label}</dt>
      <dd className="text-right">
        <span className="stat text-sm text-chalk">{value}</span>
        <span className="stat block text-[10.5px] leading-tight text-dim">{note}</span>
      </dd>
    </div>
  );
}

/** One breakdown: record and CLV per bucket, n on every row. */
function CutTable({
  spec,
  rows,
  total,
}: {
  spec: ModelCutSpec;
  rows: Array<[string, ModelTally]>;
  total: number;
}) {
  if (rows.length === 0) return null;
  const covered = rows.reduce((n, [, t]) => n + t.n, 0);
  return (
    <div className="card min-w-0 p-3">
      <h3 className="mb-1 text-xs uppercase text-chalk/55">{spec.label}</h3>
      <table className="stats w-full text-sm">
        <thead className="sr-only">
          <tr>
            <th>{spec.label}</th>
            <th>Record</th>
            <th>CLV</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, t]) => (
            <tr key={key} className="border-t border-chalk/10">
              <td className="py-2 pr-2 font-sans">
                {key}
                <span className="ml-1.5 text-[10px] text-dim">{t.n}</span>
              </td>
              <td className="whitespace-nowrap py-2 px-2 text-right">
                {formatRecord3(t.ats)}
                <span className="ml-1.5 text-[10px] text-dim">{fmtPct(t.atsPct)}</span>
              </td>
              <td className={`whitespace-nowrap py-2 pl-2 text-right ${clvClass(t.clv.avg)}`}>
                {fmtSigned(t.clv.avg)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(spec.note || covered < total) && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-dim">
          {spec.note}
          {spec.note && covered < total ? " " : ""}
          {covered < total && `${covered} of ${total} games; the rest have no line.`}
        </p>
      )}
    </div>
  );
}

/** The totals breakdown: over/under record and average miss per bucket. */
function TotalTable({ spec, rows }: { spec: ModelCutSpec; rows: Array<[string, ModelTally]> }) {
  if (rows.length === 0) return null;
  return (
    <div className="card min-w-0 p-3">
      <h3 className="mb-1 text-xs uppercase text-chalk/55">Totals · {spec.label.toLowerCase()}</h3>
      <table className="stats w-full text-sm">
        <thead className="sr-only">
          <tr>
            <th>{spec.label}</th>
            <th>Over/under record</th>
            <th>Average miss</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, t]) => (
            <tr key={key} className="border-t border-chalk/10">
              <td className="py-2 pr-2 font-sans">
                {key}
                <span className="ml-1.5 text-[10px] text-dim">{t.ou.wins + t.ou.losses + t.ou.pushes}</span>
              </td>
              <td className="whitespace-nowrap py-2 px-2 text-right">
                {formatRecord3(t.ou)}
                <span className="ml-1.5 text-[10px] text-dim">{fmtPct(t.ouPct)}</span>
              </td>
              <td className="whitespace-nowrap py-2 pl-2 text-right text-dim">
                {t.totalMae === null ? "–" : `${t.totalMae.toFixed(1)} pts`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** SPEC §2.5: do 70% favourites win about 70%? Predicted beside what happened. */
function CalibrationTable({
  rows,
}: {
  rows: Array<{ label: string; n: number; predicted: number; actual: number }>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="card min-w-0 p-3">
      <h3 className="mb-1 text-xs uppercase text-chalk/55">Win probability</h3>
      <table className="stats w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase text-chalk/55">
            <th className="pb-1 pr-2 font-normal">Favourite at</th>
            <th className="pb-1 px-2 text-right font-normal">Expected</th>
            <th className="pb-1 pl-2 text-right font-normal">Won</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-chalk/10">
              <td className="py-2 pr-2">
                {r.label}
                <span className="ml-1.5 text-[10px] text-dim">{r.n}</span>
              </td>
              <td className="py-2 px-2 text-right text-dim">{(r.predicted * 100).toFixed(0)}%</td>
              <td className="py-2 pl-2 text-right">{(r.actual * 100).toFixed(0)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5 text-[10px] leading-relaxed text-dim">
        Expected is the win probability the model gave its favourite; Won is how often it did.
      </p>
    </div>
  );
}

/**
 * The house shell: `AppNav` a sibling of `<main>`, main `w-full` — the two
 * details `/ledger/stats` learned the hard way (its Shell explains why).
 */
function Shell({
  seasonId,
  seasons,
  children,
}: {
  seasonId: number;
  seasons: number[];
  children: React.ReactNode;
}) {
  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h1 className="text-2xl">Model stats</h1>
          <span className="flex items-baseline gap-3">
            <Link
              href="/model"
              className="flex min-h-11 items-center text-sm text-accent underline-offset-2 hover:underline"
            >
              The model
            </Link>
            <Link
              href="/receipts"
              className="flex min-h-11 items-center text-sm text-accent underline-offset-2 hover:underline"
            >
              Receipts
            </Link>
          </span>
        </div>
        <p className="mb-4 text-sm text-dim">The {seasonId} season, graded off the frozen receipts.</p>
        {seasons.length > 0 && (
          <nav aria-label="Season" className="mb-5 flex flex-wrap gap-2">
            {seasons.map((s) => (
              <Link
                key={s}
                href={`/model/stats?season=${s}`}
                aria-current={s === seasonId ? "page" : undefined}
                className={`chip min-h-11 px-3 ${
                  s === seasonId ? "bg-accent/15 text-accent" : "bg-chalk/10 text-chalk/60"
                }`}
              >
                {s}
              </Link>
            ))}
          </nav>
        )}
        {children}
      </main>
    </>
  );
}
