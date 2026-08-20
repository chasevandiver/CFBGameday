"use client";

import { useEffect } from "react";
import {
  funOn,
  msToNextDaypart,
  overriddenDaypart,
  overriddenGameday,
  useFunPrefs,
} from "../lib/fun-mode";

/**
 * The fall light engine's clock (FUN-2). Renders nothing; while the light
 * engine is on it keeps `data-daypart` on <html> matching the viewer's local
 * time on gamedays, waking on a timeout to the next boundary rather than an
 * interval — the light changes four times a day, not sixty times a minute.
 *
 * The pre-paint script in layout.tsx sets the same attributes before first
 * paint; this component owns them from hydration on (and honors the
 * `?funday=` / `?daypart=` preview overrides, which a pre-paint one-liner
 * has no business parsing).
 */
export function FunAtmosphere() {
  const [prefs] = useFunPrefs();
  const lightOn = funOn(prefs, "fallLight");

  useEffect(() => {
    const d = document.documentElement.dataset;
    if (!lightOn) {
      delete d.daypart;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const apply = () => {
      const now = new Date();
      const search = new URLSearchParams(window.location.search);
      const gameday = overriddenGameday(search, now);
      if (gameday) d.daypart = overriddenDaypart(search, now);
      else delete d.daypart;
      clearTimeout(timer);
      timer = setTimeout(apply, msToNextDaypart(now));
    };
    apply();
    // A phone that slept through a boundary catches up on wake.
    const onVisible = () => {
      if (document.visibilityState === "visible") apply();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [lightOn]);

  return null;
}
