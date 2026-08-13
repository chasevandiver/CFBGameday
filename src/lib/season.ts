/**
 * "What slate is it right now?" — derived from the games table, not calendar
 * arithmetic (audit bug #6: the old floor((now − week0_start)/7d) math flipped
 * the current week at Friday 7pm CT and spent Sunday–Friday pointed at the
 * previous week's finals).
 *
 * Rules, in order:
 *   1. If anything is live, the slate of the earliest live game is current.
 *   2. Else the slate of the next kickoff (scheduled, started within the last
 *      6h — covers status lag — or any time in the future) is current. This
 *      rolls the site forward the moment a week's last game goes final.
 *   3. Else (season over / nothing ingested yet) the latest final's slate.
 *
 * Shared by the app (fetchCurrentSeasonWeek) and the freeze job, which
 * previously had its own min-scheduled-week logic that a postponed-and-
 * rescheduled game could pin forever (audit bug #8).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** CFB uses regular | postseason; the NFL adds preseason (August, weeks 1–4,
 *  week 1 being the Hall of Fame game). Real games, real lines, real bets —
 *  just no pick'em boards (set_group_week_config rejects it) and no model. */
export type SeasonType = "preseason" | "regular" | "postseason";

export interface SlatePointer {
  week: number;
  seasonType: SeasonType;
}

const LATE_START_GRACE_MS = 6 * 3600 * 1000;

export async function fetchCurrentSlate(
  db: SupabaseClient,
  seasonId: number,
): Promise<SlatePointer> {
  const cutoff = new Date(Date.now() - LATE_START_GRACE_MS).toISOString();

  const { data: next } = await db
    .from("games")
    .select("week, season_type, start_ts, status")
    .eq("season_id", seasonId)
    .or(`status.eq.in_progress,and(status.eq.scheduled,start_ts.gte.${cutoff})`)
    .order("start_ts", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (next) return toPointer(next.week, next.season_type);

  const { data: last } = await db
    .from("games")
    .select("week, season_type")
    .eq("season_id", seasonId)
    .eq("status", "final")
    .order("start_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last) return toPointer(last.week, last.season_type);

  return { week: 1, seasonType: "regular" };
}

function toPointer(week: number, seasonType: string): SlatePointer {
  return {
    week,
    seasonType:
      seasonType === "postseason" ? "postseason" : seasonType === "preseason" ? "preseason" : "regular",
  };
}
