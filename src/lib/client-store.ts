"use client";

/**
 * Tiny external stores for browser-only state (theme, starred teams, viewer
 * timezone) so components read them via useSyncExternalStore — SSR renders the
 * defaults, the client settles to the real values without effect-driven
 * setState cascades.
 */

import { useCallback, useSyncExternalStore } from "react";

/* ---- theme ------------------------------------------------------------- */

const themeListeners = new Set<() => void>();
const subscribeTheme = (cb: () => void) => {
  themeListeners.add(cb);
  return () => themeListeners.delete(cb);
};

export function useLightTheme(): [boolean, (light: boolean) => void] {
  const light = useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.dataset.theme === "light",
    () => false,
  );
  const setLight = useCallback((next: boolean) => {
    if (next) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("slate-theme", next ? "light" : "dark");
    } catch {
      /* private mode */
    }
    themeListeners.forEach((l) => l());
  }, []);
  return [light, setLight];
}

/* ---- starred teams ------------------------------------------------------ */

const STAR_KEY = "slate-starred";
const EMPTY: number[] = [];
let starCache: number[] | null = null;
const starListeners = new Set<() => void>();
const subscribeStars = (cb: () => void) => {
  starListeners.add(cb);
  return () => starListeners.delete(cb);
};

function readStars(): number[] {
  if (starCache === null) {
    try {
      const raw = localStorage.getItem(STAR_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      starCache = Array.isArray(parsed) ? parsed.filter((v) => typeof v === "number") : [];
    } catch {
      starCache = [];
    }
  }
  return starCache;
}

export function useStarred(): [number[], (teamId: number) => void] {
  const starred = useSyncExternalStore(subscribeStars, readStars, () => EMPTY);
  const toggle = useCallback((teamId: number) => {
    const prev = readStars();
    starCache = prev.includes(teamId) ? prev.filter((id) => id !== teamId) : [...prev, teamId];
    try {
      localStorage.setItem(STAR_KEY, JSON.stringify(starCache));
    } catch {
      /* private mode */
    }
    starListeners.forEach((l) => l());
  }, []);
  return [starred, toggle];
}

/* ---- viewer timezone ---------------------------------------------------- */

let tzCache: string | null = null;
const noopSubscribe = () => () => {};

export function useViewerTz(fallback: string): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => {
      if (tzCache === null) {
        try {
          tzCache = Intl.DateTimeFormat().resolvedOptions().timeZone || fallback;
        } catch {
          tzCache = fallback;
        }
      }
      return tzCache;
    },
    () => fallback,
  );
}
