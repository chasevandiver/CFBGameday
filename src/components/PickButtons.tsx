"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { makePick, removePick } from "../app/actions/picks";
import { fmtSpread, fmtTotal } from "../lib/slate";

interface Props {
  gameId: number;
  homeLabel: string;
  awayLabel: string;
  /** Vegas convention, home perspective */
  currentSpread: number | null;
  currentTotal: number | null;
  myPick: {
    side: string;
    line_at_pick: number;
    result?: string | null;
    clv?: number | null;
  } | null;
  kickoffPassed: boolean;
  /** ISO kickoff for the lock countdown; null = TBD */
  kickoffTs: string | null;
  signedIn: boolean;
}

/**
 * One pick per game, four ways to make it: either spread side or either side
 * of the total (the schema, grader, and live tracker supported O/U picks all
 * along — this adds the missing UI). Tapping your current side removes it;
 * tapping another swaps it and re-snapshots the line (League Rule #2).
 */
export function PickButtons({
  gameId,
  homeLabel,
  awayLabel,
  currentSpread,
  currentTotal,
  myPick,
  kickoffPassed,
  kickoffTs,
  signedIn,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <p className="text-sm text-dim">
        <Link href="/login" className="font-medium text-accent underline-offset-2 hover:underline">
          Sign in
        </Link>{" "}
        to make your pick — the line snapshots the moment you tap.
      </p>
    );
  }

  if (kickoffPassed) {
    return myPick ? (
      <div className="flex flex-wrap items-center gap-2">
        <p className="stat text-sm text-chalk/70">
          Locked: {pickLabel(myPick.side, myPick.line_at_pick, homeLabel, awayLabel)}
        </p>
        {myPick.result && myPick.result !== "void" && (
          <span
            className={`chip ${
              myPick.result === "win"
                ? "bg-win/12 text-win"
                : myPick.result === "loss"
                  ? "bg-loss/12 text-loss"
                  : "bg-push/12 text-push"
            }`}
          >
            {myPick.result}
          </span>
        )}
        {myPick.clv !== null && myPick.clv !== undefined && (
          <span className={`stat text-xs ${myPick.clv > 0 ? "text-win" : myPick.clv < 0 ? "text-loss" : "text-dim"}`}>
            CLV {myPick.clv > 0 ? "+" : ""}
            {myPick.clv}
          </span>
        )}
      </div>
    ) : (
      <p className="stat text-sm text-chalk/50">Kickoff — no pick made</p>
    );
  }

  const pick = (side: "home" | "away" | "over" | "under") =>
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
      <div className="flex gap-2">
        <PickButton
          label={`Over ${fmtTotal(currentTotal)}`}
          active={myPick?.side === "over"}
          disabled={pending || currentTotal === null}
          onClick={() => pick("over")}
        />
        <PickButton
          label={`Under ${fmtTotal(currentTotal)}`}
          active={myPick?.side === "under"}
          disabled={pending || currentTotal === null}
          onClick={() => pick("under")}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {myPick ? (
          <p className="stat text-xs text-accent">
            Your number: {pickLabel(myPick.side, myPick.line_at_pick, homeLabel, awayLabel)}{" "}
            <span className="text-dim">(tap again to remove — re-picking re-snapshots the line)</span>
          </p>
        ) : (
          <span />
        )}
        <LockCountdown kickoffTs={kickoffTs} />
      </div>
      {error && <p className="text-xs text-loss">{error}</p>}
    </div>
  );
}

function pickLabel(side: string, line: number, homeLabel: string, awayLabel: string): string {
  if (side === "home") return `${homeLabel} ${fmtSpread(line)}`;
  if (side === "away") return `${awayLabel} ${fmtSpread(line)}`;
  return `${side === "over" ? "Over" : "Under"} ${fmtTotal(line)}`;
}

/** "Locks in 2h 14m" once kickoff is inside 24h; ticks every 30s. */
function LockCountdown({ kickoffTs }: { kickoffTs: string | null }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!kickoffTs) return;
    const kick = Date.parse(kickoffTs);
    const tick = () => {
      const ms = kick - Date.now();
      if (ms <= 0 || ms > 24 * 3600_000) {
        setLabel(null);
        return;
      }
      const h = Math.floor(ms / 3600_000);
      const m = Math.ceil((ms % 3600_000) / 60_000);
      setLabel(h > 0 ? `Locks in ${h}h ${m}m` : `Locks in ${m}m`);
    };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [kickoffTs]);
  if (!label) return null;
  return <span className="stat shrink-0 text-xs text-dim">{label}</span>;
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
      aria-pressed={active}
      className={`stat flex-1 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50 ${
        active
          ? "border-accent bg-accent/20 text-accent"
          : "border-chalk/25 text-chalk hover:border-chalk/60"
      }`}
    >
      {label}
    </button>
  );
}
