import Link from "next/link";
import { AppNav } from "../../../components/AppNav";
import { StatTile } from "../../../components/StatTile";
import type { GameRow, PredictionRow, TeamRow } from "../../../lib/db-types";
import { required } from "../../../lib/db-result";
import {
  calibration,
  closingTotal,
  DISAGREEMENT_CUTS,
  formatRecord3,
  gradeReceipt,
  MATCHUP_CUTS,
  rowsFor,
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
import { fetchCurrentSeasonWeek } from "../../../lib/queries";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Model stats" };

/**
 * The model's season record, and every split of it (owner request,
 * 2026-09-04: "I want to see how it's doing on a bunch of different buckets").
 *
 * This page renders; it does not calculate. `src/lib/model-stats.ts` grades
 * each frozen prediction the way Receipts does and owns every bucket
 * boundary; each table here is `rowsFor(graded, spec)`. Same division as
 * `/ledger/stats` and `bet-cuts.ts`, for the same reason: a second private
 * tally is a second place for "the model was 8-3" to mean something else.
 *
 * Reads the same rows Receipts reads — frozen predictions for the season,
 * newest per game — plus the game and team context the cuts need and one
 * `line_consensus` row per game for the closing total, which Receipts never
 * grades. Whole-season on purpose: these are season numbers, and a paginated
 * read would silently turn them into this page's numbers (09:P-13).
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
const fmtSigned = (v: number | null, digits = 2): string =>
  v === null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
const toneOf = (v: number | null): "gold" | "flag" | undefined =>
  v === null || v === 0 ? undefined : v > 0 ? "gold" : "flag";

export default async function ModelStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const supabase = await createClient();
  const { seasonId: currentSeason } = await fetchCurrentSeasonWeek(supabase);

  // Which seasons have receipts at all. Head-only counts, one per CFB season
  // row, so the switcher lists only seasons with something to show and the
  // page stays silent about the three archive seasons that never froze one.
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
  const frozen = required<PredSlice>(
    await supabase
      .from("predictions")
      .select(
        "game_id, season_id, model_version, spread, total, home_win_prob, vegas_spread, open_spread, close_spread, edge, edge_flag, consensus_flag, clv, created_at",
      )
      .eq("frozen", true)
      .eq("season_id", seasonId)
      .order("created_at", { ascending: false }),
    "frozen predictions",
  );
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
  const cal = calibration(graded);
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

  return (
    <Shell seasonId={seasonId} seasons={seasons}>
      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Straight up"
          value={`${overall.su.wins}-${overall.su.n - overall.su.wins}`}
          sub={`${fmtPct(overall.suPct)} · model favourites`}
        />
        <StatTile
          label="Leans ATS"
          value={formatRecord3(overall.ats)}
          sub={`${fmtPct(overall.atsPct, 1)} vs the freeze line`}
        />
        <StatTile
          label="Vs the close"
          value={formatRecord3(overall.atsClose)}
          sub={
            overall.atsClose.wins + overall.atsClose.losses > 0
              ? `${fmtPct(
                  overall.atsClose.wins / (overall.atsClose.wins + overall.atsClose.losses),
                  1,
                )} · needs 52.4%`
              : "graded Sunday"
          }
        />
        <StatTile
          label="Flagged edges"
          value={formatRecord3(flagged.ats)}
          sub={
            flagged.ats.wins + flagged.ats.losses > 0
              ? `${fmtPct(flagged.atsPct, 1)} · 2023–25 went 49.2%`
              : "no graded flags yet"
          }
        />
        <StatTile
          label="Closing line value"
          value={overall.clv.avg === null ? "–" : `${fmtSigned(overall.clv.avg)} pts`}
          tone={toneOf(overall.clv.avg)}
          sub={
            overall.clv.n === 0
              ? "graded Sunday after kickoff"
              : `beat the close ${overall.clv.beat}/${overall.clv.n}`
          }
        />
        <StatTile
          label="Spread error"
          value={overall.mae === null ? "–" : overall.mae.toFixed(1)}
          sub={`MAE · bias ${fmtSigned(overall.bias, 1)} home`}
        />
        <StatTile
          label="Totals"
          value={overall.ou.wins + overall.ou.losses + overall.ou.pushes > 0 ? formatRecord3(overall.ou) : "–"}
          sub={
            overall.ou.wins + overall.ou.losses > 0
              ? `${fmtPct(overall.ouPct, 1)} vs the closing total`
              : overall.totalMae === null
                ? "no totals priced yet"
                : "no closing totals captured"
          }
        />
        <StatTile
          label="Graded"
          value={String(overall.n)}
          sub={`of ${frozenCount} frozen · ${versions.size === 1 ? [...versions][0] : `${versions.size} versions`}`}
        />
      </section>

      <p className="mb-6 text-[11px] leading-relaxed text-dim">
        Leans are information, not bets: the model&rsquo;s disagreements with the market went 49.2%
        against the close in the 2023–25 backtest, under the 52.4% a −110 bet needs. Every table
        below is descriptive. Win rates carry their standard error, and a bucket that clears
        break-even on a few dozen games is what noise looks like — the backtest&rsquo;s 6–10 band did
        exactly that and it was nothing.{" "}
        <Link href="/model" className="text-accent underline-offset-2 hover:underline">
          What was tried →
        </Link>
      </p>

      <Group title="Week by week" single>
        <CutTable spec={WEEK_CUT} rows={rowsFor(graded, WEEK_CUT)} total={overall.n} />
      </Group>

      <Group title="The disagreement">
        {DISAGREEMENT_CUTS.map((spec) => (
          <CutTable key={spec.label} spec={spec} rows={rowsFor(graded, spec)} total={overall.n} />
        ))}
      </Group>

      <Group title="The matchup">
        {MATCHUP_CUTS.map((spec) => (
          <CutTable key={spec.label} spec={spec} rows={rowsFor(graded, spec)} total={overall.n} />
        ))}
      </Group>

      <Group title="When it kicks">
        {TIMING_CUTS.map((spec) => (
          <CutTable key={spec.label} spec={spec} rows={rowsFor(graded, spec)} total={overall.n} />
        ))}
      </Group>

      <Group title="Totals">
        {TOTAL_CUTS.map((spec) => (
          <TotalTable key={spec.label} spec={spec} rows={rowsFor(graded, spec)} />
        ))}
        {TOTAL_CUTS.every((spec) => rowsFor(graded, spec).length === 0) && (
          <p className="text-xs leading-relaxed text-dim sm:col-span-2">
            No totals graded yet. The freeze prices a total only once the offense/defense split
            carries information — not in the preseason weeks — and grades it against the consensus
            captured at kickoff.
          </p>
        )}
      </Group>

      <Group title="Calibration" single>
        <CalibrationTable rows={cal} />
      </Group>

      {versions.size > 1 && (
        <Group title="By model version" single>
          <CutTable spec={VERSION_CUT} rows={rowsFor(graded, VERSION_CUT)} total={overall.n} />
        </Group>
      )}

      <p className="mb-8 mt-6 text-[10.5px] leading-relaxed text-dim">
        Final games only; a postponed or cancelled game grades nothing. ATS is the model&rsquo;s
        lean against the consensus it was priced against Thursday night — the same line Receipts
        grades — and a game where the model sat on the number has no lean. Totals grade against
        the consensus total captured within six hours of kickoff, the grader&rsquo;s rule; the
        model&rsquo;s own total is only stored once the season has enough results to price one. MAE
        is the model spread against the actual margin, in points. Rows a cut can&rsquo;t answer are
        left out, so a table that skips some games will not add to {overall.n}.
      </p>
    </Shell>
  );
}

function Group({
  title,
  children,
  single = false,
}: {
  title: string;
  children: React.ReactNode;
  single?: boolean;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm text-accent">{title}</h2>
      <div className={single ? "grid gap-3" : "grid gap-3 sm:grid-cols-2"}>{children}</div>
    </section>
  );
}

/** Dim a row too small to read anything into. */
const THIN = 10;

const pctClass = (t: ModelTally): string => {
  if (t.atsPct === null) return "text-dim";
  if (t.ats.wins + t.ats.losses < THIN) return "text-chalk";
  return t.atsPct > 0.524 ? "text-win" : t.atsPct < 0.476 ? "text-loss" : "text-chalk";
};

/**
 * One breakdown: ATS record, win rate with its standard error, CLV and MAE
 * per bucket, with n so a 3-0 cannot be mistaken for a season.
 */
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
    <div className="card min-w-0 overflow-x-auto p-3">
      <h3 className="mb-2 text-xs uppercase text-chalk/55">{spec.label}</h3>
      <table className="stats w-full text-sm">
        <thead>
          <tr className="border-b border-chalk/20 text-left text-[10px] uppercase text-chalk/55">
            <th className="py-1 pr-2 font-normal">{spec.label}</th>
            <th className="py-1 px-2 text-right font-normal">ATS</th>
            <th className="py-1 px-2 text-right font-normal">Win%</th>
            <th className="py-1 px-2 text-right font-normal">CLV</th>
            <th className="py-1 pl-2 text-right font-normal">MAE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, t]) => (
            <tr
              key={key}
              className={`border-b border-chalk/10 last:border-0 ${t.n < THIN ? "text-chalk/60" : ""}`}
            >
              <td className="py-1.5 pr-2 font-sans">
                {key}
                <span className="ml-1.5 text-[10px] text-dim">n={t.n}</span>
              </td>
              <td className="py-1.5 px-2 text-right">{formatRecord3(t.ats)}</td>
              <td className={`py-1.5 px-2 text-right ${pctClass(t)}`}>
                {fmtPct(t.atsPct)}
                {t.atsSe !== null && (
                  <span className="text-[10px] text-dim"> ±{(t.atsSe * 100).toFixed(0)}</span>
                )}
              </td>
              <td
                className={`py-1.5 px-2 text-right ${
                  t.clv.avg === null
                    ? "text-dim"
                    : t.clv.avg > 0
                      ? "text-win"
                      : t.clv.avg < 0
                        ? "text-loss"
                        : "text-push"
                }`}
              >
                {fmtSigned(t.clv.avg, 1)}
              </td>
              <td className="py-1.5 pl-2 text-right text-dim">
                {t.mae === null ? "–" : t.mae.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(spec.note || covered < total) && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-dim">
          {spec.note}
          {spec.note && covered < total ? " " : ""}
          {covered < total && `${covered} of ${total} graded games; the rest have no ${spec.label.toLowerCase()}.`}
        </p>
      )}
    </div>
  );
}

/** The totals breakdown: O/U record and total MAE per bucket. */
function TotalTable({ spec, rows }: { spec: ModelCutSpec; rows: Array<[string, ModelTally]> }) {
  if (rows.length === 0) return null;
  return (
    <div className="card min-w-0 overflow-x-auto p-3">
      <h3 className="mb-2 text-xs uppercase text-chalk/55">{spec.label}</h3>
      <table className="stats w-full text-sm">
        <thead>
          <tr className="border-b border-chalk/20 text-left text-[10px] uppercase text-chalk/55">
            <th className="py-1 pr-2 font-normal">{spec.label}</th>
            <th className="py-1 px-2 text-right font-normal">O/U</th>
            <th className="py-1 px-2 text-right font-normal">Win%</th>
            <th className="py-1 pl-2 text-right font-normal">MAE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, t]) => {
            const decided = t.ou.wins + t.ou.losses;
            return (
              <tr
                key={key}
                className={`border-b border-chalk/10 last:border-0 ${decided < THIN ? "text-chalk/60" : ""}`}
              >
                <td className="py-1.5 pr-2 font-sans">
                  {key}
                  <span className="ml-1.5 text-[10px] text-dim">n={t.ou.wins + t.ou.losses + t.ou.pushes}</span>
                </td>
                <td className="py-1.5 px-2 text-right">{formatRecord3(t.ou)}</td>
                <td className="py-1.5 px-2 text-right">
                  {fmtPct(t.ouPct)}
                  {decided > 0 && (
                    <span className="text-[10px] text-dim"> ±{(Math.sqrt(0.25 / decided) * 100).toFixed(0)}</span>
                  )}
                </td>
                <td className="py-1.5 pl-2 text-right text-dim">
                  {t.totalMae === null ? "–" : t.totalMae.toFixed(1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** SPEC §2.5: do 70% favourites win about 70%? */
function CalibrationTable({
  rows,
}: {
  rows: Array<{ label: string; n: number; predicted: number; actual: number }>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="card min-w-0 overflow-x-auto p-3">
      <h3 className="mb-2 text-xs uppercase text-chalk/55">Win probability</h3>
      <table className="stats w-full text-sm">
        <thead>
          <tr className="border-b border-chalk/20 text-left text-[10px] uppercase text-chalk/55">
            <th className="py-1 pr-2 font-normal">Favourite at</th>
            <th className="py-1 px-2 text-right font-normal">n</th>
            <th className="py-1 px-2 text-right font-normal">Predicted</th>
            <th className="py-1 px-2 text-right font-normal">Won</th>
            <th className="py-1 pl-2 text-right font-normal">Gap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const gap = (r.actual - r.predicted) * 100;
            return (
              <tr
                key={r.label}
                className={`border-b border-chalk/10 last:border-0 ${r.n < THIN ? "text-chalk/60" : ""}`}
              >
                <td className="py-1.5 pr-2">{r.label}</td>
                <td className="py-1.5 px-2 text-right text-dim">{r.n}</td>
                <td className="py-1.5 px-2 text-right">{(r.predicted * 100).toFixed(0)}%</td>
                <td className="py-1.5 px-2 text-right">{(r.actual * 100).toFixed(0)}%</td>
                <td
                  className={`py-1.5 pl-2 text-right ${
                    r.n < THIN ? "text-dim" : Math.abs(gap) <= 3 ? "text-win" : Math.abs(gap) <= 6 ? "text-chalk" : "text-loss"
                  }`}
                >
                  {fmtSigned(gap, 0)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1.5 text-[10px] leading-relaxed text-dim">
        Predicted is the mean win probability the model gave its favourite in the band; Won is
        how often it did. The backtest&rsquo;s bar is every band within 3 points.
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
        <p className="mb-4 text-sm text-dim">
          The {seasonId} record, graded off the frozen receipts, and every split of it.
        </p>
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
