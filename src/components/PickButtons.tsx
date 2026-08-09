"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { makePick, removePick } from "../app/actions/picks";
import type { PickMarket } from "../lib/grade";
import { fmtSpread, fmtTotal } from "../lib/slate";

export interface MyPickView {
  market: PickMarket;
  side: string;
  line_at_pick: number | null;
  result?: string | null;
  clv?: number | null;
}

interface Props {
  /** The group these picks belong to. Picks are per group (migration 0021). */
  groupId: string;
  gameId: number;
  homeLabel: string;
  awayLabel: string;
  /** Vegas convention, home perspective */
  currentSpread: number | null;
  currentTotal: number | null;
  /** Which markets this group's admin turned on for the week. */
  markets: PickMarket[];
  /** The viewer's picks on this game in this group — up to one per market. */
  myPicks: MyPickView[];
  kickoffPassed: boolean;
  /** ISO kickoff for the lock countdown; null = TBD */
  kickoffTs: string | null;
  signedIn: boolean;
}

/**
 * One pick per market per game, in one group. The admin decides which of the
 * three markets are live for the week, so this renders a row per enabled market
 * rather than a fixed grid — a spreads-only pool sees two buttons, not six
 * with four disabled.
 *
 * Tapping your current side removes it; tapping another swaps it and
 * re-snapshots the line (League Rule #2). Straight-up takes no number at all,
 * so it has nothing to re-snapshot and no CLV to report.
 */
export function PickButtons({
  groupId,
  gameId,
  homeLabel,
  awayLabel,
  currentSpread,
  currentTotal,
  markets,
  myPicks,
  kickoffPassed,
  kickoffTs,
  signedIn,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const pickIn = (m: PickMarket) => myPicks.find((p) => p.market === m) ?? null;

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
    return myPicks.length > 0 ? (
      <div className="flex flex-col gap-1.5">
        {myPicks.map((p) => (
          <div key={p.market} className="flex flex-wrap items-center gap-2">
            <p className="stat text-sm text-chalk/70">
              Locked: {pickLabel(p, homeLabel, awayLabel)}
            </p>
            {p.result && p.result !== "void" && (
              <span
                className={`chip ${
                  p.result === "win"
                    ? "bg-win/12 text-win"
                    : p.result === "loss"
                      ? "bg-loss/12 text-loss"
                      : "bg-push/12 text-push"
                }`}
              >
                {p.result}
              </span>
            )}
            {p.clv !== null && p.clv !== undefined && (
              <span
                className={`stat text-xs ${p.clv > 0 ? "text-win" : p.clv < 0 ? "text-loss" : "text-dim"}`}
              >
                CLV {p.clv > 0 ? "+" : ""}
                {p.clv}
              </span>
            )}
          </div>
        ))}
      </div>
    ) : (
      <p className="stat text-sm text-chalk/50">Kickoff — no pick made</p>
    );
  }

  const tap = (market: PickMarket, side: "home" | "away" | "over" | "under") =>
    startTransition(async () => {
      setError(null);
      const res =
        pickIn(market)?.side === side
          ? await removePick(groupId, gameId, market)
          : await makePick(groupId, gameId, market, side);
      if (!res.ok && res.message) setError(res.message);
    });

  const awaySpread = currentSpread === null ? null : -currentSpread;
  const has = (m: PickMarket) => markets.includes(m);

  return (
    <div className="flex flex-col gap-1.5">
      {has("spread") && (
        <div className="flex gap-2">
          <PickButton
            label={`${awayLabel} ${fmtSpread(awaySpread)}`}
            active={pickIn("spread")?.side === "away"}
            disabled={pending || currentSpread === null}
            onClick={() => tap("spread", "away")}
          />
          <PickButton
            label={`${homeLabel} ${fmtSpread(currentSpread)}`}
            active={pickIn("spread")?.side === "home"}
            disabled={pending || currentSpread === null}
            onClick={() => tap("spread", "home")}
          />
        </div>
      )}
      {has("total") && (
        <div className="flex gap-2">
          <PickButton
            label={`Over ${fmtTotal(currentTotal)}`}
            active={pickIn("total")?.side === "over"}
            disabled={pending || currentTotal === null}
            onClick={() => tap("total", "over")}
          />
          <PickButton
            label={`Under ${fmtTotal(currentTotal)}`}
            active={pickIn("total")?.side === "under"}
            disabled={pending || currentTotal === null}
            onClick={() => tap("total", "under")}
          />
        </div>
      )}
      {has("straight_up") && (
        <div className="flex gap-2">
          {/* No line, so no disabled state: a winner pick works on a game no
              book has posted a number for. */}
          <PickButton
            label={`${awayLabel} to win`}
            active={pickIn("straight_up")?.side === "away"}
            disabled={pending}
            onClick={() => tap("straight_up", "away")}
          />
          <PickButton
            label={`${homeLabel} to win`}
            active={pickIn("straight_up")?.side === "home"}
            disabled={pending}
            onClick={() => tap("straight_up", "home")}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {myPicks.length > 0 ? (
          <p className="stat text-xs text-accent">
            Your {myPicks.length === 1 ? "number" : "picks"}:{" "}
            {myPicks.map((p) => pickLabel(p, homeLabel, awayLabel)).join(" · ")}{" "}
            <span className="text-dim">
              (tap again to remove — re-picking re-snapshots the line)
            </span>
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

function pickLabel(p: MyPickView, homeLabel: string, awayLabel: string): string {
  const team = p.side === "home" ? homeLabel : awayLabel;
  if (p.market === "straight_up") return `${team} to win`;
  if (p.market === "spread") return `${team} ${fmtSpread(p.line_at_pick)}`;
  return `${p.side === "over" ? "Over" : "Under"} ${fmtTotal(p.line_at_pick)}`;
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
