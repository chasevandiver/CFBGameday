/**
 * Turning the two things the product already has — a bet slip and a list of
 * ledger rows — into a share-card payload.
 *
 * Pure, and separate from `share-card.ts` so the domain module never has to
 * import the client-only slip store. Same split as `group-share.ts`, which
 * builds the text contexts from the same two sources.
 */

import type { SlipSelection } from "./bet-slip-store";
import type { BetRow, ConfidenceTier } from "./db-types";
import { sportOfSeasonId } from "./league";
import { capForCard, sanitizeForCard, type ShareCardBet, type ShareCardPayload } from "./share-card";

/** "<display_name> Bets" — the owner asked for exactly this string. */
export function cardTitle(displayName: string): string {
  const name = displayName.trim();
  return name ? `${name} Bets` : "My Bets";
}

export function cardSubtitle(week: number, day: string): string {
  return `Week ${week} · ${day}`;
}

/** The teams a card row draws, or nulls for a bet with no game. */
interface Sides {
  away: ShareCardBet["away"];
  home: ShareCardBet["home"];
}

const NO_SIDES: Sides = { away: null, home: null };

/**
 * A slip that has not been logged yet.
 *
 * The units come from the slip's own inputs rather than from the selection,
 * because that is where they live until the moment of submit — the same
 * `unitsFor` the slip uses to price its own footer.
 */
export function slipCardPayload(
  slip: SlipSelection[],
  unitsFor: (key: string) => number,
  { displayName, week, day }: { displayName: string; week: number; day: string },
): ShareCardPayload {
  const bets: ShareCardBet[] = slip.map((s) => {
    const units = unitsFor(`${s.gameId}:${s.betType}`);
    return {
      key: `${s.gameId}:${s.betType}`,
      tier: s.tier,
      pick: sanitizeForCard(s.label),
      matchup: sanitizeForCard(s.matchup),
      away: s.away,
      home: s.home,
      units: Number.isFinite(units) ? units : 1,
      odds: s.odds,
      kickTs: s.kickTs,
    };
  });
  const capped = capForCard(bets);
  return {
    title: cardTitle(displayName),
    subtitle: cardSubtitle(week, day),
    bets: capped.bets,
    overflow: capped.overflow,
  };
}

export interface BetCardGame {
  startTs: string | null;
  away: ShareCardBet["away"];
  home: ShareCardBet["home"];
}

/**
 * Logged bets, from the ledger or a group sheet.
 *
 * `description` is used verbatim as the pick. A ledger row is freeform by
 * design ("OSU win total o10.5") and `share-text.ts` reached the same
 * conclusion for the same reason: there is no honest way to reconstruct one
 * from a side and a line.
 *
 * The league comes from the row's own `season_id` rather than from a column on
 * the game, because `slate.ts` is explicit that league is derived from the
 * season id and never guessed. That is what lets an NFL bet head a section
 * called "Bet of the Early window Slate" instead of a college one.
 */
export function betsCardPayload(
  bets: BetRow[],
  gameById: Map<number, BetCardGame>,
  { displayName, week, day }: { displayName: string; week: number; day: string },
): ShareCardPayload {
  const rows: ShareCardBet[] = bets.map((b) => {
    const game = b.game_id === null ? undefined : gameById.get(b.game_id);
    const sides: Sides = game ? { away: game.away, home: game.home } : NO_SIDES;
    return {
      key: `bet:${b.id}`,
      tier: b.confidence as ConfidenceTier,
      pick: sanitizeForCard(b.description),
      matchup: sanitizeForCard(
        game && game.away && game.home ? `${game.away.abbr} at ${game.home.abbr}` : "Season futures",
      ),
      ...sides,
      units: Number(b.units),
      odds: b.odds,
      kickTs: game?.startTs ?? null,
      league: sportOfSeasonId(b.season_id),
    };
  });
  const capped = capForCard(rows);
  return {
    title: cardTitle(displayName),
    subtitle: cardSubtitle(week, day),
    bets: capped.bets,
    overflow: capped.overflow,
  };
}

/**
 * The bets worth putting on a card: open ones, newest conviction first.
 *
 * A share is a forward-looking object — "here is what I am on" — so a graded
 * or voided row has no place on it. Filtering here rather than at each call
 * site means the ledger and the group sheet cannot disagree about it.
 */
export function shareableBets(bets: BetRow[]): BetRow[] {
  return bets.filter((b) => b.result === null && b.voided_at === null);
}
