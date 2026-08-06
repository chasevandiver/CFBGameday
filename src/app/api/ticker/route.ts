import { NextResponse } from "next/server";
import type { GameRow, TeamRow } from "../../../lib/db-types";
import { fetchCurrentSeasonWeek } from "../../../lib/queries";
import type { TickerData, TickerGame } from "../../../lib/ticker";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 3600 * 1000;
const SOON_MS = 4 * 3600 * 1000;

/**
 * Tiny gameday payload for the score ticker: live games, finals from the last
 * 24h, and kickoffs within 4h. Empty outside those windows (ticker hides).
 */
export async function GET() {
  const supabase = await createClient();

  // Public — the ticker is read-only scores (audit bug #5: used to 401 anon).
  const { seasonId, week, seasonType } = await fetchCurrentSeasonWeek(supabase);
  const { data } = await supabase
    .from("games")
    .select("id, status, start_ts, current_period, current_clock, home_points, away_points, home_team_id, away_team_id")
    .eq("season_id", seasonId)
    .eq("week", week)
    .eq("season_type", seasonType)
    .order("start_ts", { ascending: true });

  type Row = Pick<
    GameRow,
    | "id"
    | "status"
    | "start_ts"
    | "current_period"
    | "current_clock"
    | "home_points"
    | "away_points"
    | "home_team_id"
    | "away_team_id"
  >;
  const now = Date.now();
  const rows = ((data ?? []) as Row[]).filter((g) => {
    if (g.status === "in_progress") return true;
    const kick = g.start_ts ? Date.parse(g.start_ts) : null;
    if (kick === null) return false;
    if (g.status === "final") return now - kick <= DAY_MS;
    if (g.status === "scheduled") return kick >= now - SOON_MS && kick - now <= SOON_MS;
    return false;
  });

  const teamIds = [...new Set(rows.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const { data: teams } =
    teamIds.length > 0
      ? await supabase.from("teams").select("id, school, abbreviation").in("id", teamIds)
      : { data: [] };
  const abbrById = new Map(
    ((teams ?? []) as Array<Pick<TeamRow, "id" | "school" | "abbreviation">>).map((t) => [
      t.id,
      t.abbreviation ?? t.school.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase(),
    ]),
  );

  const games: TickerGame[] = rows.map((g) => ({
    id: g.id,
    status: g.status,
    startTs: g.start_ts,
    period: g.current_period,
    clock: g.current_clock,
    homeAbbr: abbrById.get(g.home_team_id) ?? "?",
    awayAbbr: abbrById.get(g.away_team_id) ?? "?",
    homePoints: g.home_points,
    awayPoints: g.away_points,
  }));

  const payload: TickerData = { seasonId, week, games };
  return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
}
