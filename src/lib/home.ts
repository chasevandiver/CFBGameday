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
import type { GroupWeekConfigRow, PickMarket } from "./db-types";
import { fetchMyGroups, type GroupSummary } from "./groups";
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
import type { GameView, MyBetView, MyPickView } from "./slate";

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
  /** Next kickoff still in the future, or null once the week has all started. */
  firstKick: string | null;
  liveCount: number;
  weekGameCount: number;
  positions: Position[];
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
 * question the row answers is "what have I got on this game", and that is one
 * question however many boards it spans.
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
    .map((g) => ({
      game: g,
      picks: picksByGame.get(g.id) ?? [],
      bets: betsByGame.get(g.id) ?? [],
    }))
    .sort((a, b) => phaseOf(a.game) - phaseOf(b.game) || kickKey(a.game).localeCompare(kickKey(b.game)));
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

  const empty: HomeData = {
    seasonId,
    week,
    seasonType,
    firstKick,
    liveCount: weekGames.filter((g) => g.status === "in_progress").length,
    weekGameCount: weekGames.length,
    positions: [],
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
          .eq("season_id", seasonId)
      : Promise.resolve({ data: [] }),
    supabase
      .from("bets")
      .select("id, game_id, bet_type, side, line_taken, result, units, payout_units, clv, placed_at")
      .eq("season_id", seasonId)
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
  const myWeekPicks = myPickRows.filter((p) => weekGameIds.has(p.game_id));
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
  const homeBets: HomeBet[] = betRows
    .filter((b) => b.game_id !== null && weekGameIds.has(b.game_id))
    .map((b) => ({
      id: b.id,
      gameId: b.game_id as number,
      betType: b.bet_type,
      side: b.side,
      line: b.line_taken === null ? null : Number(b.line_taken),
      result: b.result,
    }));

  const actionGameIds = new Set<number>([
    ...homePicks.map((p) => p.gameId),
    ...homeBets.map((b) => b.gameId),
  ]);

  let positions: Position[] = [];
  if (actionGameIds.size > 0) {
    // Only now is the slate's full loader worth its fifteen queries. Picks and
    // bets are supplied above rather than by passing a user and a group here:
    // the hub shows every pool the viewer is in, and `fetchSlateView` can only
    // scope its pick layer to one.
    const slate = await fetchSlateView(supabase, seasonId, week, null, seasonType, null, null);
    positions = buildPositions(
      slate.games.filter((g) => actionGameIds.has(g.id)),
      homePicks,
      homeBets,
    );
  }

  return {
    ...empty,
    positions,
    groups,
    progress,
    bets: betsTally,
    picks: picksTally,
    pickGroupCount,
    curve,
  };
}
