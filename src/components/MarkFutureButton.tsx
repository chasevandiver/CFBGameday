"use client";

import { useTransition } from "react";
import { markFuture } from "../app/actions/bets";

/**
 * The manual mark-to-market on an open future (R2-A4). `prompt()` for the
 * same reason VoidBetButton uses `confirm()`: a one-number, once-a-week entry
 * doesn't earn a form. Blank clears the mark; cancel does nothing.
 */
export function MarkFutureButton({
  betId,
  markedOdds,
}: {
  betId: number;
  markedOdds: number | null;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => {
        const raw = prompt(
          "Current price for this future, American odds (e.g. +450). Blank clears the mark.",
          markedOdds === null ? "" : String(markedOdds),
        );
        if (raw === null) return;
        const trimmed = raw.trim();
        const odds = trimmed === "" ? null : Number(trimmed.replace(/^\+/, ""));
        if (odds !== null && !Number.isFinite(odds)) return;
        startTransition(() => markFuture(betId, odds).then(() => undefined));
      }}
      className="-mx-2 inline-flex min-h-11 items-center px-2 text-xs text-chalk/40 underline hover:text-accent disabled:opacity-50"
    >
      mark
    </button>
  );
}
