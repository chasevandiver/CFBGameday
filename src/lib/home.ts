/**
 * Everything the home hub reads.
 *
 * The hub is not a new product — it is four questions the site could already
 * answer, asked on one screen: what have I got riding this week, where do I
 * stand in my groups, how is the season going, and where do I go next. So
 * nothing here computes a record: every number folds through `lib/records.ts`,
 * the same function the ledger, the group standings and the crew line use, and
 * any disagreement between this page and those is a bug rather than a rounding
 * difference.
 *
 * It is also deliberately lazy. A signed-out visitor and a brand-new account
 * both load a handful of columns; the slate's fifteen-query loader only runs
 * once we know there is actually a position to draw.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchBettingSheet, byUnits } from "./betting-groups";
import { spreadClv, totalClv } from "./clv";
import type { GroupWeekConfigRow, PickMarket } from "./db-types";
import { fetchMyGroups, type GroupSummary } from "./groups";
import { seasonIdsForYear, seasonYearOf } from "./league";
import { fetchCurrentSeasonWeek, fetchSlateView } from "./queries";
import {
  byLeagueRules,
  cumulativeUnits,
  EMPTY_TALLY,
  tally,
  tallyBy,
  type Tally,
  type Wager,
} from "./records";
import type { SeasonType } from "./season";
import { lineForSide, type GameView, type MyBetView, type MyPickView } from "./slate";

/* ---- shapes ------------------------------------------------------------ */

/** One of the viewer's pool picks, tagged with the pool it was made in. */
export interface HomePick extends MyPickView {
  gameId: number;
  groupId: string;
  groupName: string;
  groupSlug: string;
  result: "win" | "loss" | "push" | "void" | null;
}

/** One of the viewer's logged bets, on a game. Futures carry no game and drop. */
export interface HomeBet extends MyBetView {
  gameId: number;
}

/** A game the viewer has money or a pick on. */
export interface Position {
  game: GameView;
  picks: HomePick[];
  bets: HomeBet[];
}

/** A group the viewer is in, and where they sit in it. */
export interface GroupStanding {
  group: GroupSummary;
  /** 1-based place in the group. Null when nobody has graded anything yet. */
  place: number | null;
  /** How many people that place is out of — the roster, not the picked. */
  field: number;
  tally: Tally;
}

/** How far through this week's board the viewer is, in one pool. */
export interface WeekProgress {
  name: string;
  slug: string;
  made: number;
  /** The group's stated minimum, or null when it sets none. */
  target: number | null;
}

export interface HomeData {
  seasonId: number;
  week: number;
  seasonType: SeasonType;
  /**
   * When this payload was read, stamped server-side. The page needs a "now" to
   * decide whether a kickoff is imminent, and `Date.now()` during render is
   * both impure (react-hooks/purity) and unstable across a re-render — the
   * slate carries the same field for the same reason.
   */
  fetchedAt: string;
  /** Next kickoff still in the future, or null once the week has all started. */
  firstKick: string | null;
  liveCount: number;
  weekGameCount: number;
  positions: Position[];
  /** Open bets on this week's games, and the units riding on them. */
  openBetCount: number;
  openBetUnits: number;
  /** Picks made on this week's board, across every pool. */
  weekPickCount: number;
  groups: GroupStanding[];
  progress: WeekProgress[];
  /** The money ledger, this season. */
  bets: Tally;
  /** Pool picks, this season — kept apart from `bets` and never summed with it. */
  picks: Tally;
  /** How many pools those picks span, for the one-line pool summary. */
  pickGroupCount: number;
  /** Cumulative units from the bet ledger, oldest settled bet first. */
  curve: number[];
}

/* ---- pure helpers (unit-tested in home.test.ts) ------------------------- */

/** How hard the hub should poll, in the tiers `useLiveRefresh` takes. */
export interface RefreshTier {
  live: boolean;
  imminent: boolean;
}

/**
 * The hub's refresh cadence, decided by what is on the page.
 *
 * This must not read `liveCount`/`firstKick` alone. Those describe the CFB
 * week on purpose — "the hero stays CFB", below — and the hub shows both
 * leagues. On 2026-08-14 that combination put the page on its five-minute
 * idle tier while the owner sat watching a live NFL game he had money on,
 * because CFB week 0 was fifteen days out and so, as far as this function's
 * first version could see, nothing was happening. It reads as a page that
 * never refreshes at all.
 *
 * So the positions decide, and they span both leagues, with the CFB week
 * OR'd in for the signed-out visitor who has no positions at all.
 *
 * "Now" is the payload's own stamp, never `Date.now()` — this runs during
 * render (react-hooks/purity) and has to be stable across a re-render.
 */
export function homeRefreshTier(data: HomeData): RefreshTier {
  const now = Date.parse(data.fetchedAt);
  if (data.liveCount > 0 || data.positions.some((p) => p.game.status === "in_progress"))
    return { live: true, imminent: true };

  // Same window the slate uses: kickoff inside six hours, or up to three hours
  // past a start that hasn't flipped to in_progress yet. Bounded on both sides
  // so a permanently-stuck scheduled game can't hold the fast tier forever.
  const kicks = [
    data.firstKick,
    ...data.positions
      .filter((p) => p.game.status === "scheduled")
      .map((p) => p.game.startTs),
  ]
    .filter((ts): ts is string => ts !== null)
    .map((ts) => Date.parse(ts) - now)
    .filter((dt) => Number.isFinite(dt) && dt > -3 * 3600_000 && dt < 6 * 3600_000);

  return { live: false, imminent: kicks.length > 0 };
}

/**
 * Where `userId` sits in an already-sorted standings list.
 *
 * Null when nothing in the group has graded — "1st of 8" off a board where
 * every row is 0-0 is a claim the data does not support, and it is the state
 * every group is in until the first Saturday settles.
 */
export function placeOf(
  sorted: Array<{ userId: string; tally: Tally }>,
  userId: string,
): number | null {
  if (!sorted.some((r) => r.tally.decided > 0)) return null;
  const i = sorted.findIndex((r) => r.userId === userId);
  return i === -1 ? null : i + 1;
}

/**
 * Games the viewer has action on, in the order a Saturday is read: what is
 * happening now, then what is about to, then what already did.
 *
 * A game with a pick in two different pools appears once, carrying both — the
 * question a row answers is "what have I got on this game", and that is one
 * question however many boards it spans.
 *
 * The viewer's picks and bets are also written back onto each `GameView`. They
 * are the fields `fetchSlateView` fills for the slate, and every helper in
 * `live-status.ts` — `tintFor`, `pickCoverView` — reads them, so attaching them
 * here means the hub gets the slate's aura and verdict logic without a second
 * implementation. The hub loads the slate with a null user precisely so it can
 * supply these itself across every pool rather than one.
 */
export function buildPositions(
  games: GameView[],
  picks: HomePick[],
  bets: HomeBet[],
): Position[] {
  const picksByGame = new Map<number, HomePick[]>();
  for (const p of picks) {
    picksByGame.set(p.gameId, [...(picksByGame.get(p.gameId) ?? []), p]);
  }
  const betsByGame = new Map<number, HomeBet[]>();
  for (const b of bets) {
    betsByGame.set(b.gameId, [...(betsByGame.get(b.gameId) ?? []), b]);
  }

  return games
    .filter((g) => picksByGame.has(g.id) || betsByGame.has(g.id))
    .map((g) => {
      const myPicks = picksByGame.get(g.id) ?? [];
      const myBets = betsByGame.get(g.id) ?? [];
      return { game: { ...g, myPicks, myBets }, picks: myPicks, bets: myBets };
    })
    .sort((a, b) => phaseOf(a.game) - phaseOf(b.game) || kickKey(a.game).localeCompare(kickKey(b.game)));
}

/**
 * The same positions, split by which ledger they belong to.
 *
 * `/ledger` keeps bets and pool picks in separate tabs because they are
 * separate products with separate arithmetic — real odds and a real stake on
 * one side, flat −110 pretend money on the other. The hub's first version put
 * them back on one row as differently-tinted chips, which made a card carrying
 * both unreadable: you could not tell what you had money on.
 *
 * A game with both appears in both lists, carrying only that list's layer.
 * That is not duplication — the same game held at +7 in a pool and +6.5 on a
 * ticket is two positions, and showing one row hides the difference.
 */
export function splitPositions(positions: Position[]): {
  bets: Position[];
  picks: Position[];
} {
  return {
    bets: positions
      .filter((p) => p.bets.length > 0)
      // The game's own layers are narrowed too, not just the row's: `tintFor`
      // reads `myPicks`/`myBets` off the game, so leaving the pool pick on a
      // money row would let a pick decide the colour of a bet — and on a pool
      // row, the bet would.
      .map((p) => ({ ...p, picks: [], game: { ...p.game, myPicks: [] } })),
    picks: positions
      .filter((p) => p.picks.length > 0)
      .map((p) => ({ ...p, bets: [], game: { ...p.game, myBets: [] } })),
  };
}

/**
 * Your number against the number on the board right now.
 *
 * The one thing a position row can say that the slate cannot: whether the
 * number you are holding is still the number, and which way it moved.
 *
 * The arithmetic is `spreadClv` / `totalClv` — this is the same question CLV
 * asks, against the running line instead of the close, and those two carry the
 * asymmetry that makes it easy to get wrong (a spread holder wants a bigger
 * number, an over wants a smaller one, an under a bigger one). They are already
 * tested with worked examples, so deriving the signs a second time here would
 * only be a second chance to invert one.
 *
 * They take home-perspective numbers, which is how `line_at_pick`, `line_taken`
 * and `lines.spread` are all stored. The two numbers rendered to the reader go
 * through `lineForSide` instead, since a ticket reads its own side.
 */
export function heldVsNow(
  market: string,
  side: string,
  held: number | null,
  lines: GameView["lines"],
): { held: number; now: number | null; delta: number | null; isTotal: boolean } | null {
  if (held === null) return null;
  const isTotal = market === "total";
  const isSpread = market === "spread";
  if (!isTotal && !isSpread) return null;

  const current = isTotal ? lines.total : lines.spread;
  // A spread reads with its sign from the holder's side; a total is just a
  // number — "Over +51.5" is not a thing anyone writes.
  const shown = (v: number) => (isTotal ? v : (lineForSide(side, v) ?? v));
  if (current === null) return { held: shown(held), now: null, delta: null, isTotal };

  const delta = isTotal
    ? totalClv(side === "under" ? "under" : "over", held, current)
    : spreadClv(side === "away" ? "away" : "home", held, current);

  return {
    held: shown(held),
    now: shown(current),
    delta: Math.round(delta * 10) / 10,
    isTotal,
  };
}

/** Live first, then not-yet-played, then settled. */
const phaseOf = (g: GameView): number =>
  g.status === "in_progress" ? 0 : g.status === "final" || g.status === "postponed" || g.status === "canceled" ? 2 : 1;

/** Sort key that puts games with no kickoff last within their phase. */
const kickKey = (g: GameView): string => g.startTs ?? "9999";

/* ---- the loader -------------------------------------------------------- */

type PickStandingRow = {
  group_id: string;
  user_id: string;
  game_id: number;
  market: PickMarket;
  side: "home" | "away" | "over" | "under";
  line_at_pick: number | null;
  result: "win" | "loss" | "push" | "void" | null;
  units: number;
  clv: number | null;
};

type BetLedgerRow = {
  id: number;
  game_id: number | null;
  bet_type: string;
  side: string | null;
  line_taken: number | null;
  result: "win" | "loss" | "push" | "void" | null;
  units: number;
  payout_units: number | null;
  clv: number | null;
  placed_at: string;
};

const toWager = (r: { result: PickStandingRow["result"]; units: number; clv: number | null }): Wager => ({
  result: r.result,
  units: Number(r.units),
  payoutUnits: null,
  clv: r.clv === null ? null : Number(r.clv),
});

export async function fetchHomeData(
  supabase: SupabaseClient,
  userId: string | null,
): Promise<HomeData> {
  const { seasonId, week, seasonType } = await fetchCurrentSeasonWeek(supabase);

  // The week's shape is public and cheap — a signed-out visitor gets the hero
  // and nothing else, without paying for the slate's full loader.
  const { data: weekGameRows } = await supabase
    .from("games")
    .select("id, start_ts, status")
    .eq("season_id", seasonId)
    .eq("week", week)
    .eq("season_type", seasonType);
  const weekGames = (weekGameRows ?? []) as Array<{
    id: number;
    start_ts: string | null;
    status: string;
  }>;
  const weekGameIds = new Set(weekGames.map((g) => g.id));
  const now = Date.now();
  const firstKick =
    weekGames
      .map((g) => g.start_ts)
      .filter((ts): ts is string => ts !== null && new Date(ts).getTime() > now)
      .sort()[0] ?? null;

  // The hero stays CFB — Saturday is the product's spine — but "what you have
  // riding" is one book across both leagues, so positions and tallies below
  // read the NFL's current week too. Absent until nfl-sync-reference has run;
  // a home page must not 500 over a league that isn't configured yet.
  let nflPointer: { seasonId: number; week: number; seasonType: SeasonType } | null = null;
  try {
    nflPointer = await fetchCurrentSeasonWeek(supabase, "nfl");
  } catch {
    /* no NFL season configured */
  }
  const { data: nflWeekGameRows } = nflPointer
    ? await supabase
        .from("games")
        .select("id")
        .eq("season_id", nflPointer.seasonId)
        .eq("week", nflPointer.week)
        .eq("season_type", nflPointer.seasonType)
    : { data: [] };
  const nflWeekGameIds = new Set(
    ((nflWeekGameRows ?? []) as Array<{ id: number }>).map((g) => g.id),
  );
  const actionWeekGameIds = new Set([...weekGameIds, ...nflWeekGameIds]);

  const empty: HomeData = {
    seasonId,
    week,
    seasonType,
    fetchedAt: new Date().toISOString(),
    firstKick,
    liveCount: weekGames.filter((g) => g.status === "in_progress").length,
    weekGameCount: weekGames.length,
    positions: [],
    openBetCount: 0,
    openBetUnits: 0,
    weekPickCount: 0,
    groups: [],
    progress: [],
    bets: EMPTY_TALLY,
    picks: EMPTY_TALLY,
    pickGroupCount: 0,
    curve: [],
  };
  if (!userId) return empty;

  const mine = await fetchMyGroups(supabase, userId);
  const pickemIds = mine.filter((g) => g.kind === "pickem").map((g) => g.id);
  const bettingGroups = mine.filter((g) => g.kind === "betting");

  const [rosterRes, pickRes, betRes, configRes] = await Promise.all([
    pickemIds.length > 0
      ? supabase
          .from("group_members")
          .select("group_id, user_id")
          .in("group_id", pickemIds)
          .is("removed_at", null)
      : Promise.resolve({ data: [] }),
    // One query, three jobs: the group standings, the viewer's season pick
    // record, and their positions on this week's board. RLS already limits
    // `picks` to groups the viewer can see.
    pickemIds.length > 0
      ? supabase
          .from("picks")
          .select("group_id, user_id, game_id, market, side, line_at_pick, result, units, clv")
          .in("group_id", pickemIds)
          .in("season_id", seasonIdsForYear(seasonYearOf(seasonId)))
      : Promise.resolve({ data: [] }),
    supabase
      .from("bets")
      .select("id, game_id, bet_type, side, line_taken, result, units, payout_units, clv, placed_at")
      .in("season_id", seasonIdsForYear(seasonYearOf(seasonId)))
      .eq("user_id", userId)
      .is("voided_at", null)
      .order("placed_at", { ascending: true }),
    pickemIds.length > 0
      ? supabase
          .from("group_week_config")
          .select("group_id, markets, min_picks_per_week")
          .in("group_id", pickemIds)
          .eq("season_id", seasonId)
          .eq("week", week)
          .eq("season_type", seasonType)
      : Promise.resolve({ data: [] }),
  ]);

  const roster = (rosterRes.data ?? []) as Array<{ group_id: string; user_id: string }>;
  const pickRows = (pickRes.data ?? []) as PickStandingRow[];
  const betRows = (betRes.data ?? []) as BetLedgerRow[];
  const configs = (configRes.data ?? []) as Array<
    Pick<GroupWeekConfigRow, "group_id" | "markets" | "min_picks_per_week">
  >;

  /* ---- your record ---- */

  const myPickRows = pickRows.filter((p) => p.user_id === userId);
  const picksTally = tally(myPickRows.map(toWager));
  const pickGroupCount = new Set(
    myPickRows.filter((p) => p.result && p.result !== "void").map((p) => p.group_id),
  ).size;

  // Bets grade at their real American odds, so `payout_units` is passed through
  // rather than synthesized — the one place the shared tally does not apply the
  // flat −110 of pick'em.
  const betWagers: Wager[] = betRows.map((b) => ({
    result: b.result,
    units: Number(b.units),
    payoutUnits: b.payout_units === null ? null : Number(b.payout_units),
    clv: b.clv === null ? null : Number(b.clv),
  }));
  const betsTally = tally(betWagers);
  const curve = cumulativeUnits(betWagers);

  /* ---- your groups ---- */

  const pickTallies = tallyBy(
    pickRows.map((p) => ({ ...toWager(p), key: `${p.group_id}|${p.user_id}` })),
    (p) => p.key,
  );
  const rosterByGroup = new Map<string, string[]>();
  for (const r of roster) {
    rosterByGroup.set(r.group_id, [...(rosterByGroup.get(r.group_id) ?? []), r.user_id]);
  }

  const groups: GroupStanding[] = [];
  for (const g of mine) {
    if (g.kind === "pickem") {
      const members = rosterByGroup.get(g.id) ?? [userId];
      const sorted = members
        .map((uid) => ({ userId: uid, tally: pickTallies.get(`${g.id}|${uid}`) ?? EMPTY_TALLY }))
        .sort((a, b) => byLeagueRules(a.tally, b.tally));
      groups.push({
        group: g,
        place: placeOf(sorted, userId),
        field: members.length,
        tally: pickTallies.get(`${g.id}|${userId}`) ?? EMPTY_TALLY,
      });
    }
  }
  // A betting group's standing is its members' ledgers, which is a different
  // join entirely (`fetchBettingSheet` classifies the whole season so tail and
  // fade stay meaningful). One round trip each; people are in nought or one.
  const sheets = await Promise.all(
    bettingGroups.map((g) => fetchBettingSheet(supabase, g.id, seasonId)),
  );
  bettingGroups.forEach((g, i) => {
    const ranked = [...sheets[i].members].sort(byUnits);
    groups.push({
      group: g,
      place: placeOf(
        ranked.map((m) => ({ userId: m.userId, tally: m.stats.overall })),
        userId,
      ),
      field: ranked.length,
      tally: ranked.find((m) => m.userId === userId)?.stats.overall ?? EMPTY_TALLY,
    });
  });
  // Keep the viewer's own order from fetchMyGroups rather than the two kinds
  // arriving in blocks.
  const order = new Map(mine.map((g, i) => [g.id, i]));
  groups.sort((a, b) => (order.get(a.group.id) ?? 0) - (order.get(b.group.id) ?? 0));

  /* ---- this week ---- */

  const configByGroup = new Map(configs.map((c) => [c.group_id, c]));
  const myWeekPicks = myPickRows.filter((p) => actionWeekGameIds.has(p.game_id));
  const progress: WeekProgress[] = mine
    .filter((g) => g.kind === "pickem" && configByGroup.has(g.id))
    .map((g) => {
      const min = configByGroup.get(g.id)?.min_picks_per_week ?? 0;
      return {
        name: g.name,
        slug: g.slug,
        made: myWeekPicks.filter((p) => p.group_id === g.id).length,
        // A group with no minimum has no denominator here on purpose. The full
        // "of N picks" needs the board's game list, which is three more round
        // trips, and the group's own hub already prints it.
        target: min > 0 ? min : null,
      };
    });

  /* ---- your positions ---- */

  const groupById = new Map(mine.map((g) => [g.id, g]));
  const homePicks: HomePick[] = myWeekPicks.map((p) => ({
    gameId: p.game_id,
    market: p.market,
    side: p.side,
    line: p.line_at_pick === null ? null : Number(p.line_at_pick),
    result: p.result,
    groupId: p.group_id,
    groupName: groupById.get(p.group_id)?.name ?? "A pool",
    groupSlug: groupById.get(p.group_id)?.slug ?? "",
  }));
  const weekBetRows = betRows.filter((b) => b.game_id !== null && actionWeekGameIds.has(b.game_id));
  const homeBets: HomeBet[] = weekBetRows.map((b) => ({
    id: b.id,
    gameId: b.game_id as number,
    betType: b.bet_type,
    side: b.side,
    line: b.line_taken === null ? null : Number(b.line_taken),
    result: b.result,
  }));

  // "Open" means still to settle. A graded bet stays on the row — the card
  // shows your money pregame, live and postgame — but it is no longer at risk,
  // so counting it in the units figure would overstate what is riding.
  const openBets = weekBetRows.filter((b) => !b.result);
  const openBetCount = openBets.length;
  const openBetUnits = openBets.reduce((n, b) => n + Number(b.units), 0);

  const actionGameIds = new Set<number>([
    ...homePicks.map((p) => p.gameId),
    ...homeBets.map((b) => b.gameId),
  ]);

  let positions: Position[] = [];
  if (actionGameIds.size > 0) {
    // Only now is the slate's full loader worth its fifteen queries. Picks and
    // bets are supplied above rather than by passing a user and a group here:
    // the hub shows every pool the viewer is in, and `fetchSlateView` can only
    // scope its pick layer to one. The NFL slate is only loaded when a
    // position actually rides on it.
    const wantsNfl = nflPointer && [...actionGameIds].some((id) => nflWeekGameIds.has(id));
    const [slate, nflSlate] = await Promise.all([
      fetchSlateView(supabase, seasonId, week, null, seasonType, null, null),
      wantsNfl && nflPointer
        ? fetchSlateView(
            supabase,
            nflPointer.seasonId,
            nflPointer.week,
            null,
            nflPointer.seasonType,
            null,
            null,
          )
        : Promise.resolve(null),
    ]);
    const actionGames = [...slate.games, ...(nflSlate?.games ?? [])].filter((g) =>
      actionGameIds.has(g.id),
    );
    positions = buildPositions(actionGames, homePicks, homeBets);
  }

  return {
    ...empty,
    positions,
    openBetCount,
    openBetUnits,
    weekPickCount: myWeekPicks.length,
    groups,
    progress,
    bets: betsTally,
    picks: picksTally,
    pickGroupCount,
    curve,
  };
}
