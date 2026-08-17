/**
 * Crew splits (R2-D1): who is on which side, and with how much.
 *
 * PICK splits already live on the week board — MatchupCard's MarketSplit
 * halves the names and draws the lean bar, and RLS is the authority on which
 * rows the viewer may aggregate (the definer-fn design for pre-kick hidden
 * splits was REJECTED — see the changelog: with the pick count public and a
 * crew of 5–15, any side aggregate is reverse-engineerable).
 *
 * This module is the MONEY half: `bets` are crew-readable by design (0001,
 * "read all bets" — the ledger is unhideable), so the game page can say
 * "you're with the crew's units or fading them" from rows it already may
 * read. Ticket % is bets; units % is stake — 63% of tickets and 40% of
 * units on a side is a story about who disagrees with whom.
 */

export interface MoneyBetLike {
  bet_type: string;
  side: string | null;
  units: number | string;
}

export interface MoneySide {
  n: number;
  units: number;
}

export interface MoneySplit {
  betType: string;
  /** home or over */
  a: MoneySide;
  /** away or under */
  b: MoneySide;
}

const A_SIDES = new Set(["home", "over"]);
const B_SIDES = new Set(["away", "under"]);
const SPLIT_TYPES = ["spread", "total", "moneyline"];

/**
 * Side splits per market, for markets carrying two or more bets. Types the
 * grader can't settle from a full-game score (team_total, first_half,
 * future) are excluded — their sides aren't comparable across rows.
 */
export function moneySplits(bets: MoneyBetLike[]): MoneySplit[] {
  const out: MoneySplit[] = [];
  for (const betType of SPLIT_TYPES) {
    const a: MoneySide = { n: 0, units: 0 };
    const b: MoneySide = { n: 0, units: 0 };
    for (const bet of bets) {
      if (bet.bet_type !== betType || bet.side === null) continue;
      const u = Number(bet.units);
      if (!Number.isFinite(u)) continue;
      if (A_SIDES.has(bet.side)) {
        a.n += 1;
        a.units += u;
      } else if (B_SIDES.has(bet.side)) {
        b.n += 1;
        b.units += u;
      }
    }
    if (a.n + b.n >= 2) out.push({ betType, a, b });
  }
  return out;
}
