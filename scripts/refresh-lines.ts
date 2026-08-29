/**
 * Line snapshot job — the source of openers, movement, and closing lines
 * (docs/SPEC.md §5.3). Appends a snapshot per game per provider; never
 * updates in place.
 *
 * Modes:
 *   default   snapshot every game in the current/next week
 *   --burst   only games kicking off in the next 100 minutes (run every
 *             5–10 min pre-kickoff so the closing proxy is honest)
 *   --force   ignore the offseason idle guard (see scripts/lib/idle.ts)
 *
 * Usage: npx tsx scripts/refresh-lines.ts [--dry-run] [--burst] [--week N] [--force]
 */

import { cfbd, cfbdCallCount } from "../src/lib/cfbd";
import { normalizeProvider } from "../src/lib/providers";
import { logCfbdCalls, recordJobRun } from "./lib/jobs-core";
import { idleSkip, envDays } from "./lib/idle";
import { SEASON, chunk, createSink, dropUnknownGames } from "./lib/ingest";

const BURST_WINDOW_MIN = 100;

async function main() {
  const { sink, db } = createSink();
  const burst = process.argv.includes("--burst");
  const job = burst ? "refresh-lines-burst" : "refresh-lines";
  const body = () => run(sink, db, burst);
  // job_runs is the dead-man's record: a missing row is the only visible
  // trace of a cron that never fired (audit 07 / migration 0024).
  const result = db ? await recordJobRun(db, job, body) : await body();
  console.log(job, JSON.stringify(result));
}

async function run(
  sink: ReturnType<typeof createSink>["sink"],
  db: ReturnType<typeof createSink>["db"],
  burst: boolean,
): Promise<Record<string, unknown>> {
  const weekArg = process.argv.indexOf("--week");
  let week = weekArg > -1 ? Number(process.argv[weekArg + 1]) : undefined;

  // Offseason guard, BEFORE the CFBD fetch: in burst mode the lines call
  // happens ahead of the kick-window filter, so an idle Saturday would still
  // spend ~72 calls a day on games two months out.
  const idle = db
    ? await idleSkip(db, {
        job: burst ? "refresh-lines-burst" : "refresh-lines",
        season: SEASON,
        horizonDays: envDays("LINES_IDLE_DAYS", 7),
      })
    : false;
  // The reason, not a flat "idle" — `next_game_gt_7d` and `no_scheduled_games`
  // are a correct offseason no-op and a broken bootstrap respectively, and
  // job_runs.detail used to render both as the same green nothing.
  if (idle) return { skipped: idle };

  if (week === undefined && db) {
    // Default to the earliest week with unplayed games
    const { data } = await db
      .from("games")
      .select("week")
      .eq("season_id", SEASON)
      .eq("status", "scheduled")
      .order("week")
      .limit(1)
      .maybeSingle();
    week = data?.week;
  }

  console.log(`Lines ${SEASON}${week !== undefined ? ` week ${week}` : ""}${burst ? " (burst)" : ""}…`);
  const lines = await cfbd.lines(SEASON, { week });

  let kickWindow: Set<number> | null = null;
  if (burst && db) {
    const now = Date.now();
    const horizon = new Date(now + BURST_WINDOW_MIN * 60 * 1000).toISOString();
    const { data } = await db
      .from("games")
      .select("id")
      .eq("season_id", SEASON)
      .gt("start_ts", new Date(now).toISOString())
      .lte("start_ts", horizon);
    kickWindow = new Set((data ?? []).map((g: { id: number }) => g.id));
    console.log(`  burst window: ${kickWindow.size} games inside ${BURST_WINDOW_MIN} min`);
  }

  const capturedAt = new Date().toISOString();
  let rows = lines
    .filter((game) => !kickWindow || kickWindow.has(game.id))
    .flatMap((game) =>
      game.lines.map((l) => ({
        game_id: game.id,
        provider: normalizeProvider(l.provider),
        source: "cfbd",
        spread: l.spread,
        spread_open: l.spreadOpen,
        total: l.overUnder,
        total_open: l.overUnderOpen,
        ml_home: l.homeMoneyline,
        ml_away: l.awayMoneyline,
        captured_at: capturedAt,
      })),
    );

  /* CFBD's /lines can carry a game our games table does not (launch morning
     2026-08-29: it grew one overnight while sync-games stayed green — the two
     CFBD feeds disagree with each other, so re-syncing cannot heal it). The
     FK on line_snapshots.game_id then fails the WHOLE batch, which is how a
     day of snapshots and every chained freeze-groups run were lost over one
     game we never wanted. Keep our batch; report theirs. */
  let droppedUnknown: number[] = [];
  if (db && rows.length > 0) {
    const ids = [...new Set(rows.map((r) => r.game_id))];
    const known = new Set<number>();
    for (const batch of chunk(ids, 500)) {
      const { data } = await db.from("games").select("id").in("id", batch);
      for (const g of (data ?? []) as Array<{ id: number }>) known.add(g.id);
    }
    const filtered = dropUnknownGames(rows, known);
    rows = filtered.kept;
    droppedUnknown = filtered.dropped;
    if (droppedUnknown.length > 0)
      console.log(`  skipped ${droppedUnknown.length} unknown game id(s): ${droppedUnknown.join(", ")}`);
  }

  for (const batch of chunk(rows, 500)) await sink.insert("line_snapshots", batch);
  if (db) await logCfbdCalls(db, burst ? "refresh-lines-burst" : "refresh-lines", cfbdCallCount());
  console.log(`  ${rows.length} snapshots appended`);
  // The dropped ids go in the run detail, not just the log — a green run that
  // silently ate a feed hole is the SYS-1 failure shape all over again.
  return {
    snapshots: rows.length,
    week: week ?? null,
    ...(droppedUnknown.length > 0 ? { unknown_game_ids: droppedUnknown } : {}),
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
