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

import { CfbdError, cfbd, cfbdCallCount } from "../src/lib/cfbd";
import { logCfbdCalls, recordJobRun } from "./lib/jobs-core";
import { DAY_MS, envDays, idleOverridden, msUntilNextGame } from "./lib/idle";
import { SEASON, chunk, createSink } from "./lib/ingest";
import { resolvedWeek, weekZeroIds } from "./lib/weeks";

const MONDAY = 1;

/**
 * Broadcast assignments are optional — tv just stays null and the card shows no
 * network — so a failure here must not fail the whole sync. It used to be a
 * bare `.catch(() => [])`, which swallowed a tier denial, a 500, a timeout and a
 * parse error identically and logged none of them (P2-11). `probe-cfbd.ts`
 * carried a note saying so, which meant the only way to learn that /games/media
 * had been revoked was to run the probe and read it.
 *
 * Now the outcome is recorded: 401/403 is "the key or the tier cannot have
 * this", which is actionable and permanent, and anything else is CFBD having a
 * bad day. Both land in the job's return value and therefore in
 * `job_runs.detail` and on /admin. A non-CfbdError still throws — a missing
 * CFBD_API_KEY raises a plain Error (`cfbd.ts:42`), and a config mistake should
 * go red rather than degrade to a slate with no networks on it.
 */
async function media<T>(
  label: string,
  fetch: () => Promise<T[]>,
  failures: string[],
): Promise<T[]> {
  try {
    return await fetch();
  } catch (err) {
    if (!(err instanceof CfbdError)) throw err;
    const denied = err.status === 401 || err.status === 403;
    failures.push(`${label}:${err.status}`);
    console.warn(
      `  ::warning::gameMedia ${label} failed: ${err.status} — ` +
        `${denied ? "tier or key denied, tv stays null until it is fixed" : "transient, retried once already"}`,
    );
    return [];
  }
}

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
  const mediaFailures: string[] = [];
  const [regular, postseason, mediaReg, mediaPost] = await Promise.all([
    cfbd.games(SEASON, { week }),
    week === undefined ? cfbd.games(SEASON, { seasonType: "postseason" }) : Promise.resolve([]),
    // Broadcast assignments, so a pregame card can say what channel it's on.
    // The scoreboard feed also carries tv, but only once a game is current.
    media("regular", () => cfbd.gameMedia(SEASON, { week }), mediaFailures),
    week === undefined
      ? media(
          "postseason",
          () => cfbd.gameMedia(SEASON, { seasonType: "postseason" }),
          mediaFailures,
        )
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
    // Conference AT KICKOFF (migration 0067). Carried here as well as in the
    // backfill so the live season is not the one gap in the column.
    home_conference: g.homeConference ?? null,
    away_conference: g.awayConference ?? null,
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
  return {
    games: rows.length,
    tv: tvByGame.size,
    // Only present when something went wrong, so a healthy run's detail stays
    // as short as it is today.
    ...(mediaFailures.length > 0 ? { media_failed: mediaFailures } : {}),
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
