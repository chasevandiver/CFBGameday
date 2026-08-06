"use client";

import { useTransition } from "react";
import { voidBet } from "../app/actions/bets";

export function VoidBetButton({ betId }: { betId: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => {
        if (confirm("Void this bet? It stays on the ledger, marked void.")) {
          startTransition(() => voidBet(betId).then(() => undefined));
        }
      }}
      className="text-xs text-chalk/40 underline hover:text-loss disabled:opacity-50"
    >
      void
    </button>
  );
}
