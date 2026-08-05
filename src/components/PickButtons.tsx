"use client";

import { useState, useTransition } from "react";
import { makePick, removePick } from "../app/actions/picks";
import { fmtSpread } from "../lib/slate";

interface Props {
  gameId: number;
  homeLabel: string;
  awayLabel: string;
  /** Vegas convention, home perspective */
  currentSpread: number | null;
  myPick: { side: string; line_at_pick: number } | null;
  kickoffPassed: boolean;
}

export function PickButtons({
  gameId,
  homeLabel,
  awayLabel,
  currentSpread,
  myPick,
  kickoffPassed,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (kickoffPassed) {
    return myPick ? (
      <p className="stat text-sm text-chalk/70">
        Locked: {myPick.side === "home" ? homeLabel : awayLabel} {fmtSpread(myPick.line_at_pick)}
      </p>
    ) : (
      <p className="stat text-sm text-chalk/40">Kickoff — no pick made</p>
    );
  }

  const pick = (side: "home" | "away") =>
    startTransition(async () => {
      setError(null);
      const res = myPick?.side === side ? await removePick(gameId) : await makePick(gameId, side);
      if (!res.ok && res.message) setError(res.message);
    });

  const awaySpread = currentSpread === null ? null : -currentSpread;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <PickButton
          label={`${awayLabel} ${fmtSpread(awaySpread)}`}
          active={myPick?.side === "away"}
          disabled={pending || currentSpread === null}
          onClick={() => pick("away")}
        />
        <PickButton
          label={`${homeLabel} ${fmtSpread(currentSpread)}`}
          active={myPick?.side === "home"}
          disabled={pending || currentSpread === null}
          onClick={() => pick("home")}
        />
      </div>
      {myPick && (
        <p className="stat text-xs text-gold">
          Your number: {fmtSpread(myPick.line_at_pick)} (tap again to remove)
        </p>
      )}
      {error && <p className="text-xs text-flag">{error}</p>}
    </div>
  );
}

function PickButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`stat flex-1 rounded border px-3 py-2 text-sm transition-colors disabled:opacity-50 ${
        active
          ? "border-gold bg-gold/20 text-gold"
          : "border-chalk/25 text-chalk hover:border-chalk/60"
      }`}
    >
      {label}
    </button>
  );
}
