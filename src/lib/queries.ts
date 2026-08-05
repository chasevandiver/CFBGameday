import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  GameRow,
  LineSnapshotRow,
  PickRow,
  PredictionRow,
  ProfileRow,
  TeamRow,
} from "./db-types";
import type { GameView, LinePoint, SlateData, TeamView } from "./slate";

/** Consensus of the most recent snapshot per provider. */
export function consensusFromSnapshots(snapshots: LineSnapshotRow[]): {
  spread: number | null;
  open: number | null;
  total: number | null;
  totalOpen: number | null;
  mlHome: number | null;
  mlAway: number | null;
} {
  const latestByProvider = new Map<string, LineSnapshotRow>();
  for (const s of snapshots) {
    const prev = latestByProvider.get(s.provider);
    if (!prev || s.captured_at > prev.captured_at) latestByProvider.set(s.provider, s);
  }
  const latest = [...latestByProvider.values()];
  const avg = (vals: Array<number | null>, digits = 1): number | null => {
    const nums = vals.filter((v): v is number => v !== null);
    if (nums.length === 0) return null;
    const f = 10 ** digits;
    return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * f) / f;
  };
  return {
    spread: avg(latest.map((s) => s.spread)),
    open: avg(latest.map((s) => s.spread_open ?? s.spread)),
    total: avg(latest.map((s) => s.total)),
    totalOpen: avg(latest.map((s) => s.total_open ?? s.total)),
    mlHome: avg(latest.map((s) => s.ml_home), 0),
    mlAway: avg(latest.map((s) => s.ml_away), 0),
  };
}

/**
 * Consensus spread over time for the movement sparkline: walk snapshots in
 * capture order, keep each provider's latest, emit a point whenever the
 * cross-provider average changes. Capped to the trailing 24 points.
 */
export function consensusHistory(snapshots: LineSnapshotRow[]): LinePoint[] {
  const sorted = [...snapshots].sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const latestByProvider = new Map<string, number>();
  const points: LinePoint[] = [];
  for (const s of sorted) {
    if (s.spread === null) continue;
    latestByProvider.set(s.provider, s.spread);
    const vals = [...latestByProvider.values()];
    const v = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    if (points.length === 0 || points[points.length - 1].v !== v) {
      points.push({ t: s.captured_at, v });
    }
  }
  // seed with the open so a single-snapshot game still shows a start point
  if (points.length === 1) {
    const open = consensusFromSnapshots(snapshots).open;
    if (open !== null && open !== points[0].v) points.unshift({ t: points[0].t, v: open });
  }
  return points.slice(-24);
}

function toTeamView(
  t: TeamRow,
  ranks: Map<number, number>,
  records: Map<number, { w: number; l: number }>,
): TeamView {
  const rec = records.get(t.id);
  return {
    id: t.id,
    school: t.school,
    abbr: t.abbreviation ?? t.school.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase(),
    mascot: t.mascot,
    conference: t.conference,
    color: t.color,
    altColor: t.alt_color,
    logo: t.logo_url,
    rank: ranks.get(t.id) ?? null,
    record: rec ? `${rec.w}-${rec.l}` : null,
  };
}

export async function fetchSlateView(
  supabase: SupabaseClient,
  seasonId: number,
  week: number,
  userId: string | null,
): Promise<SlateData> {
  const fetchedAt = new Date().toISOString();
  const { data: games, error } = await supabase
    .from("games")
    .select("*")
    .eq("season_id", seasonId)
    .eq("week", week)
    .order("start_ts", { ascending: true });
  if (error) throw error;
  if (!games || games.length === 0) return { seasonId, week, fetchedAt, games: [] };

  const gameRows = games as GameRow[];
  const gameIds = gameRows.map((g) => g.id);
  const teamIds = [...new Set(gameRows.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const venueIds = [...new Set(gameRows.map((g) => g.venue_id).filter((v): v is number => v !== null))];

  const [teamsRes, linesRes, predsRes, picksRes, weatherRes, venuesRes, seasonGamesRes, ratingsRes] =
    await Promise.all([
      supabase.from("teams").select("*").in("id", teamIds),
      supabase.from("line_snapshots").select("*").in("game_id", gameIds),
      supabase
        .from("predictions")
        .select("*")
        .in("game_id", gameIds)
        .order("created_at", { ascending: false }),
      userId
        ? supabase.from("picks").select("*").in("game_id", gameIds).eq("user_id", userId)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("weather_forecasts").select("*").in("game_id", gameIds),
      venueIds.length > 0
        ? supabase.from("venues").select("id, dome").in("id", venueIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("games")
        .select("home_team_id, away_team_id, home_points, away_points, status")
        .eq("season_id", seasonId)
        .eq("status", "final"),
      supabase
        .from("ratings")
        .select("team_id, week, overall")
        .eq("season_id", seasonId),
    ]);

  const teams = new Map(((teamsRes.data ?? []) as TeamRow[]).map((t) => [t.id, t]));

  const linesByGame = new Map<number, LineSnapshotRow[]>();
  for (const s of (linesRes.data ?? []) as LineSnapshotRow[]) {
    const arr = linesByGame.get(s.game_id) ?? [];
    arr.push(s);
    linesByGame.set(s.game_id, arr);
  }

  // newest prediction wins; prefer frozen (Thursday receipts) rows
  const predByGame = new Map<number, PredictionRow>();
  for (const p of (predsRes.data ?? []) as PredictionRow[]) {
    const existing = predByGame.get(p.game_id);
    if (!existing || (p.frozen && !existing.frozen)) predByGame.set(p.game_id, p);
  }

  const pickByGame = new Map(((picksRes.data ?? []) as PickRow[]).map((p) => [p.game_id, p]));

  const weatherByGame = new Map(
    ((weatherRes.data ?? []) as Array<{
      game_id: number;
      temp_f: number | null;
      wind_mph: number | null;
      precip_prob: number | null;
    }>).map((w) => [w.game_id, w]),
  );

  const domeByVenue = new Map(
    ((venuesRes.data ?? []) as Array<{ id: number; dome: boolean }>).map((v) => [v.id, v.dome]),
  );

  // season records from final games
  const records = new Map<number, { w: number; l: number }>();
  for (const g of (seasonGamesRes.data ?? []) as Array<{
    home_team_id: number;
    away_team_id: number;
    home_points: number | null;
    away_points: number | null;
  }>) {
    if (g.home_points === null || g.away_points === null || g.home_points === g.away_points)
      continue;
    const winner = g.home_points > g.away_points ? g.home_team_id : g.away_team_id;
    const loser = winner === g.home_team_id ? g.away_team_id : g.home_team_id;
    const w = records.get(winner) ?? { w: 0, l: 0 };
    w.w += 1;
    records.set(winner, w);
    const l = records.get(loser) ?? { w: 0, l: 0 };
    l.l += 1;
    records.set(loser, l);
  }

  // model ranks from the latest ratings week
  const allRatings = (ratingsRes.data ?? []) as Array<{
    team_id: number;
    week: number;
    overall: number;
  }>;
  const latestRatingWeek = allRatings.length > 0 ? Math.max(...allRatings.map((r) => r.week)) : -1;
  const ranks = new Map<number, number>();
  allRatings
    .filter((r) => r.week === latestRatingWeek)
    .sort((a, b) => b.overall - a.overall)
    .forEach((r, i) => ranks.set(r.team_id, i + 1));

  const views: GameView[] = gameRows.flatMap((game) => {
    const home = teams.get(game.home_team_id);
    const away = teams.get(game.away_team_id);
    if (!home || !away) return [];
    const snapshots = linesByGame.get(game.id) ?? [];
    const consensus = consensusFromSnapshots(snapshots);
    const pred = predByGame.get(game.id) ?? null;
    const pick = pickByGame.get(game.id) ?? null;
    const weather = weatherByGame.get(game.id) ?? null;
    return [
      {
        id: game.id,
        week: game.week,
        startTs: game.start_ts,
        status: game.status,
        period: game.current_period,
        clock: game.current_clock,
        tv: game.tv,
        neutralSite: game.neutral_site,
        homePoints: game.home_points,
        awayPoints: game.away_points,
        home: toTeamView(home, ranks, records),
        away: toTeamView(away, ranks, records),
        lines: {
          spread: consensus.spread,
          spreadOpen: consensus.open,
          total: consensus.total,
          totalOpen: consensus.totalOpen,
          mlHome: consensus.mlHome,
          mlAway: consensus.mlAway,
        },
        spreadHistory: consensusHistory(snapshots),
        prediction: pred
          ? {
              spread: Number(pred.spread),
              total: pred.total === null ? null : Number(pred.total),
              homeScore: pred.home_score === null ? null : Number(pred.home_score),
              awayScore: pred.away_score === null ? null : Number(pred.away_score),
              homeWinProb: Number(pred.home_win_prob),
              vegasSpread: pred.vegas_spread === null ? null : Number(pred.vegas_spread),
              edge: pred.edge === null ? null : Number(pred.edge),
              edgeFlag: pred.edge_flag,
              consensus: pred.consensus_flag,
            }
          : null,
        myPick: pick ? { side: pick.side, line: Number(pick.line_at_pick) } : null,
        weather: weather
          ? { tempF: weather.temp_f, windMph: weather.wind_mph, precipProb: weather.precip_prob }
          : null,
        dome: game.venue_id !== null ? (domeByVenue.get(game.venue_id) ?? false) : false,
      },
    ];
  });

  return { seasonId, week, fetchedAt, games: views };
}

export async function fetchCurrentSeasonWeek(
  supabase: SupabaseClient,
): Promise<{ seasonId: number; week: number }> {
  const { data: season } = await supabase
    .from("seasons")
    .select("id, week0_start")
    .eq("is_current", true)
    .maybeSingle();
  if (!season) return { seasonId: 2026, week: 1 };

  const week0 = new Date(`${season.week0_start}T00:00:00Z`).getTime();
  const elapsedWeeks = Math.floor((Date.now() - week0) / (7 * 24 * 60 * 60 * 1000));
  // CFBD numbers the opening slate week 1; clamp pre-season to week 1 too
  return { seasonId: season.id, week: Math.min(Math.max(elapsedWeeks + 1, 1), 15) };
}

export async function fetchProfiles(supabase: SupabaseClient): Promise<ProfileRow[]> {
  const { data } = await supabase.from("profiles").select("*").order("display_name");
  return (data ?? []) as ProfileRow[];
}
