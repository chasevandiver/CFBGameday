/**
 * Structural soft-market tags for a game (SPEC §5.1, F11).
 *
 * "Soft" here is a claim about the MARKET's structure — thinner limits, less
 * syndicate attention, slower prices — not a measured profit. The 49.2% edge
 * verdict was measured against closing lines pooled across all markets; §5.1's
 * taxonomy names where the close itself is a weaker opponent. A tag marks a
 * game as belonging to one of those structurally softer pools and claims
 * nothing further; per SPEC §11.1 the only verification that counts is CLV.
 *
 * Only the tags derivable from data we hold are computed. The taxonomy's
 * judgment calls — backup-QB situations, backdoor dynamics — are editorial
 * copy on /edges, not tags, because nothing in the database knows a depth
 * chart.
 */

import { tierOf } from "./tiers";

export type SoftMarket = "G5" | "weekday";

/** Human label per tag, for row meta lines and titles. */
export const SOFT_MARKET_LABEL: Record<SoftMarket, string> = {
  G5: "G5 matchup",
  weekday: "weekday game",
};

export interface SoftMarketTeam {
  school: string;
  conference: string | null;
}

/**
 * Tags for one game. `season` is the calendar-year season id (`seasons.id`);
 * it only changes the answer for 2023 and earlier (the Pac-12 rule in
 * `tierOf`). `tz` is the display timezone the weekday is judged in.
 *
 * Weekday means Tuesday or Wednesday — the MACtion window the spec names.
 * Thursday and Friday carry national broadcasts and the market attention that
 * follows them, so they don't qualify as structurally soft.
 */
export function softMarketTags(
  game: { startTs: string | null; home: SoftMarketTeam; away: SoftMarketTeam },
  season: number,
  tz: string,
): SoftMarket[] {
  const tags: SoftMarket[] = [];

  const homeTier = tierOf(game.home.conference, game.home.school, season);
  const awayTier = tierOf(game.away.conference, game.away.school, season);
  if (homeTier === "G5" && awayTier === "G5") tags.push("G5");

  if (game.startTs !== null) {
    const day = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
    }).format(new Date(game.startTs));
    if (day === "Tue" || day === "Wed") tags.push("weekday");
  }

  return tags;
}
