"use client";

/**
 * Slim gameday score strip, sticky under the nav (docs/SPEC.md §7). Renders
 * nothing outside game windows — /api/ticker only returns live games, recent
 * finals, and imminent kickoffs. Polls every 60s and rides the realtime
 * channel for instant score updates while anything is live.
 *
 * A signed-in viewer's games carry `mine`: a verdict-coloured underline in the
 * aura's vocabulary (green covering, red not, amber on the number, plain chalk
 * for action that has no verdict yet), so the strip reads like a broadcast
 * ticker that knows where your money is.
 *
 * In demo mode (`demo` prop) the ticker is the sample slate's: no fetch, no
 * realtime channel — nothing that reaches past the page — and the chips don't
 * link, because /game/:id doesn't exist for invented games.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { periodLabel } from "../lib/kick";
import type { TickerData, TickerGame, TickerMine } from "../lib/ticker";
import { useGamesRealtime } from "../lib/use-games-realtime";
import { useLiveRefresh } from "../lib/use-live-refresh";

const MINE_WORDS: Record<TickerMine, string> = {
  covering: "Your side is covering.",
  losing: "Your side is not covering.",
  push: "Your side is on the number.",
  on: "You have action on this game.",
};

export function ScoreTicker({ demo }: { demo?: TickerData }) {
  const [data, setData] = useState<TickerData | null>(demo ?? null);
  const stripRef = useRef<HTMLDivElement>(null);

  // The ticker is sticky under the nav; anything else sticky (the slate's
  // control bar) offsets below it via --ticker-h, which tracks the ticker's
  // real height and drops to 0 when it hides (audit #17: the control bar
  // used to assume no ticker and sandwich it).
  const visible = (data?.games.length ?? 0) > 0;
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--ticker-h",
      visible ? `${stripRef.current?.offsetHeight ?? 30}px` : "0px",
    );
    return () => {
      root.style.setProperty("--ticker-h", "0px");
    };
  }, [visible]);

  const isDemo = demo !== undefined;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // async subscription to an external system: state updates land in the
  // fetch callback, never synchronously in the effect body
  const load = useCallback(
    () =>
      void fetch("/api/ticker", { cache: "no-store" })
        .then(async (res) => {
          if (res.ok && mounted.current) setData((await res.json()) as TickerData);
        })
        .catch(() => {
          /* transient network error — next poll retries */
        }),
    [],
  );

  useEffect(() => {
    if (isDemo) return; // demo data arrived as a prop; nothing to fetch
    load();
  }, [isDemo, load]);

  const anyLive = data?.games.some((g) => g.status === "in_progress") ?? false;
  // Same wall-clock poller as the slate, so the strip is current the moment the
  // page is looked at again rather than up to a minute later.
  useLiveRefresh(load, anyLive ? 30_000 : 60_000, !isDemo);
  useGamesRealtime({
    enabled: !isDemo && anyLive && data !== null,
    week: data?.week ?? 0,
    seasonId: data?.seasonId ?? 0,
    onGameUpdate: (row) => {
      setData((d) =>
        d === null
          ? d
          : {
              ...d,
              games: d.games.map((g) =>
                g.id === row.id
                  ? {
                      ...g,
                      status: row.status,
                      period: row.current_period,
                      clock: row.current_clock,
                      homePoints: row.home_points,
                      awayPoints: row.away_points,
                    }
                  : g,
              ),
            },
      );
    },
  });

  if (!data || data.games.length === 0) return null;

  return (
    <div
      ref={stripRef}
      className="sticky top-12 z-[15] border-b border-chalk/10 bg-background/85 backdrop-blur-md"
    >
      <div className="scroll-thin mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4 py-1">
        {data.games.map((g) =>
          isDemo ? (
            <span key={g.id} className={chipClass(g.mine)}>
              <ChipBody g={g} />
            </span>
          ) : (
            <Link
              key={g.id}
              href={`/game/${g.id}`}
              className={`${chipClass(g.mine)} transition-colors hover:bg-surface hover:text-chalk`}
            >
              <ChipBody g={g} />
            </Link>
          ),
        )}
      </div>
    </div>
  );
}

/* The mine underline is a box-shadow, not a border, so a verdict appearing
   mid-drive cannot shift the strip's layout by a pixel. */
const chipClass = (mine: TickerGame["mine"]): string =>
  `stat flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] leading-none text-dim ${
    mine ? `ticker-mine-${mine}` : ""
  }`;

function ChipBody({ g }: { g: TickerGame }) {
  const live = g.status === "in_progress";
  const final = g.status === "final";
  return (
    <>
      {live && (
        <span aria-label="Live" className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-live" />
      )}
      {/* colour is never alone: the underline's read, in words */}
      {g.mine && <span className="sr-only">{MINE_WORDS[g.mine]}</span>}
      {g.sport === "nfl" && (
        <span className="text-[9px] font-semibold uppercase tracking-wider text-chalk/40">
          NFL
        </span>
      )}
      <span className="font-medium text-chalk">
        {g.awayAbbr} {live || final ? (g.awayPoints ?? 0) : ""}
      </span>
      <span className="text-chalk/30">–</span>
      <span className="font-medium text-chalk">
        {g.homeAbbr} {live || final ? (g.homePoints ?? 0) : ""}
      </span>
      <span className="text-[10px] uppercase">
        {live
          ? `${periodLabel(g.period)}${g.clock ? ` ${g.clock}` : ""}`
          : final
            ? "Final"
            : g.startTs
              ? new Intl.DateTimeFormat("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                }).format(new Date(g.startTs))
              : ""}
      </span>
    </>
  );
}
