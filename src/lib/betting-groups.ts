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
import { seasonIdsForYear, seasonYearOf, sportOfSeasonId } from "./league";
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

export interface SheetMember extends GroupMemberView {
  stats: MemberStats;
  form: Form;
  /** Per-league records (0042) — who's doing better where. */
  leagueSplit: { cfb: Tally; nfl: Tally };
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
    })),
    bets,
    nameById: new Map(members.map((m) => [m.userId, m.name])),
    raw,
  };
}

/**
 * Members ordered the way a sheet should read: most units first.
 *
 * Not by record. A betting group plays at real prices with real stakes, so
 * 12-8 on 1u bets and 12-8 with three 5u losers are not the same season, and
 * only one of those two numbers knows it. Ungraded members sink rather than
 * tying at the top.
 */
export function byUnits(a: SheetMember, b: SheetMember): number {
  return (
    b.stats.overall.units - a.stats.overall.units ||
    (b.stats.overall.roi ?? -Infinity) - (a.stats.overall.roi ?? -Infinity) ||
    a.name.localeCompare(b.name)
  );
}

/** "12-8" or null before anything grades — the sheet's shorthand for a source. */
export const recordOrNull = (t: { decided: number; wins: number; losses: number; pushes: number }) =>
  t.decided > 0 ? formatRecord(t as Parameters<typeof formatRecord>[0]) : null;
