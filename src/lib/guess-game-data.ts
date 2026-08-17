/**
 * Guess the Game's server-side reads, shared by the daily route and practice.
 *
 * Extracted when practice mode arrived, because the alternative was a second
 * copy of the deck query, the record query and the guess resolver — three
 * things that must agree with the daily puzzle exactly or practice stops being
 * practice for it. `guess-game.ts` stays pure; this is the half that touches
 * the database.
 *
 * Nothing here writes. The daily route owns the only write in the feature
 * (`gtg_guesses`), which is what keeps practice structurally incapable of
 * touching anyone's score.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { NFL_ID_OFFSET } from "./league";
import { recordEntering, type GtgAnswerCtx, type RecordGameLike } from "./guess-game";

/**
 * The deck: every CFB regular-season final we hold a score for.
 *
 * This used to be `for (const season of [2023, 2024, 2025])`, and that literal
 * was the whole bug: the three seasons it named were never backfilled into
 * this database, so the deck was empty and the page said "no puzzle today"
 * every day since R2-C3 shipped. Worse, it could not heal — when 2026
 * finishes, its games are season 2026 and the list would still ask for 2023.
 *
 * So the seasons are DISCOVERED rather than declared. Whatever CFB seasons
 * exist get played; a backfill widens the deck by landing rows, and the season
 * now being played widens it every Saturday. Rendezvous hashing is what makes
 * a growing deck safe — a new candidate only ever changes the days it would
 * itself have won, so yesterday's puzzle never moves.
 *
 * Read per season rather than in one query: a season is ~870 regular-season
 * games and PostgREST caps a response at 1000 rows, so one query over all of
 * them would silently truncate — and a silently truncated deck is a deck that
 * still works, which is the kind of bug nobody finds.
 *
 * Cached per instance per day, but **an empty deck is never cached**, and that
 * exception is the lesson of the bug above rather than a micro-optimisation.
 * An empty deck means either something is wrong or a backfill is in flight,
 * and both want the next request to look again; caching it pins "no puzzle
 * today" onto a warm instance for the rest of the day.
 */
let deckCache: { day: string; ids: number[] } | null = null;

export async function cfbDeck(db: SupabaseClient, day: string): Promise<number[]> {
  if (deckCache && deckCache.day === day) return deckCache.ids;

  const { data: seasonRows } = await db
    .from("seasons")
    .select("id")
    .lt("id", NFL_ID_OFFSET)
    .order("id");

  const ids: number[] = [];
  for (const s of (seasonRows ?? []) as Array<{ id: number }>) {
    const { data } = await db
      .from("games")
      .select("id")
      .eq("season_id", s.id)
      .eq("season_type", "regular")
      .eq("status", "final")
      // A "final" with no score cannot answer its own first hint.
      .not("home_points", "is", null)
      .not("away_points", "is", null);
    for (const r of (data ?? []) as Array<{ id: number }>) ids.push(r.id);
  }

  deckCache = ids.length > 0 ? { day, ids } : null;
  return ids;
}

/** Everything a puzzle needs to cut its clues. Null if the game is unusable. */
export async function answerFor(
  db: SupabaseClient,
  gameId: number,
): Promise<GtgAnswerCtx | null> {
  const { data: game } = await db
    .from("games")
    .select("id, season_id, week, start_ts, home_team_id, away_team_id, home_points, away_points")
    .eq("id", gameId)
    .maybeSingle();
  if (!game || game.home_points === null || game.away_points === null) return null;

  const [{ data: teams }, { data: priorRows }] = await Promise.all([
    db
      .from("teams")
      .select("id, school, conference")
      .in("id", [game.home_team_id, game.away_team_id]),
    /* The home team's season up to this kickoff — the clue that replaced the
       closing spread, which no backfilled puzzle could ever answer. Bounded by
       construction: at most a dozen or so rows, and none at all in week 0. */
    game.start_ts === null
      ? Promise.resolve({ data: [] })
      : db
          .from("games")
          .select("home_team_id, away_team_id, home_points, away_points")
          .eq("season_id", game.season_id)
          .eq("status", "final")
          .lt("start_ts", game.start_ts)
          .or(`home_team_id.eq.${game.home_team_id},away_team_id.eq.${game.home_team_id}`),
  ]);

  const teamById = new Map(
    ((teams ?? []) as Array<{ id: number; school: string; conference: string | null }>).map((t) => [
      t.id,
      t,
    ]),
  );
  const home = teamById.get(game.home_team_id);
  const away = teamById.get(game.away_team_id);
  if (!home || !away) return null;

  return {
    homeTeamId: game.home_team_id,
    homeConference: home.conference,
    homeSchool: home.school,
    awaySchool: away.school,
    homePoints: game.home_points,
    awayPoints: game.away_points,
    season: game.season_id,
    week: game.week,
    homeRecord: recordEntering((priorRows ?? []) as RecordGameLike[], game.home_team_id),
  };
}

export interface ResolvedTeam {
  id: number;
  school: string;
  conference: string | null;
}

/**
 * A typed guess → a team, or a refusal the player can act on.
 *
 * Exact-insensitive on school OR abbreviation first, so "UNT" and "North
 * Texas" are the same guess, then an unambiguous contains match. Ambiguity is
 * an error rather than a pick: silently choosing one of two schools that both
 * match "Texas" would spend an attempt on a team the player did not name.
 *
 * Both callers treat a refusal as costing no attempt, which is why the message
 * matters more than it looks — it is the entire feedback for a bad guess.
 */
export async function resolveTeam(
  db: SupabaseClient,
  guessName: string,
): Promise<{ team: ResolvedTeam } | { error: string; status: number }> {
  const { data: exact } = await db
    .from("teams")
    .select("id, school, conference")
    .eq("sport", "cfb")
    .or(`school.ilike.${guessName},abbreviation.ilike.${guessName}`)
    .limit(2);
  const hit = (exact ?? [])[0] as ResolvedTeam | undefined;
  if (hit) return { team: hit };

  const { data: fuzzy } = await db
    .from("teams")
    .select("id, school, conference")
    .eq("sport", "cfb")
    .ilike("school", `%${guessName}%`)
    .limit(2);
  const rows = (fuzzy ?? []) as ResolvedTeam[];
  if (rows.length === 1) return { team: rows[0]! };
  if (rows.length > 1) {
    return {
      error: `“${guessName}” matches more than one school — be more specific`,
      status: 422,
    };
  }
  return { error: `No school matching “${guessName}”`, status: 422 };
}
