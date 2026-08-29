"use client";

import { useSyncExternalStore } from "react";
import { pickKey } from "./pick-key";

/**
 * The picks made since this page was opened.
 *
 * "Just placed" is the share button's default, and it is the one thing the
 * server cannot answer: a row's `locked_at` says when it was written, not
 * whether it belongs to the batch you are about to text your group. So the
 * pick control records each successful write here, and the share sheet reads
 * it back.
 *
 * Module-level and deliberately not persisted — the same shape as
 * `bet-slip-store`. Reloading the page ends the session, which is the right
 * behaviour: "just placed" should not mean "placed on Tuesday".
 */

const keys = new Set<string>();
let snapshot: string[] = [];
const listeners = new Set<() => void>();

const emit = () => {
  snapshot = [...keys];
  listeners.forEach((l) => l());
};

/* Re-exported for the client callers that already import it from here. The
   definition moved to ./pick-key so the server can call it too — see that
   file. */
export { pickKey };

export function rememberPick(gameId: number, market: string): void {
  keys.add(pickKey(gameId, market));
  emit();
}

export function forgetPick(gameId: number, market: string): void {
  if (keys.delete(pickKey(gameId, market))) emit();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const EMPTY: string[] = [];

export function useSessionPicks(): string[] {
  // The server snapshot has to be a stable reference or React re-renders forever.
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  );
}
