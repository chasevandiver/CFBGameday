"use client";

import { useEffect } from "react";

/**
 * Hold a screen wake lock while the component is mounted (R5-A). The
 * Jumbotron is a leave-it-running surface; a screen that sleeps mid-drive
 * defeats it. Navigation to the page is the user gesture; if the request
 * is still refused, the first tap retries. The lock auto-releases when the
 * tab hides, so it is re-requested on visibilitychange — the same wake-up
 * discipline `use-live-refresh` follows. No-op where unsupported (the
 * screen simply follows the device's own timeout, honestly).
 */
export function useWakeLock(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    // The property check, not a type assertion: older Safari has no wakeLock.
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let alive = true;

    const request = async () => {
      try {
        const l = await navigator.wakeLock.request("screen");
        if (!alive) {
          void l.release();
          return;
        }
        lock = l;
      } catch {
        /* refused (low battery, not visible) — the retry paths below */
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void request();
    };
    const onTap = () => {
      if (lock === null) void request();
    };

    void request();
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("pointerdown", onTap);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("pointerdown", onTap);
      try {
        void lock?.release();
      } catch {
        /* already released by the platform */
      }
    };
  }, [enabled]);
}
