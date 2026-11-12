import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import type { GameRow, TeamRow } from "../../../lib/db-types";
import { fetchCurrentSeasonWeek } from "../../../lib/queries";
import type { SeasonType } from "../../../lib/season";
import type { MyBetView, MyPickView } from "../../../lib/slate";
import type { WagerResult } from "../../../lib/records";
import {
  tickerMine,
  tickerStake,
  tickerSummary,
  type TickerData,
  type TickerGame,
  type TickerMine,
  type TickerStake,
  type TickerSummary,
} from "../../../lib/ticker";
import { createClient } from "../../../lib/supabase/server";
import { createServiceClient } from "../../../lib/supabase/service";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 3600 * 1000;
const SOON_MS = 4 * 3600 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tiny gameday payload for the score ticker: live games, finals from the last
 * 24h, and kickoffs within 4h. Empty outside those windows (ticker hides).
 */
export async function GET(req: NextRequest) {
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
    "id, status, start_ts, current_period, current_clock, home_points, away_points, home_team_id, away_team_id, current_situation, possession, tv";
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
    | "current_situation"
    | "possession"
    | "tv"
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
  const [{ data: teams }, { data: consensus }] = await Promise.all([
    teamIds.length > 0
      ? supabase.from("teams").select("id, school, abbreviation, color, logo_url").in("id", teamIds)
      : Promise.resolve({ data: [] }),
    // The market number on each chip (TV-3). Public, like the scores.
    rows.length > 0
      ? supabase
          .from("line_consensus")
          .select("game_id, spread, total")
          .in(
            "game_id",
            rows.map((g) => g.id),
          )
      : Promise.resolve({ data: [] }),
  ]);
  type ConsensusSlim = { game_id: number; spread: number | null; total: number | null };
  const toNum = (v: number | null) => (v === null ? null : Number(v));
  const spreadById = new Map(
    ((consensus ?? []) as ConsensusSlim[]).map((c) => [c.game_id, toNum(c.spread)]),
  );
  const totalById = new Map(
    ((consensus ?? []) as ConsensusSlim[]).map((c) => [c.game_id, toNum(c.total)]),
  );
  // TV-10: the broadcast tiles need each school's logo and colour.
  const lookById = new Map(
    ((teams ?? []) as Array<Pick<TeamRow, "id" | "color" | "logo_url">>).map((t) => [
      t.id,
      { color: t.color ?? null, logo: t.logo_url ?? null },
    ]),
  );
  // TV-18: full school names, for the touchdown banner.
  const nameById = new Map(
    ((teams ?? []) as Array<Pick<TeamRow, "id" | "school">>).map((t) => [t.id, t.school]),
  );
  const abbrById = new Map(
    ((teams ?? []) as Array<Pick<TeamRow, "id" | "school" | "abbreviation">>).map((t) => [
      t.id,
      t.abbreviation ??
        t.school
          .replace(/[^A-Za-z]/g, "")
          .slice(0, 4)
          .toUpperCase(),
    ]),
  );

  // The broadcast-strip layer: which of these games the viewer has money or a
  // pick on, and how it's going. Signed-out gets the plain strip — the two
  // extra queries only run for a session, and RLS scopes both to own rows.
  const { data: auth } = await supabase.auth.getUser();
  let userId = auth?.user?.id ?? null;
  let mineDb: SupabaseClient = supabase;

  /* TV-2: the Fire TV overlay can't sign in, so it carries the viewer's
     calendar key as `?k=` (migration 0054: a capability token for a client
     that cannot hold a session). Resolved on the service client, the same
     posture as /api/calendar/[token]; both queries below filter on user_id
     explicitly, so bypassing RLS discloses nothing beyond this viewer's own
     verdicts. A bad or unknown key is the plain strip, never an error. */
  if (userId === null) {
    const k = req.nextUrl.searchParams.get("k");
    if (k && UUID_RE.test(k) && rows.length > 0) {
      const svc = createServiceClient();
      const { data: tok } = await svc
        .from("calendar_tokens")
        .select("user_id")
        .eq("token", k)
        .maybeSingle();
      if (tok) {
        userId = tok.user_id as string;
        mineDb = svc;
      }
    }
  }

  let summary: TickerSummary | null = null;
  const mineById = new Map<number, TickerMine | null>();
  const stakeById = new Map<number, TickerStake | null>();
  if (userId !== null && rows.length > 0) {
    const gameIds = rows.map((g) => g.id);
    const [betsRes, picksRes] = await Promise.all([
      mineDb
        .from("bets")
        .select("id, game_id, bet_type, side, line_taken, odds, units, result, payout_units")
        .in("game_id", gameIds)
        .eq("user_id", userId)
        .is("voided_at", null)
        .order("placed_at", { ascending: true }),
      mineDb
        .from("picks")
        .select("game_id, market, side, line_at_pick")
        .in("game_id", gameIds)
        .eq("user_id", userId),
    ]);
    type BetRowSlim = {
      id: number;
      game_id: number;
      bet_type: string;
      side: string | null;
      line_taken: number | null;
      odds: number;
      units: number;
      result: WagerResult | "void" | null;
      payout_units: number | null;
    };
    type PickRowSlim = {
      game_id: number;
      market: MyPickView["market"];
      side: string;
      line_at_pick: number | null;
    };
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
    summary = tickerSummary((betsRes.data ?? []) as BetRowSlim[], rows);
    for (const g of rows) {
      stakeById.set(
        g.id,
        tickerStake(
          betsByGame.get(g.id) ?? [],
          picksByGame.get(g.id) ?? [],
          abbrById.get(g.home_team_id) ?? "?",
          abbrById.get(g.away_team_id) ?? "?",
        ),
      );
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
    homeName: nameById.get(g.home_team_id) ?? null,
    awayName: nameById.get(g.away_team_id) ?? null,
    homePoints: g.home_points,
    awayPoints: g.away_points,
    homeColor: lookById.get(g.home_team_id)?.color ?? null,
    awayColor: lookById.get(g.away_team_id)?.color ?? null,
    homeLogo: lookById.get(g.home_team_id)?.logo ?? null,
    awayLogo: lookById.get(g.away_team_id)?.logo ?? null,
    tv: g.tv ?? null,
    mine: mineById.get(g.id) ?? null,
    stake: stakeById.get(g.id) ?? null,
    spread: spreadById.get(g.id) ?? null,
    total: totalById.get(g.id) ?? null,
    // TV-8: the card view shows who has the ball and where. Only meaningful
    // live; the sync nulls both at the final whistle.
    possession: g.status === "in_progress" ? (g.possession ?? null) : null,
    situation: g.status === "in_progress" ? (g.current_situation ?? null) : null,
    // MIA is Miami on Saturday and the Dolphins on Sunday; the chip says which.
    ...(nflIds.has(g.id) ? { sport: "nfl" as const } : {}),
  }));

  // TV-16: the deploy this answer came from. The TV pages reload themselves
  // when it changes, so a fix reaches the overlay without touching the remote.
  const build = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  const payload: TickerData = { seasonId, week, games, summary, build };
  return NextResponse.json(payload, {
    headers: { "cache-control": "no-store" },
  });
}
