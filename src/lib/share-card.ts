/**
 * The image share of a member's bets — everything about it that is a decision
 * rather than a pixel.
 *
 * Sibling to `share-text.ts`, and deliberately the same shape: pure, no React,
 * no I/O, so the ordering and the headings can be pinned by tests instead of
 * eyeballed in a share sheet. The route renders whatever this returns.
 *
 * The card exists to do the one thing the text share admits it cannot.
 * `share-text.ts` opens by conceding that iMessage's proportional font means
 * "no amount of padding will make columns line up" — so the units column here
 * is fixed-width and every stake is printed to one decimal, because a column
 * that actually aligns is the entire argument for shipping an image.
 *
 * Layout lives in `public/design/share-card-d.html`, which renders all four
 * hero states.
 */

import { CONFIDENCE_TIERS, type ConfidenceTier } from "./db-types";
import { kickSlot, nflKickSlot } from "./kick";

export interface ShareCardTeam {
  abbr: string;
  /** Absolute URL. Null falls back to the abbr monogram, as TeamMark does. */
  logo: string | null;
  color: string | null;
}

export interface ShareCardBet {
  /** `${gameId}:${betType}` for a game bet, or `future:${id}`. */
  key: string;
  tier: ConfidenceTier;
  /** The pick as the bettor took it: "Georgia −6.5", "Over 51.5". */
  pick: string;
  /** "Tennessee at Georgia", "Ole Miss / LSU", "Season futures". */
  matchup: string;
  /** Both null for a future, which has no game and therefore no logos. */
  away: ShareCardTeam | null;
  home: ShareCardTeam | null;
  units: number;
  /** American. */
  odds: number;
  /** ISO kickoff. Null for a future, or a game with no announced time. */
  kickTs: string | null;
  /** The NFL names its windows differently. Defaults to college. */
  league?: "cfb" | "nfl";
}

export interface ShareCardPayload {
  /** "<display_name> Bets" — the owner asked for exactly this. */
  title: string;
  /** "Week 3 · Sat Sep 12" */
  subtitle: string;
  bets: ShareCardBet[];
  /** Bets that did not fit, for the "+N more" line. */
  overflow: number;
}

/**
 * Twelve rows is where the layout stops being legible on a phone-sized
 * rendering of a 1350px card — measured in share-card-d.html, not guessed.
 */
export const MAX_CARD_BETS = 12;

/** Index into the ordered ladder. Higher is more conviction. */
export function tierRank(tier: ConfidenceTier): number {
  return CONFIDENCE_TIERS.indexOf(tier);
}

/**
 * Conviction first, then the clock — the sort the owner asked for.
 *
 * Unscheduled bets (futures, and games with no announced kickoff) sink to the
 * bottom of their own tier rather than sorting first off a null. Ties keep
 * input order, which is the order the bets were placed; `sort` has been
 * stable since ES2019 and `groupByKickoff` in share-text.ts already leans on
 * that, so this returns 0 rather than threading an index through.
 */
export function sortForCard(bets: ShareCardBet[]): ShareCardBet[] {
  return [...bets].sort((a, b) => {
    const byTier = tierRank(b.tier) - tierRank(a.tier);
    if (byTier !== 0) return byTier;
    const at = a.kickTs ?? null;
    const bt = b.kickTs ?? null;
    if (at === bt) return 0;
    if (at === null) return 1;
    if (bt === null) return -1;
    return at.localeCompare(bt);
  });
}

/**
 * The hero rule, and the whole rule: the top bet gets the panel **iff exactly
 * one bet sits alone at the highest tier present**.
 *
 * It lives here rather than as a check inside the JSX so it can be tested on
 * its own, because the failure it prevents is a quiet one. Direction C in the
 * first exploration round promoted its first row unconditionally, which on a
 * Saturday where every bet is the same tier means the card asserts that one of
 * them is special when nothing says so.
 *
 * A lone bet trivially satisfies this and gets the hero. That is not a special
 * case — it is the same sentence — and the card looks far better for it than a
 * single thin row on 1350px of empty field.
 */
export function heroBet(bets: ShareCardBet[]): ShareCardBet | null {
  if (bets.length === 0) return null;
  const top = Math.max(...bets.map((b) => tierRank(b.tier)));
  const atTop = bets.filter((b) => tierRank(b.tier) === top);
  return atTop.length === 1 ? atTop[0] : null;
}

/** The broadcast window a bet belongs to, in its own league's vocabulary. */
export function slotOf(bet: ShareCardBet): string | null {
  if (!bet.kickTs) return null;
  return bet.league === "nfl" ? nflKickSlot(bet.kickTs) : kickSlot(bet.kickTs);
}

/**
 * What a group of same-tier bets is called.
 *
 * The superlatives stay singular even over several rows — they are titles, not
 * categories, and "Bets of the Century" reads like a joke. The bottom two rungs
 * are categories and do pluralise.
 *
 * `slate` interpolates the broadcast window from the bet's own kickoff, so a
 * 2:30 CT bet heads a section called "Bet of the Afternoon Slate" with no
 * column anywhere storing "afternoon". Falls back to the bare "Bet of the
 * Slate" when there is no kickoff to read a window off.
 */
export function tierHeadline(bet: ShareCardBet, count: number): string {
  switch (bet.tier) {
    case "lean":
      return count === 1 ? "Lean" : "Leans";
    case "bet":
      return count === 1 ? "Bet" : "Bets";
    case "slate": {
      const slot = slotOf(bet);
      return slot ? `Bet of the ${slot} Slate` : "Bet of the Slate";
    }
    case "day":
      return "Bet of the Day";
    case "year":
      return "Bet of the Year";
    case "century":
      return "Bet of the Century";
  }
}

/**
 * Two `slate` bets in different windows are not the same section — one is the
 * bet of the afternoon and the other the bet of primetime — so the window is
 * part of the grouping key for that tier alone. Kickoff order already clusters
 * windows together, so this never fragments a run that should have been whole.
 */
function groupKeyOf(bet: ShareCardBet): string {
  return bet.tier === "slate" ? `slate:${slotOf(bet) ?? "tbd"}` : bet.tier;
}

export interface ShareCardGroup {
  tier: ConfidenceTier;
  heading: string;
  bets: ShareCardBet[];
}

/**
 * Consecutive same-tier runs, so a heading is printed on a tier *change*
 * rather than once per row. That is what buys back the vertical cost of
 * printing the tier in words at all — seven bets at one tier need one heading,
 * not seven. Same consecutive-run shape as `groupByKickoff`.
 *
 * Expects sorted input; call `sortForCard` first.
 */
export function groupByTier(bets: ShareCardBet[]): ShareCardGroup[] {
  const out: ShareCardGroup[] = [];
  let lastKey: string | null = null;
  for (const bet of bets) {
    const key = groupKeyOf(bet);
    if (lastKey === key && out.length > 0) {
      out[out.length - 1].bets.push(bet);
    } else {
      out.push({ tier: bet.tier, heading: "", bets: [bet] });
      lastKey = key;
    }
  }
  // The heading needs the group's size, so it is filled once the run is closed.
  for (const g of out) g.heading = tierHeadline(g.bets[0], g.bets.length);
  return out;
}

/**
 * Sort, then cut. The order matters: capping before sorting would drop bets by
 * the order they were placed and could throw away the Bet of the Year to keep
 * a lean.
 */
export function capForCard(bets: ShareCardBet[]): { bets: ShareCardBet[]; overflow: number } {
  const sorted = sortForCard(bets);
  return {
    bets: sorted.slice(0, MAX_CARD_BETS),
    overflow: Math.max(0, sorted.length - MAX_CARD_BETS),
  };
}

/**
 * Always one decimal, so the column aligns. `2u` above `1.5u` puts the decimal
 * points out of register and undoes the reason this is an image.
 */
export function formatUnits(units: number): string {
  return `${units.toFixed(1)}u`;
}

/**
 * A real minus sign (U+2212), not a hyphen: this is set in IBM Plex Mono at
 * display size on a card meant for a timeline, and a hyphen sits too high and
 * too short next to tabular figures.
 *
 * Plex Mono covers U+2212, but satori draws tofu rather than falling back when
 * a supplied font lacks a glyph — so whoever wires the fonts up in SHARE-5
 * must confirm coverage on the actual subset that ships, not on the family.
 */
export function formatOdds(odds: number): string {
  return odds < 0 ? `−${Math.abs(odds)}` : `+${odds}`;
}

/** Total staked, for the footer. */
export function totalUnits(bets: ShareCardBet[]): number {
  return bets.reduce((sum, b) => sum + b.units, 0);
}
