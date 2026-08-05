/**
 * Games sync for the current season: schedule, kickoff times, scores, status.
 * Scheduled: 2× daily off-season, more often on game days (scoreboard job
 * handles live states separately).
 *
 * Usage: npx tsx scripts/sync-games.ts [--dry-run] [--week N]
 */

import { cfbd } from "../src/lib/cfbd";
import { SEASON, chunk, createSink } from "./lib/ingest";

async function main() {
  const { sink } = createSink();
  const weekArg = process.argv.indexOf("--week");
  const week = weekArg > -1 ? Number(process.argv[weekArg + 1]) : undefined;

  console.log(`Games ${SEASON}${week ? ` week ${week}` : ""}…`);
  const games = await cfbd.games(SEASON, { week });

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
  console.log(`  ${rows.length} games upserted`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
