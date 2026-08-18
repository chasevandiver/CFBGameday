/**
 * PRAC-1 — reads for the three practice pools.
 *
 * Nothing here writes, and nothing in the practice routes does either. That is
 * the whole guarantee, and it is the same one GTG-6 established: practice
 * progress is passed back by the client on each call, which is safe for exactly
 * one reason — **nothing is scored**, so there is nothing for a client to lie
 * its way into. A practice route with a write path would turn that from a
 * property of the code into a promise in a comment.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChainsCard } from "./chains";
import type { DcGrid } from "./depth-chart";
import type { TapeFixture, TapeQuestion } from "./tape";

/**
 * One round from a pool, by id — or a random one when no id is given.
 *
 * Random selection happens in SQL-adjacent code rather than by reading every
 * row: `id` is a dense identity sequence, so a bounded read of ids and a pick
 * from those is enough and stays one small query as the pool grows.
 */
async function pickRound<T>(
  db: SupabaseClient,
  table: string,
  cols: string,
  id: number | null,
): Promise<T | null> {
  if (id !== null) {
    const { data } = await db.from(table).select(cols).eq("id", id).maybeSingle();
    return (data as T | null) ?? null;
  }
  const { data: ids } = await db.from(table).select("id").limit(200);
  const rows = (ids ?? []) as Array<{ id: number }>;
  if (rows.length === 0) return null;
  const chosen = rows[Math.floor(Math.random() * rows.length)]!.id;
  const { data } = await db.from(table).select(cols).eq("id", chosen).maybeSingle();
  return (data as T | null) ?? null;
}

export interface TapePracticeRound {
  id: number;
  fixture: TapeFixture;
  questions: TapeQuestion[];
  crests: Record<number, { school: string; abbr: string; color: string | null; logo: string | null }>;
}

export async function fetchTapePractice(
  db: SupabaseClient,
  id: number | null,
): Promise<TapePracticeRound | null> {
  const row = await pickRound<{ id: number; game_id: number; payload: { questions: TapeQuestion[] } }>(
    db,
    "tape_practice",
    "id, game_id, payload",
    id,
  );
  if (!row) return null;

  const { data: game } = await db
    .from("games")
    .select(
      "id, season_id, week, season_type, neutral_site, home_team_id, away_team_id, home_points, away_points",
    )
    .eq("id", row.game_id)
    .maybeSingle();
  if (!game || game.home_points === null || game.away_points === null) return null;

  const { data: teams } = await db
    .from("teams")
    .select("id, school, abbreviation, color, logo_url")
    .in("id", [game.home_team_id, game.away_team_id]);
  const byId = new Map(
    ((teams ?? []) as Array<{
      id: number;
      school: string;
      abbreviation: string | null;
      color: string | null;
      logo_url: string | null;
    }>).map((t) => [t.id, t]),
  );
  const home = byId.get(game.home_team_id);
  const away = byId.get(game.away_team_id);
  if (!home || !away) return null;

  const crests: TapePracticeRound["crests"] = {};
  for (const t of [home, away]) {
    crests[t.id] = {
      school: t.school,
      abbr: t.abbreviation ?? "",
      color: t.color,
      logo: t.logo_url,
    };
  }

  return {
    id: row.id,
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
    questions: row.payload.questions,
    crests,
  };
}

export interface ChainsPracticeRound {
  id: number;
  deck: ChainsCard[];
  crests: Record<number, { school: string; abbr: string; color: string | null; logo: string | null }>;
}

export async function fetchChainsPractice(
  db: SupabaseClient,
  id: number | null,
): Promise<ChainsPracticeRound | null> {
  const row = await pickRound<{ id: number; payload: { deck: ChainsCard[] } }>(
    db,
    "chains_practice",
    "id, payload",
    id,
  );
  if (!row) return null;

  const teamIds = [
    ...new Set(
      row.payload.deck
        .flatMap((c) => [c.left.teamId, c.right.teamId])
        .filter((t): t is number => t !== null),
    ),
  ];
  const crests: ChainsPracticeRound["crests"] = {};
  if (teamIds.length > 0) {
    const { data: teams } = await db
      .from("teams")
      .select("id, school, abbreviation, color, logo_url")
      .in("id", teamIds);
    for (const t of (teams ?? []) as Array<{
      id: number;
      school: string;
      abbreviation: string | null;
      color: string | null;
      logo_url: string | null;
    }>) {
      crests[t.id] = {
        school: t.school,
        abbr: t.abbreviation ?? "",
        color: t.color,
        logo: t.logo_url,
      };
    }
  }
  return { id: row.id, deck: row.payload.deck, crests };
}

export interface DcPracticeRound {
  id: number;
  grid: DcGrid;
  crests: Record<number, { school: string; abbr: string; color: string | null; logo: string | null }>;
}

export async function fetchDcPractice(
  db: SupabaseClient,
  id: number | null,
): Promise<DcPracticeRound | null> {
  const row = await pickRound<{
    id: number;
    payload: { groups: DcGrid["groups"]; tiles: number[] };
  }>(db, "dc_practice", "id, payload", id);
  if (!row) return null;
  if (row.payload.groups?.length !== 4 || row.payload.tiles?.length !== 16) return null;

  const { data: teams } = await db
    .from("teams")
    .select("id, school, abbreviation, color, logo_url")
    .in("id", row.payload.tiles);
  const crests: DcPracticeRound["crests"] = {};
  for (const t of (teams ?? []) as Array<{
    id: number;
    school: string;
    abbreviation: string | null;
    color: string | null;
    logo_url: string | null;
  }>) {
    crests[t.id] = {
      school: t.school,
      abbr: t.abbreviation ?? "",
      color: t.color,
      logo: t.logo_url,
    };
  }
  return { id: row.id, grid: { groups: row.payload.groups, tiles: row.payload.tiles }, crests };
}
