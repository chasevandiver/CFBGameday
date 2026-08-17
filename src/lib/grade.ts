/**
 * How a pick settles once the game is final.
 *
 * Pulled out of the Sunday grader (`scripts/lib/jobs-core.ts`) when
 * straight-up picks arrived, because the grader branched on `side` and
 * straight-up shares `home`/`away` with the spread. Grading it as a spread
 * would coerce its null line to 0 and quietly settle every winner pick at
 * pick'em — right most of the time, wrong exactly when a favourite wins by
 * less than the number, which is the interesting case.
 *
 * The equivalent live-game version lives in `live-status.ts`, which answers
 * "if it ended now" with a label attached. They agree on the formulas because
 * both call `coverMargin` in `cover.ts`; this one is the settlement.
 */

import { buildBoxScore } from "./boxscore";
import { coverMargin } from "./cover";
import type { ScoringPlayRow } from "./scoring";

export type PickMarket = "spread" | "total" | "straight_up";
export type PickResult = "win" | "loss" | "push";

/**
 * `line` is the number taken at pick time, and is null only for straight-up.
 * A spread or total with a null line cannot settle — the caller should never
 * see one, because a check constraint forbids it (migration 0021) — so this
 * returns null rather than inventing a zero.
 */
export function gradePick(
  market: PickMarket,
  side: string,
  line: number | null,
  homePoints: number,
  awayPoints: number,
): PickResult | null {
  const margin = homePoints - awayPoints;

  if (market === "straight_up") {
    if (side !== "home" && side !== "away") return null;
    // A tie is impossible in college football, but a bad feed can leave 0-0,
    // and settling that as a loss for whoever picked is worse than no action.
    if (margin === 0) return "push";
    return (margin > 0) === (side === "home") ? "win" : "loss";
  }

  if (line === null) return null;

  if (market === "spread") {
    if (side !== "home" && side !== "away") return null;
    // Home-perspective line: a home backer covers when margin + line > 0.
    const cm = coverMargin(side, line, homePoints, awayPoints);
    return cm > 0 ? "win" : cm < 0 ? "loss" : "push";
  }

  if (side !== "over" && side !== "under") return null;
  const diff = side === "over" ? homePoints + awayPoints - line : line - (homePoints + awayPoints);
  return diff > 0 ? "win" : diff < 0 ? "loss" : "push";
}

/**
 * A team total settles on one team's points (R2-A4). The subject team travels
 * in `bets.team_side` (0055) — rows from before that column, where the team
 * lives only in free-text `description`, are not auto-gradable and never
 * reach this function.
 */
export function gradeTeamTotal(
  side: "over" | "under",
  line: number,
  teamPoints: number,
): PickResult {
  const diff = side === "over" ? teamPoints - line : line - teamPoints;
  return diff > 0 ? "win" : diff < 0 ? "loss" : "push";
}

export interface HalfScore {
  home: number;
  away: number;
}

/**
 * The halftime score, ONLY when it is provable (R2-A4).
 *
 * `scoring_plays` yields an exact H1 split iff the stored plays fully explain
 * the final scoreboard: `buildBoxScore` puts each play's points in its period,
 * and the placed cells must sum to the scoreboard EXACTLY, both directions —
 * under (a missed play, or one with a null period that can't land in any
 * cell) and over (a reversed score the feed logged and never took back;
 * `unaccounted` clamps at zero, so it alone would wave that case through).
 * Any mismatch means some points are in an unknown quarter, and a first-half
 * number derived from that is a guess wearing a score. Null here means
 * "leave it for manual settle", never "assume".
 */
export function firstHalfScore(
  plays: ScoringPlayRow[],
  homePoints: number,
  awayPoints: number,
): HalfScore | null {
  const box = buildBoxScore(plays, homePoints, awayPoints, "final", null);
  const placed = (cells: Array<number | null>) =>
    cells.reduce<number>((t, c) => t + (c ?? 0), 0);
  if (placed(box.home.cells) !== box.home.total || placed(box.away.cells) !== box.away.total)
    return null;
  const half = (cells: Array<number | null>) => (cells[0] ?? 0) + (cells[1] ?? 0);
  return { home: half(box.home.cells), away: half(box.away.cells) };
}
