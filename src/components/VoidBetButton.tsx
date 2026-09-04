"use client";

import { useTransition } from "react";
import { voidBet } from "../app/actions/bets";

export function VoidBetButton({
  betId,
  forUserId = null,
}: {
  betId: number;
  /** 0083: the bet belongs to a member you logged it for, not to you. */
  forUserId?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  // -mx-2 keeps the 44px target from widening the row it sits in: the padding
  // grows the hit area outward and the negative margin gives the space back to
  // the layout (UX-08, DESIGN.md's 44px rule).
  return (
    <button
      disabled={pending}
      onClick={() => {
        if (confirm("Void this bet? It stays on the ledger, marked void.")) {
          startTransition(() => voidBet(betId, forUserId).then(() => undefined));
        }
      }}
      className="-mx-2 inline-flex min-h-11 items-center px-2 text-xs text-chalk/40 underline hover:text-loss disabled:opacity-50"
    >
      void
    </button>
  );
}
