"use client";

import { useState, useTransition } from "react";
import { retagBet } from "../app/actions/bets";
import { CONFIDENCE_TIER_LABELS, type ConfidenceTier } from "../lib/db-types";
import { ConfidencePicker } from "./ConfidencePicker";

/**
 * The confidence cell in the ledger's history table.
 *
 * Editable until the game kicks off and static after — but the decision is the
 * database's, not this component's. It renders the picker when the row still
 * looks live and shows whatever error the trigger returns if the two disagree,
 * because the clock here is the browser's and the clock that matters is
 * Postgres's.
 */
export function RetagBetButton({
  betId,
  tier,
  editable,
}: {
  betId: number;
  tier: ConfidenceTier;
  /** Ungraded and not yet kicked off, as far as the page knows. */
  editable: boolean;
}) {
  const [value, setValue] = useState<ConfidenceTier>(tier);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editable) {
    return <span className="text-xs text-chalk/60">{CONFIDENCE_TIER_LABELS[tier]}</span>;
  }

  const change = (next: ConfidenceTier) => {
    const previous = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const res = await retagBet(betId, next);
      if (!res.ok) {
        // Put the old value back rather than leaving the select showing a tier
        // the ledger does not actually hold.
        setValue(previous);
        setError(res.message ?? "Could not retag");
        setTimeout(() => setError(null), 2600);
      }
    });
  };

  return (
    <span className="flex flex-col items-start">
      <ConfidencePicker
        value={value}
        onChange={change}
        label="Confidence"
        className="stat min-h-11 rounded-md border border-chalk/12 bg-elev px-1.5 text-[11px] text-chalk disabled:opacity-60"
      />
      {error && <span className="mt-0.5 text-[10px] text-loss">{error}</span>}
      {pending && <span className="sr-only">Saving</span>}
    </span>
  );
}
