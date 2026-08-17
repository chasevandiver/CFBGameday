/**
 * The Six-Pack job (R3-E2): generate the week's six questions, then settle
 * them behind the finals. Sibling of `daily-games.ts` — the rules are pure in
 * `src/lib/six-pack.ts`, this is the IO.
 *
 * Both halves are idempotent. Generation writes only when the week's slate is
 * missing OR short of six (a crashed run must be repairable, not a permanent
 * hole), and it never rewrites a question people may already have answered.
 * Grading only touches ungraded rows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MARGIN_BUCKETS, settle, type SixPackGame, type SixPackKind } from "../../src/lib/six-pack";
import { pickPollRanks, type PollRankInput } from "../../src/lib/rankings";
import { fetchCurrentSlate } from "../../src/lib/season";
import { marqueeScore, type MarqueeGame } from "./daily-games";
import { SEASON } from "./ingest";

type Json = Record<string, unknown>;

export const SIX = 6;

interface Candidate extends MarqueeGame {
  spread: number | null;
  total: number | null;
}

export interface DraftQuestion {
  idx: number;
  kind: SixPackKind;
  game_id: number | null;
  line: number | null;
  choices: string[];
}

/**
 * The week's six questions, built from the marquee games. Deterministic — no
 * randomness, so a repair run produces the same shape the first run would
 * have.
 *
 * The recipe, in order: the two best games ask a straight winner; the next
 * asks a cover (needs a spread) and the one after a total (needs a number);
 * then a margin bucket; and the sixth is always the slate-wide
 * highest-scoring question, whose choices are the games the earlier five
 * named — which is the closure rule made concrete.
 *
 * A game missing the number a kind needs is skipped for that kind rather than
 * asked at a null line, so `buildQuestions` can return FEWER than six. The
 * caller decides what to do about it; writing an unaskable question is not on
 * the menu.
 */
export function buildQuestions(candidates: Candidate[]): DraftQuestion[] {
  const ranked = [...candidates].sort(
    (a, b) =>
      marqueeScore(b, new Map(), b.spread) - marqueeScore(a, new Map(), a.spread) ||
      (a.start_ts ?? "9999").localeCompare(b.start_ts ?? "9999") ||
      a.id - b.id,
  );
  if (ranked.length === 0) return [];

  const out: DraftQuestion[] = [];
  const push = (kind: SixPackKind, game: Candidate | null, line: number | null, choices: string[]) =>
    out.push({ idx: out.length + 1, kind, game_id: game?.id ?? null, line, choices });

  for (const g of ranked) {
    if (out.length >= 2) break;
    push("winner", g, null, ["home", "away"]);
  }
  const covered = ranked.find((g) => g.spread !== null && !out.some((q) => q.game_id === g.id));
  if (covered) push("cover", covered, covered.spread, ["home", "away"]);

  const totaled = ranked.find((g) => g.total !== null && !out.some((q) => q.game_id === g.id));
  if (totaled) push("total", totaled, totaled.total, ["over", "under"]);

  const margined = ranked.find((g) => !out.some((q) => q.game_id === g.id)) ?? ranked[0]!;
  if (out.length < SIX) push("margin", margined, null, [...MARGIN_BUCKETS]);

  // The closer: highest-scoring among the games this slate already named.
  const named = [...new Set(out.map((q) => q.game_id).filter((id): id is number => id !== null))];
  if (named.length >= 2 && out.length < SIX) {
    push("high_game", null, null, named.map(String));
  }

  return out.slice(0, SIX);
}

export async function sixPackJob(db: SupabaseClient): Promise<Json> {
  let generated = 0;
  let graded = 0;
  let entriesGraded = 0;

  let pointer: { week: number; seasonType: string };
  try {
    pointer = await fetchCurrentSlate(db, SEASON);
  } catch {
    return { generated, graded, entriesGraded, skipped: "no current season" };
  }
  // The NFL preseason is never a board (SPEC §10.5); nor is CFB's.
  if (pointer.seasonType === "preseason") {
    return { generated, graded, entriesGraded, skipped: "preseason" };
  }

  /* ---- generate (or repair) ------------------------------------------- */

  const { data: slateRow, error: slateErr } = await db
    .from("six_pack_slates")
    .select("id")
    .eq("season_id", SEASON)
    .eq("season_type", pointer.seasonType)
    .eq("week", pointer.week)
    .maybeSingle();
  if (slateErr) throw new Error(`six-pack: slate read failed: ${slateErr.message}`);

  let slateId = (slateRow as { id: number } | null)?.id ?? null;
  const { data: existingQs } = slateId
    ? await db.from("six_pack_questions").select("idx").eq("slate_id", slateId)
    : { data: [] };
  const have = ((existingQs ?? []) as Array<{ idx: number }>).length;

  if (have < SIX) {
    const { data: gameRows, error: gamesErr } = await db
      .from("games")
      .select("id, home_team_id, away_team_id, start_ts, status")
      .eq("season_id", SEASON)
      .eq("week", pointer.week)
      .eq("season_type", pointer.seasonType)
      .eq("status", "scheduled");
    if (gamesErr) throw new Error(`six-pack: games read failed: ${gamesErr.message}`);

    const now = Date.now();
    const upcoming = ((gameRows ?? []) as Array<MarqueeGame & { status: string }>).filter(
      (g) => g.start_ts !== null && Date.parse(g.start_ts) > now,
    );

    if (upcoming.length > 0) {
      const { data: consRows } = await db
        .from("line_consensus")
        .select("game_id, spread, total")
        .in("game_id", upcoming.map((g) => g.id));
      const lines = new Map(
        ((consRows ?? []) as Array<{ game_id: number; spread: number | null; total: number | null }>).map(
          (r) => [r.game_id, { spread: r.spread === null ? null : Number(r.spread), total: r.total === null ? null : Number(r.total) }],
        ),
      );
      const { data: pollRows } = await db
        .from("poll_rankings")
        .select("week, poll, team_id, rank")
        .eq("season_id", SEASON)
        .eq("season_type", "regular");
      const { byTeam } = pickPollRanks((pollRows ?? []) as PollRankInput[]);

      const candidates: Candidate[] = upcoming
        .map((g) => ({
          ...g,
          spread: lines.get(g.id)?.spread ?? null,
          total: lines.get(g.id)?.total ?? null,
        }))
        .sort(
          (a, b) =>
            marqueeScore(b, byTeam, b.spread) - marqueeScore(a, byTeam, a.spread) ||
            (a.start_ts ?? "9999").localeCompare(b.start_ts ?? "9999"),
        );

      const draft = buildQuestions(candidates);
      if (draft.length === SIX) {
        if (slateId === null) {
          const { data: made, error: insErr } = await db
            .from("six_pack_slates")
            .insert({ season_id: SEASON, season_type: pointer.seasonType, week: pointer.week })
            .select("id")
            .single();
          if (insErr) throw new Error(`six-pack: slate insert failed: ${insErr.message}`);
          slateId = (made as { id: number }).id;
        }
        // Repair without rewriting: only the indexes that are missing. An
        // answered question keeps the wording people answered.
        const present = new Set(((existingQs ?? []) as Array<{ idx: number }>).map((q) => q.idx));
        const toWrite = draft.filter((q) => !present.has(q.idx));
        if (toWrite.length > 0) {
          const { error: qErr } = await db
            .from("six_pack_questions")
            .insert(toWrite.map((q) => ({ ...q, slate_id: slateId })));
          if (qErr) throw new Error(`six-pack: question insert failed: ${qErr.message}`);
          generated += toWrite.length;
        }
      }
    }
  }

  /* ---- grade ----------------------------------------------------------- */

  const { data: ungraded, error: ugErr } = await db
    .from("six_pack_questions")
    .select("slate_id, idx, kind, game_id, line, choices")
    .is("graded_at", null);
  if (ugErr) throw new Error(`six-pack: ungraded read failed: ${ugErr.message}`);
  const pending = (ungraded ?? []) as Array<{
    slate_id: number;
    idx: number;
    kind: SixPackKind;
    game_id: number | null;
    line: number | null;
    choices: string[];
  }>;

  if (pending.length > 0) {
    const needed = [
      ...new Set([
        ...pending.map((q) => q.game_id).filter((id): id is number => id !== null),
        ...pending.flatMap((q) => (q.kind === "high_game" ? q.choices.map(Number) : [])),
      ]),
    ];
    const games: SixPackGame[] = [];
    for (let i = 0; i < needed.length; i += 300) {
      const { data: rows, error } = await db
        .from("games")
        .select("id, status, home_points, away_points")
        .in("id", needed.slice(i, i + 300));
      if (error) throw new Error(`six-pack: games read failed: ${error.message}`);
      for (const r of (rows ?? []) as Array<{
        id: number;
        status: string;
        home_points: number | null;
        away_points: number | null;
      }>) {
        games.push({
          id: r.id,
          status: r.status,
          homePoints: r.home_points,
          awayPoints: r.away_points,
        });
      }
    }

    const gradedAt = new Date().toISOString();
    for (const q of pending) {
      const answer = settle(
        { idx: q.idx, kind: q.kind, gameId: q.game_id, line: q.line === null ? null : Number(q.line), choices: q.choices },
        games,
      );
      if (answer === null) continue; // not ready — leave it alone
      const { error } = await db
        .from("six_pack_questions")
        .update({ answer, graded_at: gradedAt })
        .eq("slate_id", q.slate_id)
        .eq("idx", q.idx);
      if (error) continue;
      graded += 1;

      // Settle everyone's answer to it in one pass.
      const { data: entries } = await db
        .from("six_pack_entries")
        .select("user_id, choice")
        .eq("slate_id", q.slate_id)
        .eq("idx", q.idx)
        .is("result", null);
      for (const e of (entries ?? []) as Array<{ user_id: string; choice: string }>) {
        const result = answer === "void" ? "void" : e.choice === answer ? "correct" : "wrong";
        const { error: entryErr } = await db
          .from("six_pack_entries")
          .update({ result })
          .eq("user_id", e.user_id)
          .eq("slate_id", q.slate_id)
          .eq("idx", q.idx);
        if (!entryErr) entriesGraded += 1;
      }
    }
  }

  return { generated, graded, entriesGraded };
}
