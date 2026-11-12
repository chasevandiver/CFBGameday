/**
 * College basketball reference bootstrap: the seasons row. Dispatch-only, run
 * once per season (November), after migration 0084.
 *
 * It is one row because everything else arrives with the games: teams, their
 * conferences and venues are upserted by `cbb-sync-games` from the same board
 * that carries the schedule, so there is no 365-team list to keep in step.
 *
 * Marks the season current for the `cbb` sport and un-marks the previous one
 * FIRST — `seasons_one_current_per_sport` (0042) allows one current row per
 * sport, so the order is what makes the rollover a no-error operation. The
 * football leagues' pointers filter on their own sport and never see this row.
 *
 * Usage: npx tsx scripts/cbb-sync-reference.ts [--dry-run]
 */

import { cbbDayZero } from "../src/lib/cbb";
import { createSink } from "./lib/ingest";
import { recordJobRun } from "./lib/jobs-core";
import { CBB_SEASON, cbbSeasonLabel, cbbStartYear } from "./lib/cbb";

async function main() {
  const { sink, db } = createSink();
  const body = async () => {
    const startYear = cbbStartYear();
    console.log(`CBB reference ${cbbSeasonLabel(startYear)} (season id ${CBB_SEASON})…`);
    if (db) {
      const { error } = await db
        .from("seasons")
        .update({ is_current: false })
        .eq("sport", "cbb")
        .neq("id", CBB_SEASON);
      if (error) throw new Error(`retiring the previous cbb season: ${error.message}`);
    }
    await sink.upsert("seasons", [
      {
        id: CBB_SEASON,
        label: cbbSeasonLabel(startYear),
        sport: "cbb",
        // Day 0 of the season's day index (src/lib/cbb.ts). The column drives
        // nothing else for basketball but is NOT NULL by schema.
        week0_start: cbbDayZero(CBB_SEASON),
        is_current: true,
      },
    ]);
    return { season: CBB_SEASON, label: cbbSeasonLabel(startYear) };
  };
  const result = db ? await recordJobRun(db, "cbb-sync-reference", body) : await body();
  console.log("cbb-sync-reference", JSON.stringify(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
