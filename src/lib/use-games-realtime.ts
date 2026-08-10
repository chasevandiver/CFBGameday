"use client";

/**
 * Supabase Realtime subscription to live `games` rows for one week.
 *
 * The scoreboard job writes scores/situation to Postgres; with `games` in the
 * supabase_realtime publication those UPDATEs stream here the moment they
 * land. `games` is public-read (migration 0011), so anon viewers receive
 * events on the anon key too — `setAuth` is only needed to upgrade the socket
 * when a session exists, and it is refreshed on auth state changes.
 *
 * ONE channel per (season, week) per browser tab, refcounted: SlateView and
 * ScoreTicker both ride this hook, and two subscriptions meant every UPDATE
 * was delivered — and billed — twice per tab (audit 09/P-2b). Callers keep
 * their poller as a fallback: realtime only covers the live columns, and a
 * missed event heals on the next poll.
 */

import { useEffect, useRef, useState } from "react";
import type { GameRow } from "./db-types";
import { createClient } from "./supabase/client";

type Listener = (row: GameRow) => void;

interface SharedChannel {
  refs: number;
  connected: boolean;
  listeners: Set<Listener>;
  statusListeners: Set<(connected: boolean) => void>;
  teardown: () => void;
}

const shared = new Map<string, SharedChannel>();

function acquire(seasonId: number, week: number): SharedChannel {
  const key = `games-${seasonId}-${week}`;
  const existing = shared.get(key);
  if (existing) {
    existing.refs++;
    return existing;
  }

  const supabase = createClient();
  const entry: SharedChannel = {
    refs: 1,
    connected: false,
    listeners: new Set(),
    statusListeners: new Set(),
    teardown: () => {},
  };

  void supabase.auth.getSession().then(({ data: { session } }) => {
    if (shared.get(key) === entry && session)
      void supabase.realtime.setAuth(session.access_token);
  });
  const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session) void supabase.realtime.setAuth(session.access_token);
  });

  const channel = supabase
    .channel(key)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "games", filter: `week=eq.${week}` },
      (payload) => {
        const row = payload.new as GameRow;
        // single-column filter above; season double-checked here
        if (row.season_id !== seasonId) return;
        for (const l of entry.listeners) l(row);
      },
    )
    .subscribe((status) => {
      entry.connected = status === "SUBSCRIBED";
      for (const l of entry.statusListeners) l(entry.connected);
    });

  entry.teardown = () => {
    authSub.subscription.unsubscribe();
    void supabase.removeChannel(channel);
    shared.delete(key);
  };
  shared.set(key, entry);
  return entry;
}

export function useGamesRealtime({
  enabled,
  week,
  seasonId,
  onGameUpdate,
}: {
  enabled: boolean;
  week: number;
  seasonId: number;
  onGameUpdate: (row: GameRow) => void;
}): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const onUpdateRef = useRef(onGameUpdate);
  useEffect(() => {
    onUpdateRef.current = onGameUpdate;
  }, [onGameUpdate]);

  useEffect(() => {
    if (!enabled) return;
    const entry = acquire(seasonId, week);
    const listener: Listener = (row) => onUpdateRef.current(row);
    const statusListener = (c: boolean) => setConnected(c);
    entry.listeners.add(listener);
    entry.statusListeners.add(statusListener);
    // A second consumer joining an already-SUBSCRIBED channel gets no fresh
    // status event, so it has to be told the current value once — but doing
    // that in the effect body is a synchronous cascading render.
    queueMicrotask(() => statusListener(entry.connected));

    return () => {
      entry.listeners.delete(listener);
      entry.statusListeners.delete(statusListener);
      setConnected(false);
      if (--entry.refs === 0) entry.teardown();
    };
  }, [enabled, week, seasonId]);

  return { connected };
}
