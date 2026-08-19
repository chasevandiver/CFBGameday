"use client";

import { useState, useTransition } from "react";
import { setGameStatus } from "../app/actions/games";
import type { VoidAction } from "../lib/void";

export interface AdminGameView {
  id: number;
  label: string;
  kickoff: string;
  /** True when the kickoff has passed — a rescheduled game is un-pickable
   *  until sync-games moves start_ts, and the panel has to say so. */
  kickedOff: boolean;
  status: string;
}

export function GameStatusPanel({ open, dead }: { open: AdminGameView[]; dead: AdminGameView[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [gameId, setGameId] = useState("");
  // Voiding is destructive to other people's picks and there is no undo that
  // gives them back, so the two dead actions arm before they fire.
  const [armed, setArmed] = useState<VoidAction | null>(null);

  function act(id: number, action: VoidAction) {
    startTransition(async () => {
      setError(null);
      setNote(null);
      setArmed(null);
      const res = await setGameStatus(id, action);
      if (!res.ok) {
        setError(res.message ?? "Something went wrong");
        return;
      }
      const wagers = (res.picks ?? 0) + (res.bets ?? 0);
      setNote(
        action === "restore"
          ? "Restored to scheduled. Voided picks stay voided — members re-pick."
          : wagers === 0
            ? "Done. No open picks or bets on that game."
            : `Done. ${res.picks} pick${res.picks === 1 ? "" : "s"} and ${res.bets} bet${res.bets === 1 ? "" : "s"} voided.`,
      );
    });
  }

  function armOrFire(action: VoidAction) {
    if (!gameId) {
      setError("Pick a game first");
      return;
    }
    if (armed === action) act(Number(gameId), action);
    else {
      setError(null);
      setNote(null);
      setArmed(action);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <select
          value={gameId}
          onChange={(e) => {
            setGameId(e.target.value);
            setArmed(null);
          }}
          aria-label="Game"
          className="min-h-11 min-w-40 flex-1 rounded-lg border border-chalk/25 bg-elev px-3 py-2 text-sm text-chalk focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          <option value="">Select a game…</option>
          {open.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label} · {g.kickoff}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending}
          onClick={() => armOrFire("postpone")}
          className={`stat min-h-11 rounded-lg border px-3 text-xs disabled:opacity-50 ${
            armed === "postpone" ? "border-loss text-loss" : "border-chalk/20 text-chalk"
          }`}
        >
          {armed === "postpone" ? "Tap again to postpone" : "Postpone"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => armOrFire("cancel")}
          className={`stat min-h-11 rounded-lg border px-3 text-xs disabled:opacity-50 ${
            armed === "cancel" ? "border-loss text-loss" : "border-chalk/20 text-chalk"
          }`}
        >
          {armed === "cancel" ? "Tap again to cancel" : "Cancel game"}
        </button>
      </div>

      {open.length === 0 && (
        <p className="text-xs text-dim">No scheduled games in the next nine days.</p>
      )}

      {dead.length > 0 && (
        <ul className="flex flex-col gap-2 border-t border-chalk/8 pt-3">
          {dead.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-chalk/80">
                {g.label}
                <span className="chip ml-2 bg-push/12 text-push">{g.status}</span>
                {g.kickedOff && (
                  // Restoring a game whose kickoff is in the past leaves it
                  // un-pickable: make_pick refuses once start_ts <= now(), and
                  // CFBD will not move the time until it publishes the new
                  // date. Worth saying, because "restored but nobody can pick"
                  // reads as a bug.
                  <span className="ml-2 text-xs text-dim">
                    kickoff has passed — members cannot re-pick until the new time syncs
                  </span>
                )}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => act(g.id, "restore")}
                className="stat min-h-11 rounded-lg border border-chalk/20 px-3 text-xs text-chalk disabled:opacity-50"
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}

      {note && <p className="text-xs text-dim">{note}</p>}
      {error && <p className="text-xs text-loss">{error}</p>}
    </div>
  );
}
