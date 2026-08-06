/**
 * Shared job implementations (docs/SPEC.md §8), used by the thin CLI wrappers
 * in scripts/ (scheduled via GitHub Actions) and mirrored by the edge function
 * in supabase/functions/jobs/ (the future pg_cron path).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { cfbd } from "../../src/lib/cfbd";
import { buildTeamNameIndex } from "../../src/lib/rankings";
import {
  DEFAULT_PARAMS,
  MODEL_VERSION,
  blendWithPrior,
  priceGame,
  priorWeight,
  updateFromResult,
  type TeamRating,
} from "../../src/model/ratings";

export const SEASON = 2026;
const FCS_RATING = -30;

type Json = Record<string, unknown>;

async function currentWeek(db: SupabaseClient): Promise<number | undefined> {
  const { data } = await db
    .from("games")
    .select("week")
    .eq("season_id", SEASON)
    .eq("status", "scheduled")
    .order("week")
    .limit(1)
    .maybeSingle();
  return data?.week;
}

interface Snapshot {
  game_id: number;
  provider: string;
  spread: number | null;
  total: number | null;
  captured_at: string;
}

/**
 * Latest snapshot per provider (optionally before a cutoff), averaged and
 * snapped to the half point — books only hang lines in 0.5 increments.
 */
function consensus(
  snapshots: Snapshot[],
  before?: string,
): { spread: number | null; total: number | null } {
  const latest = new Map<string, Snapshot>();
  for (const s of snapshots) {
    if (before && s.captured_at >= before) continue;
    const prev = latest.get(s.provider);
    if (!prev || s.captured_at > prev.captured_at) latest.set(s.provider, s);
  }
  const avg = (vals: Array<number | null>) => {
    const nums = vals.filter((v): v is number => v !== null);
    return nums.length
      ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 2) / 2
      : null;
  };
  const rows = [...latest.values()];
  return { spread: avg(rows.map((s) => s.spread)), total: avg(rows.map((s) => s.total)) };
}

// ---------------------------------------------------------------------------

/** Live scoreboard poll → games status/points/period/clock (slate live states). */
export async function scoreboardJob(db: SupabaseClient): Promise<Json> {
  const board = await cfbd.scoreboard();
  let updated = 0;
  for (const g of board) {
    const status =
      g.status === "in_progress" ? "in_progress" : g.status === "completed" ? "final" : "scheduled";
    if (status === "scheduled") continue;
    const inProgress = status === "in_progress";
    const { data: touched } = await db
      .from("games")
      .update({
        status,
        home_points: g.homeTeam.points,
        away_points: g.awayTeam.points,
        current_period: g.period,
        current_clock: g.clock,
        // nulled once final so finished games never show a stale down-and-distance
        current_situation: inProgress ? g.situation : null,
        last_play: inProgress ? (g.lastPlay ?? null) : null,
        possession:
          inProgress && (g.possession === "home" || g.possession === "away")
            ? g.possession
            : null,
        tv: g.tv ?? undefined,
      })
      .eq("id", g.id)
      .select("id");
    if (touched && touched.length > 0) updated++;
  }
  return { live_or_final: updated };
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

/** Open-Meteo forecasts for outdoor games in the next 7 days. */
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
    .select("team_id, overall")
    .eq("season_id", SEASON)
    .eq("week", 0);
  if (!priorRows || priorRows.length === 0) throw new Error("no week-0 priors");
  const priors = new Map<number, number>(
    priorRows.map((r: { team_id: number; overall: number }) => [r.team_id, Number(r.overall)]),
  );

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

  const results = new Map<number, number>(priors);
  const weeksPlayed = [...new Set(finals.map((g) => g.week))].sort((a, b) => a - b);
  const ratingRows: Json[] = [];
  for (const week of weeksPlayed) {
    for (const g of finals.filter((x) => x.week === week)) {
      const blended = (teamId: number): number => {
        const prior = priors.get(teamId);
        if (prior === undefined) return FCS_RATING;
        return blendWithPrior(prior, results.get(teamId) ?? prior, week, DEFAULT_PARAMS);
      };
      const rating = (overall: number): TeamRating => ({
        overall,
        offense: overall / 2,
        defense: overall / 2,
        tempo: 70,
      });
      const price = priceGame(
        {
          home: rating(blended(g.home_team_id)),
          away: rating(blended(g.away_team_id)),
          homeTeamHfa: hfa.get(g.home_team_id) ?? DEFAULT_PARAMS.baseHfa,
          neutralSite: g.neutral_site,
          situationalPoints: 0,
          vegasSpread: null,
        },
        DEFAULT_PARAMS,
      );
      const upd = updateFromResult(
        {
          homeRating: results.get(g.home_team_id) ?? FCS_RATING,
          awayRating: results.get(g.away_team_id) ?? FCS_RATING,
          predictedMargin: price.margin,
          actualHomeMargin: (g.home_points as number) - (g.away_points as number),
        },
        DEFAULT_PARAMS,
      );
      if (priors.has(g.home_team_id)) {
        results.set(g.home_team_id, (results.get(g.home_team_id) ?? 0) + upd.homeDelta);
      }
      if (priors.has(g.away_team_id)) {
        results.set(g.away_team_id, (results.get(g.away_team_id) ?? 0) + upd.awayDelta);
      }
    }
    const nextWeek = week + 1;
    for (const [teamId, prior] of priors) {
      const blended = blendWithPrior(prior, results.get(teamId) ?? prior, nextWeek, DEFAULT_PARAMS);
      ratingRows.push({
        season_id: SEASON,
        team_id: teamId,
        week: nextWeek,
        overall: Math.round(blended * 100) / 100,
        offense: Math.round((blended / 2) * 100) / 100,
        defense: Math.round((blended / 2) * 100) / 100,
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
  if (finalIds.length > 0) {
    const gameById = new Map(finals.map((g) => [g.id, g]));
    const { data: snaps } = await db
      .from("line_snapshots")
      .select("game_id, provider, spread, total, captured_at")
      .in("game_id", finalIds);
    const snapsByGame = new Map<number, Snapshot[]>();
    for (const s of (snaps ?? []) as Snapshot[]) {
      const arr = snapsByGame.get(s.game_id) ?? [];
      arr.push(s);
      snapsByGame.set(s.game_id, arr);
    }
    const closing = (gameId: number) => {
      const g = gameById.get(gameId);
      return consensus(snapsByGame.get(gameId) ?? [], g?.start_ts ?? undefined);
    };

    const { data: picks } = await db
      .from("picks")
      .select("id, game_id, side, line_at_pick, result")
      .in("game_id", finalIds)
      .is("result", null);
    for (const p of picks ?? []) {
      const g = gameById.get(p.game_id)!;
      const margin = (g.home_points as number) - (g.away_points as number);
      const total = (g.home_points as number) + (g.away_points as number);
      const line = Number(p.line_at_pick);
      let result: string;
      let clv: number | null = null;
      const close = closing(p.game_id);
      if (p.side === "home" || p.side === "away") {
        const coverMargin = p.side === "home" ? margin + line : -margin - line;
        result = coverMargin > 0 ? "win" : coverMargin < 0 ? "loss" : "push";
        if (close.spread !== null) {
          clv = p.side === "home" ? close.spread - line : line - close.spread;
        }
      } else {
        const diff = p.side === "over" ? total - line : line - total;
        result = diff > 0 ? "win" : diff < 0 ? "loss" : "push";
        if (close.total !== null) {
          clv = p.side === "over" ? line - close.total : close.total - line;
        }
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
      if (b.line_taken === null || !b.side) continue;
      const g = gameById.get(b.game_id)!;
      const margin = (g.home_points as number) - (g.away_points as number);
      const total = (g.home_points as number) + (g.away_points as number);
      const line = Number(b.line_taken);
      const close = closing(b.game_id);
      let result: string | null = null;
      let clv: number | null = null;
      if (b.bet_type === "spread" && (b.side === "home" || b.side === "away")) {
        const coverMargin = b.side === "home" ? margin + line : -margin - line;
        result = coverMargin > 0 ? "win" : coverMargin < 0 ? "loss" : "push";
        if (close.spread !== null) {
          clv = b.side === "home" ? close.spread - line : line - close.spread;
        }
      } else if (b.bet_type === "total" && (b.side === "over" || b.side === "under")) {
        const diff = b.side === "over" ? total - line : line - total;
        result = diff > 0 ? "win" : diff < 0 ? "loss" : "push";
        if (close.total !== null) {
          clv = b.side === "over" ? line - close.total : close.total - line;
        }
      }
      if (result === null) continue;
      const units = Number(b.units);
      const odds = Number(b.odds);
      const win = odds > 0 ? units * (odds / 100) : units * (100 / -odds);
      const payout = result === "win" ? win : result === "loss" ? -units : 0;
      const { error } = await db
        .from("bets")
        .update({
          result,
          clv,
          closing_line: b.bet_type === "total" ? close.total : close.spread,
          payout_units: Math.round(payout * 100) / 100,
        })
        .eq("id", b.id);
      if (!error) betsGraded++;
    }
  }

  return { weeks: weeksPlayed.length, ratingRows: ratingRows.length, picksGraded, betsGraded };
}

/**
 * Thursday job: freeze predictions for the upcoming week (receipts), pricing
 * with current ratings + team HFA + admin-CONFIRMED rating adjustments.
 */
export async function freezeJob(db: SupabaseClient): Promise<Json> {
  const week = await currentWeek(db);
  if (week === undefined) return { note: "no scheduled games" };

  const { data: gameRows } = await db
    .from("games")
    .select("id, home_team_id, away_team_id, neutral_site, status")
    .eq("season_id", SEASON)
    .eq("week", week)
    .eq("status", "scheduled");
  const games = (gameRows ?? []) as Array<{
    id: number;
    home_team_id: number;
    away_team_id: number;
    neutral_site: boolean;
  }>;
  if (games.length === 0) return { week, frozen: 0 };

  const { data: ratingRows } = await db
    .from("ratings")
    .select("team_id, week, overall")
    .eq("season_id", SEASON)
    .order("week", { ascending: false });
  const latest = new Map<number, number>();
  for (const r of ratingRows ?? []) {
    if (!latest.has(r.team_id)) latest.set(r.team_id, Number(r.overall));
  }

  const [{ data: hfaRows }, { data: adjRows }, { data: snaps }] = await Promise.all([
    db.from("team_hfa").select("team_id, blended_hfa"),
    db
      .from("rating_adjustments")
      .select("team_id, game_id, points")
      .eq("season_id", SEASON)
      .not("confirmed_at", "is", null),
    db
      .from("line_snapshots")
      .select("game_id, provider, spread, total, captured_at")
      .in(
        "game_id",
        games.map((g) => g.id),
      ),
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

  const rows: Json[] = [];
  for (const g of games) {
    const homeR = latest.get(g.home_team_id);
    const awayR = latest.get(g.away_team_id);
    if (homeR === undefined && awayR === undefined) continue;
    const rating = (overall: number | undefined): TeamRating => ({
      overall: overall ?? FCS_RATING,
      offense: (overall ?? FCS_RATING) / 2,
      defense: (overall ?? FCS_RATING) / 2,
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
      },
      DEFAULT_PARAMS,
    );
    rows.push({
      game_id: g.id,
      model_version: MODEL_VERSION,
      frozen: true,
      spread: Math.round(price.spread * 10) / 10,
      total: Math.round(price.projectedTotal * 10) / 10,
      home_score: Math.round(price.projectedHomeScore * 10) / 10,
      away_score: Math.round(price.projectedAwayScore * 10) / 10,
      home_win_prob: Math.round(price.homeWinProb * 10000) / 10000,
      cover_prob:
        price.homeCoverProb !== null ? Math.round(price.homeCoverProb * 10000) / 10000 : null,
      vegas_spread: vegas.spread,
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
