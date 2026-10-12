/**
 * "Who bet what" — a betting group's week, person by person (LOGF-7).
 *
 * Owner, 2026-10-12: "I need an easier way to view what my friends Eric and
 * Hayden have bet on after the week is done. No idea if Hayden's Green Bay +1
 * against the Bears was logged, if Hayden had tailed Eric's Colts +3 versus
 * the Steelers bet or if I had logged Hayden's Ravens +3 against the Falcons."
 *
 * Every surface before this answered a different question. The sheet is one
 * league's week filed by GAME; the week-by-week section is records, not bets;
 * a member's page is their whole season. "Did Hayden's Packers bet make it in"
 * needed one person, one week, both leagues — and an absence you can see.
 *
 * The week is the same Tuesday-to-Monday bucket the group's week-by-week
 * section uses (`footballWeekKey`), keyed by its Tuesday, so a link from one
 * opens the other on the same days.
 */

import { footballWeekKey } from "./week-records";

const KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Which week to show: the one asked for if it is a real week key, else the
 * current week when anyone bet in it, else the latest week that has bets —
 * the "after the week is done" read lands on a Tuesday, when the current week
 * is still empty and last week is the one wanted.
 */
export function chooseWeek(
  keysWithBets: readonly string[],
  currentKey: string,
  asked: string | null | undefined,
): string {
  // Normalised, so any date in the week opens that week rather than a void.
  if (asked && KEY.test(asked) && !Number.isNaN(Date.parse(`${asked}T12:00:00Z`))) {
    return footballWeekKey(`${asked}T12:00:00Z`, "UTC");
  }
  if (keysWithBets.includes(currentKey)) return currentKey;
  const past = [...keysWithBets].filter((k) => k <= currentKey).sort();
  return past.at(-1) ?? currentKey;
}

/** The weeks either side of `key` that are worth stepping to: ones with bets, or now. */
export function neighbourWeeks(
  keysWithBets: readonly string[],
  currentKey: string,
  key: string,
): { prev: string | null; next: string | null } {
  const all = [...new Set([...keysWithBets, currentKey])].sort();
  const earlier = all.filter((k) => k < key);
  const later = all.filter((k) => k > key);
  return { prev: earlier.at(-1) ?? null, next: later[0] ?? null };
}

/** The bits of a bet that decide "does this person already hold it". */
export interface HeldBet {
  userId: string;
  gameId: number | null;
  betType: string;
  side: string | null;
}

/**
 * Who a bet could still be copied to: the candidates (the viewer, and for an
 * admin the rest of the roster) minus its owner and anyone already holding
 * the same side of the same market on the same game. The action makes the
 * same refusal; filtering here is what keeps a button off the page that could
 * only ever answer "already on their ledger".
 */
export function copyTargets<C extends { id: string }>(
  bet: HeldBet,
  book: readonly HeldBet[],
  candidates: readonly C[],
): C[] {
  if (bet.gameId === null) return [];
  const holders = new Set(
    book
      .filter((b) => b.gameId === bet.gameId && b.betType === bet.betType && b.side === bet.side)
      .map((b) => b.userId),
  );
  return candidates.filter((c) => c.id !== bet.userId && !holders.has(c.id));
}
