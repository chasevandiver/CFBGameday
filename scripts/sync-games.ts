/**
 * Games sync for the current season: schedule, kickoff times, scores, status.
 * Scheduled: 2× daily off-season, more often on game days (scoreboard job
 * handles live states separately).
 *
 * Deep offseason (next kickoff more than SYNC_GAMES_IDLE_DAYS away) drops to
 * Mondays only — schedules do still move in February, just not daily. Within
 * the horizon it stays daily, which keeps the chained sync-rankings and
 * sync-systems jobs capturing preseason polls and SP+/FPI/Elo all August.
 *
 * Usage: npx tsx scripts/sync-games.ts [--dry-run] [--week N] [--force]
 */

import { cfbd, cfbdCallCount } from "../src/lib/cfbd";
import { logCfbdCalls, recordJobRun } from "./lib/jobs-core";
import { DAY_MS, envDays, idleOverridden, msUntilNextGame } from "./lib/idle";
import { SEASON, chunk, createSink } from "./lib/ingest";
import { resolvedWeek, weekZeroIds } from "./lib/weeks";

const MONDAY = 1;

async function main() {
  const { sink, db } = createSink();
  // job_runs is the dead-man's record (audit 07 / migration 0024).
  const result = db ? await recordJobRun(db, "sync-games", () => run(sink, db)) : await run(sink, db);
  console.log("sync-games", JSON.stringify(result));
}

async function run(
  sink: ReturnType<typeof createSink>["sink"],
  db: ReturnType<typeof createSink>["db"],
): Promise<Record<string, unknown>> {
  const weekArg = process.argv.indexOf("--week");
  const week = weekArg > -1 ? Number(process.argv[weekArg + 1]) : undefined;

  // Unlike the polling jobs this one never hard-skips on an empty table: it is
  // the job that POPULATES games, so an unconditional idle guard would deadlock
  // the bootstrap every new season.
  if (db && !idleOverridden()) {
    const ms = await msUntilNextGame(db, SEASON);
    const horizon = envDays("SYNC_GAMES_IDLE_DAYS", 14);
    const days = ms === null ? null : ms / DAY_MS;
    if (days !== null && days > horizon && new Date().getUTCDay() !== MONDAY) {
      console.log(
        JSON.stringify({
          job: "sync-games",
          season: SEASON,
          skipped: `next_game_gt_${horizon}d_and_not_monday`,
          days_to_kickoff: Math.round(days * 10) / 10,
        }),
      );
      return { skipped: `next_game_gt_${horizon}d_and_not_monday` };
    }
  }

  console.log(`Games ${SEASON}${week ? ` week ${week}` : ""}…`);
  // Regular season AND postseason — championship week, bowls, and the CFP were
  // never ingested before (audit #1: "the season ends in November").
  const [regular, postseason, mediaReg, mediaPost] = await Promise.all([
    cfbd.games(SEASON, { week }),
    week === undefined ? cfbd.games(SEASON, { seasonType: "postseason" }) : Promise.resolve([]),
    // Broadcast assignments, so a pregame card can say what channel it's on.
    // The scoreboard feed also carries tv, but only once a game is current.
    cfbd.gameMedia(SEASON, { week }).catch(() => []),
    week === undefined
      ? cfbd.gameMedia(SEASON, { seasonType: "postseason" }).catch(() => [])
      : Promise.resolve([]),
  ]);
  const games = [...regular, ...postseason];
  // First tv outlet per game; radio/web rows are ignored.
  const tvByGame = new Map<number, string>();
  for (const m of [...mediaReg, ...mediaPost]) {
    if (m.mediaType !== "tv" || !m.outlet) continue;
    if (!tvByGame.has(m.id)) tvByGame.set(m.id, m.outlet);
  }

  // CFBD merges Week 0 into Week 1 in seasons like 2026 — 99 games over ten
  // days and two Saturdays. Split it back out before anything stores a week,
  // because every surface downstream keys on that number. No-op when the feed
  // already labels Week 0 properly. See scripts/lib/weeks.ts.
  const weekZero = weekZeroIds(games);
  if (weekZero.size > 0)
    console.log(`  week 0 split out of CFBD's week 1: ${weekZero.size} games`);

  const rows = games.map((g) => ({
    id: g.id,
    season_id: SEASON,
    week: resolvedWeek(g, weekZero),
    season_type: g.seasonType,
    start_ts: g.startDate,
    start_time_tbd: g.startTimeTBD,
    neutral_site: g.neutralSite,
    conference_game: g.conferenceGame,
    venue_id: g.venueId,
    home_team_id: g.homeId,
    away_team_id: g.awayId,
    home_points: g.homePoints,
    away_points: g.awayPoints,
    // Only assert "final"; otherwise leave status alone (new rows take the
    // schema default 'scheduled'). The old unconditional map flipped a live
    // game back to 'scheduled' if this ever ran mid-window (audit 07/OPS-12c).
    ...(g.completed ? { status: "final" } : {}),
    // Never null out a tv the live board already found for us.
    ...(tvByGame.has(g.id) ? { tv: tvByGame.get(g.id) as string } : {}),
    notes: g.notes,
  }));

  // PostgREST bulk rows must share a column set, and these rows deliberately
  // vary: `status` only on finals (so a live game is never knocked back to
  // scheduled) and `tv` only where the media feed had one (so an outlet the
  // live board found is never nulled out). Group by shape and send each.
  const byShape = new Map<string, typeof rows>();
  for (const r of rows) {
    const shape = Object.keys(r).sort().join(",");
    const arr = byShape.get(shape) ?? [];
    arr.push(r);
    byShape.set(shape, arr);
  }
  for (const group of byShape.values())
    for (const batch of chunk(group, 500)) await sink.upsert("games", batch);
  if (db) await logCfbdCalls(db, "sync-games", cfbdCallCount());
  console.log(`  ${rows.length} games upserted`);
  return { games: rows.length };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
