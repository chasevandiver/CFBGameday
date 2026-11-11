"use client";

/**
 * The broadcast strip for the Fire TV overlay (/tv/ticker). The overlay app
 * sizes the window; this page fills it, so every measure here is relative to
 * the viewport height rather than to a phone layout.
 */

import { useEffect, useRef, useState } from "react";
import { TvChip } from "./TvChip";
import { tvOrder, useTickerFeed } from "./use-ticker-feed";

export function TvTicker() {
  const data = useTickerFeed();
  const games = data ? tvOrder(data.games) : [];

  const frameRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  // 0 = everything fits, hold still. Otherwise seconds per loop.
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const measure = () => {
      const frame = frameRef.current;
      const copy = copyRef.current;
      if (!frame || !copy) return;
      const w = copy.scrollWidth;
      // Speed in strip-heights per second, so a bigger strip moves the same
      // amount of text past the eye on any TV.
      const pxPerSec = frame.clientHeight * 1.5;
      const next = w <= frame.clientWidth ? 0 : Math.max(15, Math.round(w / pxPerSec));
      // Changing animation-duration mid-loop makes the crawl jump. A clock
      // going 10:45 -> 9:59 nudges the width every poll, so hold the current
      // speed unless the strip really changed (a game added or dropped).
      setDuration((prev) =>
        prev > 0 && next > 0 && Math.abs(next - prev) / prev < 0.25 ? prev : next,
      );
    };
    const copy = copyRef.current;
    const ro = new ResizeObserver(measure);
    if (copy) ro.observe(copy);
    measure();
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [games.length]);

  return (
    <main className="tv-strip tv-panel">
      <div className="tv-brand">
        <span>THE SLATE</span>
        {data && <span className="tv-week">WK {data.week}</span>}
      </div>
      <div className="tv-viewport" ref={frameRef}>
        {games.length === 0 ? (
          <span className="tv-empty">{data ? "No games on right now" : "Loading scores"}</span>
        ) : (
          <div
            className="tv-track"
            data-still={duration === 0 ? "1" : undefined}
            style={{ "--tv-dur": `${duration}s` } as React.CSSProperties}
          >
            <div className="tv-copy" ref={copyRef}>
              {games.map((g) => (
                <TvChip key={g.id} g={g} />
              ))}
            </div>
            {duration > 0 && (
              <div className="tv-copy" aria-hidden>
                {games.map((g) => (
                  <TvChip key={g.id} g={g} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
