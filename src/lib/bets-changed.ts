"use client";

/**
 * "The viewer's bets just changed" — a one-way signal from the components that
 * write bets to the one that holds the slate.
 *
 * The bet actions call `revalidatePath("/slate")`, which is right for a hard
 * navigation and useless here: SlateView is a client component holding the
 * slate in `useState`, seeded once from the server and refreshed only by its
 * own poll. So a bet logged from the slip was invisible until the next tick —
 * up to 90s pregame, which reads as "the button didn't work" — and a voided
 * chip could reappear when an in-flight poll landed.
 *
 * Deliberately an event, not state: nothing renders from it, the consumer just
 * refetches. Module-level with no provider, the same shape as
 * `session-picks` / `bet-slip-store`, because the emitters sit on both sides of
 * the tree — the slip is SlateView's own child, the void button is four levels
 * down inside a card.
 */

const listeners = new Set<() => void>();

/** Announce that a bet was logged or voided. Safe to call from a transition. */
export function betsChanged(): void {
  listeners.forEach((l) => l());
}

/** Subscribe; returns the unsubscribe for an effect cleanup. */
export function onBetsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
