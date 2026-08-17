"use client";

import { useState, useTransition } from "react";
import { makeStreakPick } from "../app/actions/daily-games";

/**
 * Today's streak matchup (R2-C2): two buttons, pick a side, protect the run.
 * Optimistic like PickButtons — the tap paints, the write follows, an error
 * reverts with the message shown. Locks at kickoff (the RPC's word is final).
 */
export function StreakCard({
  day,
  homeLabel,
  awayLabel,
  mySide,
  locked,
}: {
  day: string;
  homeLabel: string;
  awayLabel: string;
  mySide: "home" | "away" | null;
  locked: boolean;
}) {
  const [side, setSide] = useState<"home" | "away" | null>(mySide);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const pick = (s: "home" | "away") => {
    if (locked || pending) return;
    const before = side;
    setSide(s);
    setMessage(null);
    startTransition(async () => {
      const res = await makeStreakPick(day, s);
      if (!res.ok) {
        setSide(before);
        setMessage(res.message ?? "Something went wrong");
      }
    });
  };

  const btn = (s: "home" | "away", label: string) => (
    <button
      onClick={() => pick(s)}
      disabled={locked || pending}
      aria-pressed={side === s}
      className={`min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
        side === s
          ? "bg-accent text-accent-ink"
          : "bg-elev text-chalk ring-1 ring-inset ring-chalk/12 hover:ring-accent/40"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="flex gap-2">
        {btn("away", awayLabel)}
        {btn("home", homeLabel)}
      </div>
      {locked ? (
        <p className="mt-2 text-xs text-dim">Locked at kickoff.</p>
      ) : (
        <p className="mt-2 text-xs text-dim">
          {side === null ? "Pick a side — a miss resets the streak to zero." : "You can switch until kickoff."}
        </p>
      )}
      {message && <p className="mt-1 text-xs text-loss">{message}</p>}
    </div>
  );
}
