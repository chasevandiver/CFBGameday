"use client";

import { useCallback, useEffect, useState } from "react";
import type { TickerData, TickerGame } from "../../lib/ticker";
import { useLiveRefresh } from "../../lib/use-live-refresh";

/**
 * The /api/ticker payload for the TV overlay pages. Same feed and cadence as
 * the in-app ScoreTicker (30s while anything is live, 60s otherwise), without
 * the realtime channel: the overlay runs for hours on a stick with little RAM,
 * and a poll that cannot leak a socket is the safer trade.
 */
export function useTickerFeed(): TickerData | null {
  const [data, setData] = useState<TickerData | null>(null);

  const load = useCallback(
    () =>
      void fetch("/api/ticker", { cache: "no-store" })
        .then(async (res) => {
          if (res.ok) setData((await res.json()) as TickerData);
        })
        .catch(() => {
          /* transient; the next poll retries */
        }),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  const anyLive = data?.games.some((g) => g.status === "in_progress") ?? false;
  useLiveRefresh(load, anyLive ? 30_000 : 60_000);
  return data;
}

/** Live first, then the next kickoffs, then finals: what a viewer looks for. */
export function tvOrder(games: TickerGame[]): TickerGame[] {
  const rank = (g: TickerGame) =>
    g.status === "in_progress" ? 0 : g.status === "scheduled" ? 1 : 2;
  return [...games].sort(
    (a, b) => rank(a) - rank(b) || (a.startTs ?? "").localeCompare(b.startTs ?? ""),
  );
}
