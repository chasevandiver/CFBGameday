import Link from "next/link";
import { AppNav } from "../../../components/AppNav";
import { StatTile } from "../../../components/StatTile";
import { type BetRow, type TeamRow, CONFIDENCE_TIER_LABELS } from "../../../lib/db-types";
import {
  MARKET_CUTS,
  TIMING_CUTS,
  EMPTY_STREAKS,
  leagueOf,
  streaks,
  teamsOf,
  type CutSpec,
  type StatsBet,
} from "../../../lib/bet-cuts";
import { seasonIdsForYear, seasonYearOf } from "../../../lib/league";
import { fetchCurrentSeasonWeek } from "../../../lib/queries";
import { byLeagueRules, formatRecord, tally, tallyBy, type Tally } from "../../../lib/records";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Bet stats" };

/**
 * The breakdowns behind the ledger's Record tile (owner request, 2026-08-14:
 * "click on your betting record and it'd show a whole bunch of stats").
 *
 * This page renders; it does not calculate. Every table is
 * `tallyBy(bets, cut)` — the cuts come from `src/lib/bet-cuts.ts` and the
 * arithmetic from `src/lib/records.ts`, which is the module that exists so
 * six surfaces stop disagreeing about what a record is. Adding a seventh
 * private tally here would have been the exact mistake that module was written
 * to undo.
 *
 * **No CLV cut**, by choice. Closing-line value already has a home on
 * `/ledger` — the stat tile and the tail/fade audit — and a second place for
 * the same number is a second place for it to be wrong.
 */

/** Only decided, non-void bets count. Same rule as the ledger's dashboard. */
const DECIDED = (b: BetRow) => b.result && b.result !== "void";

function fmtUnits(u: number): string {
  return `${u >= 0 ? "+" : ""}${u.toFixed(1)}`;
}

function toneOf(units: number): "gold" | "flag" | undefined {
  return units > 0 ? "gold" : units < 0 ? "flag" : undefined;
}

export default async function BetStatsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { seasonId } = await fetchCurrentSeasonWeek(supabase);

  // Same read as the ledger: this user's bets across both leagues for the
  // current year. Oldest-first, because `streaks` takes its order from the
  // caller and "current streak" means the most recent run.
  const { data } = user
    ? await supabase
        .from("bets")
        .select("*")
        .in("season_id", seasonIdsForYear(seasonYearOf(seasonId)))
        .eq("user_id", user.id)
        .order("placed_at", { ascending: true })
    : { data: [] as BetRow[] };
  const rows = (data ?? []) as BetRow[];
  const decided = rows.filter(DECIDED);

  // Games and teams for the matchup cut and the kickoff windows. One query
  // each, keyed off the bets we actually have — a bet with no game_id (a
  // future) simply contributes nothing to those two cuts.
  const gameIds = [...new Set(rows.map((b) => b.game_id).filter((id): id is number => id !== null))];
  const { data: gameRows } = gameIds.length
    ? await supabase
        .from("games")
        .select("id, start_ts, home_team_id, away_team_id")
        .in("id", gameIds)
    : { data: [] };
  const games = new Map(
    ((gameRows ?? []) as Array<{
      id: number;
      start_ts: string | null;
      home_team_id: number;
      away_team_id: number;
    }>).map((g) => [g.id, g]),
  );

  const teamIds = [
    ...new Set([...games.values()].flatMap((g) => [g.home_team_id, g.away_team_id])),
  ];
  const { data: teamRows } = teamIds.length
    ? await supabase.from("teams").select("*").in("id", teamIds)
    : { data: [] };
  const teams = new Map(((teamRows ?? []) as TeamRow[]).map((t) => [t.id, t]));

  const toStats = (b: BetRow): StatsBet => {
    const g = b.game_id === null ? undefined : games.get(b.game_id);
    return {
      result: b.result,
      units: b.units,
      payoutUnits: b.payout_units,
      clv: b.clv,
      betType: b.bet_type,
      side: b.side,
      line: b.line_taken === null ? null : Number(b.line_taken),
      odds: b.odds,
      confidence: b.confidence,
      seasonId: b.season_id,
      startTs: g?.start_ts ?? null,
      homeTeamId: g?.home_team_id ?? null,
      awayTeamId: g?.away_team_id ?? null,
    };
  };

  const bets = decided.map(toStats);
  const overall = tally(bets);
  const run = bets.length ? streaks(bets) : EMPTY_STREAKS;

  // Team cut: one row per team, counting a bet once where it was backed and
  // once where it was faded. The same bet lands in both tables under different
  // teams, which is the point — "I am 1-4 fading Georgia" is the finding.
  const backed = tallyByTeam(bets, "backed");
  const faded = tallyByTeam(bets, "faded");

  const byLeague = tallyBy(bets, leagueOf);
  const showLeagues = (byLeague.get("CFB")?.decided ?? 0) > 0 && (byLeague.get("NFL")?.decided ?? 0) > 0;

  if (!user) {
    return (
      <Shell>
        <div className="card px-6 py-12 text-center">
          <p className="display text-lg text-chalk/80">Sign in to see your stats</p>
          <p className="mt-1 text-sm text-dim">
            These are your bets, broken down. Nobody else&apos;s.
          </p>
        </div>
      </Shell>
    );
  }

  if (decided.length === 0) {
    return (
      <Shell>
        <div className="card px-6 py-12 text-center">
          <p className="display text-lg text-chalk/80">Nothing has graded yet</p>
          <p className="mt-1 text-sm text-dim">
            {rows.length > 0
              ? `${rows.length} open ${rows.length === 1 ? "bet" : "bets"}. Breakdowns appear once games finish and the grader settles them.`
              : "Log a bet on the ledger and this fills in as results land."}
          </p>
          <Link href="/ledger" className="mt-4 inline-block text-sm text-accent underline">
            Back to the ledger
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Record" value={formatRecord(overall)} sub={`${overall.decided} settled`} />
        <StatTile label="Units" value={fmtUnits(overall.units)} tone={toneOf(overall.units)} />
        <StatTile
          label="ROI"
          value={overall.roi === null ? "–" : `${(overall.roi * 100).toFixed(1)}%`}
          tone={overall.roi === null ? undefined : toneOf(overall.roi)}
        />
        <StatTile
          label={run.currentKind === "loss" ? "Cold" : "Hot"}
          value={run.currentKind === null ? "–" : `${run.currentLength}${run.currentKind === "win" ? "W" : "L"}`}
          tone={run.currentKind === "win" ? "gold" : run.currentKind === "loss" ? "flag" : undefined}
          sub={`best ${run.longestWin}W · worst ${run.longestLoss}L`}
        />
      </section>

      {showLeagues && (
        <CutTable
          title="League"
          rows={orderedRows(byLeague, ["CFB", "NFL"])}
          total={overall.decided}
        />
      )}

      <Group title="Type, side and price">
        {MARKET_CUTS.map((spec) => (
          <CutTable
            key={spec.label}
            title={spec.label}
            rows={rowsFor(bets, spec)}
            total={overall.decided}
          />
        ))}
      </Group>

      <Group title="Teams">
        <TeamTable title="Backing" tallies={backed} teams={teams} />
        <TeamTable title="Fading" tallies={faded} teams={teams} />
      </Group>

      <Group title="Timing and discipline">
        {TIMING_CUTS.map((spec) => (
          <CutTable
            key={spec.label}
            title={spec.label}
            rows={rowsFor(bets, spec, spec.label === "Confidence" ? labelConfidence : undefined)}
            total={overall.decided}
          />
        ))}
      </Group>

      <p className="mb-8 mt-6 text-[10.5px] leading-relaxed text-dim">
        Settled bets only — pushes count in the record, voids never happened (League Rules #4).
        Rows a cut can&apos;t answer are left out rather than guessed at: a total has no favourite,
        a future has no kickoff. Percentages are of your {overall.decided} settled{" "}
        {overall.decided === 1 ? "bet" : "bets"}, so a cut that skips some will not add to 100.
      </p>
    </Shell>
  );
}

/**
 * Group by team id, then tally each group — `tallyBy` can't do this one because
 * the key comes from a lookup that can decline (a total backs no team), and its
 * signature has no "skip this wager" answer. Still folds through `tally`, so
 * the arithmetic is the shared one.
 */
function tallyByTeam(bets: StatsBet[], pick: "backed" | "faded"): Map<number, Tally> {
  const buckets = new Map<number, StatsBet[]>();
  for (const b of bets) {
    const id = teamsOf(b)[pick];
    if (id === null) continue;
    const arr = buckets.get(id);
    if (arr) arr.push(b);
    else buckets.set(id, [b]);
  }
  const out = new Map<number, Tally>();
  for (const [id, arr] of buckets) out.set(id, tally(arr));
  return out;
}

const labelConfidence = (key: string) =>
  CONFIDENCE_TIER_LABELS[key as keyof typeof CONFIDENCE_TIER_LABELS] ?? key;

/** Tally map → display rows, dropping the null bucket the cut couldn't answer. */
function orderedRows(
  map: Map<string | null, Tally>,
  order?: readonly string[],
): Array<[string, Tally]> {
  const rows = [...map.entries()].filter((e): e is [string, Tally] => e[0] !== null);
  return order
    ? rows.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    : rows.sort((a, b) => byLeagueRules(a[1], b[1]));
}

function rowsFor(
  bets: StatsBet[],
  spec: CutSpec,
  relabel?: (key: string) => string,
): Array<[string, Tally]> {
  const rows = orderedRows(tallyBy(bets, spec.cut), spec.order);
  return relabel ? rows.map(([k, t]) => [relabel(k), t] as [string, Tally]) : rows;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm text-accent">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/**
 * One breakdown. Record, units and ROI per bucket, with the count so a 1-0
 * that reads as 100% cannot be mistaken for a season.
 */
function CutTable({
  title,
  rows,
  total,
}: {
  title: string;
  rows: Array<[string, Tally]>;
  total: number;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="card min-w-0 overflow-x-auto p-3">
      <h3 className="mb-2 text-xs uppercase text-chalk/55">{title}</h3>
      <table className="stats w-full text-sm">
        <thead>
          <tr className="border-b border-chalk/20 text-left text-[10px] uppercase text-chalk/55">
            <th className="py-1 pr-2 font-normal">{title}</th>
            <th className="py-1 px-2 text-right font-normal">Record</th>
            <th className="py-1 px-2 text-right font-normal">Units</th>
            <th className="py-1 pl-2 text-right font-normal">ROI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, t]) => (
            <tr key={key} className="border-b border-chalk/10 last:border-0">
              <td className="py-1.5 pr-2">{key}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{formatRecord(t)}</td>
              <td
                className={`py-1.5 px-2 text-right tabular-nums ${
                  t.units > 0 ? "text-win" : t.units < 0 ? "text-loss" : ""
                }`}
              >
                {fmtUnits(t.units)}
              </td>
              <td className="py-1.5 pl-2 text-right tabular-nums text-dim">
                {t.roi === null ? "–" : `${(t.roi * 100).toFixed(0)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.reduce((n, [, t]) => n + t.decided, 0) < total && (
        <p className="mt-1.5 text-[10px] text-dim">
          {rows.reduce((n, [, t]) => n + t.decided, 0)} of {total} settled bets — the rest have no{" "}
          {title.toLowerCase()}.
        </p>
      )}
    </div>
  );
}

/** Teams sorted by League Rules #5, capped so one bad week doesn't fill a phone. */
function TeamTable({
  title,
  tallies,
  teams,
}: {
  title: string;
  tallies: Map<number, Tally>;
  teams: Map<number, TeamRow>;
}) {
  const rows = [...tallies.entries()]
    .map(([id, t]) => [teams.get(id)?.school ?? `Team ${id}`, t] as [string, Tally])
    .sort((a, b) => byLeagueRules(a[1], b[1]))
    .slice(0, 10);
  if (rows.length === 0) return null;
  return (
    <div className="card min-w-0 overflow-x-auto p-3">
      <h3 className="mb-2 text-xs uppercase text-chalk/55">{title}</h3>
      <table className="stats w-full text-sm">
        <thead>
          <tr className="border-b border-chalk/20 text-left text-[10px] uppercase text-chalk/55">
            <th className="py-1 pr-2 font-normal">Team</th>
            <th className="py-1 px-2 text-right font-normal">Record</th>
            <th className="py-1 pl-2 text-right font-normal">Units</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([school, t]) => (
            <tr key={school} className="border-b border-chalk/10 last:border-0">
              <td className="py-1.5 pr-2">{school}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{formatRecord(t)}</td>
              <td
                className={`py-1.5 pl-2 text-right tabular-nums ${
                  t.units > 0 ? "text-win" : t.units < 0 ? "text-loss" : ""
                }`}
              >
                {fmtUnits(t.units)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {tallies.size > 10 && (
        <p className="mt-1.5 text-[10px] text-dim">Top 10 of {tallies.size} by units.</p>
      )}
    </div>
  );
}

/**
 * The house shell, copied rather than improvised: `AppNav` is a **sibling** of
 * `<main>`, not a child, and main carries `w-full`.
 *
 * Both details are load-bearing and I got both wrong first. Without `w-full` a
 * block element with only `max-w-3xl` sizes to its content instead of its
 * container, so the tables pushed the page to 768px and the whole document
 * scrolled sideways at 375 — measured, not guessed: `scrollWidth` 768 against a
 * 375 viewport, while `/ledger` and `/` were both 375. Nesting the nav inside
 * main compounded it by putting the sticky header in that same over-wide box.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-5 flex items-baseline justify-between gap-3">
          <h1 className="text-2xl">Bet stats</h1>
          <Link
            href="/ledger"
            className="flex min-h-11 items-center text-sm text-accent underline-offset-2 hover:underline"
          >
            Ledger
          </Link>
        </div>
        {children}
      </main>
    </>
  );
}
