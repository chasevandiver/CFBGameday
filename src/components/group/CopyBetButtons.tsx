"use client";

import { useState, useTransition } from "react";
import { copyBet } from "../../app/actions/bets";

/**
 * "+ Hayden" under a bet on the week's who-bet-what page (LOGF-7): put the
 * same bet on another ledger in one tap — the tail that got texted but never
 * typed in. One button per person who does not already hold it; the page
 * re-renders on success and the button goes with it. The action re-asks the
 * grant, so this only decides what to draw.
 */
export function CopyBetButtons({
  betId,
  targets,
}: {
  betId: number;
  targets: Array<{ id: string; name: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  if (targets.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {targets.map((t) => (
        <button
          key={t.id}
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setMessage(null);
              const res = await copyBet(betId, [t.id]);
              if (!res.ok) setMessage(res.message ?? "Couldn’t copy it");
            })
          }
          aria-label={`Add this bet to ${t.name}’s ledger too`}
          className="stat inline-flex min-h-11 items-center rounded-full border border-chalk/20 px-3 text-xs text-dim hover:border-accent hover:text-accent disabled:opacity-50"
        >
          + {t.name.split(" ")[0]}
        </button>
      ))}
      {message && (
        <span role="status" className="text-xs text-loss">
          {message}
        </span>
      )}
    </span>
  );
}
