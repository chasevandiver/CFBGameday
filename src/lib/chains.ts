/**
 * Chains (CHAIN-1) — a daily run of higher-or-lower over the archive.
 *
 * ## The shape, and why it is a run
 *
 * One fixed sequence a day, the same for everybody. Each card puts two real
 * things side by side and asks which number is bigger. Get it right and the
 * chains move; get it wrong and the drive is over. Your run length is the
 * score.
 *
 * This is the third answer to the same complaint. Guess the Game asked you to
 * name a game from clues that narrowed nothing — a guess dressed as a puzzle.
 * A comparison cannot be that, because there is no space to guess *into*: it
 * is one in two every time, and the only thing that moves you off the coin
 * flip is knowing something. Which is the point.
 *
 * ## Difficulty has to ramp, or a run is just luck
 *
 * A run of coin flips has a geometric distribution and says nothing about the
 * player. So the cards are ordered by DECREASING gap between the two values:
 * card one is a blowout comparison anybody can call, card fifteen is two
 * numbers a point apart. That turns run length from a random variable into a
 * ladder, and it is the single most load-bearing thing in this file.
 *
 * Gaps are normalised per kind before they are compared, because a 14-point
 * spread difference and a 14-point scoring difference are not the same amount
 * of obvious.
 *
 * ## Ties are refused at generation, not voided at play
 *
 * `six-pack.ts` grades a push as `void` — nobody wins or loses it. A run has
 * nowhere to put a void: there is no slot for a non-event between "kept going"
 * and "stopped". So a card whose two values are equal is never minted. This is
 * the one place Chains departs from the void discipline everywhere else in the
 * arcade, and the reason is structural rather than a preference.
 */

import { EMPTY_DAILY, recordDayResult, type DailyStats } from "./daily-stats";

export type ChainsKind = "total_points" | "margin" | "spread" | "ap_finish";

/** How many cards a day's deck holds. Nobody is expected to reach the end. */
export const CHAINS_DECK = 20;

/**
 * What counts as a "wide" gap for each kind, in that kind's own units.
 *
 * Dividing by these is what makes gaps comparable: 20 points of scoring
 * difference and 20 points of spread difference are wildly different amounts
 * of obvious, and ordering the deck on raw differences would put four scoring
 * cards first every day.
 */
export const GAP_SCALE: Record<ChainsKind, number> = {
  total_points: 35,
  margin: 28,
  spread: 17,
  ap_finish: 15,
};

export interface ChainsSide {
  /** The headline — a fixture, or a team and a season. */
  label: string;
  /** The supporting line: the week, the season, the venue. */
  sub: string;
  /** Crest art, when the side is about one team. */
  teamId: number | null;
}

export interface ChainsCard {
  kind: ChainsKind;
  prompt: string;
  left: ChainsSide;
  right: ChainsSide;
  /** The numbers being compared. NEVER shipped for an unplayed card. */
  leftValue: number;
  rightValue: number;
  answer: "left" | "right";
}

/** The question each kind asks. One definition, shared by the deck and the UI. */
export function chainsPrompt(kind: ChainsKind): string {
  switch (kind) {
    case "total_points":
      return "Which game had more points?";
    case "margin":
      return "Which was won by more?";
    case "spread":
      return "Which had the bigger favourite?";
    case "ap_finish":
      return "Which finished higher in the final AP?";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * Which side is the answer.
 *
 * `ap_finish` inverts, and that inversion is exactly the kind of thing that
 * ships wrong and stays wrong: a poll rank is better when it is LOWER, so #2
 * beats #8 and the naive comparison gets every one of these cards backwards.
 * It has its own test.
 */
export function chainsWinner(kind: ChainsKind, left: number, right: number): "left" | "right" {
  const higherWins = kind !== "ap_finish";
  if (higherWins) return left > right ? "left" : "right";
  return left < right ? "left" : "right";
}

/**
 * How obvious a card is: 0 is a coin flip, 1 is a blowout. Capped at 1 so one
 * absurd pairing cannot dominate the ordering.
 */
export function cardGap(card: Pick<ChainsCard, "kind" | "leftValue" | "rightValue">): number {
  return Math.min(1, Math.abs(card.leftValue - card.rightValue) / GAP_SCALE[card.kind]);
}

/**
 * The deck, easiest first.
 *
 * Ties break on the prompt and then on the labels so the order is TOTAL — two
 * cards with the same gap must not depend on the order the generator happened
 * to build them in, or the "same run for everyone" promise quietly stops being
 * true across two runs of the generator.
 */
export function chainsOrder(cards: ChainsCard[]): ChainsCard[] {
  return [...cards].sort(
    (a, b) =>
      cardGap(b) - cardGap(a) ||
      a.kind.localeCompare(b.kind) ||
      a.left.label.localeCompare(b.left.label) ||
      a.right.label.localeCompare(b.right.label),
  );
}

/** A card with two equal values has no answer, so it is never minted. */
export function isMintable(left: number, right: number): boolean {
  return left !== right;
}

/* ---- the payload -------------------------------------------------------- */

export interface ChainsRunState {
  /** How many cards have been called correctly. Also the index in play. */
  length: number;
  busted: boolean;
  answers: Array<{ idx: number; choice: "left" | "right"; correct: boolean }>;
  ended_at: string | null;
}

export const EMPTY_RUN: ChainsRunState = {
  length: 0,
  busted: false,
  answers: [],
  ended_at: null,
};

/** One card, stripped of everything that would answer it. */
function faceUp(card: ChainsCard, idx: number) {
  return {
    idx,
    kind: card.kind,
    prompt: card.prompt,
    left: { label: card.left.label, sub: card.left.sub, teamId: card.left.teamId },
    right: { label: card.right.label, sub: card.right.sub, teamId: card.right.teamId },
  };
}

/** A card that has been played, with the numbers that decided it. */
function revealed(card: ChainsCard, idx: number) {
  return {
    ...faceUp(card, idx),
    leftValue: card.leftValue,
    rightValue: card.rightValue,
    answer: card.answer,
  };
}

/**
 * Everything the client may see.
 *
 * The whole deck exists on the server, and shipping it is the obvious way to
 * ruin this game — a player who can read card nine before answering card one
 * has no run, they have a list. So: exactly one face-up card, every card
 * already played revealed with its numbers, and the REST of the deck only once
 * the run is over.
 *
 * That last part is the payoff rather than a leak. "You stopped on card nine —
 * here is what ten through twenty were" is the reason to come back tomorrow,
 * and it can only be shown when there is nothing left to protect.
 */
export function chainsPayload(
  day: string,
  deck: ChainsCard[],
  run: ChainsRunState,
  stats: DailyStats = EMPTY_DAILY,
) {
  const over = run.busted || run.length >= deck.length;
  return {
    day,
    length: run.length,
    deckSize: deck.length,
    busted: run.busted,
    done: over,
    current: over ? null : faceUp(deck[run.length]!, run.length),
    played: run.answers.map((a) => ({
      ...revealed(deck[a.idx]!, a.idx),
      yours: a.choice,
      correct: a.correct,
    })),
    /* The rest of the deck, and only once there is nothing left to protect. */
    rest: over ? deck.slice(run.answers.length).map((c, i) => revealed(c, run.answers.length + i)) : [],
    stats,
  };
}

const CELL = { hit: "🟩", miss: "🟥" } as const;

/**
 * The share block. A run reads as a chain of links and one break, which says
 * how far you got without naming a single game — so it is legible to somebody
 * who has played and gives away nothing to somebody who has not.
 */
export function chainsShareBlock(day: string, run: ChainsRunState, best = 0): string {
  const links = run.answers.map((a) => (a.correct ? CELL.hit : CELL.miss)).join("");
  const footer = best > 0 ? `\nBest ${best}` : "";
  return `Chains · ${day} · ${run.length}\n${links}${footer}`;
}

/**
 * A day's run counts as a WIN when it reaches the end of the deck.
 *
 * Deliberately rare. Chains' currency is the run length, not the streak — a
 * game whose streak moves every day would be measuring attendance.
 */
export function chainsStanding(
  rows: Array<{ day: string; length: number; deckSize: number }>,
): DailyStats {
  return [...rows]
    .sort((a, b) => a.day.localeCompare(b.day))
    .reduce(
      (acc, r) => recordDayResult(acc, r.day, r.length >= r.deckSize, r.length),
      EMPTY_DAILY,
    );
}
