/**
 * The Pool Machine (R2-D2): toggle the rest of the board, watch the race
 * re-sort. Agency over anxiety — the Playoff Machine mechanic pointed at the
 * weekly pool instead of the playoffs.
 *
 * Scoring is IMPORTED from records.ts, never re-implemented: the parity test
 * ("no toggles ⇒ exactly the graded standings") is the drift alarm — if this
 * module ever disagrees with the leaderboard, one of them changed and the
 * test says so.
 *
 * Honest limits, stated where the UI repeats them:
 *  - A side toggle answers spread and straight-up picks. It cannot answer a
 *    TOTAL (that needs a score, not a winner), so total picks stay pending
 *    in every projection.
 *  - Spread picks are projected as "that side covers" — the toggle is "who
 *    covers", not "who wins", for any board carrying spreads.
 *  - Hidden picks the viewer cannot read simply aren't here; the projection
 *    covers what the board shows and says so.
 */

import type { PickMarket } from "./grade";
import { tally, type Tally, type Wager } from "./records";

export interface MachinePick {
  userId: string;
  gameId: number;
  market: PickMarket;
  side: string;
  units: number;
}

export type Outcome = "home" | "away";

export interface ProjectedRow {
  userId: string;
  name: string;
  /** Graded units + projected units from the toggles. */
  units: number;
  /** The projected part alone — 0 with no toggles touching this member. */
  delta: number;
}

/**
 * Project the week race. `base` is each member's GRADED week tally (from the
 * same tallies the page already renders); `pending` is the ungraded, visible
 * picks; `outcomes` maps toggled games to the side that covers/wins.
 */
export function projectWeek(
  members: Array<{ userId: string; name: string }>,
  base: Map<string, Tally>,
  pending: MachinePick[],
  outcomes: Map<number, Outcome>,
): ProjectedRow[] {
  const synth = new Map<string, Wager[]>();
  for (const p of pending) {
    const outcome = outcomes.get(p.gameId);
    if (outcome === undefined) continue; // untouched game stays pending
    if (p.market === "total") continue; // a side toggle cannot answer a total
    if (p.side !== "home" && p.side !== "away") continue;
    const arr = synth.get(p.userId) ?? [];
    arr.push({ result: p.side === outcome ? "win" : "loss", units: p.units });
    synth.set(p.userId, arr);
  }
  return members
    .map((m) => {
      const graded = base.get(m.userId);
      const projected = tally(synth.get(m.userId) ?? []);
      return {
        userId: m.userId,
        name: m.name,
        units: (graded?.units ?? 0) + projected.units,
        delta: projected.units,
      };
    })
    .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
}
