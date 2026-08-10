"use client";

/**
 * Bet slip: sportsbook-style selections built by tapping the spread / total /
 * ML cells on game cards. Module-level store read via useSyncExternalStore,
 * same pattern as client-store.ts — no context providers, survives the slate's
 * poll-driven re-renders, and resets on navigation (a slip is ephemeral).
 */

import { useCallback, useSyncExternalStore } from "react";

export type SlipBetType = "spread" | "total" | "moneyline";
export type SlipSide = "home" | "away" | "over" | "under";

export interface SlipSelection {
  gameId: number;
  betType: SlipBetType;
  side: SlipSide;
  /** Short ticket label, e.g. "MICH -3.5" / "O 54.5" / "OSU ML" */
  label: string;
  /** "GA @ OSU" — shown under the label and folded into the ledger description */
  matchup: string;
  /** Full description stored on the ledger row */
  description: string;
  line: number | null;
  odds: number;
  /** ISO kickoff, so a shared slip can be grouped by the clock. Null = TBD. */
  kickTs: string | null;
  /**
   * Set when the selection came from a Tail button: whose bet it copies.
   * Drives the slip's reason tag, which is what makes "is tailing actually
   * profitable for me" answerable from the ledger's existing tag audit rather
   * than from a new report nobody would build.
   */
  tailedFrom?: string;
}

let selections: SlipSelection[] = [];
const EMPTY: SlipSelection[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export const slipKey = (s: Pick<SlipSelection, "gameId" | "betType">) =>
  `${s.gameId}:${s.betType}`;

export function useBetSlip() {
  const slip = useSyncExternalStore(subscribe, () => selections, () => EMPTY);

  // One selection per market per game: tapping the same cell removes it,
  // tapping the opposite side swaps it — exactly like a sportsbook slip.
  const toggle = useCallback((sel: SlipSelection) => {
    const existing = selections.find((s) => slipKey(s) === slipKey(sel));
    selections =
      existing && existing.side === sel.side
        ? selections.filter((s) => s !== existing)
        : [...selections.filter((s) => s !== existing), sel];
    emit();
  }, []);

  const remove = useCallback((gameId: number, betType: SlipBetType) => {
    selections = selections.filter((s) => !(s.gameId === gameId && s.betType === betType));
    emit();
  }, []);

  const clear = useCallback(() => {
    selections = [];
    emit();
  }, []);

  return { slip, toggle, remove, clear };
}

export function inSlip(
  slip: SlipSelection[],
  gameId: number,
  betType: SlipBetType,
  side: SlipSide,
): boolean {
  return slip.some((s) => s.gameId === gameId && s.betType === betType && s.side === side);
}
