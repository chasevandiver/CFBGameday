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
import { logCfbdCalls } from "./lib/jobs-core";
import { DAY_MS, envDays, idleOverridden, msUntilNextGame } from "./lib/idle";
import { SEASON, chunk, createSink } from "./lib/ingest";

const MONDAY = 1;

async function main() {
  const { sink, db } = createSink();
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
      return;
    }
  }

  console.log(`Games ${SEASON}${week ? ` week ${week}` : ""}…`);
  // Regular season AND postseason — championship week, bowls, and the CFP were
  // never ingested before (audit #1: "the season ends in November").
  const [regular, postseason] = await Promise.all([
    cfbd.games(SEASON, { week }),
    week === undefined ? cfbd.games(SEASON, { seasonType: "postseason" }) : Promise.resolve([]),
  ]);
  const games = [...regular, ...postseason];

  const rows = games.map((g) => ({
    id: g.id,
    season_id: SEASON,
    week: g.week,
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
    status: g.completed ? "final" : "scheduled",
    notes: g.notes,
  }));

  for (const batch of chunk(rows, 500)) await sink.upsert("games", batch);
  if (db) await logCfbdCalls(db, "sync-games", cfbdCallCount());
  console.log(`  ${rows.length} games upserted`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
