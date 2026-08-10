/**
 * Who got there first, who followed, and who took the other side.
 *
 * A betting group has no board and no admin — it is a crowd around a slate.
 * The only structure it has is the order people got their money down, and
 * that order is where every number on the sheet comes from:
 *
 *   origin — first in the group on this game and market. The source.
 *   tail   — behind the source, same side. You're riding them.
 *   fade   — behind the source, other side. You're taking them on.
 *
 * ## Derived, never stored
 *
 * There is no `tailed_bet_id` column, and there should not be. Two people who
 * bet the same side ten minutes apart without speaking are, for every purpose
 * this sheet serves, a source and a tail — and a stored pointer would only be
 * set on the ones who used the Tail button, which would make the stats a
 * measure of button usage rather than of who is worth following. Time is the
 * whole rule and time is already recorded.
 *
 * ## Every follower's counterparty is the source
 *
 * Not the person immediately before them. If Jeff opens UGA -6.5, Mo tails,
 * and Sam takes BAMA +6.5, then Mo tailed Jeff and Sam faded Jeff — Sam did
 * not fade Mo. One source per game per market keeps "fading Jeff" a single
 * countable relationship instead of a chain whose meaning depends on arrival
 * order, and it matches the credit rule: the source is who put the bet on the
 * board.
 *
 * ## Markets, not games
 *
 * The key is game + bet type. Being first on the spread says nothing about
 * the total, and someone who bets the total when you bet the spread has not
 * faded you — they've bet a different thing. Bets with no side (futures, a
 * freeform ledger row) have no market to be first in and stay unclassified.
 */

import { isDecided, tally, type Tally, type Wager, type WagerResult } from "./records";

/** One member's bet, as the sheet reads it. */
export interface SheetBet {
  id: number;
  userId: string;
  gameId: number | null;
  betType: string;
  side: string | null;
  line: number | null;
  odds: number;
  units: number;
  placedAt: string;
  result: WagerResult;
  payoutUnits: number | null;
  clv: number | null;
  voidedAt: string | null;
}

export type Relation = "origin" | "tail" | "fade" | "unclassified";

export interface ClassifiedBet extends SheetBet {
  relation: Relation;
  /** The source this bet followed. Null on an origin or an unclassified row. */
  sourceUserId: string | null;
  /** The source's bet, for a "tail this" CTA that knows what it is copying. */
  sourceBetId: number | null;
  /** How long after the source it landed, in ms. Null unless tail/fade. */
  lagMs: number | null;
  /** Bets that followed this one, same side. Only ever non-zero on an origin. */
  tailedBy: number;
  /** Bets that followed this one on the other side. */
  fadedBy: number;
}

/** Game + market. Being first on the spread says nothing about the total. */
const marketKey = (b: SheetBet): string => `${b.gameId}:${b.betType}`;

/**
 * Chronological, with the row id as the tiebreak.
 *
 * Two bets can share a `placed_at` to the microsecond — the slip logs a whole
 * batch in one statement, and `now()` is fixed for the transaction, so a slip
 * with a spread and a total from two members submitted in the same second is
 * not hypothetical. Falling back to the identity column makes the ordering
 * total, which makes "who was first" stable across page loads instead of
 * whichever row Postgres returned first.
 */
function byTime(a: SheetBet, b: SheetBet): number {
  return a.placedAt.localeCompare(b.placedAt) || a.id - b.id;
}

/**
 * Classify a group's bets against each other.
 *
 * Voided rows are dropped before anything is decided: a void never happened
 * (League Rule #4), and letting one hold origination would credit a bet that
 * was taken back and demote the person who actually put the number up.
 */
export function classifyBets(bets: SheetBet[]): ClassifiedBet[] {
  const live = bets.filter((b) => b.voidedAt === null);
  const byMarket = new Map<string, SheetBet[]>();
  for (const b of live) {
    if (b.gameId === null || b.side === null) continue;
    const key = marketKey(b);
    const arr = byMarket.get(key);
    if (arr) arr.push(b);
    else byMarket.set(key, [b]);
  }

  const out = new Map<number, ClassifiedBet>();
  for (const b of live) {
    out.set(b.id, {
      ...b,
      relation: "unclassified",
      sourceUserId: null,
      sourceBetId: null,
      lagMs: null,
      tailedBy: 0,
      fadedBy: 0,
    });
  }

  for (const group of byMarket.values()) {
    const ordered = [...group].sort(byTime);
    const source = ordered[0];
    const sourceOut = out.get(source.id)!;
    sourceOut.relation = "origin";

    for (const b of ordered.slice(1)) {
      const row = out.get(b.id)!;
      // Your own second bet on the same market is another position of yours,
      // not you tailing yourself. It stays an origin so it still shows as
      // money you put up, and it earns nobody a tail.
      if (b.userId === source.userId) {
        row.relation = "origin";
        continue;
      }
      const same = b.side === source.side;
      row.relation = same ? "tail" : "fade";
      row.sourceUserId = source.userId;
      row.sourceBetId = source.id;
      row.lagMs = Math.max(0, Date.parse(b.placedAt) - Date.parse(source.placedAt));
      if (same) sourceOut.tailedBy += 1;
      else sourceOut.fadedBy += 1;
    }
  }

  return [...out.values()];
}

/* ---- stats ------------------------------------------------------------- */

const asWager = (b: ClassifiedBet): Wager => ({
  result: b.result,
  units: b.units,
  payoutUnits: b.payoutUnits,
  clv: b.clv,
});

export interface MemberStats {
  userId: string;
  /** Everything they've had down, whoever got there first. */
  overall: Tally;
  /** The ones they opened. What they're worth as a source. */
  originated: Tally;
  /** Their bets that followed somebody, same side. */
  tailing: Tally;
  /** Their bets that followed somebody, other side. */
  fading: Tally;
  /** How everyone who rode THEM did — the number that says "worth following". */
  tailedByOthers: Tally;
  /** How everyone who took them on did. Above .500 here is not a compliment. */
  fadedByOthers: Tally;
  /** How many of their opens somebody followed either way. */
  timesFollowed: number;
}

export function statsByMember(
  classified: ClassifiedBet[],
  userIds: string[],
): Map<string, MemberStats> {
  const mine = (id: string) => classified.filter((b) => b.userId === id);
  const out = new Map<string, MemberStats>();
  for (const userId of userIds) {
    const own = mine(userId);
    const followers = classified.filter((b) => b.sourceUserId === userId);
    out.set(userId, {
      userId,
      overall: tally(own.map(asWager)),
      originated: tally(own.filter((b) => b.relation === "origin").map(asWager)),
      tailing: tally(own.filter((b) => b.relation === "tail").map(asWager)),
      fading: tally(own.filter((b) => b.relation === "fade").map(asWager)),
      tailedByOthers: tally(followers.filter((b) => b.relation === "tail").map(asWager)),
      fadedByOthers: tally(followers.filter((b) => b.relation === "fade").map(asWager)),
      timesFollowed: own.reduce((n, b) => n + b.tailedBy + b.fadedBy, 0),
    });
  }
  return out;
}

export interface PairStats {
  /** The other member. */
  otherId: string;
  /** Viewer's bets that rode them. */
  tailing: Tally;
  /** Viewer's bets that took them on. */
  fading: Tally;
}

/**
 * One member against each of the others: how you do riding them, how you do
 * opposing them.
 *
 * This is the question a sheet exists to answer — "am I better off just
 * copying Jeff?" — and it is not answerable from anyone's own record, because
 * a source's record counts the bets you never saw in time to copy.
 */
export function pairStatsFor(classified: ClassifiedBet[], userId: string): PairStats[] {
  const mine = classified.filter((b) => b.userId === userId && b.sourceUserId !== null);
  const byOther = new Map<string, { tail: ClassifiedBet[]; fade: ClassifiedBet[] }>();
  for (const b of mine) {
    const bucket = byOther.get(b.sourceUserId!) ?? { tail: [], fade: [] };
    if (b.relation === "tail") bucket.tail.push(b);
    else if (b.relation === "fade") bucket.fade.push(b);
    byOther.set(b.sourceUserId!, bucket);
  }
  return [...byOther.entries()]
    .map(([otherId, b]) => ({
      otherId,
      tailing: tally(b.tail.map(asWager)),
      fading: tally(b.fade.map(asWager)),
    }))
    .sort(
      (a, b) =>
        b.tailing.decided + b.fading.decided - (a.tailing.decided + a.fading.decided),
    );
}

/* ---- form -------------------------------------------------------------- */

export type FormLabel = "hot" | "cold" | "level";

export interface Form {
  /** Most recent first, newest graded bet at index 0. */
  results: Array<"win" | "loss" | "push">;
  wins: number;
  losses: number;
  units: number;
  label: FormLabel;
}

/**
 * The last `n` graded bets, and whether that is hot.
 *
 * Deliberately a stated threshold rather than a feel: **hot** is +3 or better
 * on wins minus losses over the window, **cold** is −3 or worse, everything
 * else is level. At n=10 that is 6-3 or better — far enough from even that a
 * coin would land there under a third of the time, and close enough to reach
 * in a normal Saturday. Units are reported alongside because a 6-4 at −110
 * with one 5u loser is not a hot streak, and the reader should be able to see
 * that for themselves.
 *
 * Ungraded and voided bets are skipped, not counted as anything. A window of
 * pending bets is not form; it is a week that hasn't happened.
 */
export function recentForm(bets: SheetBet[], n = 10): Form {
  const graded = bets
    .filter((b) => b.voidedAt === null && isDecided({ result: b.result, units: b.units }))
    .sort((a, b) => byTime(b, a))
    .slice(0, n);
  const results = graded.map((b) => b.result as "win" | "loss" | "push");
  const wins = results.filter((r) => r === "win").length;
  const losses = results.filter((r) => r === "loss").length;
  const t = tally(graded.map((b) => ({
    result: b.result,
    units: b.units,
    payoutUnits: b.payoutUnits,
    clv: b.clv,
  })));
  const diff = wins - losses;
  return {
    results,
    wins,
    losses,
    units: t.units,
    label: diff >= 3 ? "hot" : diff <= -3 ? "cold" : "level",
  };
}

/* ---- the slate view ---------------------------------------------------- */

/** One member's position on one game, as a card shows it. */
export interface GroupBetView {
  betId: number;
  userId: string;
  name: string;
  betType: string;
  side: string | null;
  line: number | null;
  odds: number;
  units: number;
  relation: Relation;
  /** True for the viewer's own row, so a card can say "You". Resolved on the
   *  server: the card has no session of its own. */
  isViewer: boolean;
  /** This member's own season record in the group, e.g. "12-8". */
  record: string | null;
  /** Hot / cold / level over their last ten graded bets. */
  form: FormLabel;
  /** Who they followed, by name, when they followed anybody. */
  sourceName: string | null;
  tailedBy: number;
  fadedBy: number;
  result: WagerResult;
}
