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
import { logCfbdCalls } from "./lib/jobs-core";
import { idleSkip, envDays } from "./lib/idle";
import { SEASON, chunk, createSink } from "./lib/ingest";

const BURST_WINDOW_MIN = 100;

async function main() {
  const { sink, db } = createSink();
  const burst = process.argv.includes("--burst");
  const weekArg = process.argv.indexOf("--week");
  let week = weekArg > -1 ? Number(process.argv[weekArg + 1]) : undefined;

  // Offseason guard, BEFORE the CFBD fetch: in burst mode the lines call
  // happens ahead of the kick-window filter, so an idle Saturday would still
  // spend ~72 calls a day on games two months out.
  if (db && (await idleSkip(db, {
    job: burst ? "refresh-lines-burst" : "refresh-lines",
    season: SEASON,
    horizonDays: envDays("LINES_IDLE_DAYS", 7),
  }))) {
    return;
  }

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
  const rows = lines
    .filter((game) => !kickWindow || kickWindow.has(game.id))
    .flatMap((game) =>
      game.lines.map((l) => ({
        game_id: game.id,
        provider: l.provider,
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

  for (const batch of chunk(rows, 500)) await sink.insert("line_snapshots", batch);
  if (db) await logCfbdCalls(db, burst ? "refresh-lines-burst" : "refresh-lines", cfbdCallCount());
  console.log(`  ${rows.length} snapshots appended`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
