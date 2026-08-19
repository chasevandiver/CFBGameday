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

import { cfbd, cfbdCallCount, type CfbdGame, type CfbdLine } from "../../src/lib/cfbd";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeProvider } from "../../src/lib/providers";
import { chunk } from "./ingest";
import { logCfbdCalls, syncRankingsFor } from "./jobs-core";
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
  /* Conference AT KICKOFF (migration 0067). Always present, null when CFBD
     omits it — `undefined` would mean "leave the column alone" to PostgREST,
     which is a different statement from "we do not know". */
  home_conference: string | null;
  away_conference: string | null;
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
      home_conference: g.homeConference ?? null,
      away_conference: g.awayConference ?? null,
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

/* ---- BF-3: the archive's lines and polls --------------------------------
 *
 * `backfill-games` lands games and nothing else, and that gap has already cost
 * one feature: Guess the Game's "closing spread" clue was a shrug on every
 * puzzle because `line_snapshots` held nothing before 2026, and GTG-5 deleted
 * the rung rather than fix the data. The replacement games all want the market
 * and the polls — "who was favoured", "did it cover", "were they ranked" are
 * the questions that make a history puzzle a football question instead of a
 * memory test — so the archive has to carry them.
 *
 * Both endpoints are SEASON-SCOPED (`cfbd.lines(year)`, `cfbd.rankings(year)`):
 * one call each per season, so widening to 2015 costs about sixteen calls
 * against a 30,000/mo budget. Like `backfill-games`, both are dispatch-only —
 * a finished season does not change, so there is no cadence, no cron entry and
 * no watchdog lane.
 */

/** Where a reconstructed line comes from. Never `'cfbd'` — see below. */
export const BACKFILL_LINE_SOURCE = "cfbd-backfill";

/**
 * How long before kickoff a reconstructed snapshot claims to have been taken.
 *
 * **This constant is the whole job.** The closing line is defined as the last
 * snapshot with `captured_at < games.start_ts` (`consensusFromSnapshots`'s
 * `before` argument, `src/lib/consensus.ts`). CFBD's historical `/lines` feed
 * carries no capture time, so one has to be chosen, and the obvious choice —
 * the column default, `now()` — is YEARS AFTER kickoff for a 2015 game. Every
 * backfilled line would then be invisible to every closing-line reader, the
 * archive would look like it had no market data at all, and it would present
 * as a CFBD coverage problem rather than as a bug here.
 *
 * An hour rather than a second so a REAL observation still wins. `refresh-lines
 * --burst` captures inside 90 minutes of kickoff, so on any game where both a
 * real snapshot and a reconstruction exist, the real one is later and takes
 * the "last before kickoff" slot. That is the right precedence: an observation
 * beats a reconstruction.
 */
export const BACKFILL_CAPTURE_LEAD_MS = 60 * 60 * 1000;

export interface BackfillSnapshotRow {
  game_id: number;
  provider: string;
  source: string;
  spread: number | null;
  spread_open: number | null;
  total: number | null;
  total_open: number | null;
  ml_home: number | null;
  ml_away: number | null;
  captured_at: string;
}

/**
 * Pure: CFBD lines → snapshot rows, plus what was dropped and why.
 *
 * Signs pass through untouched. CFBD's `/lines` spread is already
 * home-perspective with negative meaning the home team is favoured, which is
 * the convention every reader in this codebase assumes
 * (`src/lib/bet-line-convention.test.ts`) — so the correct amount of
 * arithmetic here is none, and the test asserts that rather than trusting it.
 *
 * A game with no kickoff produces NO snapshot. There is no defensible
 * `captured_at` without a `start_ts` to subtract from, and a row whose capture
 * time is a guess is worse than a missing row — the same discipline
 * `backfillRows` applies to `droppedNoKickoff`.
 *
 * An entry with neither a spread nor a total is also dropped: it is a provider
 * row with no market in it, and storing it would only dilute the consensus
 * mean with nulls.
 */
export function backfillSnapshotRows(
  lines: CfbdLine[],
  startTsById: Map<number, string | null>,
): { rows: BackfillSnapshotRow[]; droppedNoKickoff: number; droppedNoMarket: number } {
  const rows: BackfillSnapshotRow[] = [];
  let droppedNoKickoff = 0;
  let droppedNoMarket = 0;

  for (const game of lines) {
    const startTs = startTsById.get(game.id);
    if (startTs === undefined || startTs === null) {
      droppedNoKickoff += game.lines.length;
      continue;
    }
    const kickoff = Date.parse(startTs);
    if (!Number.isFinite(kickoff)) {
      droppedNoKickoff += game.lines.length;
      continue;
    }
    const capturedAt = new Date(kickoff - BACKFILL_CAPTURE_LEAD_MS).toISOString();

    for (const l of game.lines) {
      if (l.spread === null && l.overUnder === null) {
        droppedNoMarket += 1;
        continue;
      }
      rows.push({
        game_id: game.id,
        provider: normalizeProvider(l.provider),
        source: BACKFILL_LINE_SOURCE,
        spread: l.spread,
        spread_open: l.spreadOpen,
        total: l.overUnder,
        total_open: l.overUnderOpen,
        ml_home: l.homeMoneyline,
        ml_away: l.awayMoneyline,
        captured_at: capturedAt,
      });
    }
  }
  return { rows, droppedNoKickoff, droppedNoMarket };
}

/**
 * Seasons this job will consider, for lines and polls.
 *
 * Same rule as `backfillTargets` and same reason: CFB, never the season being
 * played. The live season's lines belong to `refresh-lines`, which observes
 * them as they move; reconstructing them from a season-wide pull would drop a
 * synthetic row an hour before every kickoff and step on real observations.
 */
const pastCfbSeasons = backfillTargets;

/**
 * `backfill-lines` — the archive's market, one season-scoped call at a time.
 *
 * Idempotent by DELETE-then-INSERT, scoped to this job's own `source`.
 * `line_snapshots` is append-only for members but the service role can still
 * delete, and re-running must not double the rows: a second reconstruction of
 * the same game would put two identical snapshots one hour before kickoff and
 * make the provider consensus count that book twice. Only
 * `source = 'cfbd-backfill'` rows are removed, so a real observation is never
 * touched by a re-run — which is the other half of why the source string is
 * its own value rather than `'cfbd'`.
 */
export async function backfillLinesJob(db: SupabaseClient): Promise<Record<string, unknown>> {
  const targets = await pastCfbSeasons(db);
  if (targets.length === 0) return { skipped: "no past cfb seasons — apply migration 0067" };

  const perSeason: Record<string, unknown> = {};
  let total = 0;

  for (const seasonId of targets) {
    /* The kickoff map is the reason this reads games first: `captured_at` is
       derived from `start_ts`, so a line for a game we never landed (an FCS
       opponent the backfill dropped) has nothing to anchor to and is skipped
       by `backfillSnapshotRows` rather than inserted against a missing FK. */
    const { data: gameRows, error: gameErr } = await db
      .from("games")
      .select("id, start_ts")
      .eq("season_id", seasonId);
    if (gameErr) throw new Error(`backfill-lines: ${seasonId} games read failed: ${gameErr.message}`);
    const startTsById = new Map(
      ((gameRows ?? []) as Array<{ id: number; start_ts: string | null }>).map((g) => [
        g.id,
        g.start_ts,
      ]),
    );
    if (startTsById.size === 0) {
      perSeason[seasonId] = { skipped: "no games — run backfill-games first" };
      continue;
    }

    const [regular, postseason] = await Promise.all([
      cfbd.lines(seasonId),
      cfbd.lines(seasonId, { seasonType: "postseason" }),
    ]);
    const { rows, droppedNoKickoff, droppedNoMarket } = backfillSnapshotRows(
      [...regular, ...postseason],
      startTsById,
    );

    const { error: delErr } = await db
      .from("line_snapshots")
      .delete()
      .eq("source", BACKFILL_LINE_SOURCE)
      .in("game_id", [...startTsById.keys()]);
    if (delErr) throw new Error(`backfill-lines: ${seasonId} cleanup failed: ${delErr.message}`);

    for (const batch of chunk(rows, 500)) {
      const { error } = await db.from("line_snapshots").insert(batch);
      if (error) throw new Error(`backfill-lines: ${seasonId} insert failed: ${error.message}`);
    }

    total += rows.length;
    perSeason[seasonId] = {
      snapshots: rows.length,
      games: new Set(rows.map((r) => r.game_id)).size,
      ...(droppedNoKickoff > 0 ? { dropped_no_kickoff: droppedNoKickoff } : {}),
      ...(droppedNoMarket > 0 ? { dropped_no_market: droppedNoMarket } : {}),
    };
  }

  await logCfbdCalls(db, "backfill-lines", cfbdCallCount());
  return { total, seasons: perSeason };
}

/**
 * `backfill-rankings` — the archive's polls.
 *
 * Thin by design: `syncRankingsFor` already owns the KEEP set, the team
 * name-index and the upsert conflict target, and it is idempotent because
 * `poll_rankings` is keyed on `(season, season_type, week, poll, team)`. This
 * only picks the seasons.
 */
export async function backfillRankingsJob(db: SupabaseClient): Promise<Record<string, unknown>> {
  const targets = await pastCfbSeasons(db);
  if (targets.length === 0) return { skipped: "no past cfb seasons — apply migration 0067" };

  const perSeason: Record<string, unknown> = {};
  for (const seasonId of targets) {
    perSeason[seasonId] = await syncRankingsFor(db, seasonId);
  }
  await logCfbdCalls(db, "backfill-rankings", cfbdCallCount());
  return { seasons: perSeason };
}
