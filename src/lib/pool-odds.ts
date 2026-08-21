/**
 * Win-the-week % (R2-D3): a seeded Monte Carlo over the board's remaining
 * games. One number per member that moves as games grade — the identity
 * mechanic (a number beats a table).
 *
 * PRESENTATION MATH ONLY. Per-game win probabilities come from data that
 * already exists: the frozen prediction's homeWinProb where there is one
 * (CFB), a market-implied number from the spread otherwise, 50/50 with no
 * line at all. Cover and total outcomes are coin flips by construction —
 * betting them profitably being ~impossible is this site's founding
 * evidence. Nothing here touches the model.
 *
 * Assumptions, documented rather than hidden:
 *  - Games are independent.
 *  - Within one game, the winner / the cover / the total are sampled
 *    independently (they are correlated in reality; at crew scale the
 *    ranking this feeds is insensitive to it).
 *  - Ties in the projected standings split the "win" equally.
 */

import type { MachinePick } from "./pool-machine";
import { tally, type Tally, type Wager } from "./records";

/** Deterministic PRNG (mulberry32) — a seeded run is reproducible in a test. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Market-implied home win probability from a home-perspective spread, via
 * the model's published logistic slope (1.7/σ — a constant read, not a
 * parameter change). Null spread = a coin flip.
 */
export function impliedHomeProb(spread: number | null): number {
  if (spread === null) return 0.5;
  return 1 / (1 + Math.exp(0.101 * spread));
}

export interface OddsGame {
  id: number;
  /** Frozen prediction's number when it exists; else implied; else 0.5. */
  homeWinProb: number;
}

/**
 * P(win the week) per member. `base` is graded week tallies; `pending` the
 * visible ungraded picks; `games` the outcome models for their games.
 */
export function weekWinOdds(
  members: Array<{ userId: string }>,
  base: Map<string, Tally>,
  pending: MachinePick[],
  games: OddsGame[],
  iterations = 2000,
  seed = 20260817,
): Map<string, number> {
  const rng = mulberry32(seed);
  const probOf = new Map(games.map((g) => [g.id, g.homeWinProb]));
  const wins = new Map<string, number>(members.map((m) => [m.userId, 0]));
  if (members.length === 0) return wins;

  for (let i = 0; i < iterations; i++) {
    // One sampled reality per game: who wins, who covers, over or under.
    const winner = new Map<number, "home" | "away">();
    const cover = new Map<number, "home" | "away">();
    const total = new Map<number, "over" | "under">();
    for (const g of games) {
      winner.set(g.id, rng() < (probOf.get(g.id) ?? 0.5) ? "home" : "away");
      cover.set(g.id, rng() < 0.5 ? "home" : "away");
      total.set(g.id, rng() < 0.5 ? "over" : "under");
    }
    const synth = new Map<string, Wager[]>();
    for (const p of pending) {
      let won: boolean;
      if (p.market === "straight_up") won = winner.get(p.gameId) === p.side;
      else if (p.market === "spread") won = cover.get(p.gameId) === p.side;
      else won = total.get(p.gameId) === p.side;
      const arr = synth.get(p.userId) ?? [];
      arr.push({ result: won ? "win" : "loss", units: p.units });
      synth.set(p.userId, arr);
    }
    /* POOL-6: the sim scores the week the way the board does — points. It read
       units until 2026-08-21, which is the same defect as a machine racing in
       units beside a board scoring in points, only harder to see: the odds
       column would have been answering "who wins the week on a book's
       arithmetic" while the standings underneath answered a different
       question. Ties are now genuinely common (points are integers, and −110
       units almost never tie), which is what the leader-splitting below is
       for. */
    let bestPoints = -Infinity;
    let leaders: string[] = [];
    for (const m of members) {
      const points = (base.get(m.userId)?.points ?? 0) + tally(synth.get(m.userId) ?? []).points;
      if (points > bestPoints + 1e-9) {
        bestPoints = points;
        leaders = [m.userId];
      } else if (Math.abs(points - bestPoints) <= 1e-9) {
        leaders.push(m.userId);
      }
    }
    for (const l of leaders) wins.set(l, (wins.get(l) ?? 0) + 1 / leaders.length);
  }

  for (const [k, v] of wins) wins.set(k, v / iterations);
  return wins;
}
