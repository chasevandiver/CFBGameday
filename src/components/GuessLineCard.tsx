"use client";

import { useState, useTransition } from "react";
import { submitLineGuess } from "../app/actions/daily-games";
import { fmtSpread } from "../lib/slate";

/**
 * One guessable game (R2-C1): a half-point stepper for the HOME spread,
 * open until the books post a number. Once revealed, the row shows the open,
 * everyone's guesses and the errors — the reveal is the payoff, so this
 * component only handles the "before" state; the page renders the "after".
 */
export function GuessLineCard({
  gameId,
  label,
  myGuess,
}: {
  gameId: number;
  label: string;
  /** Home-perspective spread already submitted, or null. */
  myGuess: number | null;
}) {
  const [value, setValue] = useState<string>(myGuess === null ? "" : String(myGuess));
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = () => {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      setMessage("A spread, e.g. -3.5 (home favored) or 6.5 (home dog)");
      return;
    }
    startTransition(async () => {
      setMessage(null);
      setSaved(false);
      const res = await submitLineGuess(gameId, n);
      if (!res.ok) setMessage(res.message ?? "Something went wrong");
      else setSaved(true);
    });
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-chalk/5 py-2 last:border-0">
      <span className="min-w-0 truncate font-sans text-sm text-chalk">{label}</span>
      <span className="flex items-center gap-2">
        {myGuess !== null && !saved && (
          <span className="stat text-xs text-chalk/50">yours: {fmtSpread(myGuess)}</span>
        )}
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="-3.5"
          aria-label={`Your spread for ${label}, home perspective`}
          className="w-20 rounded-lg border border-chalk/12 bg-elev px-2 py-1.5 text-right text-sm text-chalk placeholder:text-chalk/35 focus:border-accent focus-visible:outline-2 focus-visible:outline-accent"
        />
        <button
          onClick={submit}
          disabled={pending}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-60"
        >
          {saved ? "Saved" : myGuess === null ? "Lock it" : "Update"}
        </button>
      </span>
      {message && <span className="w-full text-xs text-loss">{message}</span>}
    </div>
  );
}
