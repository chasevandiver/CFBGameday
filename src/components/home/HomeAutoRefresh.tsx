"use client";

/**
 * The home hub's refresh, which it did not have.
 *
 * `/` is a server component all the way down — deliberately, since the hub
 * needs a database, a season, a group, picks and bets before it draws
 * anything. The cost of that was total: nothing on the page ever updated. The
 * slate at least polled; home rendered once and then sat there until you
 * navigated, which is what the owner hit on the iPad (2026-08-14) on the same
 * night the slate's own poller was fixed.
 *
 * `router.refresh()` is the fix rather than a client-side data layer: it
 * re-runs the server render in place, keeps scroll position and client state,
 * and needs no `/api/home` route duplicating `fetchHomeData`'s six queries.
 * The pacing comes from the same `useLiveRefresh` the slate and ticker use, so
 * all three surfaces come back current the moment the tab does.
 *
 * Renders nothing.
 */

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useLiveRefresh } from "../../lib/use-live-refresh";

export function HomeAutoRefresh({ live, imminent }: { live: boolean; imminent: boolean }) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  /* A full server re-render is heavier than the slate's JSON poll, so the idle
     tier is much slower — with nothing kicking off there is nothing on this
     page that changes on its own. The wake handler is what matters then, and
     it fires regardless of the interval. */
  useLiveRefresh(refresh, live ? 30_000 : imminent ? 60_000 : 300_000);
  return null;
}
