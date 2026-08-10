/**
 * Shared job implementations (docs/SPEC.md §8), used by the thin CLI wrappers
 * in scripts/ (scheduled via GitHub Actions) and mirrored by the edge function
 * in supabase/functions/jobs/ (the future pg_cron path).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { cfbd, type CfbdScoreboardGame } from "../../src/lib/cfbd";
import { modelClv, roundClv, spreadClv, totalClv } from "../../src/lib/clv";
import { consensusFromSnapshots } from "../../src/lib/consensus";
import { gradePick, type PickMarket } from "../../src/lib/grade";
import { buildTeamNameIndex } from "../../src/lib/rankings";
import { fetchCurrentSlate } from "../../src/lib/season";
import {
  DEFAULT_PARAMS,
  MODEL_VERSION,
  blendWithPrior,
  paramsForWeek,
  priceGame,
  priorWeight,
  splitInformative,
  updateSubRatings,
  type TeamRating,
} from "../../src/model/ratings";
import { DAY_MS, envDays, idleOverridden } from "./idle";

export const SEASON = Number(process.env.CFB_SEASON ?? 2026);
const FCS_RATING = -30;

type Json = Record<string, unknown>;

// Current slate derived from kickoffs (src/lib/season.ts) — the old
// min-scheduled-week query here could be pinned forever by one postponed-and-
// rescheduled early-season game (audit bug #8).

interface Snapshot {
  game_id: number;
  provider: string;
  spread: number | null;
  /** Only selected where the opener is needed; consensus falls back to `spread`. */
  spread_open?: number | null;
  total: number | null;
  captured_at: string;
}

/**
 * The columns every consensus read needs.
 *
 * `spread_open` matters and is easy to lose: `consensusFromSnapshots` computes
 * `open` as `spread_open ?? spread`, so a select that omits the column doesn't
 * error — it silently reports the current line as the opener, and every
 * prediction's `open_spread` becomes a copy of `vegas_spread`. Exported so a
 * test can hold the column list to that.
 */
export const SNAPSHOT_COLS = "game_id, provider, spread, spread_open, total, captured_at";

/** Shared consensus (src/lib/consensus.ts) — no more drift between the jobs'
 *  copy and the app's copy (audit #43). */
const consensus = (snapshots: Snapshot[], before?: string) =>
  consensusFromSnapshots(snapshots, before);

/**
 * A close only counts as a close if somebody captured it near kickoff. With
 * one close pass per kickoff wave (jobs.yml) the last pre-kick snapshot is
 * normally under an hour old; if the pass missed — cron skipped, kickoff moved,
 * TBD start — the newest pre-kick snapshot might be Tuesday's, and grading CLV
 * against Tuesday's line produces a plausible-looking wrong number that is
 * worse than no number. So a close older than STALE_CLOSE_MS at kickoff nulls
 * the priced fields: results still grade (they read the line *taken*, not the
 * close) and CLV stays null in the ungraded set, exactly like a game with no
 * snapshots at all.
 */
export const STALE_CLOSE_MS = 6 * 3600 * 1000;
export function closingConsensus(
  snapshots: Snapshot[],
  startTs: string | null,
  maxAgeMs: number = STALE_CLOSE_MS,
): ReturnType<typeof consensusFromSnapshots> {
  const c = consensusFromSnapshots(snapshots, startTs ?? undefined);
  if (startTs === null) return c;
  const kick = Date.parse(startTs);
  let newest = -Infinity;
  for (const s of snapshots) {
    const t = Date.parse(s.captured_at);
    if (t < kick && t > newest) newest = t;
  }
  if (kick - newest > maxAgeMs) return { ...c, spread: null, total: null, mlHome: null, mlAway: null };
  return c;
}

/**
 * Meter CFBD usage into api_call_log (one row per call — the table existed
 * since 0001 but nothing ever wrote it). The scoreboard loop throttles and
 * stops off this table, and the Crew admin panel shows the month's total.
 */
export async function logCfbdCalls(
  db: SupabaseClient,
  job: string,
  calls: number,
): Promise<void> {
  if (calls <= 0) return;
  const rows = Array.from({ length: calls }, () => ({ source: "cfbd", endpoint: job }));
  const { error } = await db.from("api_call_log").insert(rows);
  if (error) console.error(`api_call_log insert failed: ${error.message}`);
}

// ---------------------------------------------------------------------------

/** The games columns the scoreboard poll owns, as stored. */
export interface ScoreboardRow {
  id: number;
  status: string;
  home_points: number | null;
  away_points: number | null;
  current_period: number | null;
  current_clock: string | null;
  current_situation: string | null;
  last_play: string | null;
  possession: string | null;
  tv: string | null;
}

export const SCOREBOARD_COLS =
  "id, status, home_points, away_points, current_period, current_clock, current_situation, last_play, possession, tv";

/**
 * The UPDATE a scoreboard game implies, or null when the stored row already
 * says all of it. The null matters: every games UPDATE fans out as a realtime
 * message to every connected client, and an unconditional write loop re-wrote
 * every final unchanged each 30s tick — by the evening slate, finished games
 * were most of the message volume, spent broadcasting nothing.
 */
export function scoreboardPatch(
  g: CfbdScoreboardGame,
  stored: ScoreboardRow | undefined,
): Partial<ScoreboardRow> | null {
  const status =
    g.status === "in_progress" ? "in_progress" : g.status === "completed" ? "final" : "scheduled";
  if (status === "scheduled") return null;
  const inProgress = status === "in_progress";
  const patch = {
    status,
    home_points: g.homeTeam.points,
    away_points: g.awayTeam.points,
    current_period: g.period,
    current_clock: g.clock,
    // nulled once final so finished games never show a stale down-and-distance
    current_situation: inProgress ? g.situation : null,
    last_play: inProgress ? (g.lastPlay ?? null) : null,
    possession:
      inProgress && (g.possession === "home" || g.possession === "away") ? g.possession : null,
    // null TV from the board never clobbers a stored assignment
    tv: g.tv ?? stored?.tv ?? null,
  };
  if (stored && (Object.keys(patch) as Array<keyof typeof patch>).every((k) => stored[k] === patch[k]))
    return null;
  return patch;
}

/** Live scoreboard poll → games status/points/period/clock (slate live states). */
export async function scoreboardJob(db: SupabaseClient): Promise<Json> {
  const board = await cfbd.scoreboard();
  const active = board.filter((g) => g.status === "in_progress" || g.status === "completed");
  if (active.length === 0) return { live_or_final: 0, updated: 0 };

  // one read of what's stored, so unchanged games cost zero writes
  const { data: storedRows, error } = await db
    .from("games")
    .select(SCOREBOARD_COLS)
    .in("id", active.map((g) => g.id));
  if (error) throw new Error(`scoreboard: reading stored rows failed: ${error.message}`);
  const stored = new Map((storedRows as ScoreboardRow[] | null)?.map((r) => [r.id, r]) ?? []);

  let updated = 0;
  for (const g of active) {
    const patch = scoreboardPatch(g, stored.get(g.id));
    if (!patch) continue;
    const { data: touched } = await db.from("games").update(patch).eq("id", g.id).select("id");
    if (touched && touched.length > 0) updated++;
  }
  return { live_or_final: active.length, updated };
}

/**
 * Daily poll sync: AP / Coaches / CFP committee ranks (display-only context;
 * never fed to the model). CFBD returns school names, so rows that don't
 * match teams.school or teams.alt_names are reported for repair via alt_names.
 */
export async function syncRankingsJob(db: SupabaseClient): Promise<Json> {
  const KEEP = new Set(["AP Top 25", "Coaches Poll", "Playoff Committee Rankings"]);
  const weeks = await cfbd.rankings(SEASON);
  const { data: teamRows } = await db.from("teams").select("id, school, alt_names");
  const nameIndex = buildTeamNameIndex(
    (teamRows ?? []) as Array<{ id: number; school: string; alt_names: string[] | null }>,
  );

  const rows: Json[] = [];
  const unmatched = new Set<string>();
  for (const wk of weeks) {
    for (const poll of wk.polls) {
      if (!KEEP.has(poll.poll)) continue;
      for (const r of poll.ranks) {
        const teamId = nameIndex.get(r.school.toLowerCase());
        if (teamId === undefined) {
          unmatched.add(r.school);
          continue;
        }
        rows.push({
          season_id: wk.season,
          week: wk.week,
          season_type: wk.seasonType,
          poll: poll.poll,
          team_id: teamId,
          rank: r.rank,
          points: r.points,
          first_place_votes: r.firstPlaceVotes,
          fetched_at: new Date().toISOString(),
        });
      }
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("poll_rankings").upsert(rows.slice(i, i + 500), {
      onConflict: "season_id,season_type,week,poll,team_id",
    });
    if (error) throw new Error(error.message);
  }
  return { rows: rows.length, unmatched: [...unmatched] };
}

/**
 * Weekly SP+ / FPI / Elo snapshot → system_ratings (spec §2.4). Persisted so
 * the freeze job can compute a real consensus flag and the game page can show
 * the systems side by side — both previously impossible (audit #28).
 */
export async function syncSystemsJob(db: SupabaseClient): Promise<Json> {
  const { week } = await fetchCurrentSlate(db, SEASON);
  const [sp, fpi, elo, { data: teamRows }] = await Promise.all([
    cfbd.spRatings(SEASON),
    cfbd.fpiRatings(SEASON),
    cfbd.eloRatings(SEASON),
    db.from("teams").select("id, school, alt_names"),
  ]);
  const nameIndex = buildTeamNameIndex(
    (teamRows ?? []) as Array<{ id: number; school: string; alt_names: string[] | null }>,
  );

  const rows: Json[] = [];
  const unmatched = new Set<string>();
  const push = (system: string, school: string, value: number | null | undefined) => {
    if (value === null || value === undefined) return;
    const teamId = nameIndex.get(school.toLowerCase());
    if (teamId === undefined) {
      unmatched.add(school);
      return;
    }
    rows.push({
      season_id: SEASON,
      team_id: teamId,
      system,
      week,
      value,
      fetched_at: new Date().toISOString(),
    });
  };
  for (const r of sp) push("sp", r.team, r.rating);
  for (const r of fpi) push("fpi", r.team, r.fpi);
  for (const r of elo) push("elo", r.team, r.elo);

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("system_ratings").upsert(rows.slice(i, i + 500), {
      onConflict: "season_id,system,week,team_id",
    });
    if (error) throw new Error(error.message);
  }

  return { week, rows: rows.length, unmatched: [...unmatched] };
}

/** Open-Meteo forecasts for outdoor games in the next 7 days. */
/**
 * Materialise every group week whose first game has kicked off.
 *
 * `full_slate` and `conference` boards resolve live from `games` until they
 * freeze, which is what lets a game added to the schedule join the board on
 * its own. Once the week starts that has to stop, or a postponement moving a
 * game to another week would silently pull it off a board people already
 * picked. `freeze_group_week` copies the resolved list into
 * `group_week_games` and stamps `locked_at`.
 *
 * It does NOT decide whether the week is locked — `group_week_is_locked` reads
 * the clock, and `set_group_week_config` rejects edits on its own. So a missed
 * run costs materialisation, never correctness, and the function is idempotent
 * and cheap enough to call on every lines refresh.
 */
export async function freezeGroupWeeksJob(db: SupabaseClient): Promise<Json> {
  const { data: pending } = await db
    .from("group_week_config")
    .select("group_id, season_id, week, season_type")
    .is("locked_at", null);
  if (!pending || pending.length === 0) return { considered: 0, frozen: 0 };

  let frozen = 0;
  for (const c of pending as Array<{
    group_id: string;
    season_id: number;
    week: number;
    season_type: string;
  }>) {
    const { data, error } = await db.rpc("freeze_group_week", {
      p_group: c.group_id,
      p_season: c.season_id,
      p_week: c.week,
      p_season_type: c.season_type,
    });
    // A week whose first kickoff is still ahead returns false; that is the
    // normal case for most rows on most runs, not a failure.
    if (!error && data === true) frozen++;
  }
  return { considered: pending.length, frozen };
}

export async function weatherJob(db: SupabaseClient): Promise<Json> {
  const horizon = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const { data: games } = await db
    .from("games")
    .select("id, start_ts, venue_id")
    .eq("season_id", SEASON)
    .eq("status", "scheduled")
    .gt("start_ts", new Date().toISOString())
    .lte("start_ts", horizon)
    .not("venue_id", "is", null);
  if (!games || games.length === 0) return { forecasts: 0 };

  const venueIds = [...new Set(games.map((g: { venue_id: number }) => g.venue_id))];
  const [{ data: venues }, { data: overrides }] = await Promise.all([
    db.from("venues").select("id, latitude, longitude, dome").in("id", venueIds),
    db
      .from("venue_coord_overrides")
      .select("venue_id, latitude, longitude")
      .in("venue_id", venueIds),
  ]);
  const coords = new Map<number, { lat: number; lon: number; dome: boolean }>();
  for (const v of venues ?? []) {
    if (v.latitude !== null && v.longitude !== null) {
      coords.set(v.id, { lat: v.latitude, lon: v.longitude, dome: v.dome });
    }
  }
  for (const o of overrides ?? []) {
    coords.set(o.venue_id, { lat: o.latitude, lon: o.longitude, dome: false });
  }

  let forecasts = 0;
  for (const g of games as Array<{ id: number; start_ts: string; venue_id: number }>) {
    const c = coords.get(g.venue_id);
    if (!c || c.dome) continue;
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}` +
      `&hourly=temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation_probability,precipitation` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&forecast_days=7&timezone=UTC`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const wx = (await res.json()) as {
      hourly: {
        time: string[];
        temperature_2m: number[];
        wind_speed_10m: number[];
        wind_gusts_10m: number[];
        precipitation_probability: number[];
        precipitation: number[];
      };
    };
    const kickHour = g.start_ts.slice(0, 13);
    const idx = wx.hourly.time.findIndex((t) => t.startsWith(kickHour));
    if (idx === -1) continue;
    const { error } = await db.from("weather_forecasts").upsert({
      game_id: g.id,
      temp_f: wx.hourly.temperature_2m[idx],
      wind_mph: wx.hourly.wind_speed_10m[idx],
      wind_gust_mph: wx.hourly.wind_gusts_10m[idx],
      precip_prob: wx.hourly.precipitation_probability[idx],
      precip_in: wx.hourly.precipitation[idx],
      fetched_at: new Date().toISOString(),
    });
    if (!error) forecasts++;
  }
  return { forecasts };
}

/**
 * Sunday job: stateless season replay from week-0 priors over all final games
 * → blended ratings rows per week (idempotent), then grade picks/bets + CLV
 * against the closing consensus (last snapshots before kickoff).
 */
export async function ratingsUpdateJob(db: SupabaseClient): Promise<Json> {
  const { data: priorRows } = await db
    .from("ratings")
    .select("team_id, overall, offense, defense")
    .eq("season_id", SEASON)
    .eq("week", 0);
  if (!priorRows || priorRows.length === 0) throw new Error("no week-0 priors");
  const priors = new Map<number, number>();
  // Preseason halves exactly as stored: this job never re-derives them, so
  // whatever the preseason build wrote (even split, or a fitted tilt once
  // `backtest.ts --tune-preseason-tilts` earns one) carries the season.
  const priorOff = new Map<number, number>();
  const priorDef = new Map<number, number>();
  for (const r of priorRows as Array<{
    team_id: number;
    overall: number;
    offense: number | null;
    defense: number | null;
  }>) {
    const overall = Number(r.overall);
    priors.set(r.team_id, overall);
    priorOff.set(r.team_id, r.offense === null ? overall / 2 : Number(r.offense));
    priorDef.set(r.team_id, r.defense === null ? overall / 2 : Number(r.defense));
  }

  const { data: gameRows } = await db
    .from("games")
    .select(
      "id, week, home_team_id, away_team_id, home_points, away_points, neutral_site, status, start_ts",
    )
    .eq("season_id", SEASON)
    .eq("season_type", "regular")
    .order("week");
  const games = (gameRows ?? []) as Array<{
    id: number;
    week: number;
    home_team_id: number;
    away_team_id: number;
    home_points: number | null;
    away_points: number | null;
    neutral_site: boolean;
    status: string;
    start_ts: string | null;
  }>;
  const finals = games.filter(
    (g) => g.status === "final" && g.home_points !== null && g.away_points !== null,
  );

  const { data: hfaRows } = await db.from("team_hfa").select("team_id, blended_hfa");
  const hfa = new Map<number, number>(
    (hfaRows ?? []).map((r: { team_id: number; blended_hfa: number }) => [
      r.team_id,
      Number(r.blended_hfa),
    ]),
  );

  // Off/def carry the replay (§2.2) — same structure the backtest validated:
  // totals MAE beat the constant baseline (13.09 vs 13.72 over 2023–25) while
  // margins reproduced the tuned behavior (updateSubRatings' off+def deltas
  // sum to the old overall delta). Priors split evenly; results differentiate.
  const offense = new Map<number, number>(priorOff);
  const defense = new Map<number, number>(priorDef);
  const weeksPlayed = [...new Set(finals.map((g) => g.week))].sort((a, b) => a - b);
  const ratingRows: Json[] = [];
  for (const week of weeksPlayed) {
    for (const g of finals.filter((x) => x.week === week)) {
      const blended = (teamId: number): TeamRating => {
        const prior = priors.get(teamId);
        if (prior === undefined)
          return { overall: FCS_RATING, offense: FCS_RATING / 2, defense: FCS_RATING / 2, tempo: 70 };
        const pOff = priorOff.get(teamId) ?? prior / 2;
        const pDef = priorDef.get(teamId) ?? prior / 2;
        const off = blendWithPrior(pOff, offense.get(teamId) ?? pOff, week, DEFAULT_PARAMS);
        const def = blendWithPrior(pDef, defense.get(teamId) ?? pDef, week, DEFAULT_PARAMS);
        return { overall: off + def, offense: off, defense: def, tempo: 70 };
      };
      const home = blended(g.home_team_id);
      const away = blended(g.away_team_id);
      const upd = updateSubRatings(
        {
          homeOffense: home.offense,
          homeDefense: home.defense,
          awayOffense: away.offense,
          awayDefense: away.defense,
          homePoints: g.home_points as number,
          awayPoints: g.away_points as number,
          hfa: hfa.get(g.home_team_id) ?? DEFAULT_PARAMS.baseHfa,
          neutralSite: g.neutral_site,
        },
        DEFAULT_PARAMS,
      );
      if (priors.has(g.home_team_id)) {
        offense.set(g.home_team_id, (offense.get(g.home_team_id) ?? 0) + upd.homeOffDelta);
        defense.set(g.home_team_id, (defense.get(g.home_team_id) ?? 0) + upd.homeDefDelta);
      }
      if (priors.has(g.away_team_id)) {
        offense.set(g.away_team_id, (offense.get(g.away_team_id) ?? 0) + upd.awayOffDelta);
        defense.set(g.away_team_id, (defense.get(g.away_team_id) ?? 0) + upd.awayDefDelta);
      }
    }
    const nextWeek = week + 1;
    for (const [teamId, prior] of priors) {
      const pOff = priorOff.get(teamId) ?? prior / 2;
      const pDef = priorDef.get(teamId) ?? prior / 2;
      const off = blendWithPrior(pOff, offense.get(teamId) ?? pOff, nextWeek, DEFAULT_PARAMS);
      const def = blendWithPrior(pDef, defense.get(teamId) ?? pDef, nextWeek, DEFAULT_PARAMS);
      ratingRows.push({
        season_id: SEASON,
        team_id: teamId,
        week: nextWeek,
        overall: Math.round((off + def) * 100) / 100,
        offense: Math.round(off * 100) / 100,
        defense: Math.round(def * 100) / 100,
        tempo: 70,
        prior_weight: Math.round(priorWeight(nextWeek, DEFAULT_PARAMS) * 1000) / 1000,
        model_version: MODEL_VERSION,
      });
    }
  }
  for (let i = 0; i < ratingRows.length; i += 500) {
    const { error } = await db
      .from("ratings")
      .upsert(ratingRows.slice(i, i + 500), { onConflict: "season_id,team_id,week" });
    if (error) throw new Error(error.message);
  }

  // ---- Grading + CLV ----
  const finalIds = finals.map((g) => g.id);
  let picksGraded = 0;
  let betsGraded = 0;
  let predictionsGraded = 0;
  if (finalIds.length > 0) {
    const gameById = new Map(finals.map((g) => [g.id, g]));
    const { data: snaps } = await db
      .from("line_snapshots")
      .select(SNAPSHOT_COLS)
      .in("game_id", finalIds);
    const snapsByGame = new Map<number, Snapshot[]>();
    for (const s of (snaps ?? []) as Snapshot[]) {
      const arr = snapsByGame.get(s.game_id) ?? [];
      arr.push(s);
      snapsByGame.set(s.game_id, arr);
    }
    const closing = (gameId: number) => {
      const g = gameById.get(gameId);
      return closingConsensus(snapsByGame.get(gameId) ?? [], g?.start_ts ?? null);
    };

    // Model CLV. The leans are published as information rather than bets, so
    // the ATS column can't carry the model's scoreboard on its own — CLV asks
    // the better question (did the market come to us after we committed?) and
    // converges on a single season where a win rate does not.
    //
    // Only frozen rows, and only ones not yet graded: predictions is
    // append-only history, and re-grading would rewrite a receipt. The two
    // prediction fields written here didn't exist at freeze time; every number
    // the model committed to stays exactly as it was stored.
    const { data: preds } = await db
      .from("predictions")
      .select("id, game_id, edge, vegas_spread")
      .eq("frozen", true)
      .in("game_id", finalIds)
      .is("clv", null);
    for (const p of (preds ?? []) as Array<{
      id: number;
      game_id: number;
      edge: number | null;
      vegas_spread: number | null;
    }>) {
      const close = closing(p.game_id).spread;
      // No closing line means nothing to measure. Leave clv null so the row
      // stays in the ungraded set and a later lines backfill can still catch
      // it, rather than banking a 0 that reads as "dead even".
      if (close === null) continue;
      const clv = modelClv(
        p.edge === null ? null : Number(p.edge),
        p.vegas_spread === null ? null : Number(p.vegas_spread),
        close,
      );
      if (clv === null) continue;
      const { error } = await db
        .from("predictions")
        .update({ clv: roundClv(clv), close_spread: close })
        .eq("id", p.id);
      if (!error) predictionsGraded++;
    }

    const { data: picks } = await db
      .from("picks")
      .select("id, game_id, market, side, line_at_pick, result")
      .in("game_id", finalIds)
      .is("result", null);
    for (const p of picks ?? []) {
      const g = gameById.get(p.game_id)!;
      const line = Number(p.line_at_pick);
      const close = closing(p.game_id);
      const result = gradePick(
        p.market as PickMarket,
        p.side,
        p.line_at_pick === null ? null : line,
        g.home_points as number,
        g.away_points as number,
      );
      // A row the grader cannot settle stays ungraded rather than banking a
      // guess; the check constraint in 0021 should keep this unreachable.
      if (result === null) continue;

      // Straight-up takes no number, so there is nothing to compare a close to.
      let clv: number | null = null;
      if (p.market === "spread" && close.spread !== null) {
        clv = roundClv(spreadClv(p.side as "home" | "away", line, close.spread));
      } else if (p.market === "total" && close.total !== null) {
        clv = roundClv(totalClv(p.side as "over" | "under", line, close.total));
      }

      const { error } = await db.from("picks").update({ result, clv }).eq("id", p.id);
      if (!error) picksGraded++;
    }

    const { data: bets } = await db
      .from("bets")
      .select("id, game_id, bet_type, side, line_taken, odds, units, result")
      .in("game_id", finalIds)
      .is("result", null)
      .is("voided_at", null);
    for (const b of bets ?? []) {
      // A moneyline bet has no line to take, so `line_taken` being null is
      // normal for it rather than a reason to skip. It used to be caught by
      // this guard and sat ungraded forever, quietly missing from the ledger's
      // record and units.
      if (!b.side) continue;
      const g = gameById.get(b.game_id)!;
      const margin = (g.home_points as number) - (g.away_points as number);
      const total = (g.home_points as number) + (g.away_points as number);
      const line = b.line_taken === null ? null : Number(b.line_taken);
      const close = closing(b.game_id);
      let result: string | null = null;
      let clv: number | null = null;
      let closingLine: number | null = null;
      if (b.bet_type === "spread" && line !== null && (b.side === "home" || b.side === "away")) {
        const coverMargin = b.side === "home" ? margin + line : -margin - line;
        result = coverMargin > 0 ? "win" : coverMargin < 0 ? "loss" : "push";
        closingLine = close.spread;
        if (close.spread !== null) clv = roundClv(spreadClv(b.side, line, close.spread));
      } else if (
        b.bet_type === "total" &&
        line !== null &&
        (b.side === "over" || b.side === "under")
      ) {
        const diff = b.side === "over" ? total - line : line - total;
        result = diff > 0 ? "win" : diff < 0 ? "loss" : "push";
        closingLine = close.total;
        if (close.total !== null) clv = roundClv(totalClv(b.side, line, close.total));
      } else if (b.bet_type === "moneyline" && (b.side === "home" || b.side === "away")) {
        // Who won, full stop. CLV on a moneyline is measured in cents against a
        // closing price we do not capture — spec §5.3 — so it stays null rather
        // than being invented from the spread.
        result = margin === 0 ? "push" : (margin > 0) === (b.side === "home") ? "win" : "loss";
      }
      if (result === null) continue;
      const units = Number(b.units);
      const odds = Number(b.odds);
      // Correct for any American price, which is what makes a +2500 moneyline
      // pay what it should rather than -110.
      const win = odds > 0 ? units * (odds / 100) : units * (100 / -odds);
      const payout = result === "win" ? win : result === "loss" ? -units : 0;
      const { error } = await db
        .from("bets")
        .update({
          result,
          clv,
          closing_line: closingLine,
          payout_units: Math.round(payout * 100) / 100,
        })
        .eq("id", b.id);
      if (!error) betsGraded++;
    }
  }

  return {
    weeks: weeksPlayed.length,
    ratingRows: ratingRows.length,
    picksGraded,
    betsGraded,
    predictionsGraded,
  };
}

/**
 * Thursday job: freeze predictions for the upcoming week (receipts), pricing
 * with current ratings + team HFA + admin-CONFIRMED rating adjustments.
 */
export async function freezeJob(db: SupabaseClient): Promise<Json> {
  const { week, seasonType } = await fetchCurrentSlate(db, SEASON);

  const { data: gameRows } = await db
    .from("games")
    .select("id, home_team_id, away_team_id, neutral_site, status, start_ts")
    .eq("season_id", SEASON)
    .eq("week", week)
    .eq("season_type", seasonType)
    .eq("status", "scheduled");
  const games = (gameRows ?? []) as Array<{
    id: number;
    home_team_id: number;
    away_team_id: number;
    neutral_site: boolean;
    start_ts: string | null;
  }>;
  if (games.length === 0) return { week, frozen: 0 };

  // A freeze is a Thursday-night receipt for THIS week's slate. The cron fires
  // every Friday 03:00 UTC year-round, so without a horizon each August
  // Thursday would append a full week-1 batch priced off mid-August lines —
  // predictions is append-only, so those batches are permanent clutter on the
  // receipts page even though the latest-first read hides them.
  const horizonDays = envDays("FREEZE_HORIZON_DAYS", 8);
  const kickoffs = games
    .map((g) => (g.start_ts ? new Date(g.start_ts).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  if (!idleOverridden() && kickoffs.length > 0) {
    const days = (Math.min(...kickoffs) - Date.now()) / DAY_MS;
    if (days > horizonDays) {
      return {
        week,
        frozen: 0,
        skipped: `kickoff_gt_${horizonDays}d`,
        days_to_kickoff: Math.round(days * 10) / 10,
      };
    }
  }

  const { data: ratingRows } = await db
    .from("ratings")
    .select("team_id, week, overall, offense, defense")
    .eq("season_id", SEASON)
    .order("week", { ascending: false });
  const latest = new Map<number, { overall: number; offense: number; defense: number }>();
  for (const r of ratingRows ?? []) {
    if (!latest.has(r.team_id)) {
      latest.set(r.team_id, {
        overall: Number(r.overall),
        offense: Number(r.offense ?? Number(r.overall) / 2),
        defense: Number(r.defense ?? Number(r.overall) / 2),
      });
    }
  }

  const [{ data: hfaRows }, { data: adjRows }, { data: snaps }, { data: systemRows }] =
    await Promise.all([
      db.from("team_hfa").select("team_id, blended_hfa"),
      db
        .from("rating_adjustments")
        .select("team_id, game_id, points")
        .eq("season_id", SEASON)
        .not("confirmed_at", "is", null),
      db
        .from("line_snapshots")
        .select(SNAPSHOT_COLS)
        .in(
          "game_id",
          games.map((g) => g.id),
        ),
      db
        .from("system_ratings")
        .select("team_id, system, week, value")
        .eq("season_id", SEASON)
        .order("week", { ascending: false }),
    ]);
  const hfa = new Map<number, number>(
    (hfaRows ?? []).map((r: { team_id: number; blended_hfa: number }) => [
      r.team_id,
      Number(r.blended_hfa),
    ]),
  );
  const snapsByGame = new Map<number, Snapshot[]>();
  for (const s of (snaps ?? []) as Snapshot[]) {
    const arr = snapsByGame.get(s.game_id) ?? [];
    arr.push(s);
    snapsByGame.set(s.game_id, arr);
  }
  const adjFor = (teamId: number, gameId: number) =>
    (adjRows ?? [])
      .filter(
        (a: { team_id: number; game_id: number | null }) =>
          a.team_id === teamId && (a.game_id === null || a.game_id === gameId),
      )
      .reduce((s: number, a: { points: number }) => s + Number(a.points), 0);

  // latest system value per (system, team) → margins for the consensus flag
  const systems = new Map<string, number>();
  for (const r of (systemRows ?? []) as Array<{ team_id: number; system: string; value: number }>) {
    const key = `${r.system}:${r.team_id}`;
    if (!systems.has(key)) systems.set(key, Number(r.value));
  }
  const sysMargin = (system: "sp" | "fpi" | "elo", homeId: number, awayId: number): number | null => {
    const h = systems.get(`${system}:${homeId}`);
    const a = systems.get(`${system}:${awayId}`);
    if (h === undefined || a === undefined) return null;
    // Elo is not points-scale; ~25 Elo ≈ 1 point of margin
    return system === "elo" ? (h - a) / 25 : h - a;
  };

  // A pure even off/def split prices every total at the league baseline —
  // only store totals when at least some teams carry a real split. Shared with
  // the preseason builder so the two write paths can't drift (src/model).
  const totalsAreReal = splitInformative([...latest.values()]);

  // Early-season pricing widens sigma (and softens the win-prob slope) while
  // the preseason prior is still doing the work — identity until fit.
  const params = paramsForWeek(week, DEFAULT_PARAMS);

  const rows: Json[] = [];
  for (const g of games) {
    const homeR = latest.get(g.home_team_id);
    const awayR = latest.get(g.away_team_id);
    if (homeR === undefined && awayR === undefined) continue;
    const rating = (r: { overall: number; offense: number; defense: number } | undefined): TeamRating => ({
      overall: r?.overall ?? FCS_RATING,
      offense: r?.offense ?? FCS_RATING / 2,
      defense: r?.defense ?? FCS_RATING / 2,
      tempo: 70,
    });
    const situational = adjFor(g.home_team_id, g.id) - adjFor(g.away_team_id, g.id);
    const vegas = consensus(snapsByGame.get(g.id) ?? []);
    const price = priceGame(
      {
        home: rating(homeR),
        away: rating(awayR),
        homeTeamHfa: hfa.get(g.home_team_id) ?? DEFAULT_PARAMS.baseHfa,
        neutralSite: g.neutral_site,
        situationalPoints: situational,
        vegasSpread: vegas.spread,
        // real inputs for the consensus flag (spec §2.4) — previously never
        // passed, so the flag could only ever be false
        spPlusMargin: sysMargin("sp", g.home_team_id, g.away_team_id),
        fpiMargin: sysMargin("fpi", g.home_team_id, g.away_team_id),
        eloMargin: sysMargin("elo", g.home_team_id, g.away_team_id),
      },
      params,
    );
    rows.push({
      game_id: g.id,
      season_id: SEASON,
      model_version: MODEL_VERSION,
      frozen: true,
      spread: Math.round(price.spread * 10) / 10,
      // Totals are real when the off/def split carries information (2023–25
      // calibration: model MAE 13.09 vs constant 13.72). With a pure even
      // split (preseason, no results yet) every total is the league
      // baseline — store null rather than a constant dressed as a prediction.
      // O/U leans stay unflagged either way (50.8%/51.9% < the 52.4% vig).
      total: totalsAreReal ? Math.round(price.projectedTotal * 10) / 10 : null,
      home_score: totalsAreReal ? Math.round(price.projectedHomeScore * 10) / 10 : null,
      away_score: totalsAreReal ? Math.round(price.projectedAwayScore * 10) / 10 : null,
      home_win_prob: Math.round(price.homeWinProb * 10000) / 10000,
      cover_prob:
        price.homeCoverProb !== null ? Math.round(price.homeCoverProb * 10000) / 10000 : null,
      vegas_spread: vegas.spread,
      // The opener is context for the receipt, not the number the model was
      // graded against — CLV measures vegas_spread (what was on the board at
      // freeze) against the close. Storing it here means the movement is
      // readable later without re-deriving it from line_snapshots.
      open_spread: vegas.open,
      edge: price.edge !== null ? Math.round(price.edge * 10) / 10 : null,
      edge_flag: price.edgeFlag,
      consensus_flag: price.consensusFlag,
      adjustments: { situational },
    });
  }
  if (rows.length > 0) {
    const { error } = await db.from("predictions").insert(rows);
    if (error) throw new Error(error.message);
  }
  return { week, frozen: rows.length };
}
