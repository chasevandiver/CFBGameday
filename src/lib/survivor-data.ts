/**
 * Reading a survivor pool: the pool's rules, the games inside its scope, and
 * every pick anyone has made.
 *
 * Server-side. Nothing here writes — every write is an RPC in migration 0053,
 * following 0020's rule that a server action is not a security boundary.
 *
 * The scope query is the only interesting one. A pool is a league and maybe a
 * conference, so "the games this pool can pick" is not "the week's slate": for
 * an SEC pool it is every game with an SEC team on either side, all season, and
 * that set is what both the picker and the standings are computed from. It is
 * read once per page rather than per week, because a survivor standing is a
 * whole-season object — you cannot know who is alive in week 9 without week 1.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeamRow } from "./db-types";
import type { SurvivorGameView, SurvivorPickRowView, SurvivorPool } from "./survivor";
import type { SeasonType } from "./season";
import type { TeamView } from "./slate";

interface PoolRow {
  group_id: string;
  season_id: number;
  conference: string | null;
  strikes: number;
  reuse_teams: boolean;
  start_week: number;
}

export async function fetchSurvivorPool(
  db: SupabaseClient,
  groupId: string,
): Promise<SurvivorPool | null> {
  const { data } = await db
    .from("survivor_pools")
    .select("group_id, season_id, conference, strikes, reuse_teams, start_week")
    .eq("group_id", groupId)
    .maybeSingle();
  if (!data) return null;
  const row = data as PoolRow;
  return {
    groupId: row.group_id,
    seasonId: row.season_id,
    conference: row.conference,
    strikes: row.strikes,
    reuseTeams: row.reuse_teams,
    startWeek: row.start_week,
  };
}

const GAME_COLUMNS =
  "id, week, season_type, status, start_ts, home_team_id, away_team_id, home_points, away_points";

interface GameRowLite {
  id: number;
  week: number;
  season_type: string;
  status: string;
  start_ts: string | null;
  home_team_id: number;
  away_team_id: number;
  home_points: number | null;
  away_points: number | null;
}

const toGameView = (g: GameRowLite): SurvivorGameView => ({
  id: g.id,
  week: g.week,
  seasonType:
    g.season_type === "postseason"
      ? "postseason"
      : g.season_type === "preseason"
        ? "preseason"
        : "regular",
  status: g.status,
  startTs: g.start_ts,
  homeTeamId: g.home_team_id,
  awayTeamId: g.away_team_id,
  homePoints: g.home_points,
  awayPoints: g.away_points,
});

export interface SurvivorScope {
  games: SurvivorGameView[];
  /** Every team that can appear on a card here, by id. */
  teams: Map<number, TeamView>;
}

/**
 * Every game a pool could ever pick, plus the teams in them.
 *
 * Conference pools filter on the TEAM, not the game: an SEC team's
 * non-conference September game is a legal pick and one of the most commonly
 * used ones, so filtering games by "both teams in the conference" would hide
 * exactly the weeks a pool leans on.
 */
export async function fetchSurvivorScope(
  db: SupabaseClient,
  pool: SurvivorPool,
): Promise<SurvivorScope> {
  const { data: teamRows } = pool.conference
    ? await db.from("teams").select("*").eq("conference", pool.conference)
    : await db.from("teams").select("*");
  const allTeams = (teamRows ?? []) as TeamRow[];
  const scopeIds = allTeams.map((t) => t.id);

  const query = db
    .from("games")
    .select(GAME_COLUMNS)
    .eq("season_id", pool.seasonId)
    .neq("season_type", "preseason");
  const { data: gameRows } = pool.conference
    ? await query.or(
        `home_team_id.in.(${scopeIds.join(",")}),away_team_id.in.(${scopeIds.join(",")})`,
      )
    : await query;

  const games = ((gameRows ?? []) as GameRowLite[])
    .map(toGameView)
    .filter((g) => !(g.seasonType === "regular" && g.week < pool.startWeek));

  // Opponents matter for the card even when they are outside the scope, so the
  // second read fills in whoever the first one missed.
  const needed = new Set<number>();
  for (const g of games) {
    needed.add(g.homeTeamId);
    needed.add(g.awayTeamId);
  }
  const missing = [...needed].filter((id) => !allTeams.some((t) => t.id === id));
  const { data: extraRows } =
    missing.length > 0
      ? await db.from("teams").select("*").in("id", missing)
      : { data: [] };

  const teams = new Map<number, TeamView>();
  for (const t of [...allTeams, ...((extraRows ?? []) as TeamRow[])]) {
    teams.set(t.id, {
      id: t.id,
      school: t.school,
      abbr: t.abbreviation ?? t.school.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase(),
      mascot: t.mascot,
      conference: t.conference,
      color: t.color,
      altColor: t.alt_color,
      logo: t.logo_url,
      rank: null,
      pollRank: null,
      poll: null,
      record: null,
      confRecord: null,
    });
  }
  return { games, teams };
}

/** Every pick in the pool that RLS lets the viewer see (0053 mirrors 0023). */
export async function fetchSurvivorPicks(
  db: SupabaseClient,
  groupId: string,
  seasonId: number,
): Promise<SurvivorPickRowView[]> {
  const { data } = await db
    .from("survivor_picks")
    .select("user_id, week, season_type, game_id, team_id")
    .eq("group_id", groupId)
    .eq("season_id", seasonId);
  return ((data ?? []) as Array<{
    user_id: string;
    week: number;
    season_type: string;
    game_id: number;
    team_id: number;
  }>).map((p) => ({
    userId: p.user_id,
    week: p.week,
    seasonType: (p.season_type === "postseason" ? "postseason" : "regular") as SeasonType,
    gameId: p.game_id,
    teamId: p.team_id,
  }));
}
