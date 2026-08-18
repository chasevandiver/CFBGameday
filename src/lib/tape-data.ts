/**
 * The Tape's server-side reads. `tape.ts` stays pure; this is the half that
 * touches the database.
 *
 * Nothing here writes. The route owns the only write in the feature
 * (`tape_entries`), which is what keeps every other caller structurally
 * incapable of touching a score.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { EMPTY_DAILY, type DailyStats } from "./daily-stats";
import {
  TAPE_QUESTIONS,
  tapeStanding,
  type TapeFixture,
  type TapeQuestion,
  type TapeRowState,
} from "./tape";

export interface TapeDay {
  fixture: TapeFixture;
  questions: TapeQuestion[];
  /** Crest art, so the fixture can be shown the way the rest of the app shows one. */
  homeLogo: string | null;
  homeColor: string | null;
  awayLogo: string | null;
  awayColor: string | null;
}

/**
 * The day's fixture and its answer key.
 *
 * Reads the key on every call because the route needs it to grade, and returns
 * it to the route only — `tapePayload` is what decides which parts of it a
 * player may see, and it is the single place that decision is made.
 */
export async function fetchTapeDay(
  db: SupabaseClient,
  day: string,
): Promise<TapeDay | null> {
  const { data: puzzle } = await db
    .from("tape_puzzles")
    .select("day, game_id")
    .eq("day", day)
    .maybeSingle();
  if (!puzzle) return null;

  const [{ data: qRows }, { data: game }] = await Promise.all([
    db.from("tape_questions").select("idx, kind, prompt, choices, answer").eq("day", day).order("idx"),
    db
      .from("games")
      .select(
        "id, season_id, week, season_type, neutral_site, home_team_id, away_team_id, home_points, away_points",
      )
      .eq("id", (puzzle as { game_id: number }).game_id)
      .maybeSingle(),
  ]);

  if (!game || game.home_points === null || game.away_points === null) return null;
  const questions = ((qRows ?? []) as Array<{
    idx: number;
    kind: string;
    prompt: string;
    choices: string[];
    answer: string;
  }>).map((q) => ({
    kind: q.kind as TapeQuestion["kind"],
    prompt: q.prompt,
    choices: q.choices,
    answer: q.answer,
  }));
  /* A day whose key is short is a generation bug, and serving four questions
     would break the 0-5 score and the five-square share silently. Refuse it —
     the page reads that as "no puzzle today", which is loud enough to notice
     and honest about what it knows. */
  if (questions.length !== TAPE_QUESTIONS) return null;

  const { data: teams } = await db
    .from("teams")
    .select("id, school, logo_url, color")
    .in("id", [game.home_team_id, game.away_team_id]);
  const byId = new Map(
    ((teams ?? []) as Array<{
      id: number;
      school: string;
      logo_url: string | null;
      color: string | null;
    }>).map((t) => [t.id, t]),
  );
  const home = byId.get(game.home_team_id);
  const away = byId.get(game.away_team_id);
  if (!home || !away) return null;

  return {
    fixture: {
      season: game.season_id,
      week: game.week,
      seasonType: game.season_type,
      neutralSite: game.neutral_site,
      homeSchool: home.school,
      awaySchool: away.school,
      homeTeamId: home.id,
      awayTeamId: away.id,
      homePoints: game.home_points,
      awayPoints: game.away_points,
    },
    questions,
    homeLogo: home.logo_url,
    homeColor: home.color,
    awayLogo: away.logo_url,
    awayColor: away.color,
  };
}

/** The caller's own row for today, or a fresh one. Never another member's. */
export async function fetchTapeEntry(
  db: SupabaseClient,
  userId: string,
  day: string,
): Promise<TapeRowState> {
  const { data } = await db
    .from("tape_entries")
    .select("answers, completed_at")
    .eq("user_id", userId)
    .eq("day", day)
    .maybeSingle();
  return (data as TapeRowState | null) ?? { answers: [], completed_at: null };
}

/**
 * The caller's record across every day they have finished.
 *
 * **Days still in progress are filtered out**, the rule GTG-10 had to state
 * explicitly: a row with two answers and no `completed_at` is not a bust yet,
 * and counting it as one would zero the streak of anyone who opened the puzzle
 * and walked away.
 */
export async function fetchTapeStanding(
  db: SupabaseClient,
  userId: string,
): Promise<DailyStats> {
  const { data } = await db
    .from("tape_entries")
    .select("day, correct, completed_at")
    .eq("user_id", userId);
  const rows = ((data ?? []) as Array<{
    day: string;
    correct: number;
    completed_at: string | null;
  }>)
    .filter((r) => r.completed_at !== null)
    .map((r) => ({ day: r.day, correct: r.correct }));
  return rows.length === 0 ? EMPTY_DAILY : tapeStanding(rows);
}
