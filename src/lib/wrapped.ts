/**
 * The Slate Wrapped (R5-C) — the season, one fact per card, derived on read
 * from the receipts. Pure: the loader (`wrapped-data.ts`) shapes rows, this
 * module does the arithmetic and the selection, and every card it declines
 * to mint is declined honestly (no data → no card, never a placeholder).
 *
 * The voice rules apply hardest here (BRAND §16/§38): the cards state
 * numbers, including the unflattering ones — the CLV card exists to say
 * "you won but the close beat you" out loud. No locks, no hammers.
 */

import {
  cumulativeUnits,
  formatRecord,
  tally,
  type Tally,
  type Wager,
} from "./records";

export interface WrappedPickRow extends Wager {
  /** "AUB +6.5" — precomputed by the loader with pickSideLabel. */
  label: string;
  /** Side-perspective line (positive = the dog); null for straight-up. */
  line: number | null;
  kickoff: string | null;
  /** Nobody else in the pool took this side of this game. */
  soleSide: boolean;
  /** How many pool members picked this game at all, viewer included. */
  pickersOnGame: number;
}

export interface WrappedBetRow extends Wager {
  label: string;
  /** Side-perspective line for the underdog check; null when not a spread. */
  sideLine: number | null;
}

export interface WorstBeatRow {
  label: string;
  secondsLeft: number | null;
  lastPlay: string | null;
}

export interface PoolFinish {
  name: string;
  rank: number;
  size: number;
  record: string;
}

export interface WrappedInput {
  year: number;
  picks: WrappedPickRow[];
  bets: WrappedBetRow[];
  beats: WorstBeatRow[];
  pools: PoolFinish[];
}

export interface WrappedCardFact {
  kind:
    | "record"
    | "ledger"
    | "highWater"
    | "bestCall"
    | "contrarian"
    | "streak"
    | "worstBeat"
    | "clv"
    | "crew";
  eyebrow: string;
  /** The huge fact — set in scorebug mono, so keep it short. */
  headline: string;
  detail?: string;
  sub?: string;
}

const signed = (u: number, dp = 1) => `${u >= 0 ? "+" : "−"}${Math.abs(u).toFixed(dp)}`;

function clvFraming(t: Tally): string {
  const won = t.units >= 0;
  const beatClose = (t.avgClv ?? 0) > 0;
  if (won && beatClose) return "You won and you beat the close. It's real.";
  if (won && !beatClose) return "You won, but the close beat you. Enjoy it while it lasts.";
  if (!won && beatClose) return "You lost, but you beat the close. The process is fine.";
  return "You lost, and the close won too. The market saw you coming.";
}

export function buildWrapped(input: WrappedInput): WrappedCardFact[] {
  const cards: WrappedCardFact[] = [];
  const pickTally = tally(input.picks);
  const betTally = tally(input.bets);

  if (pickTally.decided > 0) {
    cards.push({
      kind: "record",
      eyebrow: "The record",
      headline: formatRecord(pickTally),
      detail: `${signed(pickTally.units)}u across ${pickTally.decided} graded picks`,
      sub: pickTally.roi === null ? undefined : `${signed(pickTally.roi * 100, 1)}% ROI`,
    });
  }

  if (betTally.decided > 0) {
    cards.push({
      kind: "ledger",
      eyebrow: "The ledger",
      headline: `${signed(betTally.units)}u`,
      detail: `${formatRecord(betTally)} on ${betTally.decided} settled bets`,
      sub: betTally.roi === null ? undefined : `${signed(betTally.roi * 100, 1)}% ROI`,
    });
  }

  // High water: the curve's peak, minted only when there was a real ride.
  if (betTally.decided >= 5) {
    const curve = cumulativeUnits(input.bets);
    const peak = Math.max(0, ...curve);
    const trough = Math.min(0, ...curve);
    if (peak > 0 && peak > betTally.units) {
      cards.push({
        kind: "highWater",
        eyebrow: "High water",
        headline: `${signed(peak)}u`,
        detail: "the season's high-water mark",
        sub: trough < 0 ? `low tide ${signed(trough)}u` : undefined,
      });
    }
  }

  // Best call: the biggest dog that barked; failing that, the pick that beat
  // the close hardest and still cashed.
  const winners = input.picks.filter((p) => p.result === "win");
  const dogWins = winners
    .filter((p) => p.line !== null && p.line >= 3)
    .sort((a, b) => (b.line as number) - (a.line as number));
  const betDogWins = input.bets
    .filter((b) => b.result === "win" && b.sideLine !== null && b.sideLine >= 3)
    .sort((a, b) => (b.sideLine as number) - (a.sideLine as number));
  const bestDogLine = Math.max(dogWins[0]?.line ?? -Infinity, betDogWins[0]?.sideLine ?? -Infinity);
  if (bestDogLine >= 3) {
    const fromPick = (dogWins[0]?.line ?? -Infinity) >= (betDogWins[0]?.sideLine ?? -Infinity);
    const label = fromPick ? dogWins[0].label : betDogWins[0].label;
    cards.push({
      kind: "bestCall",
      eyebrow: "The best call",
      headline: label,
      detail: `a ${bestDogLine}-point dog, and you took it`,
    });
  } else {
    const byClv = [...winners]
      .filter((p) => p.clv !== null && Number(p.clv) > 0)
      .sort((a, b) => Number(b.clv) - Number(a.clv));
    if (byClv.length > 0) {
      cards.push({
        kind: "bestCall",
        eyebrow: "The best call",
        headline: byClv[0].label,
        detail: `beat the close by ${Number(byClv[0].clv).toFixed(1)} and cashed`,
      });
    }
  }

  // The contrarian: alone on a side, in a game the pool actually played, and right.
  const contrarian = winners
    .filter((p) => p.soleSide && p.pickersOnGame >= 3)
    .sort((a, b) => b.pickersOnGame - a.pickersOnGame)[0];
  if (contrarian) {
    cards.push({
      kind: "contrarian",
      eyebrow: "The contrarian",
      headline: contrarian.label,
      detail: `${contrarian.pickersOnGame - 1} went the other way. You didn't.`,
    });
  }

  // Longest heater, in kickoff order. Pushes and voids are no action (League
  // Rule #4) — only a loss ends a run.
  const ordered = [...input.picks]
    .filter((p) => p.kickoff !== null)
    .sort((a, b) => (a.kickoff as string).localeCompare(b.kickoff as string));
  let run = 0;
  let best = 0;
  for (const p of ordered) {
    if (p.result === "win") {
      run++;
      best = Math.max(best, run);
    } else if (p.result === "loss") {
      run = 0;
    }
  }
  if (best >= 3) {
    cards.push({
      kind: "streak",
      eyebrow: "The heater",
      headline: `${best} straight`,
      detail: "your longest run of winners",
    });
  }

  // The worst beat: the flip that died latest.
  const beat = [...input.beats].sort(
    (a, b) => (a.secondsLeft ?? Infinity) - (b.secondsLeft ?? Infinity),
  )[0];
  if (beat) {
    const secs = beat.secondsLeft;
    cards.push({
      kind: "worstBeat",
      eyebrow: "The worst beat",
      headline: beat.label,
      detail: beat.lastPlay ?? undefined,
      sub:
        secs === null
          ? "a cover, gone late"
          : `flipped with ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} left`,
    });
  }

  // The honesty card. A mean of a handful is noise, so it waits for a sample.
  const combined = tally([...input.picks, ...input.bets]);
  if (combined.clvCount >= 10 && combined.avgClv !== null) {
    cards.push({
      kind: "clv",
      eyebrow: "The truth serum",
      headline: `${signed(combined.avgClv, 2)} CLV`,
      detail: clvFraming(combined),
      sub: `${combined.clvCount} closing lines`,
    });
  }

  // Where you finished, best pool first.
  const pools = [...input.pools].sort((a, b) => a.rank - b.rank);
  if (pools.length > 0) {
    const p = pools[0];
    cards.push({
      kind: "crew",
      eyebrow: "The crew",
      headline: `#${p.rank}`,
      detail: `of ${p.size} in ${p.name} (${p.record})`,
      sub:
        pools.length > 1
          ? pools
              .slice(1)
              .map((q) => `#${q.rank} in ${q.name}`)
              .join(" · ")
          : undefined,
    });
  }

  return cards;
}
