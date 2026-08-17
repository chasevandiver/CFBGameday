/**
 * The daily game layer's jobs (R2-C1, R2-C2): Guess the Lines selection and
 * grading, and the Streak's grade-and-select. Same construction as
 * notify-jobs.ts — a sibling of jobs-core registered in run-job.ts, pure
 * arithmetic exported for vitest, IO kept thin.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { openingSpread, SNAPSHOT_COLS, type SnapshotLike } from "../../src/lib/consensus";
import { pickPollRanks, type PollRankInput } from "../../src/lib/rankings";
import { fetchCurrentSlate } from "../../src/lib/season";
import { productDate, productDateOffset } from "../../src/lib/streak";
import { isDeadStatus } from "../../src/lib/void";
import { SEASON } from "./ingest";
import { NFL_SEASON } from "./nfl";

type Json = Record<string, unknown>;

/* The opening line lives in src/lib/consensus.ts (openingSpread) — the
   grading job and the reveal display must agree on it, so one definition. */
export { openingSpread };

/* ---- pure: marquee ranking ---------------------------------------------- */

export interface MarqueeGame {
  id: number;
  home_team_id: number;
  away_team_id: number;
  start_ts: string | null;
}

/**
 * Poll-rank quality, the same shape watchability() gives ranked teams — with
 * one fix for the selection use: a ranked team is floored at the unranked
 * baseline. watchability()'s raw curve gives #25 → 0.7 vs unranked → 2.0,
 * which is harmless as one term among four on a display sort and wrong as
 * the DOMINANT term of a selector (an unranked-vs-unranked game would beat a
 * #25-vs-unranked one). The closeness term watchability leads with is absent
 * here on purpose: the whole point of the guess slate is that these games
 * have no line yet.
 */
export function marqueeScore(
  g: MarqueeGame,
  ranks: Map<number, number>,
  spread?: number | null,
): number {
  const q = (r: number | undefined) =>
    r === undefined || r > 25 ? 2 : Math.max(2, (17.5 * (26 - r)) / 25);
  let score = q(ranks.get(g.home_team_id)) + q(ranks.get(g.away_team_id));
  if (spread !== undefined && spread !== null) {
    score += Math.max(0, 35 - (Math.abs(spread) * 35) / 24);
  }
  return score;
}

/** Top-n marquee games; ties break toward the earlier kickoff. */
export function selectMarquee(
  games: MarqueeGame[],
  ranks: Map<number, number>,
  n: number,
): number[] {
  return [...games]
    .sort(
      (a, b) =>
        marqueeScore(b, ranks) - marqueeScore(a, ranks) ||
        (a.start_ts ?? "9999").localeCompare(b.start_ts ?? "9999"),
    )
    .slice(0, n)
    .map((g) => g.id);
}

/* Product-day arithmetic lives in src/lib/streak.ts — the page and the job
   must agree on what "today" means, so there is exactly one definition. */
export { productDate, productDateOffset };

/* ---- pure: grading ------------------------------------------------------- */

export interface GuessRow {
  user_id: string;
  game_id: number;
  guess: number;
}

/**
 * The grade pass, pure: which guesses settle, against what. A game with no
 * snapshots (line not posted) or no derivable open produces no assignment —
 * the guess stays pending, never approximated.
 */
export function gradeAssignments(
  byGame: Map<number, GuessRow[]>,
  snapsByGame: Map<number, SnapshotLike[]>,
): Array<{ user_id: string; game_id: number; abs_error: number }> {
  const out: Array<{ user_id: string; game_id: number; abs_error: number }> = [];
  for (const [gid, rows] of byGame) {
    const snaps = snapsByGame.get(gid);
    if (!snaps || snaps.length === 0) continue;
    const open = openingSpread(snaps);
    if (open === null) continue;
    for (const r of rows) {
      out.push({
        user_id: r.user_id,
        game_id: gid,
        abs_error: Math.round(Math.abs(r.guess - open) * 10) / 10,
      });
    }
  }
  return out;
}

/**
 * How a streak pick resolves, pure. Null = not resolvable yet (still live,
 * or a final missing points — leave pending). Dead games and ties void: a
 * run is broken by a wrong answer, never by a cancelled game.
 */
export function streakResult(
  status: string,
  homePoints: number | null,
  awayPoints: number | null,
  side: string,
): "win" | "loss" | "void" | null {
  if (isDeadStatus(status)) return "void";
  if (status !== "final" || homePoints === null || awayPoints === null) return null;
  const margin = homePoints - awayPoints;
  if (margin === 0) return "void";
  return (margin > 0) === (side === "home") ? "win" : "loss";
}

/* ---- Guess the Lines (R2-C1) --------------------------------------------- */

const GUESS_SLATE_SIZE = 8;

export async function guessLinesJob(db: SupabaseClient): Promise<Json> {
  let selected = 0;
  let graded = 0;
  const now = Date.now();

  for (const seasonId of [SEASON, NFL_SEASON]) {
    let pointer: { week: number; seasonType: string };
    try {
      pointer = await fetchCurrentSlate(db, seasonId);
    } catch {
      continue; // league not configured yet
    }
    // NFL preseason is never a board (SPEC §10.5); a CFB "preseason" pointer
    // means nothing has kicked yet and week selection handles it.
    if (pointer.seasonType === "preseason") continue;

    /* -- selection: once per (season, week) -- */
    const { data: existingRows, error: slateErr } = await db
      .from("guess_line_slates")
      .select("game_id")
      .eq("season_id", seasonId)
      .eq("week", pointer.week);
    if (slateErr) throw new Error(`guess-lines: slate read failed: ${slateErr.message}`);

    if ((existingRows ?? []).length === 0) {
      const { data: gameRows, error: gamesErr } = await db
        .from("games")
        .select("id, home_team_id, away_team_id, start_ts, status")
        .eq("season_id", seasonId)
        .eq("week", pointer.week)
        .eq("season_type", pointer.seasonType)
        .eq("status", "scheduled");
      if (gamesErr) throw new Error(`guess-lines: games read failed: ${gamesErr.message}`);
      const future = ((gameRows ?? []) as Array<MarqueeGame & { status: string }>).filter(
        (g) => g.start_ts !== null && Date.parse(g.start_ts) > now,
      );

      // The integrity rule from the selection side: a game with ANY snapshot
      // already has a public number and can never join the slate.
      const ids = future.map((g) => g.id);
      const withSnaps = new Set<number>();
      for (let i = 0; i < ids.length; i += 300) {
        const { data: snapRows } = await db
          .from("line_snapshots")
          .select("game_id")
          .in("game_id", ids.slice(i, i + 300));
        for (const r of (snapRows ?? []) as Array<{ game_id: number }>)
          withSnaps.add(r.game_id);
      }
      const candidates = future.filter((g) => !withSnaps.has(g.id));

      let chosen: number[];
      if (seasonId === NFL_SEASON) {
        chosen = candidates.map((g) => g.id); // the whole NFL week is the slate
      } else {
        const { data: pollRows } = await db
          .from("poll_rankings")
          .select("week, poll, team_id, rank")
          .eq("season_id", seasonId)
          .eq("season_type", "regular");
        const { byTeam } = pickPollRanks((pollRows ?? []) as PollRankInput[]);
        chosen = selectMarquee(candidates, byTeam, GUESS_SLATE_SIZE);
      }

      if (chosen.length > 0) {
        const { error: insErr } = await db.from("guess_line_slates").insert(
          chosen.map((game_id) => ({ season_id: seasonId, week: pointer.week, game_id })),
        );
        if (insErr) throw new Error(`guess-lines: slate insert failed: ${insErr.message}`);
        selected += chosen.length;
      }
    }

    /* -- grading: any ungraded guess whose opening line now exists -- */
    const { data: ungraded, error: ugErr } = await db
      .from("line_guesses")
      .select("user_id, game_id, guess")
      .eq("season_id", seasonId)
      .is("graded_at", null);
    if (ugErr) throw new Error(`guess-lines: guesses read failed: ${ugErr.message}`);
    const byGame = new Map<number, GuessRow[]>();
    for (const g of (ungraded ?? []) as GuessRow[]) {
      const arr = byGame.get(g.game_id) ?? [];
      arr.push({ user_id: g.user_id, game_id: g.game_id, guess: Number(g.guess) });
      byGame.set(g.game_id, arr);
    }
    const gids = [...byGame.keys()];
    const snapsByGame = new Map<number, SnapshotLike[]>();
    for (let i = 0; i < gids.length; i += 300) {
      const { data: snaps, error: snapsErr } = await db
        .from("line_snapshots")
        .select(SNAPSHOT_COLS)
        .in("game_id", gids.slice(i, i + 300));
      if (snapsErr) throw new Error(`guess-lines: snapshots read failed: ${snapsErr.message}`);
      for (const s of (snaps ?? []) as SnapshotLike[] & Array<{ game_id: number }>) {
        const arr = snapsByGame.get(s.game_id) ?? [];
        arr.push(s);
        snapsByGame.set(s.game_id, arr);
      }
    }
    const gradedAt = new Date().toISOString();
    for (const a of gradeAssignments(byGame, snapsByGame)) {
      const { error } = await db
        .from("line_guesses")
        .update({ abs_error: a.abs_error, graded_at: gradedAt })
        .eq("user_id", a.user_id)
        .eq("game_id", a.game_id);
      if (!error) graded++;
    }
  }

  return { selected, graded };
}

/* ---- The Streak (R2-C2) --------------------------------------------------- */

export async function streakJob(db: SupabaseClient): Promise<Json> {
  const now = new Date();
  let graded = 0;
  let voided = 0;
  let selectedDay: string | null = null;

  /* -- grade every pending pick whose game has resolved -- */
  const { data: pending, error: pendErr } = await db
    .from("streak_picks")
    .select("user_id, day, side")
    .is("result", null);
  if (pendErr) throw new Error(`streak: picks read failed: ${pendErr.message}`);
  const pendingRows = (pending ?? []) as Array<{ user_id: string; day: string; side: string }>;

  if (pendingRows.length > 0) {
    const days = [...new Set(pendingRows.map((p) => p.day))];
    const { data: dayRows, error: dayErr } = await db
      .from("streak_days")
      .select("day, game_id")
      .in("day", days);
    if (dayErr) throw new Error(`streak: days read failed: ${dayErr.message}`);
    const gameByDay = new Map(
      ((dayRows ?? []) as Array<{ day: string; game_id: number }>).map((d) => [d.day, d.game_id]),
    );
    const gameIds = [...new Set([...gameByDay.values()])];
    const { data: gameRows, error: gErr } = gameIds.length
      ? await db
          .from("games")
          .select("id, status, home_points, away_points")
          .in("id", gameIds)
      : { data: [], error: null };
    if (gErr) throw new Error(`streak: games read failed: ${gErr.message}`);
    const gameById = new Map(
      ((gameRows ?? []) as Array<{
        id: number;
        status: string;
        home_points: number | null;
        away_points: number | null;
      }>).map((g) => [g.id, g]),
    );

    for (const p of pendingRows) {
      const game = gameById.get(gameByDay.get(p.day) ?? -1);
      if (!game) continue;
      const result = streakResult(game.status, game.home_points, game.away_points, p.side);
      if (result === null) continue;
      const { error } = await db
        .from("streak_picks")
        .update({ result })
        .eq("user_id", p.user_id)
        .eq("day", p.day);
      if (!error) {
        if (result === "void") voided++;
        else graded++;
      }
    }
  }

  /* -- select today's (if missed and still pickable) and tomorrow's matchup -- */
  for (const offset of [0, 1]) {
    const target = productDateOffset(now, offset);
    const { data: existing } = await db
      .from("streak_days")
      .select("day")
      .eq("day", target)
      .maybeSingle();
    if (existing) continue;

    const { data: gameRows, error: gamesErr } = await db
      .from("games")
      .select("id, season_id, season_type, home_team_id, away_team_id, start_ts, status")
      .in("season_id", [SEASON, NFL_SEASON])
      .eq("status", "scheduled")
      .neq("season_type", "preseason")
      .gte("start_ts", now.toISOString())
      .lte("start_ts", new Date(now.getTime() + 72 * 3600_000).toISOString());
    if (gamesErr) throw new Error(`streak: games read failed: ${gamesErr.message}`);
    const candidates = ((gameRows ?? []) as Array<MarqueeGame & { season_id: number }>).filter(
      (g) => g.start_ts !== null && productDate(new Date(g.start_ts)) === target,
    );
    if (candidates.length === 0) continue; // dormant day — a state, not an error

    const [{ data: pollRows }, { data: consRows }] = await Promise.all([
      db
        .from("poll_rankings")
        .select("week, poll, team_id, rank")
        .eq("season_id", SEASON)
        .eq("season_type", "regular"),
      db
        .from("line_consensus")
        .select("game_id, spread")
        .in("game_id", candidates.map((g) => g.id)),
    ]);
    const { byTeam } = pickPollRanks((pollRows ?? []) as PollRankInput[]);
    const spreadOf = new Map(
      ((consRows ?? []) as Array<{ game_id: number; spread: number | null }>).map((r) => [
        r.game_id,
        r.spread === null ? null : Number(r.spread),
      ]),
    );
    const best = [...candidates].sort(
      (a, b) =>
        marqueeScore(b, byTeam, spreadOf.get(b.id)) - marqueeScore(a, byTeam, spreadOf.get(a.id)) ||
        (a.start_ts ?? "9999").localeCompare(b.start_ts ?? "9999"),
    )[0]!;

    const { error: insErr } = await db
      .from("streak_days")
      .insert({ day: target, game_id: best.id });
    if (insErr) throw new Error(`streak: day insert failed: ${insErr.message}`);
    selectedDay = selectedDay === null ? target : `${selectedDay}, ${target}`;
  }

  return { graded, voided, selected: selectedDay };
}
