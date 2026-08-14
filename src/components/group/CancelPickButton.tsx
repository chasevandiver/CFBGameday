"use client";

import { useState, useTransition } from "react";
import { adminRemovePick } from "../../app/actions/admin-wagers";
import type { PickMarket } from "../../lib/grade";

/**
 * ADM-2 — a group admin cancels a member's pick, from the week's by-person view.
 *
 * That view is the only surface in the app that renders other people's picks
 * itemised and attributable, which is why the control lives here rather than on
 * the board: cancelling a pick you cannot see the owner of is not a thing
 * anyone should be able to do by accident.
 *
 * Arm-then-fire, matching `DeleteWagerButton` and `GameStatusPanel` — this
 * removes someone else's row and there is no undo short of the archive.
 */
export function CancelPickButton({
  groupId,
  userId,
  gameId,
  market,
}: {
  groupId: string;
  userId: string;
  gameId: number;
  market: PickMarket;
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
      const res = await adminRemovePick(groupId, userId, gameId, market);
      if (!res.ok) setError(res.message ?? "Could not cancel that pick");
    });
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={tap}
        onBlur={() => setArmed(false)}
        aria-label={armed ? "Confirm cancelling this pick" : "Cancel this pick"}
        className={`-mx-2 inline-flex min-h-11 items-center rounded px-2 text-[10px] uppercase tracking-wider disabled:opacity-50 ${
          armed ? "font-semibold text-loss ring-1 ring-loss/50" : "text-chalk/40 hover:text-loss"
        }`}
      >
        {pending ? "cancelling…" : armed ? "tap again" : "cancel"}
      </button>
      {error && <span className="text-[10px] text-loss">{error}</span>}
    </span>
  );
}
