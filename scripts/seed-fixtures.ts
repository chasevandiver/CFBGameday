/**
 * Dev fixtures: a fake 2026 "Week 1" slate so every page is buildable and
 * demo-able before the CFBD key works. Team ids are REAL CFBD/ESPN ids, so
 * tomorrow's real ingestion upserts over this cleanly.
 *
 * Usage: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed-fixtures.ts
 */

import { createServiceClient } from "../src/lib/supabase/service";
import { MODEL_VERSION } from "../src/model/ratings";

const SEASON = 2026;

// Real CFBD/ESPN team ids
const TEAMS = [
  { id: 333, school: "Alabama", abbreviation: "ALA", conference: "SEC", color: "#9e1b32" },
  { id: 61, school: "Georgia", abbreviation: "UGA", conference: "SEC", color: "#ba0c2f" },
  { id: 194, school: "Ohio State", abbreviation: "OSU", conference: "Big Ten", color: "#bb0000" },
  { id: 130, school: "Michigan", abbreviation: "MICH", conference: "Big Ten", color: "#00274c" },
  { id: 251, school: "Texas", abbreviation: "TEX", conference: "SEC", color: "#bf5700" },
  { id: 201, school: "Oklahoma", abbreviation: "OU", conference: "SEC", color: "#841617" },
  { id: 2483, school: "Oregon", abbreviation: "ORE", conference: "Big Ten", color: "#154733" },
  { id: 213, school: "Penn State", abbreviation: "PSU", conference: "Big Ten", color: "#041e42" },
  { id: 99, school: "LSU", abbreviation: "LSU", conference: "SEC", color: "#461d7c" },
  { id: 228, school: "Clemson", abbreviation: "CLEM", conference: "ACC", color: "#f56600" },
  { id: 87, school: "Notre Dame", abbreviation: "ND", conference: "FBS Independents", color: "#0c2340" },
  { id: 2390, school: "Miami", abbreviation: "MIA", conference: "ACC", color: "#f47321" },
  { id: 145, school: "Ole Miss", abbreviation: "MISS", conference: "SEC", color: "#ce1126" },
  { id: 2633, school: "Tennessee", abbreviation: "TENN", conference: "SEC", color: "#ff8200" },
  { id: 254, school: "Utah", abbreviation: "UTAH", conference: "Big 12", color: "#cc0000" },
  { id: 38, school: "Colorado", abbreviation: "COLO", conference: "Big 12", color: "#cfb87c" },
];

// Saturday of fixture week 1 (Sep 5), kickoffs in UTC (CT = UTC-5 in August)
const kick = (ctHour: number, ctMin = 0) =>
  new Date(Date.UTC(2026, 8, 5, ctHour + 5, ctMin)).toISOString();

interface FixtureGame {
  id: number;
  home: number;
  away: number;
  ct: [number, number];
  tv: string;
  spread: number; // vegas, home perspective
  open: number;
  total: number;
  modelSpread: number; // model, vegas convention
}

const GAMES: FixtureGame[] = [
  { id: 900001, home: 333, away: 194, ct: [11, 0], tv: "FOX", spread: -2.5, open: -1.5, total: 52.5, modelSpread: -5.0 },
  { id: 900002, home: 61, away: 228, ct: [11, 0], tv: "ABC", spread: -7.5, open: -7, total: 49.5, modelSpread: -8.2 },
  { id: 900003, home: 130, away: 87, ct: [14, 30], tv: "NBC", spread: -3, open: -3.5, total: 44.5, modelSpread: -0.8 },
  { id: 900004, home: 251, away: 201, ct: [14, 30], tv: "ESPN", spread: -10.5, open: -9.5, total: 58.5, modelSpread: -12.4 },
  { id: 900005, home: 2483, away: 213, ct: [18, 30], tv: "CBS", spread: -4.5, open: -6, total: 54.5, modelSpread: -4.1 },
  { id: 900006, home: 99, away: 2390, ct: [18, 45], tv: "ABC", spread: -6, open: -5.5, total: 51.5, modelSpread: -1.7 },
  { id: 900007, home: 145, away: 2633, ct: [21, 15], tv: "ESPN", spread: -1.5, open: -2.5, total: 61.5, modelSpread: -3.9 },
  { id: 900008, home: 254, away: 38, ct: [21, 30], tv: "FS1", spread: -9.5, open: -8.5, total: 47.5, modelSpread: -9.1 },
];

async function main() {
  const db = createServiceClient();

  console.log("Seeding season…");
  await must(
    db.from("seasons").upsert({
      id: SEASON,
      label: String(SEASON),
      week0_start: "2026-08-29",
      is_current: true,
    }),
  );

  console.log("Seeding teams…");
  await must(db.from("teams").upsert(TEAMS.map((t) => ({ ...t, classification: "fbs" }))));

  console.log("Seeding games…");
  await must(
    db.from("games").upsert(
      GAMES.map((g) => ({
        id: g.id,
        season_id: SEASON,
        week: 1,
        start_ts: kick(...g.ct),
        home_team_id: g.home,
        away_team_id: g.away,
        status: "scheduled",
        tv: g.tv,
      })),
    ),
  );

  console.log("Seeding line snapshots (open + current)…");
  for (const g of GAMES) {
    await must(
      db.from("line_snapshots").insert([
        {
          game_id: g.id,
          provider: "consensus",
          source: "fixture",
          spread: g.open,
          spread_open: g.open,
          total: g.total,
          total_open: g.total,
          captured_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
        },
        {
          game_id: g.id,
          provider: "consensus",
          source: "fixture",
          spread: g.spread,
          spread_open: g.open,
          total: g.total,
          total_open: g.total,
          captured_at: new Date().toISOString(),
        },
      ]),
    );
  }

  console.log("Seeding frozen predictions…");
  for (const g of GAMES) {
    const edge = g.modelSpread - g.spread;
    const margin = -g.modelSpread;
    await must(
      db.from("predictions").insert({
        game_id: g.id,
        model_version: `${MODEL_VERSION}-fixture`,
        frozen: true,
        spread: g.modelSpread,
        total: g.total + (Math.abs(edge) > 2 ? 3 : -1),
        home_score: (g.total + margin) / 2,
        away_score: (g.total - margin) / 2,
        home_win_prob: 1 / (1 + Math.exp(-0.145 * margin)),
        cover_prob: 0.5 + Math.min(Math.abs(edge), 6) * 0.02,
        vegas_spread: g.spread,
        edge: Math.round(edge * 10) / 10,
        edge_flag: Math.abs(edge) >= 4 ? "BIG_EDGE" : Math.abs(edge) >= 2 ? "EDGE" : null,
        consensus_flag: Math.abs(edge) >= 4,
      }),
    );
  }

  console.log("Fixtures seeded: 8 games, week 1 of 2026.");
}

async function must<T extends { error: { message: string } | null }>(p: PromiseLike<T>): Promise<T> {
  const res = await p;
  if (res.error) throw new Error(res.error.message);
  return res;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
