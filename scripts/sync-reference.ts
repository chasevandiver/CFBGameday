/**
 * Reference data sync: season row, FBS+FCS teams, venues.
 * Run once at setup and occasionally thereafter.
 *
 * Usage: npx tsx scripts/sync-reference.ts [--dry-run]
 * Needs: CFBD_API_KEY (+ Supabase env unless --dry-run)
 */

import { cfbd } from "../src/lib/cfbd";
import { SEASON, chunk, createSink } from "./lib/ingest";

async function main() {
  const { sink } = createSink();

  console.log("Season row…");
  await sink.upsert("seasons", [
    { id: SEASON, label: String(SEASON), week0_start: "2026-08-29", is_current: true },
  ]);

  console.log("Teams…");
  const teams = await cfbd.teams(SEASON);
  const teamRows = teams
    .filter((t) => t.classification === "fbs" || t.classification === "fcs")
    .map((t) => ({
      id: t.id,
      school: t.school,
      mascot: t.mascot,
      abbreviation: t.abbreviation,
      conference: t.conference,
      classification: t.classification ?? "fbs",
      color: t.color,
      alt_color: t.alternateColor,
      logo_url: t.logos?.[0] ?? null,
    }));
  for (const batch of chunk(teamRows, 500)) await sink.upsert("teams", batch);
  console.log(`  ${teamRows.length} teams`);

  console.log("Venues…");
  const venues = await cfbd.venues();
  const venueRows = venues.map((v) => ({
    id: v.id,
    name: v.name,
    city: v.city,
    state: v.state,
    latitude: v.latitude,
    longitude: v.longitude,
    capacity: v.capacity,
    dome: v.dome ?? false,
    timezone: v.timezone,
  }));
  for (const batch of chunk(venueRows, 500)) await sink.upsert("venues", batch);
  const missingCoords = venueRows.filter((v) => v.latitude === null || v.longitude === null);
  console.log(
    `  ${venueRows.length} venues (${missingCoords.length} missing coords → add to venue_coord_overrides as needed)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
