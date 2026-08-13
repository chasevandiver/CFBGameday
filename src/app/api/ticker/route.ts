import { NextResponse } from "next/server";
import type { GameRow, TeamRow } from "../../../lib/db-types";
import { fetchCurrentSeasonWeek } from "../../../lib/queries";
import type { SeasonType } from "../../../lib/season";
import type { MyBetView, MyPickView } from "../../../lib/slate";
import { tickerMine, type TickerData, type TickerGame, type TickerMine } from "../../../lib/ticker";
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
  // Both leagues share the strip: a Sunday ticker is an NFL ticker. Guarded —
  // the strip must render CFB alone until nfl-sync-reference has run. NFL
  // chips update on the 60s poll; the realtime channel stays keyed to the CFB
  // week (one channel, and CFB Saturdays are where the 30s freshness matters).
  let nfl: { seasonId: number; week: number; seasonType: SeasonType } | null = null;
  try {
    nfl = await fetchCurrentSeasonWeek(supabase, "nfl");
  } catch {
    /* no NFL season configured */
  }

  const GAME_COLS =
    "id, status, start_ts, current_period, current_clock, home_points, away_points, home_team_id, away_team_id";
  const [{ data }, { data: nflData }] = await Promise.all([
    supabase
      .from("games")
      .select(GAME_COLS)
      .eq("season_id", seasonId)
      .eq("week", week)
      .eq("season_type", seasonType)
      .order("start_ts", { ascending: true }),
    nfl
      ? supabase
          .from("games")
          .select(GAME_COLS)
          .eq("season_id", nfl.seasonId)
          .eq("week", nfl.week)
          .eq("season_type", nfl.seasonType)
          .order("start_ts", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

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
  const nflIds = new Set(((nflData ?? []) as Row[]).map((g) => g.id));
  const merged = ([...(data ?? []), ...(nflData ?? [])] as Row[]).sort((a, b) =>
    (a.start_ts ?? "9999").localeCompare(b.start_ts ?? "9999"),
  );
  const rows = merged.filter((g) => {
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

  // The broadcast-strip layer: which of these games the viewer has money or a
  // pick on, and how it's going. Signed-out gets the plain strip — the two
  // extra queries only run for a session, and RLS scopes both to own rows.
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id ?? null;
  const mineById = new Map<number, TickerMine | null>();
  if (userId !== null && rows.length > 0) {
    const gameIds = rows.map((g) => g.id);
    const [betsRes, picksRes] = await Promise.all([
      supabase
        .from("bets")
        .select("id, game_id, bet_type, side, line_taken")
        .in("game_id", gameIds)
        .eq("user_id", userId)
        .is("voided_at", null)
        .order("placed_at", { ascending: true }),
      supabase
        .from("picks")
        .select("game_id, market, side, line_at_pick")
        .in("game_id", gameIds)
        .eq("user_id", userId),
    ]);
    type BetRowSlim = { id: number; game_id: number; bet_type: string; side: string | null; line_taken: number | null };
    type PickRowSlim = { game_id: number; market: MyPickView["market"]; side: string; line_at_pick: number | null };
    const betsByGame = new Map<number, MyBetView[]>();
    for (const b of (betsRes.data ?? []) as BetRowSlim[]) {
      const view: MyBetView = {
        id: b.id,
        betType: b.bet_type,
        side: b.side,
        line: b.line_taken === null ? null : Number(b.line_taken),
      };
      betsByGame.set(b.game_id, [...(betsByGame.get(b.game_id) ?? []), view]);
    }
    const picksByGame = new Map<number, MyPickView[]>();
    for (const p of (picksRes.data ?? []) as PickRowSlim[]) {
      const view: MyPickView = {
        market: p.market,
        side: p.side,
        line: p.line_at_pick === null ? null : Number(p.line_at_pick),
      };
      picksByGame.set(p.game_id, [...(picksByGame.get(p.game_id) ?? []), view]);
    }
    for (const g of rows) {
      mineById.set(
        g.id,
        tickerMine(
          g.status,
          g.home_points,
          g.away_points,
          betsByGame.get(g.id) ?? [],
          picksByGame.get(g.id) ?? [],
        ),
      );
    }
  }

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
    mine: mineById.get(g.id) ?? null,
    // MIA is Miami on Saturday and the Dolphins on Sunday; the chip says which.
    ...(nflIds.has(g.id) ? { sport: "nfl" as const } : {}),
  }));

  const payload: TickerData = { seasonId, week, games };
  return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
}
