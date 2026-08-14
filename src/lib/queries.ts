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
import { hasCalibratedTotals } from "../model/ratings";
import { pickPollRanks, pollShortName } from "./rankings";
import { required } from "./db-result";
import { tallyBy } from "./records";
import { toSheetBet } from "./betting-groups";
import { classifyBets, recentForm, statsByMember, type GroupBetView } from "./tailing";
import { fetchCurrentSlate, type SeasonType } from "./season";
import { seasonIdsForYear, seasonYearOf, sportOfSeasonId, type Sport } from "./league";
import { atsRecord, ouRecord } from "./slate";
import type {
  CrewPickView,
  GameView,
  LinePoint,
  MyBetView,
  RivalryView,
  SlateData,
  TeamView,
} from "./slate";

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
  confRecords: Map<number, { w: number; l: number }>,
  pollRanks: Map<number, number>,
  pollName: string | null,
): TeamView {
  const rec = records.get(t.id);
  const conf = confRecords.get(t.id);
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
    confRecord: conf ? `${conf.w}-${conf.l}` : null,
  };
}

/**
 * The slate, seen from inside one group.
 *
 * `groupId` scopes both halves of the pick layer: your own picks and the crew
 * line under each card. Since migration 0021 a pick belongs to a group, so
 * without it the same user's picks from two pools would collide in a map keyed
 * by game and whichever row came back last would win. Null means "no group in
 * view" — signed out, or signed in with no membership — and the pick layer is
 * simply empty, which is the honest rendering of "you have nothing on this".
 */
export async function fetchSlateView(
  supabase: SupabaseClient,
  seasonId: number,
  week: number,
  userId: string | null,
  seasonType: SeasonType = "regular",
  groupId: string | null = null,
  /**
   * The viewer's betting group, if they're in one. Independent of `groupId`:
   * the pool and the ledger are two products, so a viewer can be in a pick'em
   * group, a betting group, both or neither, and each layer is loaded on its
   * own terms.
   */
  bettingGroupId: string | null = null,
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
    return { seasonId, sport: sportOfSeasonId(seasonId), week, seasonType, fetchedAt, linesAsOf: null, games: [] };

  const gameRows = games as GameRow[];
  const gameIds = gameRows.map((g) => g.id);
  const teamIds = [...new Set(gameRows.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const venueIds = [...new Set(gameRows.map((g) => g.venue_id).filter((v): v is number => v !== null))];

  const [teamsRes, consensusRes, predsRes, picksRes, betsRes, weatherRes, venuesRes, seasonGamesRes, ratingsRes, pollsRes, crewPicksRes, profilesRes, systemsRes, rivalriesRes, sheetMembersRes] =
    await Promise.all([
      supabase.from("teams").select("*").in("id", teamIds),
      // one consensus row per game, reduced in Postgres (migration 0015) —
      // never raw snapshots: a week of them was ~1 MB per poll tick, fetched
      // for a per-card sparkline that was removed on Aug 9. Movement detail
      // lives on /game/[id], which fetches its own single game's snapshots.
      supabase.from("line_consensus").select("*").in("game_id", gameIds),
      supabase
        .from("predictions")
        .select("*")
        .in("game_id", gameIds)
        .order("created_at", { ascending: false }),
      userId && groupId
        ? supabase
            .from("picks")
            .select("*")
            .in("game_id", gameIds)
            .eq("user_id", userId)
            .eq("group_id", groupId)
        : Promise.resolve({ data: [], error: null }),
      userId
        ? supabase
            .from("bets")
            .select("id, game_id, bet_type, side, line_taken, result")
            .in("game_id", gameIds)
            .eq("user_id", userId)
            // Graded bets stay: the card shows your money pregame, live AND
            // postgame, and dropping settled rows made a bet vanish from the
            // slate the moment Sunday's grader touched it. Voids do drop.
            .is("voided_at", null)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("weather_forecasts").select("*").in("game_id", gameIds),
      venueIds.length > 0
        ? supabase.from("venues").select("id, dome").in("id", venueIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("games")
        .select("home_team_id, away_team_id, home_points, away_points, status, conference_game")
        .eq("season_id", seasonId)
        .eq("status", "final"),
      supabase
        .from("latest_ratings")
        .select("team_id, week, overall")
        .eq("season_id", seasonId),
      // latest week per poll only (0025) — pickPollRanks needs no history
      supabase
        .from("latest_poll_rankings")
        .select("week, poll, team_id, rank")
        .eq("season_id", seasonId)
        .eq("season_type", "regular"),
      // whole season, whole crew: this week's rows drive the crew standing on
      // each card, and the graded rows (result set) drive each mate's record
      groupId
        ? supabase
            .from("picks")
            .select("user_id, game_id, market, side, result, units, clv")
            .eq("season_id", seasonId)
            .eq("group_id", groupId)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("profiles").select("id, display_name"),
      // SP+/FPI/Elo for the slate's teams (spec §2.4 promises them on every
      // card) — one row per system+team via 0025, not every synced week
      // (~5,000 rows per tick by week 14, all discarded but the newest).
      supabase
        .from("latest_systems")
        .select("team_id, system, week, value")
        .eq("season_id", seasonId)
        .in("team_id", teamIds),
      // Static editorial seed (migration 0017) — a few hundred rows at most,
      // so it is cheaper to pull once and pair in memory than to build an
      // OR filter per game.
      supabase.from("rivalries").select("team_a_id, team_b_id, name, trophy"),
      // The betting group's roster. Its sheet is these people's ledgers.
      bettingGroupId
        ? supabase
            .from("group_members")
            .select("user_id")
            .eq("group_id", bettingGroupId)
            .is("removed_at", null)
        : Promise.resolve({ data: [], error: null }),
    ]);

  // teams, the consensus lines and the frozen predictions are what a slate card
  // IS. The enrichment below (weather, venues, rivalries, polls, other systems)
  // stays quiet on failure — a missing dome flag should not blank the slate.
  // See db-result.ts for the rule.
  const teams = new Map(required<TeamRow>(teamsRes, "teams").map((t) => [t.id, t]));

  const consensusByGame = new Map(
    required<LineConsensusRow>(consensusRes, "line consensus").map((c) => [c.game_id, c]),
  );
  // newest prediction wins; prefer frozen (Thursday receipts) rows
  const predByGame = new Map<number, PredictionRow>();
  for (const p of required<PredictionRow>(predsRes, "predictions")) {
    const existing = predByGame.get(p.game_id);
    if (!existing || (p.frozen && !existing.frozen)) predByGame.set(p.game_id, p);
  }

  // Up to three picks per game now, one per market. The card carries all of
  // them (it highlights the cell you took in each) and picks one to lead with
  // where it can only show one — see headlinePick.
  const picksByGame = new Map<number, PickRow[]>();
  for (const p of required<PickRow>(picksRes, "picks")) {
    picksByGame.set(p.game_id, [...(picksByGame.get(p.game_id) ?? []), p]);
  }

  // crew standing: everyone else's picks per slate game + season records
  const nameByUser = new Map(
    ((profilesRes.data ?? []) as Array<{ id: string; display_name: string }>).map((p) => [
      p.id,
      p.display_name,
    ]),
  );
  const allPicks = (crewPicksRes.data ?? []) as Array<
    Pick<PickRow, "user_id" | "game_id" | "market" | "side" | "result" | "units" | "clv">
  >;
  // The crew line shows "Dave 12-7" beside a pick, so only W-L is rendered —
  // but it is the same tally as the leaderboard's and shares its implementation
  // so the two can never disagree about, say, whether a void counts.
  const recordByUser = tallyBy(allPicks, (p) => p.user_id);
  const gameIdSet = new Set(gameIds);
  const crewByGame = new Map<number, CrewPickView[]>();
  // Same one-per-mate rule as above: a crew line reading "Dave home, Dave over,
  // Dave home" is three renderings of one opinion.
  const seen = new Set<string>();
  for (const p of [...allPicks].sort((a, b) => (a.market === "spread" ? -1 : 0) - (b.market === "spread" ? -1 : 0))) {
    if (!gameIdSet.has(p.game_id) || p.user_id === userId) continue;
    if (seen.has(`${p.game_id}:${p.user_id}`)) continue;
    seen.add(`${p.game_id}:${p.user_id}`);
    const rec = recordByUser.get(p.user_id);
    const arr = crewByGame.get(p.game_id) ?? [];
    arr.push({
      name: nameByUser.get(p.user_id) ?? "Crew",
      side: p.side,
      // Null, not "0-0", until something has graded — an empty record beside a
      // name reads as a standing, and in week 1 nobody has one yet.
      record: rec && rec.decided > 0 ? `${rec.wins}-${rec.losses}` : null,
    });
    crewByGame.set(p.game_id, arr);
  }

  /* ---- the betting group's sheet on this week's games -------------------
   *
   * Classified across the whole season, then filtered to this week. It has to
   * be that way round: origination is decided against every bet in the group,
   * and the source's record — the number that makes a position worth copying —
   * is a season figure. Scoping the query to this week's game ids would still
   * classify correctly (the market key carries the game), but every record on
   * every card would read as a one-week sample.
   */
  const sheetMemberIds = ((sheetMembersRes.data ?? []) as Array<{ user_id: string }>).map(
    (r) => r.user_id,
  );
  const groupBetsByGame = new Map<number, GroupBetView[]>();
  if (bettingGroupId !== null && sheetMemberIds.length > 0) {
    const { data: sheetRows } = await supabase
      .from("bets")
      .select("*")
      .eq("season_id", seasonId)
      .in("user_id", sheetMemberIds);
    const sheetBets = ((sheetRows ?? []) as BetRow[]).map(toSheetBet);
    const classified = classifyBets(sheetBets);
    const memberStats = statsByMember(classified, sheetMemberIds);
    const formByUser = new Map(
      sheetMemberIds.map((id) => [
        id,
        recentForm(sheetBets.filter((b) => b.userId === id)).label,
      ]),
    );
    const nameOf = (id: string) => nameByUser.get(id) ?? "A member";
    const weekGameIds = new Set(gameIds);
    for (const b of classified) {
      if (b.gameId === null || !weekGameIds.has(b.gameId)) continue;
      const overall = memberStats.get(b.userId)?.overall;
      const arr = groupBetsByGame.get(b.gameId) ?? [];
      arr.push({
        betId: b.id,
        userId: b.userId,
        name: nameOf(b.userId),
        betType: b.betType,
        side: b.side,
        line: b.line,
        odds: b.odds,
        units: b.units,
        relation: b.relation,
        isViewer: b.userId === userId,
        record: overall && overall.decided > 0 ? `${overall.wins}-${overall.losses}` : null,
        form: formByUser.get(b.userId) ?? "level",
        sourceName: b.sourceUserId === null ? null : nameOf(b.sourceUserId),
        tailedBy: b.tailedBy,
        fadedBy: b.fadedBy,
        result: b.result,
      });
      groupBetsByGame.set(b.gameId, arr);
    }
    // Source first, then whoever followed, in the order they arrived — the
    // card is a timeline of who got there when.
    for (const arr of groupBetsByGame.values()) {
      arr.sort(
        (x, y) =>
          Number(y.relation === "origin") - Number(x.relation === "origin") || x.betId - y.betId,
      );
    }
  }

  const betsByGame = new Map<number, MyBetView[]>();
  for (const b of (betsRes.data ?? []) as Array<
    Pick<BetRow, "id" | "game_id" | "bet_type" | "side" | "line_taken" | "result">
  >) {
    if (b.game_id === null) continue;
    const arr = betsByGame.get(b.game_id) ?? [];
    arr.push({
      id: b.id,
      betType: b.bet_type,
      side: b.side,
      line: b.line_taken === null ? null : Number(b.line_taken),
      result: b.result,
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

  // latest value per system per team — rows arrive newest week first, so the
  // first one seen for a key wins (same reduction as game/[id])
  const systemLatest = new Map<string, number>();
  for (const r of (systemsRes.data ?? []) as Array<{
    team_id: number;
    system: string;
    value: number;
  }>) {
    const key = `${r.system}:${r.team_id}`;
    if (!systemLatest.has(key)) systemLatest.set(key, Number(r.value));
  }

  // rivalries are unordered pairs; key both directions so lookup is one hit
  const rivalryByPair = new Map<string, RivalryView>();
  for (const r of (rivalriesRes.data ?? []) as Array<{
    team_a_id: number;
    team_b_id: number;
    name: string | null;
    trophy: string | null;
  }>) {
    if (!r.name) continue;
    const view: RivalryView = { name: r.name, trophy: r.trophy };
    rivalryByPair.set(`${r.team_a_id}:${r.team_b_id}`, view);
    rivalryByPair.set(`${r.team_b_id}:${r.team_a_id}`, view);
  }

  // Season records from final games, overall and in conference. The league
  // record is the one a fan quotes second ("8-1, 5-1 in the Big Ten") and it is
  // the difference between a good team and a team in the race, so both halves
  // ride on the card. `conference_game` is the schedule's own flag, not a
  // comparison of the two conference strings — a team changing leagues
  // mid-season would make that comparison lie about games already played.
  const records = new Map<number, { w: number; l: number }>();
  const confRecords = new Map<number, { w: number; l: number }>();
  const credit = (
    into: Map<number, { w: number; l: number }>,
    winner: number,
    loser: number,
  ) => {
    const w = into.get(winner) ?? { w: 0, l: 0 };
    w.w += 1;
    into.set(winner, w);
    const l = into.get(loser) ?? { w: 0, l: 0 };
    l.l += 1;
    into.set(loser, l);
  };
  for (const g of (seasonGamesRes.data ?? []) as Array<{
    home_team_id: number;
    away_team_id: number;
    home_points: number | null;
    away_points: number | null;
    conference_game: boolean | null;
  }>) {
    if (g.home_points === null || g.away_points === null || g.home_points === g.away_points)
      continue;
    const winner = g.home_points > g.away_points ? g.home_team_id : g.away_team_id;
    const loser = winner === g.home_team_id ? g.away_team_id : g.home_team_id;
    credit(records, winner, loser);
    if (g.conference_game) credit(confRecords, winner, loser);
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
    as_of: null,
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
        home: toTeamView(home, ranks, records, confRecords, pollRanks, pollName),
        away: toTeamView(away, ranks, records, confRecords, pollRanks, pollName),
        lines: {
          spread: consensus.spread,
          spreadOpen: consensus.open,
          total: consensus.total,
          totalOpen: consensus.totalOpen,
          mlHome: consensus.mlHome,
          mlAway: consensus.mlAway,
        },
        prediction: pred
          ? {
              spread: Number(pred.spread),
              // frozen rows are append-only history; totals from versions
              // that priced them as a constant must never render (audit #4)
              total:
                pred.total === null || !hasCalibratedTotals(pred.model_version)
                  ? null
                  : Number(pred.total),
              homeScore:
                pred.home_score === null || !hasCalibratedTotals(pred.model_version)
                  ? null
                  : Number(pred.home_score),
              awayScore:
                pred.away_score === null || !hasCalibratedTotals(pred.model_version)
                  ? null
                  : Number(pred.away_score),
              homeWinProb: Number(pred.home_win_prob),
              coverProb: pred.cover_prob === null ? null : Number(pred.cover_prob),
              vegasSpread: pred.vegas_spread === null ? null : snapToHalf(Number(pred.vegas_spread)),
              edge: pred.edge === null ? null : Number(pred.edge),
              edgeFlag: pred.edge_flag,
              consensus: pred.consensus_flag,
              frozen: pred.frozen,
            }
          : null,
        myPicks: (picksByGame.get(game.id) ?? []).map((p) => ({
          market: p.market,
          side: p.side,
          line: p.line_at_pick === null ? null : Number(p.line_at_pick),
        })),
        myBets: betsByGame.get(game.id) ?? [],
        crewPicks: crewByGame.get(game.id) ?? [],
        groupBets: groupBetsByGame.get(game.id) ?? [],
        weather: weather
          ? { tempF: weather.temp_f, windMph: weather.wind_mph, precipProb: weather.precip_prob }
          : null,
        dome: game.venue_id !== null ? (domeByVenue.get(game.venue_id) ?? false) : false,
        rivalry: rivalryByPair.get(`${game.home_team_id}:${game.away_team_id}`) ?? null,
        systems: (["sp", "fpi", "elo"] as const)
          .map((system) => ({
            system,
            home: systemLatest.get(`${system}:${game.home_team_id}`) ?? null,
            away: systemLatest.get(`${system}:${game.away_team_id}`) ?? null,
          }))
          .filter((s) => s.home !== null || s.away !== null),
      },
    ];
  });

  // When the lines on screen were captured, not when the page was rendered —
  // with the minimal refresh cadence those differ by design, and the header
  // says which one it is showing.
  let linesAsOf: string | null = null;
  for (const c of consensusByGame.values()) {
    if (c.as_of !== null && (linesAsOf === null || c.as_of > linesAsOf)) linesAsOf = c.as_of;
  }

  return { seasonId, sport: sportOfSeasonId(seasonId), week, seasonType, fetchedAt, linesAsOf, games: views };
}

/**
 * Every live game, both leagues, one list (UX-36).
 *
 * Owner request 2026-08-14: "The slate should have a live games option to show
 * all of the live games as well as the options to view just cfb or just nfl."
 * There was no live filter of any kind before this — only a count pill in the
 * control bar and a "Live" section that appears solely when the sort is by
 * kickoff.
 *
 * ## Built out of `fetchSlateView`, not beside it
 *
 * The obvious implementation is one query over `status = 'in_progress'` across
 * both seasons. It is wrong, and expensively so: half of `fetchSlateView` is
 * enrichment keyed to a single season — ratings, poll ranks, SP+/FPI/Elo,
 * season ATS records — and a cross-league query would have to fork every one of
 * those. A card assembled that way would drift from the same card on the CFB
 * tab, which is the failure this codebase keeps recording.
 *
 * So the live game ids are found first (one cheap indexed read — 0044 added
 * `games_sport_status_start` for a predicate almost exactly like this one),
 * their distinct (season, week, season_type) buckets resolved, and each bucket
 * loaded through the ordinary path and filtered to what is live. Usually one
 * bucket, two on an NFL Sunday overlapping a CFB Saturday night. Every card is
 * then byte-for-byte the card its own league's tab would render.
 *
 * ## Why buckets rather than "the current week"
 *
 * Asking each league's pointer for its current week is simpler and drops games.
 * The NFL pointer rolls forward while Monday Night Football is still being
 * played, so a viewer with money on MNF would find the Live tab empty at
 * exactly the moment it matters most. Reading the buckets off the live rows
 * themselves cannot make that mistake.
 */
export async function fetchLiveSlate(
  supabase: SupabaseClient,
  year: number,
  userId: string | null,
  groupId: string | null = null,
  bettingGroupId: string | null = null,
): Promise<SlateData> {
  const fetchedAt = new Date().toISOString();
  const seasonIds = seasonIdsForYear(year);
  const empty: SlateData = {
    seasonId: seasonIds[0],
    sport: "cfb",
    week: 0,
    seasonType: "regular",
    fetchedAt,
    linesAsOf: null,
    games: [],
    live: true,
  };

  const { data: liveRows, error } = await supabase
    .from("games")
    .select("season_id, week, season_type")
    .in("season_id", seasonIds)
    .eq("status", "in_progress");
  if (error) throw error;
  if (!liveRows || liveRows.length === 0) return empty;

  const buckets = new Map<string, { seasonId: number; week: number; seasonType: SeasonType }>();
  for (const r of liveRows as Array<{ season_id: number; week: number; season_type: string }>) {
    buckets.set(`${r.season_id}:${r.week}:${r.season_type}`, {
      seasonId: r.season_id,
      week: r.week,
      seasonType: r.season_type as SeasonType,
    });
  }

  const slates = await Promise.all(
    [...buckets.values()].map((b) =>
      fetchSlateView(
        supabase,
        b.seasonId,
        b.week,
        userId,
        b.seasonType,
        // A pick'em group belongs to one league; handing its id to the other
        // league's bucket would return nothing and cost a round trip, so it is
        // only passed where it can apply.
        sportOfSeasonId(b.seasonId) === "cfb" ? groupId : null,
        bettingGroupId,
      ),
    ),
  );

  const games = slates
    .flatMap((s) => s.games)
    .filter((g) => g.status === "in_progress")
    .sort((a, b) => (a.startTs ?? "").localeCompare(b.startTs ?? ""));

  let linesAsOf: string | null = null;
  for (const s of slates) {
    if (s.linesAsOf !== null && (linesAsOf === null || s.linesAsOf > linesAsOf)) {
      linesAsOf = s.linesAsOf;
    }
  }

  return { ...empty, linesAsOf, games };
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

/**
 * The season/week pointer heads every route and the 60s ticker poll, costing
 * three serial round trips each time for an answer that changes on the scale
 * of hours. A ~60s in-module cache (per warm serverless instance) removes it
 * from the hot path; the staleness bound is far inside the rollover
 * granularity (audit 09/P-15).
 */
const pointerCache = new Map<
  Sport,
  { at: number; value: { seasonId: number; week: number; seasonType: SeasonType; minWeek: number } }
>();

export async function fetchCurrentSeasonWeek(
  supabase: SupabaseClient,
  sport: Sport = "cfb",
): Promise<{ seasonId: number; week: number; seasonType: SeasonType; minWeek: number }> {
  const cached = pointerCache.get(sport);
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  const { data: season } = await supabase
    .from("seasons")
    .select("id")
    .eq("is_current", true)
    .eq("sport", sport)
    .maybeSingle();
  if (!season) throw new Error(`No current ${sport} season configured — seed the seasons table.`);

  // Does this season have a Week 0? Some CFB seasons do (2026: Aug 29), some
  // don't — and the NFL never does — and the week selector should not offer a
  // week with nothing in it. One indexed existence check, on the same 60s
  // cache as the pointer it travels with.
  const { data: wk0 } =
    sport === "cfb"
      ? await supabase
          .from("games")
          .select("id")
          .eq("season_id", season.id)
          .eq("week", 0)
          .eq("season_type", "regular")
          .limit(1)
          .maybeSingle()
      : { data: null };

  const pointer = await fetchCurrentSlate(supabase, season.id);
  const value = { seasonId: season.id, ...pointer, minWeek: wk0 ? 0 : 1 };
  pointerCache.set(sport, { at: Date.now(), value });
  return value;
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
    // both leagues: the ledger is one book, and this week has games in each
    .in("season_id", seasonIdsForYear(seasonYearOf(seasonId)))
    .gte("start_ts", new Date(now - 3 * 24 * 3600 * 1000).toISOString())
    .lte("start_ts", new Date(now + 9 * 24 * 3600 * 1000).toISOString())
    .order("start_ts", { ascending: true });
  return { data: data ?? [] };
}

/**
 * Games for the /admin void control (P1-1). Same rolling window as the bet
 * form and for the same reason — a game postponed on Saturday night still
 * needs to be reachable on Sunday, after the week pointer has rolled.
 *
 * Deliberately unfiltered by status: already-dead games have to appear so they
 * can be restored, which is the only route back for a rescheduled game (CFBD
 * publishes no cancellation signal, so it will not fix itself until the game
 * is played and the feed reports it complete).
 */
export async function fetchAdminGames(
  supabase: SupabaseClient,
  seasonId: number,
): Promise<
  Array<{
    id: number;
    start_ts: string | null;
    status: string;
    home_team_id: number;
    away_team_id: number;
  }>
> {
  const now = Date.now();
  const { data } = await supabase
    .from("games")
    .select("id, start_ts, status, home_team_id, away_team_id")
    // both leagues, for the same reason as the bet form: a void control that
    // cannot reach a postponed NFL game cannot void the bets on it
    .in("season_id", seasonIdsForYear(seasonYearOf(seasonId)))
    .gte("start_ts", new Date(now - 3 * 24 * 3600 * 1000).toISOString())
    .lte("start_ts", new Date(now + 9 * 24 * 3600 * 1000).toISOString())
    .order("start_ts", { ascending: true });
  return data ?? [];
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

/**
 * Names only — its one caller (recap) builds a name-by-id map and reads nothing
 * else. It used to `select("*")`, which pulled `is_admin` and
 * `favorite_team_ids` across every profile on a signed-out page; 0040 revokes
 * `is_admin` from anon, so the old form would now fail rather than over-fetch
 * (P2-2 / SEC-08, same narrowing as 09:P-5 on the game page).
 */
export async function fetchProfiles(
  supabase: SupabaseClient,
): Promise<Pick<ProfileRow, "id" | "display_name">[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name")
    .order("display_name");
  return (data ?? []) as Pick<ProfileRow, "id" | "display_name">[];
}
