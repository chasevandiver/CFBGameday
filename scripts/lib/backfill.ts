/**
 * `backfill-games` — past CFB seasons, so the daily puzzle has a deck.
 *
 * ## Why this exists
 *
 * Guess the Game picks its puzzle from completed CFB games. The route named
 * seasons 2023–25 in a literal; those seasons were never ingested into this
 * database, so the deck was empty and the page said "no puzzle today" every
 * day from the moment R2-C3 shipped. The route now discovers seasons instead
 * of naming them (`src/app/api/guess-game/route.ts`), and migration 0063 adds
 * the season rows. This is the job that lands the games.
 *
 * ## Dispatch-only, on purpose — there is no cron
 *
 * A finished season does not change. Re-pulling three of them on a schedule
 * would spend CFBD calls to learn nothing, so this is in the `workflow_dispatch`
 * list and nowhere near the `schedule:` block. That is also why it carries no
 * watchdog lane: a job with no cadence cannot be late, and `watchdogVerdict`
 * would have to invent a horizon for it.
 *
 * ## Two things it deliberately refuses to touch
 *
 *   * **`seasons`.** `scripts/sync-reference.ts:17` hardcodes `is_current:
 *     true` and `week0_start: '2026-08-29'`, so pointing the reference sync at
 *     a past season would give 2024 the wrong Week 0 AND steal the live
 *     pointer out from under `fetchCurrentSeasonWeek`. The season rows come
 *     from migration 0063 with real dates and `is_current` false; this job
 *     only reads them.
 *   * **Teams it does not already know.** `games.home_team_id` references
 *     `teams(id)`, and a 2023 FCS opponent that never played an FBS team in
 *     2026 is not in that table. Rather than widen the reference sync (which
 *     would re-open the `is_current` problem above), such games are DROPPED
 *     and counted. A puzzle deck does not need the Week 2 buy game, and a
 *     silent FK failure mid-batch would leave a season half-loaded.
 */

import { cfbd, cfbdCallCount, type CfbdGame } from "../../src/lib/cfbd";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk } from "./ingest";
import { logCfbdCalls } from "./jobs-core";
import { resolvedWeek, weekZeroIds } from "./weeks";

export interface BackfillRow {
  id: number;
  season_id: number;
  week: number;
  season_type: string;
  start_ts: string;
  neutral_site: boolean;
  conference_game: boolean;
  venue_id: number | null;
  home_team_id: number;
  away_team_id: number;
  home_points: number | null;
  away_points: number | null;
  status?: string;
  notes: string | null;
}

/**
 * Pure: CFBD games → rows to upsert, plus what was dropped and why.
 *
 * `status` is set only on completed games, the same asymmetry `sync-games`
 * keeps: a row that is not final takes the schema default rather than being
 * asserted back to `scheduled`. For a finished season this is academic; it
 * matters if somebody ever points this at the season in progress.
 */
export function backfillRows(
  games: CfbdGame[],
  seasonId: number,
  knownTeamIds: Set<number>,
): { rows: BackfillRow[]; droppedUnknownTeam: number; droppedNoKickoff: number } {
  const weekZero = weekZeroIds(games);
  const rows: BackfillRow[] = [];
  let droppedUnknownTeam = 0;
  let droppedNoKickoff = 0;

  for (const g of games) {
    if (!knownTeamIds.has(g.homeId) || !knownTeamIds.has(g.awayId)) {
      droppedUnknownTeam++;
      continue;
    }
    // `start_ts` is how every downstream surface orders a game, and the puzzle
    // hints quote the week. A row with no kickoff is not worth the FK.
    if (!g.startDate) {
      droppedNoKickoff++;
      continue;
    }
    rows.push({
      id: g.id,
      season_id: seasonId,
      week: resolvedWeek(g, weekZero),
      season_type: g.seasonType,
      start_ts: g.startDate,
      neutral_site: g.neutralSite,
      conference_game: g.conferenceGame,
      venue_id: g.venueId,
      home_team_id: g.homeId,
      away_team_id: g.awayId,
      home_points: g.homePoints,
      away_points: g.awayPoints,
      ...(g.completed ? { status: "final" } : {}),
      notes: g.notes,
    });
  }
  return { rows, droppedUnknownTeam, droppedNoKickoff };
}

/** Seasons this job will consider: CFB, and never the one being played. */
export async function backfillTargets(db: SupabaseClient): Promise<number[]> {
  const { data, error } = await db
    .from("seasons")
    .select("id, sport, is_current")
    .eq("sport", "cfb")
    .eq("is_current", false)
    .order("id");
  if (error) throw new Error(`backfill-games: seasons read failed: ${error.message}`);
  return ((data ?? []) as Array<{ id: number }>).map((s) => s.id);
}

export async function backfillGamesJob(db: SupabaseClient): Promise<Record<string, unknown>> {
  const force = process.argv.includes("--force");
  const targets = await backfillTargets(db);
  if (targets.length === 0) return { skipped: "no past cfb seasons — apply migration 0063" };

  const { data: teamRows, error: teamErr } = await db.from("teams").select("id");
  if (teamErr) throw new Error(`backfill-games: teams read failed: ${teamErr.message}`);
  const known = new Set(((teamRows ?? []) as Array<{ id: number }>).map((t) => t.id));

  const perSeason: Record<string, unknown> = {};
  let total = 0;

  for (const seasonId of targets) {
    // Idempotence without the CFBD bill: a season already loaded is skipped
    // unless --force. Re-running the whole set to pick up one correction
    // should not cost three seasons of calls.
    const { count } = await db
      .from("games")
      .select("id", { count: "exact", head: true })
      .eq("season_id", seasonId);
    if ((count ?? 0) > 0 && !force) {
      perSeason[seasonId] = { skipped: `already has ${count} games — pass --force to re-pull` };
      continue;
    }

    const [regular, postseason] = await Promise.all([
      cfbd.games(seasonId),
      cfbd.games(seasonId, { seasonType: "postseason" }),
    ]);
    const { rows, droppedUnknownTeam, droppedNoKickoff } = backfillRows(
      [...regular, ...postseason],
      seasonId,
      known,
    );

    // Same reason `sync-games` groups before sending: PostgREST bulk rows must
    // share a column set, and `status` is present only on finals.
    const byShape = new Map<string, BackfillRow[]>();
    for (const r of rows) {
      const shape = Object.keys(r).sort().join(",");
      const arr = byShape.get(shape) ?? [];
      arr.push(r);
      byShape.set(shape, arr);
    }
    for (const group of byShape.values()) {
      for (const batch of chunk(group, 500)) {
        const { error } = await db.from("games").upsert(batch);
        if (error) throw new Error(`backfill-games: ${seasonId} upsert failed: ${error.message}`);
      }
    }

    total += rows.length;
    perSeason[seasonId] = {
      games: rows.length,
      finals: rows.filter((r) => r.status === "final").length,
      ...(droppedUnknownTeam > 0 ? { dropped_unknown_team: droppedUnknownTeam } : {}),
      ...(droppedNoKickoff > 0 ? { dropped_no_kickoff: droppedNoKickoff } : {}),
    };
  }

  await logCfbdCalls(db, "backfill-games", cfbdCallCount());
  return { total, seasons: perSeason };
}
