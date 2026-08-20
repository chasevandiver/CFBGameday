"use client";

/**
 * Fun Mode (docs/STATUS.md FUN-1) — the opt-in pageantry layer.
 *
 * One master switch and a toggle per piece, stored per device in localStorage
 * the way the theme is (`client-store.ts`): SSR renders the plain app, the
 * client settles to the saved switches without a flash (the pre-paint script
 * in layout.tsx sets the CSS-gated attributes before first paint).
 *
 * Defaults: master OFF, every piece ON — so the one switch delivers the whole
 * experience and the per-piece toggles are opt-outs, not a second gauntlet.
 * A piece is effective only while the master is on.
 *
 * The motion these pieces add is exempt from the slate's "motion means money"
 * rule BY OWNER DECISION (2026-08-20, recorded in docs/CHANGELOG.md): every
 * one of them is opt-in and off by default, so the exemption is scoped to
 * people who asked for it. The OS-level reduced-motion clamp in globals.css
 * still covers all of it — every fun-mode animation is plain CSS.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";

export type FunPiece =
  | "cover" // the Saturday program cover
  | "panel" // the crew picks reveal
  | "signs" // crowd signs behind the slate header
  | "rundown" // the Saturday slate load-in
  | "fallLight" // time-of-day backdrop
  | "weatherFx" // rain/snow/wind on cards
  | "broadcast" // production-truck live treatments
  | "rivalry" // house-divided trophy games
  | "pennants" // favorites as felt pennants
  | "stubs"; // the ticket-stub shelf

export type FunPrefs = { master: boolean } & Record<FunPiece, boolean>;

export const FUN_KEY = "slate-fun";

export const FUN_DEFAULTS: FunPrefs = {
  master: false,
  cover: true,
  panel: true,
  signs: true,
  rundown: true,
  fallLight: true,
  weatherFx: true,
  broadcast: true,
  rivalry: true,
  pennants: true,
  stubs: true,
};

/** A piece is live only under the master switch. */
export function funOn(prefs: FunPrefs, piece: FunPiece): boolean {
  return prefs.master && prefs[piece];
}

/* ---- store (the readStars idiom) ---------------------------------------- */

let cache: FunPrefs | null = null;
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function normalizeFunPrefs(raw: unknown): FunPrefs {
  if (typeof raw !== "object" || raw === null) return FUN_DEFAULTS;
  const out = { ...FUN_DEFAULTS };
  for (const k of Object.keys(FUN_DEFAULTS) as (keyof FunPrefs)[]) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

function readPrefs(): FunPrefs {
  if (cache === null) {
    try {
      const raw = localStorage.getItem(FUN_KEY);
      cache = raw ? normalizeFunPrefs(JSON.parse(raw)) : FUN_DEFAULTS;
    } catch {
      cache = FUN_DEFAULTS;
    }
  }
  return cache;
}

/**
 * The CSS-gated pieces speak through attributes on <html>, so a stylesheet
 * rule can gate itself without a component in the loop. Kept in lockstep with
 * the pre-paint script in layout.tsx — change one, change both.
 */
function syncAttributes(prefs: FunPrefs) {
  const d = document.documentElement.dataset;
  const gate = (on: boolean, key: "funLight" | "funBroadcast" | "funRivalry") => {
    if (on) d[key] = "";
    else delete d[key];
  };
  gate(funOn(prefs, "fallLight"), "funLight");
  gate(funOn(prefs, "broadcast"), "funBroadcast");
  gate(funOn(prefs, "rivalry"), "funRivalry");
  // The daypart attribute only means anything under the light engine.
  if (!funOn(prefs, "fallLight")) delete d.daypart;
}

export function useFunPrefs(): [FunPrefs, (patch: Partial<FunPrefs>) => void] {
  const prefs = useSyncExternalStore(subscribe, readPrefs, () => FUN_DEFAULTS);
  const update = useCallback((patch: Partial<FunPrefs>) => {
    cache = { ...readPrefs(), ...patch };
    try {
      localStorage.setItem(FUN_KEY, JSON.stringify(cache));
    } catch {
      /* private mode */
    }
    syncAttributes(cache);
    listeners.forEach((l) => l());
  }, []);
  return [prefs, update];
}

/* ---- gameday & daypart (pure, tested) ------------------------------------ */

export type GamedayKind = "cfb" | "nfl" | null;

/** Saturday is college, Sunday is pro, the rest of the week is the rest of the week. */
export function gamedayKind(d: Date): GamedayKind {
  const day = d.getDay();
  return day === 6 ? "cfb" : day === 0 ? "nfl" : null;
}

export type Daypart = "dawn" | "noon" | "golden" | "lights";

/**
 * The arc of a football Saturday, in the viewer's local clock: morning haze
 * until the first window, the flat light of the noon slate, the golden hour
 * the 3:30 games are played in, then under the lights.
 */
export function daypartFor(d: Date): Daypart {
  const h = d.getHours();
  if (h < 11) return "dawn";
  if (h < 15) return "noon";
  if (h < 18) return "golden";
  return "lights";
}

/** Milliseconds until the next daypart boundary — how long a timer can sleep. */
export function msToNextDaypart(d: Date): number {
  const h = d.getHours();
  const nextHour = h < 11 ? 11 : h < 15 ? 15 : h < 18 ? 18 : 24;
  const next = new Date(d);
  next.setHours(nextHour, 0, 0, 0);
  return Math.max(1_000, next.getTime() - d.getTime());
}

/**
 * Preview overrides, honored whenever present so a piece can be judged on a
 * Wednesday: `?funday=sat|sun` poses the gameday, `?daypart=golden` poses the
 * light. They pose time only — the master switch still has to be on.
 */
export function overriddenGameday(search: URLSearchParams, d: Date): GamedayKind {
  const v = search.get("funday");
  if (v === "sat") return "cfb";
  if (v === "sun") return "nfl";
  return gamedayKind(d);
}

export function overriddenDaypart(search: URLSearchParams, d: Date): Daypart {
  const v = search.get("daypart");
  if (v === "dawn" || v === "noon" || v === "golden" || v === "lights") return v;
  return daypartFor(d);
}

/**
 * Today's gameday kind, with the `?funday=` preview honored — decided once
 * per page load. Server snapshot is null (the plain app), so anything gated
 * on this settles client-side without a hydration complaint.
 */
let gamedayCache: GamedayKind | undefined;
function gamedaySnapshot(): GamedayKind {
  if (gamedayCache === undefined) {
    try {
      gamedayCache = overriddenGameday(new URLSearchParams(window.location.search), new Date());
    } catch {
      gamedayCache = null;
    }
  }
  return gamedayCache;
}
export function useGameday(): GamedayKind {
  return useSyncExternalStore(noopSubscribe, gamedaySnapshot, () => null);
}

/* ---- the rundown (FUN-11) ------------------------------------------------ */

const RUNDOWN_KEY = "slate-rundown-seen";
const noopSubscribe = () => () => {};

function rundownStamp(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/* Decided once per page load and cached, so the snapshot is stable — the
   sessionStorage write happens in the hook's effect, never during render. */
let rundownFirstLoad: boolean | null = null;
function rundownSnapshot(): boolean {
  if (rundownFirstLoad === null) {
    try {
      const now = new Date();
      const day = overriddenGameday(new URLSearchParams(window.location.search), now);
      rundownFirstLoad = day !== null && sessionStorage.getItem(RUNDOWN_KEY) !== rundownStamp(now);
    } catch {
      rundownFirstLoad = false;
    }
  }
  return rundownFirstLoad;
}

/**
 * True exactly once per gameday session: the slate's first load on a Saturday
 * or Sunday (or under a `?funday=` preview), with Fun Mode's rundown on. The
 * useSyncExternalStore shape is what lets the server render "no" and the
 * client settle to "yes" without a hydration complaint — the theme idiom.
 */
export function useRundown(): boolean {
  const [prefs] = useFunPrefs();
  const firstLoad = useSyncExternalStore(noopSubscribe, rundownSnapshot, () => false);
  const on = funOn(prefs, "rundown") && firstLoad;
  useEffect(() => {
    if (!on) return;
    try {
      // A preview run stamps too — replaying it is one sessionStorage clear
      // (or a new tab) away, and an unstamped preview would fire on every
      // navigation back to the slate.
      sessionStorage.setItem(RUNDOWN_KEY, rundownStamp(new Date()));
    } catch {
      /* private mode */
    }
  }, [on]);
  return on;
}
