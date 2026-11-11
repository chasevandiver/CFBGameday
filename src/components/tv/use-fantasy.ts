"use client";

import { useCallback, useEffect, useState } from "react";
import type { FantasyData } from "../../lib/fantasy";
import { useLiveRefresh } from "../../lib/use-live-refresh";

/**
 * The viewer's ESPN fantasy league, when the TV link names one (TV-12):
 * `?ffl=<league id>&fteam=<team id>`. No league in the URL, no requests.
 * ESPN updates fantasy scores about once a minute; polling faster buys nothing.
 */
export function useFantasy(): FantasyData | null {
  const [data, setData] = useState<FantasyData | null>(null);
  // Read once from the page's own URL. Never rendered, so the server's null
  // and the client's value can't disagree on screen.
  const [query] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const p = new URLSearchParams(window.location.search);
    const league = p.get("ffl");
    const team = p.get("fteam");
    if (!league) return null;
    return `league=${encodeURIComponent(league)}${team ? `&team=${encodeURIComponent(team)}` : ""}`;
  });

  const load = useCallback(() => {
    if (!query) return;
    void fetch(`/api/fantasy?${query}`, { cache: "no-store" })
      .then(async (res) => {
        if (res.ok) setData((await res.json()) as FantasyData);
      })
      .catch(() => {
        /* ESPN hiccup; keep what's on screen */
      });
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, 60_000);
  return data;
}
