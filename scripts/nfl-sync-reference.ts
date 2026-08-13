/**
 * NFL reference bootstrap: the seasons row and the 32 teams. Dispatch-only —
 * it changes which season is "current" for the nfl sport, so it runs when a
 * human says so, not on a schedule. Safe to re-run: everything is an upsert
 * and the season row is keyed by id.
 *
 * ORDERING (0042): the sport-aware fetchCurrentSeasonWeek must be deployed
 * before this runs — inserting a second is_current season row against the old
 * code breaks every page's season pointer.
 *
 * Usage: npx tsx scripts/nfl-sync-reference.ts [--dry-run]
 */

import { espn, espnCallCount } from "../src/lib/espn";
import { nflTeamId } from "../src/lib/league";
import { SEASON, createSink } from "./lib/ingest";
import { logEspnCalls, recordJobRun } from "./lib/jobs-core";
import { NFL_SEASON, divisionOf } from "./lib/nfl";

async function main() {
  const { sink, db } = createSink();
  const body = () => run(sink, db);
  const result = db ? await recordJobRun(db, "nfl-sync-reference", body) : await body();
  console.log("nfl-sync-reference", JSON.stringify(result));
}

async function run(
  sink: ReturnType<typeof createSink>["sink"],
  db: ReturnType<typeof createSink>["db"],
): Promise<Record<string, unknown>> {
  console.log(`NFL reference ${SEASON} (season id ${NFL_SEASON})…`);

  const teams = await espn.teams();
  const unknownDivision = teams.filter((t) => divisionOf(t.abbreviation) === null);
  if (teams.length !== 32 || unknownDivision.length > 0) {
    // A missing division would leave a team out of the filter and mislabel
    // conference_game on every one of its games — refuse rather than degrade.
    throw new Error(
      `expected 32 teams with known divisions, got ${teams.length} ` +
        `(${unknownDivision.length} unmapped: ${unknownDivision.map((t) => t.abbreviation).join(", ")})`,
    );
  }

  await sink.upsert("seasons", [
    {
      id: NFL_SEASON,
      label: `${SEASON} NFL`,
      sport: "nfl",
      // Opening kickoff is week 1 — the NFL has no week 0. The column drives
      // nothing for NFL (weeks come from the feed) but is not null by schema.
      week0_start: `${SEASON}-09-01`,
      is_current: true,
    },
  ]);

  await sink.upsert(
    "teams",
    teams.map((t) => ({
      id: nflTeamId(t.espnId),
      sport: "nfl",
      school: t.displayName, // "Kansas City Chiefs"
      mascot: t.name, // "Chiefs"
      abbreviation: t.abbreviation,
      conference: divisionOf(t.abbreviation), // "AFC West"
      division: null, // the fbs|fcs column has no NFL meaning
      classification: "nfl",
      color: t.color,
      alt_color: t.altColor,
      logo_url: t.logo,
    })),
  );

  if (db) await logEspnCalls(db, "nfl-sync-reference", espnCallCount());
  console.log(`  season ${NFL_SEASON} + ${teams.length} teams upserted`);
  return { season: NFL_SEASON, teams: teams.length };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
