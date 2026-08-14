"use client";

/**
 * The poller for a page somebody leaves open for four hours.
 *
 * `setInterval` alone is not that. A tab that gets backgrounded, or an iPad
 * whose screen dims, has its timers throttled to a crawl or frozen outright;
 * when it comes back the old interval is still armed for a full period from
 * whenever it happens to resume, and a Supabase realtime socket that died in
 * the meantime can still report `SUBSCRIBED`. The scoreboard sat there stale
 * until the viewer navigated to another tab of the site and back, which
 * remounts the page and re-renders it on the server — the owner's report,
 * 2026-08-14, watching NFL preseason on an iPad.
 *
 * Two things fix that, and both are in here:
 *
 * 1. **Wall clock, not tick count.** The elapsed time since the last run is
 *    what decides whether to run, checked on a short tick. A suspended timer
 *    therefore catches up on its first tick back instead of waiting out a
 *    fresh full period, and shortening `intervalMs` (a game goes live) takes
 *    effect against the last run rather than restarting the countdown.
 * 2. **Wake events.** Coming back to the page refreshes on the spot —
 *    `visibilitychange`, `focus`, `pageshow` (iOS restores from bfcache with
 *    timers frozen) and `online`. This is the one the owner was doing by hand.
 *
 * Runs only while the document is visible, so a background tab still costs
 * nothing.
 */

import { useEffect, useRef } from "react";

/** A refresh this recent already answers "is it current?" — don't re-fetch. */
const WAKE_FLOOR_MS = 4_000;
/** How often to compare clocks. Cheap; the comparison is what gates the fetch. */
const TICK_MS = 4_000;

export function useLiveRefresh(refresh: () => void, intervalMs: number, enabled = true): void {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // Mount counts as a run: the server just rendered this data.
  const lastRunAt = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    if (lastRunAt.current === 0) lastRunAt.current = Date.now();

    const run = () => {
      // stamped before the fetch, so a slow one can't stack requests behind it
      lastRunAt.current = Date.now();
      refreshRef.current();
    };
    const runIfOlderThan = (ms: number) => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRunAt.current >= ms) run();
    };

    const tick = () => runIfOlderThan(intervalMs);
    const wake = () => runIfOlderThan(WAKE_FLOOR_MS);

    const id = setInterval(tick, Math.min(TICK_MS, intervalMs));
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("pageshow", wake);
    window.addEventListener("online", wake);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("pageshow", wake);
      window.removeEventListener("online", wake);
    };
  }, [enabled, intervalMs]);
}
