/**
 * NFL games sync: schedule, kickoff times, scores, status, TV. Chained onto
 * the daily sync-games run. One scoreboard call per week — 18 regular +
 * postseason — against a free unauthenticated API.
 *
 * Follows sync-games' hard-won rules: only assert status on finals (a live
 * game must never be knocked back to 'scheduled'), never null out a stored tv,
 * group bulk upserts by column shape. Adds one of its own: refuse to write any
 * event id that already exists as a CFB game (see scripts/lib/nfl.ts).
 *
 * Usage: npx tsx scripts/nfl-sync-games.ts [--dry-run] [--week N] [--force]
 */

import { espn, espnCallCount, nflStoredWeek, parseEvent, type NflScoreboardGame } from "../src/lib/espn";
import { ESPN_SEASON_TYPE } from "../src/lib/espn";
import { nflTeamId } from "../src/lib/league";
import { SEASON, chunk, createSink } from "./lib/ingest";
import { DAY_MS, envDays, idleOverridden, msUntilNextGame } from "./lib/idle";
import { logEspnCalls, recordJobRun } from "./lib/jobs-core";
import { NFL_SEASON, assertNoCfbCollision, isDivisionGame } from "./lib/nfl";

const MONDAY = 1;
const PRESEASON_WEEKS = 4; // week 1 is the Hall of Fame game
const REGULAR_WEEKS = 18;
const ESPN_POSTSEASON_WEEKS = [1, 2, 3, 5]; // Wild Card…Conference, Super Bowl (4 is the Pro Bowl)

async function main() {
  const { sink, db } = createSink();
  const body = () => run(sink, db);
  const result = db ? await recordJobRun(db, "nfl-sync-games", body) : await body();
  console.log("nfl-sync-games", JSON.stringify(result));
}

async function run(
  sink: ReturnType<typeof createSink>["sink"],
  db: ReturnType<typeof createSink>["db"],
): Promise<Record<string, unknown>> {
  const weekArg = process.argv.indexOf("--week");
  const week = weekArg > -1 ? Number(process.argv[weekArg + 1]) : undefined;

  // Same idle shape as sync-games: never hard-skip on an empty table (this is
  // the job that populates it), drop to Mondays in the deep offseason.
  if (db && !idleOverridden()) {
    const ms = await msUntilNextGame(db, NFL_SEASON);
    const horizon = envDays("SYNC_GAMES_IDLE_DAYS", 14);
    const days = ms === null ? null : ms / DAY_MS;
    if (days !== null && days > horizon && new Date().getUTCDay() !== MONDAY) {
      console.log(
        JSON.stringify({
          job: "nfl-sync-games",
          season: NFL_SEASON,
          skipped: `next_game_gt_${horizon}d_and_not_monday`,
          days_to_kickoff: Math.round(days * 10) / 10,
        }),
      );
      return { skipped: `next_game_gt_${horizon}d_and_not_monday` };
    }
  }

  console.log(`NFL games ${SEASON}${week ? ` week ${week}` : ""}…`);
  const weekBoards =
    week !== undefined
      ? [{ seasonType: ESPN_SEASON_TYPE.regular, week }]
      : [
          ...Array.from({ length: PRESEASON_WEEKS }, (_, i) => ({
            seasonType: ESPN_SEASON_TYPE.preseason,
            week: i + 1,
          })),
          ...Array.from({ length: REGULAR_WEEKS }, (_, i) => ({
            seasonType: ESPN_SEASON_TYPE.regular,
            week: i + 1,
          })),
          ...ESPN_POSTSEASON_WEEKS.map((w) => ({
            seasonType: ESPN_SEASON_TYPE.postseason,
            week: w,
          })),
        ];

  const games: NflScoreboardGame[] = [];
  for (const b of weekBoards) {
    const board = await espn.scoreboard({ year: SEASON, seasonType: b.seasonType, week: b.week });
    // ESPN answers an unscheduled week (postseason before January) with an
    // empty events list, which is exactly the right no-op.
    games.push(...(board.events ?? []).map(parseEvent));
  }

  const rows = games.flatMap((g) => {
    const stored = nflStoredWeek(g.espnSeasonType, g.espnWeek, g.name);
    if (!stored) return []; // preseason, Pro Bowl
    // A playoff slot without a decided matchup carries TBD placeholder teams
    // (ids -1/-2). It lands here in January when the bracket is real.
    if (g.homeEspnId <= 0 || g.awayEspnId <= 0) return [];
    return [
      {
        id: g.id,
        season_id: NFL_SEASON,
        sport: "nfl",
        week: stored.week,
        season_type: stored.seasonType,
        start_ts: g.startDate,
        start_time_tbd: g.startTimeTbd,
        neutral_site: g.neutralSite,
        conference_game: isDivisionGame(g.homeAbbr, g.awayAbbr),
        home_team_id: nflTeamId(g.homeEspnId),
        away_team_id: nflTeamId(g.awayEspnId),
        home_points: g.homePoints,
        away_points: g.awayPoints,
        ...(g.status === "final" ? { status: "final" } : {}),
        ...(g.tv !== null ? { tv: g.tv } : {}),
      },
    ];
  });

  // The global-event-id assumption, made loud (scripts/lib/nfl.ts).
  if (db) {
    const ids = rows.map((r) => r.id);
    for (const batch of chunk(ids, 500)) {
      const { data, error } = await db.from("games").select("id, sport").in("id", batch);
      if (error) throw new Error(`collision check: ${error.message}`);
      assertNoCfbCollision((data ?? []) as Array<{ id: number; sport: string }>, new Set(batch));
    }
  }

  const byShape = new Map<string, typeof rows>();
  for (const r of rows) {
    const shape = Object.keys(r).sort().join(",");
    const arr = byShape.get(shape) ?? [];
    arr.push(r);
    byShape.set(shape, arr);
  }
  for (const group of byShape.values())
    for (const batch of chunk(group, 500)) await sink.upsert("games", batch);

  if (db) await logEspnCalls(db, "nfl-sync-games", espnCallCount());
  console.log(`  ${rows.length} games upserted`);
  return { games: rows.length };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
