"use client";

import Link from "next/link";
import { isRedZone, type GameView } from "../../lib/slate";
import { periodLabel } from "../../lib/kick";

/**
 * The rest of the board (R5-A): every other live game as a big-type row —
 * score, clock, a red-zone dot. Tap through to the game page. Rows are the
 * rail, not cards: the featured game is the only card on this screen.
 */
export function JumbotronRail({ games, demo = false }: { games: GameView[]; demo?: boolean }) {
  if (games.length === 0) return null;
  return (
    <ul aria-label="Other live games" className="space-y-1.5">
      {games.map((g) => {
        const h = g.homePoints ?? 0;
        const a = g.awayPoints ?? 0;
        const row = (
          <span className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 py-1 hover:bg-surface">
            <span className="scorebug min-w-0 truncate text-xl text-chalk">
              {g.away.abbr} <span className={a > h ? "" : "text-chalk/45"}>{a}</span>
              <span className="mx-1 text-chalk/30">–</span>
              <span className={h > a ? "" : "text-chalk/45"}>{h}</span> {g.home.abbr}
            </span>
            <span className="stat flex shrink-0 items-center gap-2 text-sm text-dim">
              {isRedZone(g) && (
                <span aria-label="Red zone" className="live-dot inline-block h-2 w-2 rounded-full bg-loss" />
              )}
              {periodLabel(g.period)}
              {g.clock ? ` ${g.clock}` : ""}
            </span>
          </span>
        );
        return (
          <li key={g.id}>
            {demo ? (
              row
            ) : (
              <Link
                href={`/game/${g.id}`}
                className="block focus-visible:outline-2 focus-visible:outline-accent"
              >
                {row}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
