/**
 * The Jumbotron's attention math (R5-A) — pure, tested, no I/O.
 *
 * `jumbotronRank` extends the whip-around recipe the roadmap already wrote
 * down (docs/ROADMAP.md §12: watchability, live win prob, crew stakes) into
 * one number per live game. `nextFeatured` is the rotation reducer: the
 * featured game holds the screen for a dwell, then the board moves on in
 * rank order — but a red-zone trip or a one-score game inside two minutes
 * jumps the queue immediately, because that is what a stadium board does.
 */

import { underTwo } from "./kick";
import { liveUrgency } from "./live-status";
import {
  isLive,
  isRedZone,
  liveHomeWinProb,
  upsetAlert,
  watchability,
  type GameView,
} from "./slate";

/** How long the featured game holds the screen between rotations. */
export const DWELL_MS = 20_000;

const NOTHING_RIDING = 1_000_000; // liveUrgency's own sentinel

function oneScore(g: GameView): boolean {
  return Math.abs((g.homePoints ?? 0) - (g.awayPoints ?? 0)) <= 8;
}

/** A state that takes the screen NOW, mid-dwell. */
export function urgentNow(g: GameView): "redzone" | "closing" | null {
  if (!isLive(g)) return null;
  if (underTwo(g.period, g.clock) && oneScore(g)) return "closing";
  if (isRedZone(g)) return "redzone";
  return null;
}

export function jumbotronRank(g: GameView): number {
  if (!isLive(g)) return -Infinity;
  // Pregame quality is the base, scaled down so the live state dominates.
  let score = (watchability(g) ?? 40) * 0.5;
  const p = liveHomeWinProb(g);
  if (p !== null) score += 80 * (1 - Math.abs(p - 0.5) * 2);
  if (isRedZone(g)) score += 45;
  if (underTwo(g.period, g.clock) && oneScore(g)) score += 60;
  if (upsetAlert(g)) score += 35;
  // Your sweat: liveUrgency is distance-to-the-number, smaller = louder.
  const urgency = liveUrgency(g);
  if (urgency < NOTHING_RIDING / 2) score += Math.max(0, 30 - urgency);
  return score;
}

export interface FeaturedNext {
  id: number | null;
  reason: "rotation" | "redzone" | "closing" | null;
}

/**
 * The rotation reducer. Deterministic over (current, games, heldMs):
 * an urgent game not already featured takes over immediately; otherwise the
 * incumbent holds through the dwell; then the board advances round-robin in
 * rank order — every live game gets air time, the best games first.
 */
export function nextFeatured(
  currentId: number | null,
  games: GameView[],
  heldMs: number,
): FeaturedNext {
  const live = games.filter(isLive);
  if (live.length === 0) return { id: null, reason: null };
  const ranked = [...live].sort((a, b) => jumbotronRank(b) - jumbotronRank(a));

  const urgent = ranked.find((g) => urgentNow(g) !== null);
  if (urgent && urgent.id !== currentId) {
    return { id: urgent.id, reason: urgentNow(urgent) };
  }

  const current = live.find((g) => g.id === currentId);
  if (!current) return { id: ranked[0].id, reason: currentId === null ? null : "rotation" };
  if (heldMs < DWELL_MS) return { id: current.id, reason: null };

  const idx = ranked.findIndex((g) => g.id === currentId);
  const next = ranked[(idx + 1) % ranked.length];
  return next.id === currentId
    ? { id: currentId, reason: null }
    : { id: next.id, reason: "rotation" };
}

/** The empty-state board: the next kickoffs still ahead, both leagues. */
export function nextKickoffBoard(games: GameView[], nowIso: string, n = 6): GameView[] {
  return games
    .filter((g) => g.status === "scheduled" && g.startTs !== null && g.startTs > nowIso)
    .sort((a, b) => (a.startTs as string).localeCompare(b.startTs as string))
    .slice(0, n);
}
