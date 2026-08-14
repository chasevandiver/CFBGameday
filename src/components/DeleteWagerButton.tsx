"use client";

import { useState, useTransition } from "react";
import { adminDeleteBet, adminDeletePick } from "../app/actions/admin-wagers";

/**
 * The admin's delete, beside the owner's void.
 *
 * Arm-then-fire rather than `confirm()`, which is what `VoidBetButton` uses.
 * The two are not the same act and should not feel the same: a void is
 * recoverable in the sense that the row survives and the ledger still shows
 * what happened, while this removes the row. `GameStatusPanel` set the
 * precedent for destructive admin controls (`:47-58`) and this follows it —
 * the first tap arms, the second fires, and moving away disarms.
 *
 * The label says "delete" both times rather than switching to "sure?": the word
 * that describes the consequence should not disappear at the moment it is about
 * to happen. The colour and the border carry the armed state instead.
 */
export function DeleteWagerButton({
  kind,
  id,
  onDone,
}: {
  kind: "bet" | "pick";
  id: number;
  onDone?: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function tap() {
    if (!armed) {
      setArmed(true);
      setError(null);
      return;
    }
    setArmed(false);
    startTransition(async () => {
      const res = kind === "bet" ? await adminDeleteBet(id) : await adminDeletePick(id);
      if (!res.ok) setError(res.message ?? "Delete failed");
      else onDone?.();
    });
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={tap}
        onBlur={() => setArmed(false)}
        aria-label={
          armed ? `Confirm deleting this ${kind} — this cannot be undone` : `Delete this ${kind}`
        }
        /* -mx-2 keeps the 44px target from widening the row it sits in, the
           same trick VoidBetButton uses (UX-08). */
        className={`-mx-2 inline-flex min-h-11 items-center rounded px-2 text-xs underline disabled:opacity-50 ${
          armed
            ? "font-semibold text-loss no-underline ring-1 ring-loss/50"
            : "text-chalk/40 hover:text-loss"
        }`}
      >
        {pending ? "deleting…" : armed ? "delete — tap again" : "delete"}
      </button>
      {error && <span className="text-xs text-loss">{error}</span>}
    </span>
  );
}
