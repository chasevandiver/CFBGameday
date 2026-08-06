"use client";

/**
 * Slim gameday score strip under the nav (docs/SPEC.md §7). Renders nothing
 * outside game windows — /api/ticker only returns live games, recent finals,
 * and imminent kickoffs. Polls every 60s and rides the realtime channel for
 * instant score updates while anything is live.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { periodLabel } from "../lib/kick";
import type { TickerData } from "../lib/ticker";
import { useGamesRealtime } from "../lib/use-games-realtime";

export function ScoreTicker() {
  const [data, setData] = useState<TickerData | null>(null);

  useEffect(() => {
    let cancelled = false;
    // async subscription to an external system: state updates land in the
    // fetch callback, never synchronously in the effect body
    const load = () =>
      fetch("/api/ticker", { cache: "no-store" })
        .then(async (res) => {
          if (res.ok && !cancelled) setData((await res.json()) as TickerData);
        })
        .catch(() => {
          /* transient network error — next poll retries */
        });
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const anyLive = data?.games.some((g) => g.status === "in_progress") ?? false;
  useGamesRealtime({
    enabled: anyLive && data !== null,
    week: data?.week ?? 0,
    seasonId: data?.seasonId ?? 0,
    onGameUpdate: (row) => {
      setData((d) =>
        d === null
          ? d
          : {
              ...d,
              games: d.games.map((g) =>
                g.id === row.id
                  ? {
                      ...g,
                      status: row.status,
                      period: row.current_period,
                      clock: row.current_clock,
                      homePoints: row.home_points,
                      awayPoints: row.away_points,
                    }
                  : g,
              ),
            },
      );
    },
  });

  if (!data || data.games.length === 0) return null;

  return (
    <div className="border-b border-chalk/10 bg-background/85 backdrop-blur-md">
      <div className="scroll-thin mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4 py-1">
        {data.games.map((g) => {
          const live = g.status === "in_progress";
          const final = g.status === "final";
          return (
            <Link
              key={g.id}
              href={`/game/${g.id}`}
              className="stat flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] leading-none text-dim transition-colors hover:bg-surface hover:text-chalk"
            >
              {live && (
                <span aria-label="Live" className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-live" />
              )}
              <span className="font-medium text-chalk">
                {g.awayAbbr} {live || final ? (g.awayPoints ?? 0) : ""}
              </span>
              <span className="text-chalk/30">–</span>
              <span className="font-medium text-chalk">
                {g.homeAbbr} {live || final ? (g.homePoints ?? 0) : ""}
              </span>
              <span className="text-[10px] uppercase">
                {live
                  ? `${periodLabel(g.period)}${g.clock ? ` ${g.clock}` : ""}`
                  : final
                    ? "Final"
                    : g.startTs
                      ? new Intl.DateTimeFormat("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        }).format(new Date(g.startTs))
                      : ""}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
