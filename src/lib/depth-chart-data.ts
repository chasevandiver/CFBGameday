/**
 * Depth Chart's server-side reads. `depth-chart.ts` stays pure; this is the
 * half that touches the database. Nothing here writes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { EMPTY_DC, dcOver, type DcEntryState, type DcGrid } from "./depth-chart";
import { EMPTY_DAILY, dailyStanding, type DailyStats } from "./daily-stats";

export interface DcDay {
  grid: DcGrid;
  crests: Record<number, { school: string; abbr: string; color: string | null; logo: string | null }>;
}

/**
 * The day's board, groups and all.
 *
 * Returns the whole grid because the route needs it to judge and to reveal.
 * `dcPayload` is the one place that decides which of it a player may see —
 * the same division The Tape and Chains use, so there is exactly one function
 * per game that can leak.
 */
export async function fetchDcDay(db: SupabaseClient, day: string): Promise<DcDay | null> {
  const [{ data: groupRows }, { data: tileRows }] = await Promise.all([
    db.from("dc_puzzle_groups").select("gidx, group_id, label, team_ids").eq("day", day).order("gidx"),
    db.from("dc_puzzle_tiles").select("tidx, team_id").eq("day", day).order("tidx"),
  ]);

  const groups = (groupRows ?? []) as Array<{
    gidx: number;
    group_id: string;
    label: string;
    team_ids: number[];
  }>;
  const tiles = ((tileRows ?? []) as Array<{ tidx: number; team_id: number }>).map((t) => t.team_id);
  /* A short board is a generation bug, and serving it would produce a puzzle
     that cannot be finished. Refuse — the page reads that as "no board today",
     which is loud enough to notice and honest about what it knows. */
  if (groups.length !== 4 || tiles.length !== 16) return null;

  const { data: teams } = await db
    .from("teams")
    .select("id, school, abbreviation, color, logo_url")
    .in("id", tiles);
  const crests: DcDay["crests"] = {};
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

  return {
    grid: {
      groups: groups.map((g) => ({ id: g.group_id, label: g.label, teamIds: g.team_ids })),
      tiles,
    },
    crests,
  };
}

/** The caller's own board state, or a fresh one. */
export async function fetchDcEntry(
  db: SupabaseClient,
  userId: string,
  day: string,
): Promise<DcEntryState> {
  const { data } = await db
    .from("dc_entries")
    .select("solved, mistakes, guesses, completed_at")
    .eq("user_id", userId)
    .eq("day", day)
    .maybeSingle();
  return (data as DcEntryState | null) ?? EMPTY_DC;
}

/**
 * The caller's record. A win is clearing all four groups; **unfinished boards
 * are filtered out**, the same rule the other two apply — somebody who opened
 * the board and walked away has not lost it.
 */
export async function fetchDcStanding(
  db: SupabaseClient,
  userId: string,
): Promise<DailyStats> {
  const { data } = await db
    .from("dc_entries")
    .select("day, solved, mistakes, completed_at")
    .eq("user_id", userId);
  const rows = ((data ?? []) as Array<{
    day: string;
    solved: string[];
    mistakes: number;
    completed_at: string | null;
  }>)
    .filter((r) => r.completed_at !== null)
    .map((r) => ({
      day: r.day,
      won: (r.solved?.length ?? 0) >= 4,
      /* Score is mistakes REMAINING, so higher is better and `best` means what
         it says on every game in the arcade. A board cleared without a mistake
         scores 4. */
      score: (r.solved?.length ?? 0) >= 4 ? 4 - r.mistakes : 0,
    }));
  return rows.length === 0 ? EMPTY_DAILY : dailyStanding(rows);
}

export { dcOver };
