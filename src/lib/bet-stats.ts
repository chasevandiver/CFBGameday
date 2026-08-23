/**
 * Deeper cuts of one member's season (GRP-9) — pure functions over the
 * classified sheet, plus the cover-flip receipts for the two that need to know
 * how a game ENDED rather than just that it did.
 *
 * Everything here is derived at read time from rows that already exist. No new
 * tables, no new writes: `cover_flips` has recorded every late flip since 0026
 * precisely so questions like "how many bad beats has Dave taken" could be
 * answered after the fact.
 */

import { tally, type Tally, type Wager } from "./records";
import type { WagerResult } from "./records";

/**
 * The slice of a bet these functions read — structural on purpose, so the
 * group sheet's `ClassifiedBet` and the ledger's own rows both fit without a
 * mapping layer that would drift.
 */
export interface StatBet {
  id: number;
  gameId: number | null;
  betType: string;
  side: string | null;
  units: number;
  placedAt: string;
  result: WagerResult;
  payoutUnits: number | null;
  clv: number | null;
}

const asWager = (b: StatBet): Wager => ({
  result: b.result,
  units: b.units,
  payoutUnits: b.payoutUnits,
  clv: b.clv,
});

/* ---- by market ---------------------------------------------------------- */

export interface MarketSplit {
  key: string;
  label: string;
  t: Tally;
}

/**
 * Spreads, totals and moneylines are three different skills wearing one
 * record. Anything rarer (team totals, futures) pools under "Other" rather
 * than earning a tile per exotic — a grid of six one-bet categories reads as
 * noise, and "Other 1-0" reads as a footnote, which is what it is.
 */
export function marketSplit(bets: StatBet[]): MarketSplit[] {
  const buckets: Array<{ key: string; label: string; match: (t: string) => boolean }> = [
    { key: "spread", label: "Spreads", match: (t) => t === "spread" },
    { key: "total", label: "Totals", match: (t) => t === "total" },
    { key: "moneyline", label: "Moneylines", match: (t) => t === "moneyline" },
    { key: "other", label: "Other", match: (t) => !["spread", "total", "moneyline"].includes(t) },
  ];
  return buckets
    .map((b) => ({ key: b.key, label: b.label, t: tally(bets.filter((x) => b.match(x.betType)).map(asWager)) }))
    .filter((b) => b.t.decided > 0);
}

/* ---- streaks ------------------------------------------------------------ */

export interface Streaks {
  /** The run they are on right now, newest graded bet backwards. Pushes and
   *  voids neither extend nor break it — a push is not a loss, and treating it
   *  as one would end a heater over a tie. */
  current: { kind: "win" | "loss"; length: number } | null;
  longestWin: number;
  longestLoss: number;
}

/** `bets` in any order; graded wins/losses are sorted by placement here. */
export function streaks(bets: StatBet[]): Streaks {
  const decided = bets
    .filter((b) => b.result === "win" || b.result === "loss")
    .sort((a, b) => a.placedAt.localeCompare(b.placedAt) || a.id - b.id)
    .map((b) => b.result as "win" | "loss");
  let longestWin = 0;
  let longestLoss = 0;
  let run = 0;
  let kind: "win" | "loss" | null = null;
  for (const r of decided) {
    if (r === kind) run += 1;
    else {
      kind = r;
      run = 1;
    }
    if (kind === "win") longestWin = Math.max(longestWin, run);
    else longestLoss = Math.max(longestLoss, run);
  }
  return {
    current: kind === null ? null : { kind, length: run },
    longestWin,
    longestLoss,
  };
}

/* ---- extremes ----------------------------------------------------------- */

export interface Extremes {
  /** Their best day, by what it actually paid. */
  bestWin: StatBet | null;
  /** Their worst, by what it cost — units risked, since a loss pays nothing. */
  worstLoss: StatBet | null;
}

export function extremes(bets: StatBet[]): Extremes {
  const wins = bets.filter((b) => b.result === "win");
  const losses = bets.filter((b) => b.result === "loss");
  const bestWin = wins.reduce<StatBet | null>(
    (best, b) => (best === null || (b.payoutUnits ?? 0) > (best.payoutUnits ?? 0) ? b : best),
    null,
  );
  const worstLoss = losses.reduce<StatBet | null>(
    (worst, b) => (worst === null || b.units > worst.units ? b : worst),
    null,
  );
  return { bestWin, worstLoss };
}

/* ---- bad beats and back doors ------------------------------------------- */

/** The slice of a cover_flips row these functions read. */
export interface FlipRow {
  game_id: number;
  market: string;
  from_side: string;
  to_side: string;
  period: number | null;
}

export interface LateFlips {
  /** Losses that were WINS in the 4th quarter — the cover left them late. */
  badBeats: number;
  /** Wins that were losses in the 4th — the backdoor swung their way. */
  backdoors: number;
}

/**
 * A bad beat is not just a loss: it is a loss that was a win in the fourth
 * quarter. `cover_flips` records the transition live (it cannot be
 * reconstructed later — 0026's whole reason to exist), so this is a join, not
 * a guess: a graded spread/total loss whose game logged a 4th-quarter-or-later
 * flip AWAY from the side they held. The mirror image — a win the flip moved
 * TO them late — is the backdoor they will not mention at the bar.
 *
 * Moneylines are excluded by construction: `cover_flips.market` is spread or
 * total only, and an ML "bad beat" (blowing a lead) is a different fact this
 * table does not record.
 */
export function lateFlips(bets: StatBet[], flips: FlipRow[]): LateFlips {
  const late = flips.filter((f) => (f.period ?? 0) >= 4);
  const key = (gameId: number, market: string) => `${gameId}:${market}`;
  const byMarket = new Map<string, FlipRow[]>();
  for (const f of late) {
    const k = key(f.game_id, f.market);
    byMarket.set(k, [...(byMarket.get(k) ?? []), f]);
  }
  let badBeats = 0;
  let backdoors = 0;
  for (const b of bets) {
    if (b.gameId === null || b.side === null) continue;
    if (b.betType !== "spread" && b.betType !== "total") continue;
    const rows = byMarket.get(key(b.gameId, b.betType)) ?? [];
    if (b.result === "loss" && rows.some((f) => f.from_side === b.side)) badBeats += 1;
    if (b.result === "win" && rows.some((f) => f.to_side === b.side)) backdoors += 1;
  }
  return { badBeats, backdoors };
}
