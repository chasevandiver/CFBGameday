import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BetRow,
  GameRow,
  LineConsensusRow,
  LineSnapshotRow,
  PickRow,
  PredictionRow,
  ProfileRow,
  TeamRow,
} from "./db-types";
import { pickPollRanks, pollShortName } from "./rankings";
import { fetchCurrentSlate, type SeasonType } from "./season";
import { atsRecord, ouRecord } from "./slate";
import type { CrewPickView, GameView, LinePoint, MyBetView, SlateData, TeamView } from "./slate";

// Consensus math lives in ./consensus (single shared implementation for app +
// jobs); re-exported here for existing importers.
import { consensusFromSnapshots, snapToHalf } from "./consensus";

export { consensusFromSnapshots, snapToHalf };

/** The columns the sparkline actually needs — keeps the wire payload small. */
export interface HistorySnapshot {
  provider: string;
  spread: number | null;
  captured_at: string;
  spread_open?: number | null;
}

/**
 * Consensus spread over time for the movement sparkline: walk snapshots in
 * capture order, keep each provider's latest, emit a point whenever the
 * cross-provider average changes. Capped to the trailing 24 points.
 * Pass `open` (from line_consensus) to seed a start point for games with a
 * single observed value.
 */
export function consensusHistory(
  snapshots: HistorySnapshot[],
  open?: number | null,
): LinePoint[] {
  const sorted = [...snapshots].sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const latestByProvider = new Map<string, number>();
  const points: LinePoint[] = [];
  for (const s of sorted) {
    if (s.spread === null) continue;
    latestByProvider.set(s.provider, s.spread);
    const vals = [...latestByProvider.values()];
    const v = snapToHalf(vals.reduce((a, b) => a + b, 0) / vals.length);
    if (points.length === 0 || points[points.length - 1].v !== v) {
      points.push({ t: s.captured_at, v });
    }
  }
  // seed with the open so a single-snapshot game still shows a start point
  if (points.length === 1) {
    const seed =
      open !== undefined
        ? open
        : mean(sorted.map((s) => s.spread_open ?? s.spread ?? null));
    const snapped = seed === null ? null : snapToHalf(seed);
    if (snapped !== null && snapped !== points[0].v)
      points.unshift({ t: points[0].t, v: snapped });
  }
  return points.slice(-24);
}

function mean(vals: Array<number | null>): number | null {
  const nums = vals.filter((v): v is number => v !== null);
  return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length;
}

function toTeamView(
  t: TeamRow,
  ranks: Map<number, number>,
  records: Map<number, { w: number; l: number }>,
  pollRanks: Map<number, number>,
  pollName: string | null,
): TeamView {
  const rec = records.get(t.id);
  const pollRank = pollRanks.get(t.id) ?? null;
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
    pollRank,
    poll: pollRank === null ? null : pollName,
    record: rec ? `${rec.w}-${rec.l}` : null,
  };
}

export async function fetchSlateView(
  supabase: SupabaseClient,
  seasonId: number,
  week: number,
  userId: string | null,
  seasonType: SeasonType = "regular",
): Promise<SlateData> {
  const fetchedAt = new Date().toISOString();
  const { data: games, error } = await supabase
    .from("games")
    .select("*")
    .eq("season_id", seasonId)
    .eq("week", week)
    .eq("season_type", seasonType)
    .order("start_ts", { ascending: true });
  if (error) throw error;
  if (!games || games.length === 0)
    return { seasonId, week, seasonType, fetchedAt, games: [] };

  const gameRows = games as GameRow[];
  const gameIds = gameRows.map((g) => g.id);
  const teamIds = [...new Set(gameRows.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const venueIds = [...new Set(gameRows.map((g) => g.venue_id).filter((v): v is number => v !== null))];

  // History window: the sparkline shows the trailing 24 consensus changes;
  // a week of snapshots more than covers it and bounds the row count.
  const historyStart = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [teamsRes, consensusRes, historyRes, predsRes, picksRes, betsRes, weatherRes, venuesRes, seasonGamesRes, ratingsRes, pollsRes, crewPicksRes, profilesRes] =
    await Promise.all([
      supabase.from("teams").select("*").in("id", teamIds),
      // one consensus row per game, reduced in Postgres (migration 0015) —
      // not the full snapshot history (audit §8)
      supabase.from("line_consensus").select("*").in("game_id", gameIds),
      supabase
        .from("line_snapshots")
        .select("game_id, provider, spread, captured_at")
        .in("game_id", gameIds)
        .gte("captured_at", historyStart),
      supabase
        .from("predictions")
        .select("*")
        .in("game_id", gameIds)
        .order("created_at", { ascending: false }),
      userId
        ? supabase.from("picks").select("*").in("game_id", gameIds).eq("user_id", userId)
        : Promise.resolve({ data: [], error: null }),
      userId
        ? supabase
            .from("bets")
            .select("id, game_id, bet_type, side, line_taken")
            .in("game_id", gameIds)
            .eq("user_id", userId)
            .is("result", null)
            .is("voided_at", null)
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
        .from("latest_ratings")
        .select("team_id, week, overall")
        .eq("season_id", seasonId),
      supabase
        .from("poll_rankings")
        .select("week, poll, team_id, rank")
        .eq("season_id", seasonId)
        .eq("season_type", "regular"),
      // whole season, whole crew: this week's rows drive the crew standing on
      // each card, and the graded rows (result set) drive each mate's record
      supabase
        .from("picks")
        .select("user_id, game_id, side, result")
        .eq("season_id", seasonId),
      supabase.from("profiles").select("id, display_name"),
    ]);

  const teams = new Map(((teamsRes.data ?? []) as TeamRow[]).map((t) => [t.id, t]));

  const consensusByGame = new Map(
    ((consensusRes.data ?? []) as LineConsensusRow[]).map((c) => [c.game_id, c]),
  );
  const historyByGame = new Map<number, Array<HistorySnapshot & { game_id: number }>>();
  for (const s of (historyRes.data ?? []) as Array<HistorySnapshot & { game_id: number }>) {
    const arr = historyByGame.get(s.game_id) ?? [];
    arr.push(s);
    historyByGame.set(s.game_id, arr);
  }

  // newest prediction wins; prefer frozen (Thursday receipts) rows
  const predByGame = new Map<number, PredictionRow>();
  for (const p of (predsRes.data ?? []) as PredictionRow[]) {
    const existing = predByGame.get(p.game_id);
    if (!existing || (p.frozen && !existing.frozen)) predByGame.set(p.game_id, p);
  }

  const pickByGame = new Map(((picksRes.data ?? []) as PickRow[]).map((p) => [p.game_id, p]));

  // crew standing: everyone else's picks per slate game + season records
  const nameByUser = new Map(
    ((profilesRes.data ?? []) as Array<{ id: string; display_name: string }>).map((p) => [
      p.id,
      p.display_name,
    ]),
  );
  const allPicks = (crewPicksRes.data ?? []) as Array<{
    user_id: string;
    game_id: number;
    side: string;
    result: string | null;
  }>;
  const recordByUser = new Map<string, { w: number; l: number }>();
  for (const p of allPicks) {
    if (p.result !== "win" && p.result !== "loss") continue;
    const rec = recordByUser.get(p.user_id) ?? { w: 0, l: 0 };
    if (p.result === "win") rec.w += 1;
    else rec.l += 1;
    recordByUser.set(p.user_id, rec);
  }
  const gameIdSet = new Set(gameIds);
  const crewByGame = new Map<number, CrewPickView[]>();
  for (const p of allPicks) {
    if (!gameIdSet.has(p.game_id) || p.user_id === userId) continue;
    const rec = recordByUser.get(p.user_id);
    const arr = crewByGame.get(p.game_id) ?? [];
    arr.push({
      name: nameByUser.get(p.user_id) ?? "Crew",
      side: p.side,
      record: rec ? `${rec.w}-${rec.l}` : null,
    });
    crewByGame.set(p.game_id, arr);
  }

  const betsByGame = new Map<number, MyBetView[]>();
  for (const b of (betsRes.data ?? []) as Array<
    Pick<BetRow, "id" | "game_id" | "bet_type" | "side" | "line_taken">
  >) {
    if (b.game_id === null) continue;
    const arr = betsByGame.get(b.game_id) ?? [];
    arr.push({
      id: b.id,
      betType: b.bet_type,
      side: b.side,
      line: b.line_taken === null ? null : Number(b.line_taken),
    });
    betsByGame.set(b.game_id, arr);
  }

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

  // model ranks from each team's latest ratings row (latest_ratings view)
  const allRatings = (ratingsRes.data ?? []) as Array<{
    team_id: number;
    week: number;
    overall: number;
  }>;
  const ranks = new Map<number, number>();
  [...allRatings]
    .sort((a, b) => Number(b.overall) - Number(a.overall))
    .forEach((r, i) => ranks.set(r.team_id, i + 1));

  // human-poll ranks: latest week, CFP > AP > Coaches
  const { poll, byTeam: pollRanks } = pickPollRanks(
    (pollsRes.data ?? []) as Array<{ week: number; poll: string; team_id: number; rank: number }>,
  );
  const pollName = pollShortName(poll);

  const nullConsensus: LineConsensusRow = {
    game_id: 0,
    spread: null,
    spread_open: null,
    total: null,
    total_open: null,
    ml_home: null,
    ml_away: null,
  };
  const views: GameView[] = gameRows.flatMap((game) => {
    const home = teams.get(game.home_team_id);
    const away = teams.get(game.away_team_id);
    if (!home || !away) return [];
    const c = consensusByGame.get(game.id) ?? nullConsensus;
    const consensus = {
      spread: c.spread === null ? null : Number(c.spread),
      open: c.spread_open === null ? null : Number(c.spread_open),
      total: c.total === null ? null : Number(c.total),
      totalOpen: c.total_open === null ? null : Number(c.total_open),
      mlHome: c.ml_home === null ? null : Number(c.ml_home),
      mlAway: c.ml_away === null ? null : Number(c.ml_away),
    };
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
        situation: game.current_situation,
        lastPlay: game.last_play,
        possession: game.possession,
        tv: game.tv,
        neutralSite: game.neutral_site,
        homePoints: game.home_points,
        awayPoints: game.away_points,
        home: toTeamView(home, ranks, records, pollRanks, pollName),
        away: toTeamView(away, ranks, records, pollRanks, pollName),
        lines: {
          spread: consensus.spread,
          spreadOpen: consensus.open,
          total: consensus.total,
          totalOpen: consensus.totalOpen,
          mlHome: consensus.mlHome,
          mlAway: consensus.mlAway,
        },
        spreadHistory: consensusHistory(historyByGame.get(game.id) ?? [], consensus.open),
        prediction: pred
          ? {
              spread: Number(pred.spread),
              total: pred.total === null ? null : Number(pred.total),
              homeScore: pred.home_score === null ? null : Number(pred.home_score),
              awayScore: pred.away_score === null ? null : Number(pred.away_score),
              homeWinProb: Number(pred.home_win_prob),
              coverProb: pred.cover_prob === null ? null : Number(pred.cover_prob),
              vegasSpread: pred.vegas_spread === null ? null : snapToHalf(Number(pred.vegas_spread)),
              edge: pred.edge === null ? null : Number(pred.edge),
              edgeFlag: pred.edge_flag,
              consensus: pred.consensus_flag,
              frozen: pred.frozen,
            }
          : null,
        myPick: pick ? { side: pick.side, line: Number(pick.line_at_pick) } : null,
        myBets: betsByGame.get(game.id) ?? [],
        crewPicks: crewByGame.get(game.id) ?? [],
        weather: weather
          ? { tempF: weather.temp_f, windMph: weather.wind_mph, precipProb: weather.precip_prob }
          : null,
        dome: game.venue_id !== null ? (domeByVenue.get(game.venue_id) ?? false) : false,
      },
    ];
  });

  return { seasonId, week, seasonType, fetchedAt, games: views };
}

export interface TeamAtsSummary {
  ats: { w: number; l: number; p: number };
  homeAts: { w: number; l: number; p: number };
  awayAts: { w: number; l: number; p: number };
  ou: { o: number; u: number; p: number };
}

/**
 * Season ATS + O/U records for a set of teams, graded against the closing
 * consensus (last snapshots before kickoff — same cutoff as the Sunday
 * grader). Fun-box data only; never fed to the model (docs/SPEC.md §6).
 */
export async function fetchTeamAtsSeason(
  supabase: SupabaseClient,
  seasonId: number,
  teamIds: number[],
): Promise<Map<number, TeamAtsSummary>> {
  if (teamIds.length === 0) return new Map();
  const orExpr = teamIds
    .flatMap((id) => [`home_team_id.eq.${id}`, `away_team_id.eq.${id}`])
    .join(",");
  const { data: gameRows } = await supabase
    .from("games")
    .select("id, start_ts, home_team_id, away_team_id, home_points, away_points")
    .eq("season_id", seasonId)
    .eq("status", "final")
    .or(orExpr);
  const finals = ((gameRows ?? []) as Array<{
    id: number;
    start_ts: string | null;
    home_team_id: number;
    away_team_id: number;
    home_points: number | null;
    away_points: number | null;
  }>).filter((g) => g.home_points !== null && g.away_points !== null);
  if (finals.length === 0) return new Map();

  const { data: snaps } = await supabase
    .from("line_snapshots")
    .select("*")
    .in(
      "game_id",
      finals.map((g) => g.id),
    );
  const snapsByGame = new Map<number, LineSnapshotRow[]>();
  for (const s of (snaps ?? []) as LineSnapshotRow[]) {
    const arr = snapsByGame.get(s.game_id) ?? [];
    arr.push(s);
    snapsByGame.set(s.game_id, arr);
  }

  const result = new Map<number, TeamAtsSummary>();
  for (const teamId of teamIds) {
    const mine = finals.filter((g) => g.home_team_id === teamId || g.away_team_id === teamId);
    const inputs = mine.map((g) => {
      const closing = consensusFromSnapshots(
        snapsByGame.get(g.id) ?? [],
        g.start_ts ?? undefined,
      );
      return {
        teamIsHome: g.home_team_id === teamId,
        margin: (g.home_points as number) - (g.away_points as number),
        closingSpread: closing.spread,
        totalPoints: (g.home_points as number) + (g.away_points as number),
        closingTotal: closing.total,
      };
    });
    result.set(teamId, {
      ats: atsRecord(inputs),
      homeAts: atsRecord(inputs.filter((i) => i.teamIsHome)),
      awayAts: atsRecord(inputs.filter((i) => !i.teamIsHome)),
      ou: ouRecord(inputs),
    });
  }
  return result;
}

export async function fetchCurrentSeasonWeek(
  supabase: SupabaseClient,
): Promise<{ seasonId: number; week: number; seasonType: SeasonType }> {
  const { data: season } = await supabase
    .from("seasons")
    .select("id")
    .eq("is_current", true)
    .maybeSingle();
  if (!season) throw new Error("No current season configured — seed the seasons table.");

  const pointer = await fetchCurrentSlate(supabase, season.id);
  return { seasonId: season.id, ...pointer };
}

/**
 * Games for the ledger's bet form: a rolling now−3d…now+9d window rather than
 * "this week", so a bet can still be attached to last night's game after the
 * current-week pointer rolls over (audit #18).
 */
export async function fetchBetFormGames(
  supabase: SupabaseClient,
  seasonId: number,
): Promise<{
  data: Array<{ id: number; start_ts: string | null; home_team_id: number; away_team_id: number }>;
}> {
  const now = Date.now();
  const { data } = await supabase
    .from("games")
    .select("id, start_ts, home_team_id, away_team_id")
    .eq("season_id", seasonId)
    .gte("start_ts", new Date(now - 3 * 24 * 3600 * 1000).toISOString())
    .lte("start_ts", new Date(now + 9 * 24 * 3600 * 1000).toISOString())
    .order("start_ts", { ascending: true });
  return { data: data ?? [] };
}

/**
 * CFBD calls metered so far this calendar month (UTC), from api_call_log.
 * Service-role only — the table is deny-all under RLS.
 */
export async function fetchCfbdCallsThisMonth(service: SupabaseClient): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { count } = await service
    .from("api_call_log")
    .select("id", { count: "exact", head: true })
    .gte("called_at", monthStart.toISOString());
  return count ?? 0;
}

export async function fetchProfiles(supabase: SupabaseClient): Promise<ProfileRow[]> {
  const { data } = await supabase.from("profiles").select("*").order("display_name");
  return (data ?? []) as ProfileRow[];
}
