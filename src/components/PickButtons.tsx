"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { makePick, removePick } from "../app/actions/picks";
import type { PickMarket } from "../lib/grade";
import { forgetPick, rememberPick } from "../lib/session-picks";
import { fmtSpread, fmtTotal, pickSideLabel } from "../lib/slate";

export interface MyPickView {
  market: PickMarket;
  side: string;
  line_at_pick: number | null;
  result?: string | null;
  clv?: number | null;
}

/** Fixed reading order, so "your picks" never reshuffles between renders. */
const MARKET_ORDER: PickMarket[] = ["spread", "total", "straight_up"];

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
  /**
   * Fires the instant a tap changes what the viewer holds — before the server
   * has confirmed it, and again with the old value if the write fails. Lets a
   * parent keep a running "8 of 10 in" count that moves at the speed of the
   * tap rather than the speed of the round-trip.
   */
  onPickChange?: (gameId: number, market: PickMarket, side: string | null) => void;
  /** Hides the "tap again to remove" explainer where a board already says it. */
  quiet?: boolean;
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
 *
 * ## The tap is instant
 *
 * The write is a server action, and a server action revalidates the page that
 * called it — on the group board that is a dozen queries and a full slate
 * fetch before the button you pressed changes colour. Making eight picks meant
 * eight of those waits, which is what "the picks take forever to lock in"
 * describes.
 *
 * So the button state is optimistic: the tap paints the pick immediately from
 * the line already on screen, the write goes out behind it, and the server's
 * answer only ever *replaces* the guess (or reverts it, with the error shown).
 * The pick is still authoritative server-side — `make_pick` snapshots the real
 * consensus number, and the reconciliation below drops the optimistic value the
 * moment the true one arrives, so a line that moved between render and tap
 * corrects itself rather than being believed.
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
  onPickChange,
  quiet = false,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Which button was tapped, so ONLY that one carries the in-flight state. The
  // old treatment dimmed all six at once, which on bar wifi reads as "my tap
  // did nothing" for the whole round-trip (audit 08/UX-10).
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  // Per-market optimistic overrides. `null` means "removed"; absent means "no
  // opinion, use the server's row".
  const [optimistic, setOptimistic] = useState<Map<PickMarket, MyPickView | null>>(new Map());
  // Derived, not synced: the key only means "in flight" while the transition
  // is actually pending, so no effect is needed to clear it.
  const inFlight = pending ? pendingKey : null;

  /**
   * The server's rows, with our in-flight guesses laid over the top.
   *
   * A guess yields to the server the moment the two agree on the side, which
   * is what retires it — no effect, no cleanup pass. That ordering matters
   * beyond tidiness: our guess carries the line we could see, the server's row
   * carries the line `make_pick` actually snapshotted, and if the market moved
   * between render and tap those differ. The real number wins as soon as it
   * exists, and until then the side (which is never in doubt) is shown.
   */
  const effective = useMemo(() => {
    const byMarket = new Map<PickMarket, MyPickView>();
    for (const p of myPicks) byMarket.set(p.market, p);
    for (const [market, guess] of optimistic) {
      const server = byMarket.get(market) ?? null;
      if (guess === null) byMarket.delete(market);
      else if (server === null || server.side !== guess.side) byMarket.set(market, guess);
    }
    return MARKET_ORDER.map((m) => byMarket.get(m)).filter((p): p is MyPickView => p !== undefined);
  }, [myPicks, optimistic]);

  const pickIn = useCallback(
    (m: PickMarket) => effective.find((p) => p.market === m) ?? null,
    [effective],
  );

  const tap = (market: PickMarket, side: "home" | "away" | "over" | "under") => {
    const removing = pickIn(market)?.side === side;
    // The line we can see is the line the server is about to snapshot; showing
    // it now is a guess that gets replaced, never a number that gets stored.
    const guess: MyPickView | null = removing
      ? null
      : {
          market,
          side,
          line_at_pick:
            market === "spread" ? currentSpread : market === "total" ? currentTotal : null,
        };
    setOptimistic((cur) => new Map(cur).set(market, guess));
    setPendingKey(`${market}:${side}`);
    setError(null);
    // Feeds the share sheet's "just placed", which is the one thing the server
    // cannot answer from a timestamp.
    if (removing) forgetPick(gameId, market);
    else rememberPick(gameId, market);
    onPickChange?.(gameId, market, removing ? null : side);

    startTransition(async () => {
      // A thrown action is the phone-on-bar-wifi case: the fetch never lands.
      // Untrapped it takes down the error boundary and the whole board with
      // it, losing every pick already on screen, so it is reported the same
      // way a rejection is — the pick reverts and the row says what happened.
      let res: { ok: boolean; message?: string };
      try {
        res = removing
          ? await removePick(groupId, gameId, market)
          : await makePick(groupId, gameId, market, side);
      } catch {
        res = { ok: false, message: "Couldn’t reach the server — tap to try again" };
      }
      if (res.ok) return;
      // Put it back the way it was and say why. Reverting the session-picks
      // entry too, or "just placed" would share a pick that was never made.
      setOptimistic((cur) => {
        const next = new Map(cur);
        next.delete(market);
        return next;
      });
      const previous = myPicks.find((p) => p.market === market) ?? null;
      if (previous) rememberPick(gameId, market);
      else forgetPick(gameId, market);
      onPickChange?.(gameId, market, previous?.side ?? null);
      if (res.message) setError(res.message);
    });
  };

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
    return effective.length > 0 ? (
      <div className="flex flex-col gap-1.5">
        {effective.map((p) => (
          <div key={p.market} className="flex flex-wrap items-center gap-2">
            <p className="stat text-sm text-chalk/70">
              Locked: {pickLabel(p, homeLabel, awayLabel)}
            </p>
            {/* Including "void", which falls to the neutral branch below. */}
            {p.result && (
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

  const awaySpread = currentSpread === null ? null : -currentSpread;
  const has = (m: PickMarket) => markets.includes(m);

  return (
    <div className="flex flex-col gap-1.5">
      {has("spread") && (
        <div className="flex gap-2">
          <PickButton
            label={`${awayLabel} ${fmtSpread(awaySpread)}`}
            active={pickIn("spread")?.side === "away"}
            disabled={currentSpread === null}
            noLine={currentSpread === null}
            pending={inFlight === "spread:away"}
            onClick={() => tap("spread", "away")}
          />
          <PickButton
            label={`${homeLabel} ${fmtSpread(currentSpread)}`}
            active={pickIn("spread")?.side === "home"}
            disabled={currentSpread === null}
            noLine={currentSpread === null}
            pending={inFlight === "spread:home"}
            onClick={() => tap("spread", "home")}
          />
        </div>
      )}
      {has("total") && (
        <div className="flex gap-2">
          <PickButton
            label={`Over ${fmtTotal(currentTotal)}`}
            active={pickIn("total")?.side === "over"}
            disabled={currentTotal === null}
            noLine={currentTotal === null}
            pending={inFlight === "total:over"}
            onClick={() => tap("total", "over")}
          />
          <PickButton
            label={`Under ${fmtTotal(currentTotal)}`}
            active={pickIn("total")?.side === "under"}
            disabled={currentTotal === null}
            noLine={currentTotal === null}
            pending={inFlight === "total:under"}
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
            disabled={false}
            pending={inFlight === "straight_up:away"}
            onClick={() => tap("straight_up", "away")}
          />
          <PickButton
            label={`${homeLabel} to win`}
            active={pickIn("straight_up")?.side === "home"}
            disabled={false}
            pending={inFlight === "straight_up:home"}
            onClick={() => tap("straight_up", "home")}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {effective.length > 0 ? (
          <p className="stat text-xs text-accent">
            Your {effective.length === 1 ? "number" : "picks"}:{" "}
            {effective.map((p) => pickLabel(p, homeLabel, awayLabel)).join(" · ")}
            {!quiet && (
              <span className="text-dim">
                {" "}
                (tap again to remove — re-picking re-snapshots the line)
              </span>
            )}
          </p>
        ) : (
          <span />
        )}
        <LockCountdown kickoffTs={kickoffTs} />
      </div>
      {/* A rejected write is an async update: announced, not just coloured. */}
      <p role="status" aria-live="polite" className="text-xs text-loss empty:hidden">
        {error}
      </p>
    </div>
  );
}

function pickLabel(p: MyPickView, homeLabel: string, awayLabel: string): string {
  return pickSideLabel(p.market, p.side, p.line_at_pick, homeLabel, awayLabel);
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
  pending,
  noLine = false,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  /** This button's own write is still in flight — a hairline cue, not a state. */
  pending: boolean;
  /** No number to pick — the one disabled state that should LOOK disabled. */
  noLine?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-busy={pending || undefined}
      /* min-h-11 = the 44px tap floor (docs/DESIGN.md). The picked look lands
         on the tap, not on the response; `pending` only softens the border
         while the write is out, so a slow round-trip is visible without the
         button ever looking un-picked. Buttons stay live during a write —
         disabling them mid-flight is what made rapid picking feel stuck. */
      className={`stat min-h-11 flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
        active
          ? `border-accent bg-accent/20 text-accent ${pending ? "opacity-80" : ""}`
          : pending
            ? "border-accent/40 text-chalk/70"
            : "border-chalk/25 text-chalk hover:border-chalk/60"
      } ${noLine ? "opacity-50" : ""}`}
    >
      {label}
    </button>
  );
}
