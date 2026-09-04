/**
 * The manual bet form's game list — this week's games, labelled for a
 * `<select>` — built once here for the two places the form renders: the
 * ledger (your own) and a betting group's home (an admin logging for a
 * member, 0083). Two copies of the label rule would drift; the abbreviation
 * fallback and the kickoff suffix were both tuned on the ledger and the group
 * page has to say the same thing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BetFormGame } from "../components/BetForm";
import type { TeamRow } from "./db-types";
import { kickParts, tzLabel } from "./kick";
import { fetchBetFormGames } from "./queries";

export const abbrOf = (t: TeamRow | undefined): string =>
  t?.abbreviation ?? t?.school.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase() ?? "?";

export async function fetchBetFormOptions(
  supabase: SupabaseClient,
  seasonId: number,
  tz: string,
): Promise<{ games: BetFormGame[]; teamById: Map<number, TeamRow> }> {
  const { data: weekGames } = await fetchBetFormGames(supabase, seasonId);
  const gameRows = (weekGames ?? []) as Array<{
    id: number;
    start_ts: string | null;
    home_team_id: number;
    away_team_id: number;
  }>;
  const teamIds = [...new Set(gameRows.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const { data: teams } =
    teamIds.length > 0 ? await supabase.from("teams").select("*").in("id", teamIds) : { data: [] };
  const teamById = new Map<number, TeamRow>(((teams ?? []) as TeamRow[]).map((t) => [t.id, t]));
  const games: BetFormGame[] = gameRows.map((g) => {
    const homeAbbr = abbrOf(teamById.get(g.home_team_id));
    const awayAbbr = abbrOf(teamById.get(g.away_team_id));
    const kick = g.start_ts ? kickParts(g.start_ts, tz) : null;
    return {
      id: g.id,
      label: `${awayAbbr} @ ${homeAbbr}${kick ? ` · ${kick.day} ${kick.time} ${tzLabel(tz)}` : ""}`,
      homeAbbr,
      awayAbbr,
    };
  });
  return { games, teamById };
}
