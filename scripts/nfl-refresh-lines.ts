/**
 * NFL line snapshots — same contract as refresh-lines.ts: append a snapshot
 * per game per provider into line_snapshots, never update in place. The
 * scoreboard feed carries one priority book with true openers
 * (pointSpread.home.open.line), so spread_open/total_open are the book's own,
 * not a first-snapshot proxy.
 *
 * Modes:
 *   default   snapshot the earliest week with unplayed games
 *   --burst   only games kicking off in the next 100 minutes (close passes:
 *             Sun early/late waves, and the SNF/MNF/TNF nights)
 *   --force   ignore the offseason idle guard
 *
 * Usage: npx tsx scripts/nfl-refresh-lines.ts [--dry-run] [--burst] [--week N] [--force]
 */

import { espn, espnCallCount, nflStoredWeek, parseEvent } from "../src/lib/espn";
import { ESPN_SEASON_TYPE } from "../src/lib/espn";
import { SEASON, chunk, createSink } from "./lib/ingest";
import { envDays, idleSkip } from "./lib/idle";
import { logEspnCalls, recordJobRun } from "./lib/jobs-core";
import { NFL_SEASON } from "./lib/nfl";

const BURST_WINDOW_MIN = 100;

async function main() {
  const { sink, db } = createSink();
  const burst = process.argv.includes("--burst");
  const job = burst ? "nfl-lines-close" : "nfl-refresh-lines";
  const body = () => run(sink, db, burst, job);
  const result = db ? await recordJobRun(db, job, body) : await body();
  console.log(job, JSON.stringify(result));
}

async function run(
  sink: ReturnType<typeof createSink>["sink"],
  db: ReturnType<typeof createSink>["db"],
  burst: boolean,
  job: string,
): Promise<Record<string, unknown>> {
  const weekArg = process.argv.indexOf("--week");
  let week = weekArg > -1 ? Number(process.argv[weekArg + 1]) : undefined;
  let seasonType: "preseason" | "regular" | "postseason" = "regular";

  // The reason, not a flat "idle" — see idle.ts. An NFL run reporting `idle`
  // 35 minutes before kickoff on 2026-08-13 is what surfaced this, and the
  // detail was too coarse to say which of the two states it had hit.
  const idle = db
    ? await idleSkip(db, { job, season: NFL_SEASON, horizonDays: envDays("LINES_IDLE_DAYS", 7) })
    : false;
  if (idle) return { skipped: idle };

  // In burst mode the kick window comes FIRST: no games inside it means no
  // fetch at all (the CFB version fetches before filtering; free API or not,
  // the extended Sat/Sun/night crons should cost nothing off-wave).
  let kickWindow: Set<number> | null = null;
  if (burst && db) {
    const now = Date.now();
    const horizon = new Date(now + BURST_WINDOW_MIN * 60 * 1000).toISOString();
    const { data } = await db
      .from("games")
      .select("id")
      .eq("season_id", NFL_SEASON)
      .gt("start_ts", new Date(now).toISOString())
      .lte("start_ts", horizon);
    kickWindow = new Set((data ?? []).map((g: { id: number }) => g.id));
    console.log(`  burst window: ${kickWindow.size} games inside ${BURST_WINDOW_MIN} min`);
    if (kickWindow.size === 0) return { snapshots: 0, skipped: "no_kicks_in_window" };
  }

  if (week === undefined && db) {
    // The next slate is whichever week kicks off soonest — start_ts, not a
    // season-type ordering, because preseason → regular → postseason has no
    // usable lexical order.
    const { data } = await db
      .from("games")
      .select("week, season_type")
      .eq("season_id", NFL_SEASON)
      .eq("status", "scheduled")
      .order("start_ts", { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    week = data?.week;
    if (data?.season_type === "postseason" || data?.season_type === "preseason")
      seasonType = data.season_type;
  }
  if (week === undefined) return { snapshots: 0, skipped: "no_scheduled_week" };

  console.log(`NFL lines ${SEASON} ${seasonType} week ${week}${burst ? " (burst)" : ""}…`);
  const board = await espn.scoreboard({
    year: SEASON,
    seasonType:
      seasonType === "postseason"
        ? ESPN_SEASON_TYPE.postseason
        : seasonType === "preseason"
          ? ESPN_SEASON_TYPE.preseason
          : ESPN_SEASON_TYPE.regular,
    // stored postseason week 4 (Super Bowl) is ESPN week 5 — the Pro Bowl gap
    week: seasonType === "postseason" && week === 4 ? 5 : week,
  });

  const capturedAt = new Date().toISOString();
  const rows = (board.events ?? [])
    .map(parseEvent)
    .filter((g) => nflStoredWeek(g.espnSeasonType, g.espnWeek, g.name) !== null)
    .filter((g) => !kickWindow || kickWindow.has(g.id))
    .filter((g) => g.odds !== null && (g.odds.spread !== null || g.odds.total !== null))
    .map((g) => ({
      game_id: g.id,
      provider: g.odds!.provider,
      source: "espn",
      spread: g.odds!.spread,
      spread_open: g.odds!.spreadOpen,
      total: g.odds!.total,
      total_open: g.odds!.totalOpen,
      ml_home: g.odds!.mlHome,
      ml_away: g.odds!.mlAway,
      captured_at: capturedAt,
    }));

  for (const batch of chunk(rows, 500)) await sink.insert("line_snapshots", batch);
  if (db) await logEspnCalls(db, job, espnCallCount());
  console.log(`  ${rows.length} snapshots appended`);
  return { snapshots: rows.length, week };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
