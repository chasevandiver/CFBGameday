"use client";

/**
 * The picture-in-picture scoreboard for the Fire TV overlay (/tv/corner):
 * six games a page, live first, rotating every eight seconds when there are
 * more. Sized to the viewport, which the overlay app sets to the box.
 */

import { useEffect, useState } from "react";
import type { TickerGame } from "../../lib/ticker";
import { leadingSide } from "../ScoreTicker";
import { tvStatus } from "./TvChip";
import { tvOrder, useTickerFeed } from "./use-ticker-feed";

const PER_PAGE = 6;
const ROTATE_MS = 8_000;

export function TvBoard() {
  const data = useTickerFeed();
  const games = data ? tvOrder(data.games) : [];
  const pages = Math.max(1, Math.ceil(games.length / PER_PAGE));
  const live = games.filter((g) => g.status === "in_progress").length;

  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (pages < 2) return;
    const t = setInterval(() => setTick((n) => n + 1), ROTATE_MS);
    return () => clearInterval(t);
  }, [pages]);
  // Derived, not stored: a poll that shrinks the list can't strand us on a
  // page that no longer exists.
  const page = tick % pages;
  const shown = games.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  return (
    <main className="tv-board tv-panel">
      <header className="tv-board-head">
        <span>THE SLATE</span>
        <span className="tv-board-meta">
          {live > 0 && (
            <>
              <span className="tv-dot live-dot" aria-hidden /> {live} LIVE
            </>
          )}
          {pages > 1 && (
            <span className="tv-pages" aria-hidden>
              {Array.from({ length: pages }, (_, i) => (
                <span key={i} data-on={i === page ? "1" : undefined} />
              ))}
            </span>
          )}
        </span>
      </header>
      {shown.length === 0 ? (
        <p className="tv-empty">{data ? "No games on right now" : "Loading scores"}</p>
      ) : (
        <div className="tv-grid">
          {shown.map((g) => (
            <Cell key={g.id} g={g} />
          ))}
        </div>
      )}
    </main>
  );
}

function Cell({ g }: { g: TickerGame }) {
  const live = g.status === "in_progress";
  const scored = live || g.status === "final";
  const lead = leadingSide(g);
  const row = (abbr: string, pts: number | null, s: "home" | "away") => (
    <span className={`tv-team ${lead !== null && lead !== s ? "text-chalk/45" : "text-chalk"}`}>
      <span style={{ fontWeight: lead === s ? 700 : 500 }}>{abbr}</span>
      {scored && <span className="stat">{pts ?? 0}</span>}
    </span>
  );
  return (
    <div className="tv-cell" data-live={live ? "1" : undefined}>
      {row(g.awayAbbr, g.awayPoints, "away")}
      <span className={`tv-cell-status stat ${live ? "text-live" : "text-dim"}`}>
        {g.sport === "nfl" && <span className="tv-tag">NFL</span>}
        {tvStatus(g)}
      </span>
      {row(g.homeAbbr, g.homePoints, "home")}
    </div>
  );
}
