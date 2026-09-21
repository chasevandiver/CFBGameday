/**
 * The bet `line_taken` write convention, in one place.
 *
 * The forms and the slip speak in the bettor's number ("UNC +6.5"); `bets`
 * stores spread-style lines home-perspective (−6.5), which is what the grader,
 * `liveSpreadStatus` and `spreadClv` all read. `slate.ts` owns the negation
 * (`lineForSide` / `homeLineForSide`); what lives here is the part that is
 * about BETS rather than about display — which bet types carry a number at all,
 * and which of those are spread-style.
 *
 * It was private to `actions/bets.ts` until ADM-3 needed the same conversion
 * to correct a line after the fact. Two copies of a sign rule is how away
 * spreads graded backwards the first time (`bet-line-convention.test.ts`).
 */

import { fmtSpread, homeLineForSide, lineForSide } from "./slate";

/** Bet types whose line is stored home-perspective rather than as given. */
export const SPREAD_STYLE = new Set(["spread", "first_half"]);

/**
 * Bet types that carry a number.
 *
 * `moneyline` has a price and no line; `future` has neither a line nor a game
 * to settle against. Correcting either is not a thing that can be meant, so
 * the caller refuses rather than writing a number nothing will read.
 */
export const LINE_BET_TYPES = new Set(["spread", "total", "team_total", "first_half"]);

export function betTypeTakesLine(betType: string): boolean {
  return LINE_BET_TYPES.has(betType);
}

/** The bettor's number → what the row stores. */
export function storedBetLine(
  betType: string,
  side: string | null,
  line: number | null,
): number | null {
  if (line === null || side === null || !SPREAD_STYLE.has(betType)) return line;
  return homeLineForSide(side, line);
}

/**
 * What the row stores → the bettor's number. The inverse of `storedBetLine`,
 * for a control that has to show the operator the number the ticket reads
 * before asking them to change it.
 */
export function ticketBetLine(
  betType: string,
  side: string | null,
  stored: number | null,
): number | null {
  if (stored === null || side === null || !SPREAD_STYLE.has(betType)) return stored;
  return lineForSide(side, stored);
}

/**
 * Swap the old number for the new one inside a free-text description.
 *
 * The description is whatever the form or the slip wrote ("Green Bay Packers
 * -3.5 (GB @ NYJ)"), so this only touches it when the old number is actually
 * there to find, formatted the way `fmtSpread` writes it. Anything else — a
 * hand-typed description, a number that appears twice, a total whose line is
 * also in the team name — is left exactly as the bettor wrote it. A wrong
 * sentence beside a right number is worse than a stale one, and the operator
 * can see both in the row.
 */
export function correctedDescription(
  description: string,
  oldLine: number,
  newLine: number,
): string {
  const from = fmtSpread(oldLine);
  const to = fmtSpread(newLine);
  if (from === to) return description;
  // Word-boundary-ish: not preceded by a digit or a dot, so "13.5" does not
  // match inside "213.5", and not followed by one, so "-3" does not eat the
  // "-3.5" it is a prefix of.
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`, "g");
  const hits = description.match(re);
  if (!hits || hits.length !== 1) return description;
  return description.replace(re, to);
}
