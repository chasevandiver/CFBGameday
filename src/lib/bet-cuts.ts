/**
 * The cuts behind `/ledger/stats` — "how do I do on X" for a pile of bets.
 *
 * This module holds only the *key functions*: given a bet, which bucket is it
 * in. The arithmetic stays in `records.ts`, which already owns "compute a
 * record from a pile of wagers" and exists precisely because five surfaces once
 * disagreed about it. Every breakdown on the stats page is therefore
 * `tallyBy(bets, someKeyFn)` — no second tally, no second ROI, no second
 * −110 convention.
 *
 * Pure and database-free, like `records.ts` and `weeks.ts`, so the bucket
 * boundaries are testable without a fixture.
 *
 * ## What is deliberately not here
 *
 * No CLV cut. Closing-line value already has a home on `/ledger` — the stat
 * tile and the by-angle table — and duplicating it here would be a second
 * place for the same number to be right or wrong. The owner picked the three
 * descriptive cuts (2026-08-14); the predictive one stays where it is.
 */

import { BET_TYPE_LABELS, TEAM_SIDED, TOTAL_SIDED, type BetType } from "./db-types";
import { kickSlot, nflKickSlot } from "./kick";
import { sportOfSeasonId, type Sport } from "./league";
import type { Wager } from "./records";

/**
 * A ledger row with the game context the timing and matchup cuts need.
 *
 * `line` is **home-perspective**, as stored — the convention pinned by
 * `bet-line-convention.test.ts`. Nothing here displays it; `favouriteOrDog`
 * converts to the bettor's number internally and that is the only reader.
 */
export interface StatsBet extends Wager {
  betType: string | null;
  side: string | null;
  line: number | null;
  odds: number | null;
  confidence: string | null;
  seasonId: number;
  /** Kickoff. Null for a future, or a bet logged against no game. */
  startTs: string | null;
  homeTeamId: number | null;
  awayTeamId: number | null;
}

/** The bucket a bet falls in, or null when the cut does not apply to it. */
export type Cut = (b: StatsBet) => string | null;

/* ── Bet type, side and price ────────────────────────────────────────────── */

export const marketOf: Cut = (b) =>
  b.betType ? (BET_TYPE_LABELS[b.betType as BetType] ?? b.betType) : null;

/**
 * Home/Away for the team-sided markets, Over/Under for the total-sided ones.
 * One cut rather than two, because a ledger mixing spreads and totals wants a
 * single "which way do I lean" table, and the two vocabularies never collide.
 */
export const sideOf: Cut = (b) => {
  if (!b.betType || !b.side) return null;
  if (TEAM_SIDED.has(b.betType)) {
    return b.side === "home" ? "Home" : b.side === "away" ? "Away" : null;
  }
  if (TOTAL_SIDED.has(b.betType)) {
    return b.side === "over" ? "Over" : b.side === "under" ? "Under" : null;
  }
  return null;
};

/**
 * Favourite or underdog, from whichever field actually knows.
 *
 * Spread bets know from the line: `line` is home-perspective, so the bettor's
 * own number is `line` when they took home and `−line` when they took away —
 * the conversion `lineForSide` does for display. Negative means they laid
 * points.
 *
 * Moneylines know from the price instead, because a moneyline has no spread to
 * read. Everything else returns null rather than guessing: a total has no
 * favourite, and saying it does would put a confident wrong number on a page
 * whose whole job is to be believed.
 */
export const favouriteOrDog: Cut = (b) => {
  if (b.betType === "spread" || b.betType === "first_half") {
    if (b.line === null || !b.side) return null;
    const bettorsLine = b.side === "away" ? -b.line : b.line;
    if (bettorsLine === 0) return "Pick'em";
    return bettorsLine < 0 ? "Favourite" : "Underdog";
  }
  if (b.betType === "moneyline") {
    if (b.odds === null) return null;
    if (b.odds === 0) return null;
    return b.odds < 0 ? "Favourite" : "Underdog";
  }
  return null;
};

/**
 * Price bucket. The boundaries are the ones a bettor already thinks in: plus
 * money, standard juice, a bit steep, and laying a lot to win a little. −110
 * lands in "−100 to −120" because that is the number every spread is quoted
 * at, and splitting it out would make the modal bucket a bucket of one price.
 */
export const priceOf: Cut = (b) => {
  if (b.odds === null || b.odds === 0) return null;
  if (b.odds > 0) return "Plus money";
  if (b.odds >= -120) return "−100 to −120";
  if (b.odds >= -160) return "−121 to −160";
  return "Worse than −160";
};

/* ── Teams and matchups ──────────────────────────────────────────────────── */

export const leagueOf: Cut = (b) => (sportOfSeasonId(b.seasonId) === "nfl" ? "NFL" : "CFB");

/**
 * The team id a bet backed, and the one it faded — as ids, because this module
 * has no team names and should not learn them. The page resolves ids to
 * schools, which is also what lets it skip a team whose row it could not load.
 *
 * A total has no backed team: nobody bets "the over on Ohio State". Returns
 * nulls rather than picking the home side, so the matchup table counts only
 * bets that actually took a side.
 */
export function teamsOf(b: StatsBet): { backed: number | null; faded: number | null } {
  if (!b.betType || !TEAM_SIDED.has(b.betType) || !b.side) return { backed: null, faded: null };
  if (b.homeTeamId === null || b.awayTeamId === null) return { backed: null, faded: null };
  if (b.side === "home") return { backed: b.homeTeamId, faded: b.awayTeamId };
  if (b.side === "away") return { backed: b.awayTeamId, faded: b.homeTeamId };
  return { backed: null, faded: null };
}

/* ── Timing and discipline ───────────────────────────────────────────────── */

/**
 * Kickoff window, in each league's own broadcast vocabulary — `kickSlot` for
 * CFB (Noon / Afternoon / Primetime / Late) and `nflKickSlot` for the NFL
 * (Early window / Late window / Primetime). Reused rather than reinvented, and
 * the reason those functions are Eastern-clock rather than viewer-local
 * applies unchanged here: "the noon slate" is the same games in every
 * timezone, so a bettor in Denver and one in Boston get the same buckets.
 */
export const windowOf: Cut = (b) => {
  if (!b.startTs) return null;
  return sportOfSeasonId(b.seasonId) === "nfl" ? nflKickSlot(b.startTs) : kickSlot(b.startTs);
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Kickoff day, Eastern, for the same reason `windowOf` is Eastern. */
export const dayOf: Cut = (b) => {
  if (!b.startTs) return null;
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(new Date(b.startTs));
  return (DAYS as readonly string[]).includes(label) ? label : null;
};

/**
 * Stake size. Fixed boundaries rather than quantiles of this bettor's own
 * history, because a bucket that moves as you bet cannot answer "am I worse
 * when I bet big" — the thing it exists to answer.
 */
export const stakeOf: Cut = (b) => {
  const u = Number(b.units ?? 0);
  if (!Number.isFinite(u) || u <= 0) return null;
  if (u < 1) return "Under 1u";
  if (u === 1) return "1u";
  if (u <= 2) return "1–2u";
  if (u <= 3) return "2–3u";
  return "Over 3u";
};

export const confidenceOf: Cut = (b) => b.confidence ?? null;

/* ── Streaks ─────────────────────────────────────────────────────────────── */

export interface Streaks {
  /** Sign of the active run: "win", "loss", or null when nothing has graded. */
  currentKind: "win" | "loss" | null;
  currentLength: number;
  longestWin: number;
  longestLoss: number;
}

export const EMPTY_STREAKS: Streaks = {
  currentKind: null,
  currentLength: 0,
  longestWin: 0,
  longestLoss: 0,
};

/**
 * Win and loss runs over wagers **in the order given** — the caller sorts,
 * same contract as `cumulativeUnits`, and for the same reason: "in order"
 * means `placed_at` for a bet and kickoff for a pick, and this module knows
 * neither.
 *
 * Pushes and voids are skipped, not treated as breaks. League Rule #4 says a
 * push is no action and a void never happened, so a 3-game win streak
 * interrupted by a push is a 4-game win streak — which is also how anyone
 * describing their own week would say it.
 */
export function streaks(wagers: Iterable<Wager>): Streaks {
  let currentKind: "win" | "loss" | null = null;
  let currentLength = 0;
  let longestWin = 0;
  let longestLoss = 0;

  for (const w of wagers) {
    if (w.result !== "win" && w.result !== "loss") continue;
    if (w.result === currentKind) currentLength += 1;
    else {
      currentKind = w.result;
      currentLength = 1;
    }
    if (currentKind === "win") longestWin = Math.max(longestWin, currentLength);
    else longestLoss = Math.max(longestLoss, currentLength);
  }

  return { currentKind, currentLength, longestWin, longestLoss };
}

/* ── Table assembly ──────────────────────────────────────────────────────── */

/** One named cut, ready to render: the label above the table and its key fn. */
export interface CutSpec {
  label: string;
  cut: Cut;
  /** Fixed display order. Absent means sort by units, League Rules #5. */
  order?: readonly string[];
}

export const MARKET_CUTS: readonly CutSpec[] = [
  { label: "Market", cut: marketOf },
  { label: "Side", cut: sideOf, order: ["Home", "Away", "Over", "Under"] },
  { label: "Favourite or dog", cut: favouriteOrDog, order: ["Favourite", "Pick'em", "Underdog"] },
  {
    label: "Price",
    cut: priceOf,
    order: ["Plus money", "−100 to −120", "−121 to −160", "Worse than −160"],
  },
];

export const TIMING_CUTS: readonly CutSpec[] = [
  { label: "Kickoff window", cut: windowOf },
  { label: "Day", cut: dayOf, order: DAYS },
  { label: "Stake", cut: stakeOf, order: ["Under 1u", "1u", "1–2u", "2–3u", "Over 3u"] },
  { label: "Confidence", cut: confidenceOf },
];

export type { Sport };
