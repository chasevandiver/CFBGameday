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
 * "if it ended now" with a label attached. The two agree on the formulas by
 * construction; this one is the settlement.
 */

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
    const coverMargin = side === "home" ? margin + line : -margin - line;
    return coverMargin > 0 ? "win" : coverMargin < 0 ? "loss" : "push";
  }

  if (side !== "over" && side !== "under") return null;
  const diff = side === "over" ? homePoints + awayPoints - line : line - (homePoints + awayPoints);
  return diff > 0 ? "win" : diff < 0 ? "loss" : "push";
}
