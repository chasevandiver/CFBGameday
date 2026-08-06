"use client";

/**
 * Supabase Realtime subscription to live `games` rows for one week.
 *
 * The scoreboard job writes scores/situation to Postgres; with `games` in the
 * supabase_realtime publication those UPDATEs stream here the moment they
 * land. Events respect RLS (games is authenticated-read), so the socket must
 * carry the user's JWT — without setAuth the server silently delivers
 * nothing, which is why the token is set explicitly and refreshed on auth
 * state changes.
 *
 * Callers keep their poller as a fallback: realtime only covers the live
 * columns, and a missed event heals on the next poll.
 */

import { useEffect, useRef, useState } from "react";
import type { GameRow } from "./db-types";
import { createClient } from "./supabase/client";

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
    const supabase = createClient();
    let cancelled = false;

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled && session) void supabase.realtime.setAuth(session.access_token);
    });
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) void supabase.realtime.setAuth(session.access_token);
    });

    const channel = supabase
      .channel(`games-week-${week}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "games", filter: `week=eq.${week}` },
        (payload) => {
          const row = payload.new as GameRow;
          // single-column filter above; season double-checked here
          if (row.season_id === seasonId) onUpdateRef.current(row);
        },
      )
      .subscribe((status) => {
        if (!cancelled) setConnected(status === "SUBSCRIBED");
      });

    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
      void supabase.removeChannel(channel);
      setConnected(false);
    };
  }, [enabled, week, seasonId]);

  return { connected };
}
