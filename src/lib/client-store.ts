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

/** The three themes. `dark` is the default and carries no data-theme attribute. */
export type Theme = "dark" | "light" | "field";

const THEME_ORDER: Theme[] = ["dark", "light", "field"];

/**
 * Theme, cycling dark → light → field.
 *
 * `field` is the brand palette from docs/BRAND.md §5 — the one that matches the
 * app icon. It is a third option rather than a replacement: the charcoal dark
 * and light themes are what the product was designed in, and swapping them out
 * from under people who like them is not an upgrade.
 */
export function useTheme(): [Theme, (next: Theme) => void, () => void] {
  const theme = useSyncExternalStore(
    subscribeTheme,
    () => (document.documentElement.dataset.theme as Theme) || "dark",
    () => "dark" as Theme,
  );
  const setTheme = useCallback((next: Theme) => {
    if (next === "dark") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("slate-theme", next);
    } catch {
      /* private mode */
    }
    themeListeners.forEach((l) => l());
  }, []);
  const cycle = useCallback(() => {
    const current = (document.documentElement.dataset.theme as Theme) || "dark";
    setTheme(THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length]);
  }, [setTheme]);
  return [theme, setTheme, cycle];
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

/* ---- focused games (multi-game focus mode) ------------------------------ */

const FOCUS_KEY = "slate-focused";
const FOCUS_CAP = 4;
let focusCache: number[] | null = null;
const focusListeners = new Set<() => void>();
const subscribeFocus = (cb: () => void) => {
  focusListeners.add(cb);
  return () => focusListeners.delete(cb);
};

function readFocused(): number[] {
  if (focusCache === null) {
    try {
      // sessionStorage: focus is a this-Saturday tool, not a preference
      const raw = sessionStorage.getItem(FOCUS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      focusCache = Array.isArray(parsed) ? parsed.filter((v) => typeof v === "number") : [];
    } catch {
      focusCache = [];
    }
  }
  return focusCache;
}

/** Pin up to four games to a Focus row at the top of the slate. */
export function useFocusedGames(): [number[], (gameId: number) => void] {
  const focused = useSyncExternalStore(subscribeFocus, readFocused, () => EMPTY);
  const toggle = useCallback((gameId: number) => {
    const prev = readFocused();
    focusCache = prev.includes(gameId)
      ? prev.filter((id) => id !== gameId)
      : [...prev, gameId].slice(-FOCUS_CAP);
    try {
      sessionStorage.setItem(FOCUS_KEY, JSON.stringify(focusCache));
    } catch {
      /* private mode */
    }
    focusListeners.forEach((l) => l());
  }, []);
  return [focused, toggle];
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
