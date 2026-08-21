"use client";

import { useMemo, useState } from "react";
import { projectWeek, type MachinePick, type Outcome } from "../../lib/pool-machine";
import { weekWinOdds, type OddsGame } from "../../lib/pool-odds";
import { fmtPct } from "../../lib/slate";
import type { Tally } from "../../lib/records";

/**
 * The Pool Machine + win-the-week % (R2-D2/D3). Toggle the remaining games,
 * watch the race re-sort; the odds column is a seeded Monte Carlo over the
 * same picks. Client-side only — nothing is written, nothing is fetched;
 * the page hands it exactly what it already renders.
 *
 * Inside a <details> so the board stays glanceable: the machine is a thing
 * you open on purpose.
 */

export interface MachineGame {
  id: number;
  awayAbbr: string;
  homeAbbr: string;
  homeWinProb: number;
}

export function PoolMachine({
  members,
  base,
  pending,
  games,
  viewerId,
  hiddenNote,
}: {
  members: Array<{ userId: string; name: string }>;
  /** Serializable Map: graded week tallies. */
  base: Array<[string, Tally]>;
  pending: MachinePick[];
  games: MachineGame[];
  viewerId: string | null;
  /** True when the blind may be hiding picks from this projection. */
  hiddenNote: boolean;
}) {
  const [outcomes, setOutcomes] = useState<Map<number, Outcome>>(new Map());
  const baseMap = useMemo(() => new Map(base), [base]);

  const odds = useMemo(
    () => weekWinOdds(members, baseMap, pending, games satisfies OddsGame[] as OddsGame[]),
    [members, baseMap, pending, games],
  );
  const rows = useMemo(
    () => projectWeek(members, baseMap, pending, outcomes),
    [members, baseMap, pending, outcomes],
  );

  const toggle = (gameId: number, side: Outcome) => {
    setOutcomes((prev) => {
      const next = new Map(prev);
      if (next.get(gameId) === side) next.delete(gameId);
      else next.set(gameId, side);
      return next;
    });
  };

  const machineGames = games.filter((g) =>
    pending.some((p) => p.gameId === g.id && p.market !== "total"),
  );
  if (members.length < 2 || (machineGames.length === 0 && pending.length === 0)) return null;

  return (
    <details className="card mb-5 px-4 py-3">
      <summary className="stat cursor-pointer text-sm text-accent">
        The Pool Machine — what if…
      </summary>
      <p className="mt-1 text-xs text-dim">
        Toggle who covers and watch the week re-sort. Totals stay pending (a side can&rsquo;t
        answer a number){hiddenNote ? "; hidden picks aren’t in this projection" : ""}. The %
        column simulates the picks still alive.
      </p>

      {machineGames.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {machineGames.map((g) => {
            const chosen = outcomes.get(g.id);
            const btn = (side: Outcome, label: string) => (
              <button
                onClick={() => toggle(g.id, side)}
                aria-pressed={chosen === side}
                className={`min-h-9 rounded-lg px-2.5 text-xs font-semibold transition-colors ${
                  chosen === side
                    ? "bg-accent text-accent-ink"
                    : "bg-elev text-chalk/80 ring-1 ring-inset ring-chalk/12 hover:ring-accent/40"
                }`}
              >
                {label}
              </button>
            );
            return (
              <li key={g.id} className="flex items-center justify-between gap-2">
                <span className="stat min-w-0 truncate text-xs text-chalk/70">
                  {g.awayAbbr} @ {g.homeAbbr}
                </span>
                <span className="flex shrink-0 gap-1.5">
                  {btn("away", g.awayAbbr)}
                  {btn("home", g.homeAbbr)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <ul className="mt-3 flex flex-col gap-1 border-t border-chalk/8 pt-2">
        {rows.map((r, i) => (
          <li
            key={r.userId}
            className={`stat flex items-center justify-between text-sm ${
              r.userId === viewerId ? "text-accent" : "text-chalk"
            }`}
          >
            <span className="font-sans">
              {i + 1}. {r.name}
            </span>
            <span className="text-dim">
              {/* Points, not units (POOL-6). Whole numbers — a pool score with
                  two decimals on it was the tell that this was a book's
                  arithmetic wearing a pool's clothes. */}
              {r.points} {r.points === 1 ? "pt" : "pts"}
              {r.delta !== 0 && (
                <span className={r.delta > 0 ? "text-win" : "text-loss"}>
                  {" "}
                  ({r.delta > 0 ? "+" : ""}
                  {r.delta})
                </span>
              )}
              <span className="ml-2 text-chalk/45">{fmtPct(odds.get(r.userId) ?? 0)}</span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
