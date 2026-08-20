"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { funOn, useFunPrefs, useGameday } from "../../lib/fun-mode";
import {
  headlinePick,
  isDead,
  isFinal,
  isLive,
  pickSideLabel,
  type GameView,
} from "../../lib/slate";

/**
 * The Panel (FUN-9): before the big game kicks, the crew's picks for it turn
 * over one by one — the picks segment, with your friends at the desk. The
 * last chair gets the long beat.
 *
 * Theater over data that is already visible, never a reveal of anything
 * hidden: `crewPicks` arrives through the same RLS the pick boards use, so a
 * group that hides picks until kickoff simply has nothing here to flip (and
 * once the game is live, the cards themselves carry the picks — the Panel
 * stands down). One animated showing per session; after that the chairs
 * render turned. "Run it back" replays on request.
 */

const SEEN_KEY = "slate-panel-seen";

interface Chair {
  name: string;
  label: string;
  color: string | null;
  record: string | null;
}

export function ThePanel({ game, displayName }: { game: GameView; displayName: string | null }) {
  const [prefs] = useFunPrefs();
  const gameday = useGameday();
  const [seen] = useState(() => {
    try {
      return sessionStorage.getItem(SEEN_KEY) === String(game.id);
    } catch {
      return false;
    }
  });
  const [replay, setReplay] = useState(0);
  const on =
    funOn(prefs, "panel") && gameday !== null && !isLive(game) && !isFinal(game) && !isDead(game);

  useEffect(() => {
    if (!on) return;
    try {
      sessionStorage.setItem(SEEN_KEY, String(game.id));
    } catch {
      /* private mode */
    }
  }, [on, game.id]);

  if (!on) return null;

  const chairs: Chair[] = [];
  const mine = headlinePick(game.myPicks);
  if (mine) {
    chairs.push({
      name: displayName ?? "You",
      label: pickSideLabel(mine.market, mine.side, mine.line, game.home.abbr, game.away.abbr, {
        compact: true,
      }),
      color:
        mine.side === "home"
          ? game.home.color
          : mine.side === "away"
            ? game.away.color
            : null,
      record: null,
    });
  }
  for (const p of game.crewPicks) {
    chairs.push({
      name: p.name,
      label: p.side === "home" ? game.home.abbr : p.side === "away" ? game.away.abbr : p.side,
      color: p.side === "home" ? game.home.color : p.side === "away" ? game.away.color : null,
      record: p.record,
    });
  }
  if (chairs.length < 2) return null;

  const animate = !seen || replay > 0;
  const delayFor = (i: number) => i * 650 + (i === chairs.length - 1 ? 450 : 0);

  return (
    <section className="card mb-5 p-3.5" aria-label="The Panel — crew picks for the Game of the Week">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm text-accent">The Panel</h2>
          <p className="mt-0.5 truncate text-xs text-dim">
            {game.away.abbr} at {game.home.abbr} · who&rsquo;s on what
          </p>
        </div>
        <button
          onClick={() => setReplay((r) => r + 1)}
          className="flex min-h-11 items-center gap-1.5 rounded-lg border border-chalk/15 px-3 text-xs font-medium text-chalk transition-colors hover:border-chalk/30"
        >
          <RotateCcw size={13} aria-hidden />
          Run it back
        </button>
      </div>
      {/* key remount restarts the CSS delays for a replay */}
      <ul key={replay} className="mt-3 flex flex-wrap gap-2">
        {chairs.map((c, i) => (
          <li
            key={`${c.name}-${i}`}
            className={`fun-flip ${animate ? "" : "fun-flip-done"}`}
            style={{ "--fp-d": `${animate ? delayFor(i) : 0}ms` } as CSSProperties}
          >
            <div className="fun-flip-inner">
              <span className="fun-flip-front">
                <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-dim">
                  {c.name}
                </span>
              </span>
              <span
                className="fun-flip-back"
                style={{ "--tc": c.color ?? "var(--push)" } as CSSProperties}
              >
                <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-dim">
                  {c.name}
                </span>
                <span className="stat text-sm font-bold text-chalk">{c.label}</span>
                {c.record && <span className="stat text-[10px] text-dim">{c.record}</span>}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
