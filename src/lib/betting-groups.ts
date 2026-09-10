/**
 * Reading a betting group's sheet.
 *
 * A betting group stores nothing of its own beyond its roster — see migration
 * 0027 for why. Its sheet is its members' ledgers, joined on the slate and run
 * through `classifyBets` to work out who was first. Everything here is that
 * join; every number comes out of `lib/tailing.ts`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BetRow } from "./db-types";
import { fetchGroupMembers, type GroupMemberView } from "./groups";
import { seasonIdsForYear, seasonYearOf, sportOfSeasonId, type Sport } from "./league";
import { formatRecord, tally, type Tally } from "./records";
import {
  classifyBets,
  recentForm,
  statsByMember,
  type ClassifiedBet,
  type Form,
  type MemberStats,
  type SheetBet,
} from "./tailing";

export const toSheetBet = (b: BetRow): SheetBet => ({
  id: b.id,
  userId: b.user_id,
  seasonId: b.season_id,
  gameId: b.game_id,
  betType: b.bet_type,
  side: b.side,
  line: b.line_taken === null ? null : Number(b.line_taken),
  odds: b.odds,
  units: Number(b.units),
  placedAt: b.placed_at,
  result: b.result,
  payoutUnits: b.payout_units === null ? null : Number(b.payout_units),
  clv: b.clv === null ? null : Number(b.clv),
  voidedAt: b.voided_at,
});

/** A member's numbers on one slice of the book: the season, or one league of it. */
export interface LeagueCut {
  stats: MemberStats;
  form: Form;
}

export interface SheetMember extends GroupMemberView {
  /** The whole book, both leagues. */
  stats: MemberStats;
  form: Form;
  /** Per-league records (0042) — who's doing better where. */
  leagueSplit: { cfb: Tally; nfl: Tally };
  /**
   * Every number in `stats` and `form`, cut to one league (GRP-13).
   *
   * Classified once, across the book, then sliced: origination and the tail
   * and fade relations are decided inside one game, and a game is in one
   * league, so a per-league cut of the classified rows loses nothing. What it
   * gains is a "who's running good in the NFL" that the home's league tab
   * can rank by, and a "how tailing Jeff goes in CFB" that the whole-book
   * number was hiding.
   */
  byLeague: Record<Sport, LeagueCut>;
}

export interface BettingSheet {
  members: SheetMember[];
  /** Every live bet in the group this season, classified against each other. */
  bets: ClassifiedBet[];
  /** Display name per member id — the sheet renders names, not uuids. */
  nameById: Map<string, string>;
  /** The raw ledger rows, for anything that needs the description verbatim. */
  raw: BetRow[];
}

/**
 * One season of a betting group.
 *
 * Deliberately the whole season rather than a week: origination is decided
 * against every bet in the group, and the tail/fade records that make the
 * sheet worth reading only mean anything over a season. Callers that want one
 * week filter `bets` by game id afterwards — the classification must not be
 * recomputed on a subset, or the first bet of a *week* would be credited as
 * the source for a game that opened the Tuesday before.
 */
export async function fetchBettingSheet(
  supabase: SupabaseClient,
  groupId: string,
  seasonId: number,
): Promise<BettingSheet> {
  const members = await fetchGroupMembers(supabase, groupId);
  const ids = members.map((m) => m.userId);
  if (ids.length === 0) {
    return { members: [], bets: [], nameById: new Map(), raw: [] };
  }

  const { data } = await supabase
    .from("bets")
    .select("*")
    // A betting group always reads both leagues (0042): the sheet is its
    // members' one book. Origination classifies across the whole book too.
    .in("season_id", seasonIdsForYear(seasonYearOf(seasonId)))
    .in("user_id", ids)
    .order("placed_at", { ascending: true });
  const raw = (data ?? []) as BetRow[];

  const sheetBets = raw.map(toSheetBet);
  const bets = classifyBets(sheetBets);
  const stats = statsByMember(bets, ids);
  const byUser = new Map<string, SheetBet[]>();
  for (const b of sheetBets) {
    byUser.set(b.userId, [...(byUser.get(b.userId) ?? []), b]);
  }
  const statsByLeague: Record<Sport, Map<string, MemberStats>> = {
    cfb: statsByMember(betsInLeague(bets, "cfb"), ids),
    nfl: statsByMember(betsInLeague(bets, "nfl"), ids),
  };
  const cut = (userId: string, sport: Sport): LeagueCut => ({
    stats: statsByLeague[sport].get(userId)!,
    form: recentForm(betsInLeague(byUser.get(userId) ?? [], sport)),
  });

  const settled = (list: SheetBet[], sport: "cfb" | "nfl") =>
    tally(
      list
        .filter((b) => sportOfSeasonId(b.seasonId) === sport && b.result && b.result !== "void")
        .map((b) => ({
          result: b.result,
          units: b.units,
          payoutUnits: b.payoutUnits,
          clv: b.clv,
        })),
    );

  return {
    members: members.map((m) => ({
      ...m,
      stats: stats.get(m.userId)!,
      form: recentForm(byUser.get(m.userId) ?? []),
      leagueSplit: {
        cfb: settled(byUser.get(m.userId) ?? [], "cfb"),
        nfl: settled(byUser.get(m.userId) ?? [], "nfl"),
      },
      byLeague: { cfb: cut(m.userId, "cfb"), nfl: cut(m.userId, "nfl") },
    })),
    bets,
    nameById: new Map(members.map((m) => [m.userId, m.name])),
    raw,
  };
}

/**
 * The bets of one league, or all of them when `sport` is null.
 *
 * The league rides in the season id (0042), so this is a filter and not a
 * join — which is what lets the classified rows be sliced after the fact
 * without re-running `classifyBets` on a subset (see `fetchBettingSheet`).
 */
export function betsInLeague<T extends { seasonId: number }>(bets: T[], sport: Sport | null): T[] {
  if (sport === null) return bets;
  return bets.filter((b) => sportOfSeasonId(b.seasonId) === sport);
}

/** A member's numbers on the league in view, or the whole book for null. */
export function memberCut(m: SheetMember, league: Sport | null): LeagueCut {
  return league === null ? { stats: m.stats, form: m.form } : m.byLeague[league];
}

/**
 * Members ordered the way a sheet should read: most units first.
 *
 * Not by record. A betting group plays at real prices with real stakes, so
 * 12-8 on 1u bets and 12-8 with three 5u losers are not the same season, and
 * only one of those two numbers knows it. Ungraded members sink rather than
 * tying at the top.
 *
 * `byUnitsIn(league)` ranks on one league's units — the order the home's
 * league tab shows (GRP-13) — and `byUnits` is the whole book, which is what
 * the home hub's group card still ranks by.
 */
export function byUnitsIn(league: Sport | null) {
  return (a: SheetMember, b: SheetMember): number => {
    const x = memberCut(a, league).stats.overall;
    const y = memberCut(b, league).stats.overall;
    return (
      y.units - x.units || (y.roi ?? -Infinity) - (x.roi ?? -Infinity) || a.name.localeCompare(b.name)
    );
  };
}

export const byUnits = byUnitsIn(null);

/** "12-8" or null before anything grades — the sheet's shorthand for a source. */
export const recordOrNull = (t: { decided: number; wins: number; losses: number; pushes: number }) =>
  t.decided > 0 ? formatRecord(t as Parameters<typeof formatRecord>[0]) : null;
