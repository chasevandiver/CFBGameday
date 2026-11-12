/**
 * College basketball games sync: schedule, tip times, TV, scores and status,
 * plus the teams (record, AP rank, conference) and venues those games name.
 * One ESPN scoreboard call per day in the window — free and unauthenticated.
 *
 * The window is yesterday through a week out by default. Yesterday because
 * the live pull stops when the last game ends and a stat correction or a
 * late-reported final has nowhere else to land; a week out because that is as
 * far ahead as anybody plans a basketball bet.
 *
 * Usage: npx tsx scripts/cbb-sync-games.ts [--dry-run] [--force]
 *          [--date YYYY-MM-DD]            one board only
 *          [--from YYYY-MM-DD --to YYYY-MM-DD]   a backfill range
 */

import { easternDate, espnDateParam } from "../src/lib/cbb";
import { espnCbb, espnCallCount } from "../src/lib/espn";
import { parseCbbConferences, parseCbbScoreboard, type CbbGame } from "../src/lib/espn-cbb";
import { idleOverridden } from "./lib/idle";
import { chunk, createSink } from "./lib/ingest";
import { logEspnCalls, recordJobRun } from "./lib/jobs-core";
import {
  CBB_SEASON,
  assertNoForeignCollision,
  cbbGameRow,
  cbbStartYear,
  cbbTeamRow,
  cbbVenueRow,
  dateRange,
  shiftDate,
  type CbbTeamRow,
  type CbbVenueRow,
} from "./lib/cbb";

const DAYS_BACK = 1;
const DAYS_AHEAD = 7;
/** A backfill longer than a season is a typo, not a request. */
const MAX_RANGE_DAYS = 200;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { sink, db } = createSink();
  const body = () => run(sink, db);
  const result = db ? await recordJobRun(db, "cbb-sync-games", body) : await body();
  console.log("cbb-sync-games", JSON.stringify(result));
}

async function run(
  sink: ReturnType<typeof createSink>["sink"],
  db: ReturnType<typeof createSink>["db"],
): Promise<Record<string, unknown>> {
  const startYear = cbbStartYear();
  const today = easternDate();
  const one = arg("--date");
  const ranged = one !== undefined || arg("--from") !== undefined;

  /* The offseason guard. The crons fire all year; from May to October there is
     no basketball and nine board calls a run would return nine empty lists.
     A calendar check rather than the games-table horizon the football jobs
     use, because this is the job that fills the table: an empty table in
     November has to mean "sync", not "idle". An explicit date range is a
     person asking, and always runs. */
  const month = Number(today.slice(5, 7));
  if (!ranged && !idleOverridden() && month >= 5 && month <= 10) {
    return { skipped: "offseason" };
  }

  const from = one ?? arg("--from") ?? shiftDate(today, -DAYS_BACK);
  const to = one ?? arg("--to") ?? shiftDate(today, DAYS_AHEAD);
  const dates = dateRange(from, to);
  if (dates.length === 0 || dates.length > MAX_RANGE_DAYS) {
    throw new Error(`bad date range ${from}…${to} (${dates.length} days)`);
  }

  // The season row is the reference job's to create. Without it every game
  // upsert below fails its foreign key one batch at a time; say so once.
  if (db) {
    const { data, error } = await db.from("seasons").select("id").eq("id", CBB_SEASON).maybeSingle();
    if (error) throw new Error(`season check: ${error.message}`);
    if (!data) {
      throw new Error(
        `no seasons row for ${CBB_SEASON} — run cbb-sync-reference first (dispatch-only, once a season)`,
      );
    }
  }

  console.log(`CBB games ${from}…${to} (${dates.length} boards, season ${CBB_SEASON})…`);
  const conferences = parseCbbConferences(await espnCbb.conferences());
  if (conferences.size < 25) {
    // 32 conferences exist. A short list would file most of Division I as
    // non-D-I and empty the conference filter — refuse rather than degrade.
    throw new Error(`expected ~32 conferences, got ${conferences.size}`);
  }

  const teams = new Map<number, CbbTeamRow>();
  const venues = new Map<number, CbbVenueRow>();
  const rows: NonNullable<ReturnType<typeof cbbGameRow>>[] = [];
  const scheduledIds: number[] = [];
  let events = 0;
  // Ascending, so the board nearest the future states each team's record
  // last and wins — a past board prints the record as of that night.
  for (const date of dates) {
    const games: CbbGame[] = parseCbbScoreboard(await espnCbb.scoreboard(espnDateParam(date)));
    events += games.length;
    for (const g of games) {
      const row = cbbGameRow(g, CBB_SEASON, startYear, date);
      if (!row) continue;
      rows.push(row);
      if (g.status === "scheduled") scheduledIds.push(g.id);
      for (const t of [g.home, g.away]) {
        const tr = cbbTeamRow(t, conferences);
        teams.set(tr.id, tr);
      }
      const v = cbbVenueRow(g.venue);
      if (v) venues.set(v.id, v);
    }
  }

  // A game listed on two boards (ESPN moves a postponed game without always
  // clearing the old slot) is stored once, on the later board.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const unique = [...byId.values()];

  // The global-event-id assumption, made loud (scripts/lib/cbb.ts).
  if (db) {
    const ids = unique.map((r) => r.id);
    for (const batch of chunk(ids, 500)) {
      const { data, error } = await db.from("games").select("id, sport").in("id", batch);
      if (error) throw new Error(`collision check: ${error.message}`);
      assertNoForeignCollision((data ?? []) as Array<{ id: number; sport: string }>, new Set(batch));
    }
  }

  // Teams and venues first: games reference both.
  for (const batch of chunk([...teams.values()], 500)) await sink.upsert("teams", batch);
  for (const batch of chunk([...venues.values()], 500)) await sink.upsert("venues", batch);

  // Grouped by column shape — a bulk upsert nulls any column one row omits.
  const byShape = new Map<string, typeof unique>();
  for (const r of unique) {
    const shape = Object.keys(r).sort().join(",");
    const arr = byShape.get(shape) ?? [];
    arr.push(r);
    byShape.set(shape, arr);
  }
  for (const group of byShape.values())
    for (const batch of chunk(group, 500)) await sink.upsert("games", batch);

  // A postponed game that ESPN has put back on the schedule. `scheduled` is
  // never asserted by the upsert above, so this is the one path back — and it
  // is narrowed to rows that are dead, so it can never touch a live game.
  let revived = 0;
  if (db) {
    for (const batch of chunk(scheduledIds, 500)) {
      const { data, error } = await db
        .from("games")
        .update({ status: "scheduled" })
        .in("id", batch)
        .eq("sport", "cbb")
        .in("status", ["postponed", "canceled"])
        .select("id");
      if (error) throw new Error(`reviving rescheduled games: ${error.message}`);
      revived += data?.length ?? 0;
    }
  }

  if (db) await logEspnCalls(db, "cbb-sync-games", espnCallCount());
  console.log(`  ${unique.length} games, ${teams.size} teams, ${venues.size} venues upserted`);
  return {
    boards: dates.length,
    events,
    games: unique.length,
    teams: teams.size,
    venues: venues.size,
    ...(revived ? { revived } : {}),
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
