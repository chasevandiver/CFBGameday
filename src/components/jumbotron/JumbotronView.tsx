"use client";

import { ArrowLeft, SkipForward } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useViewerTz } from "../../lib/client-store";
import type { GameRow } from "../../lib/db-types";
import { nextFeatured, nextKickoffBoard } from "../../lib/jumbotron";
import { DEFAULT_TZ, kickParts } from "../../lib/kick";
import { isLive, type GameView, type SlateData } from "../../lib/slate";
import { useGamesRealtime } from "../../lib/use-games-realtime";
import { useLiveRefresh } from "../../lib/use-live-refresh";
import { useWakeLock } from "../../lib/use-wake-lock";
import { JumbotronCard } from "./JumbotronCard";
import { JumbotronRail } from "./JumbotronRail";

/**
 * The Jumbotron (R5-A): the leave-it-running stadium board. Featured game
 * huge, the rest on a rail, rotating on the reducer in `lib/jumbotron.ts` —
 * a red-zone trip or a closing one-score game takes the screen immediately.
 *
 * Data is the Live view's own diet: the 30s healing poll of
 * `/api/slate?sport=live` is the backbone (the cross-league view's realtime
 * has always really been the poll — see fetchLiveSlate), plus one refcounted
 * realtime channel per (season, week) bucket the payload now names, so a
 * score lands the moment the scoreboard job writes it. Wake lock keeps the
 * screen alive; the demo flag kills everything that reaches the network.
 */

function BucketRealtime({
  seasonId,
  week,
  enabled,
  onRow,
}: {
  seasonId: number;
  week: number;
  enabled: boolean;
  onRow: (row: GameRow) => void;
}) {
  useGamesRealtime({ enabled, seasonId, week, onGameUpdate: onRow });
  return null;
}

export function JumbotronView({
  initial,
  upcoming,
  demo = false,
}: {
  initial: SlateData;
  /** Scheduled games for the countdown board when nothing is live. */
  upcoming: GameView[];
  demo?: boolean;
}) {
  const tz = useViewerTz(DEFAULT_TZ);
  const [data, setData] = useState<SlateData>(initial);
  const [featuredId, setFeaturedId] = useState<number | null>(null);
  const featRef = useRef<number | null>(null);
  // Seeded 0 (render must stay pure); the first tick stamps the real clock.
  const heldRef = useRef(0);
  const gamesRef = useRef<GameView[]>(initial.games);

  useWakeLock();

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    () =>
      void fetch("/api/slate?sport=live", { cache: "no-store" })
        .then(async (res) => {
          if (res.ok && mounted.current) setData((await res.json()) as SlateData);
        })
        .catch(() => {
          /* transient network error — next poll retries */
        }),
    [],
  );
  useLiveRefresh(load, 30_000, !demo);

  const handleRow = useCallback((row: GameRow) => {
    setData((d) => ({
      ...d,
      games: d.games.map((g) =>
        g.id === row.id
          ? {
              ...g,
              status: row.status,
              homePoints: row.home_points,
              awayPoints: row.away_points,
              period: row.current_period,
              clock: row.current_clock,
              situation: row.current_situation,
              lastPlay: row.last_play,
              possession: row.possession,
            }
          : g,
      ),
    }));
  }, []);

  /* The rotation clock: one 1s tick evaluating the reducer against the
     freshest games (mirrored into a ref by the effect below, so the interval
     never closes over stale data). State only changes when the feature does. */
  useEffect(() => {
    gamesRef.current = data.games;
  }, [data.games]);
  useEffect(() => {
    const tick = () => {
      const res = nextFeatured(featRef.current, gamesRef.current, Date.now() - heldRef.current);
      if (res.id !== featRef.current) {
        featRef.current = res.id;
        heldRef.current = Date.now();
        setFeaturedId(res.id);
      }
    };
    tick();
    const t = setInterval(tick, 1_000);
    return () => clearInterval(t);
  }, []);

  const advance = () => {
    const res = nextFeatured(featRef.current, gamesRef.current, Number.MAX_SAFE_INTEGER);
    if (res.id !== featRef.current) {
      featRef.current = res.id;
      heldRef.current = Date.now();
      setFeaturedId(res.id);
    }
  };

  const liveGames = data.games.filter(isLive);
  const featured = liveGames.find((g) => g.id === featuredId) ?? liveGames[0] ?? null;
  const rail = liveGames.filter((g) => g.id !== featured?.id);
  const board = featured === null ? nextKickoffBoard(upcoming, data.fetchedAt) : [];

  return (
    <div
      className="brand-surface bg-background flex min-h-dvh flex-col"
      style={{
        paddingTop: "max(env(safe-area-inset-top), 12px)",
        paddingBottom: "max(env(safe-area-inset-bottom), 12px)",
        paddingLeft: "max(env(safe-area-inset-left), 16px)",
        paddingRight: "max(env(safe-area-inset-right), 16px)",
      }}
    >
      <header className="flex items-center justify-between gap-2 pb-2">
        <Link
          href={demo ? "/demo/slate" : "/slate"}
          className="flex min-h-11 items-center gap-1.5 text-xs text-dim hover:text-chalk"
        >
          <ArrowLeft size={13} aria-hidden /> Slate
        </Link>
        <h1 className="text-sm text-chalk/70">Jumbotron</h1>
        {rail.length > 0 ? (
          <button
            onClick={advance}
            className="flex min-h-11 items-center gap-1.5 text-xs text-dim hover:text-chalk"
          >
            Next <SkipForward size={13} aria-hidden />
          </button>
        ) : (
          <span className="min-h-11 w-14" aria-hidden />
        )}
      </header>

      {featured ? (
        <div className="flex flex-1 flex-col gap-4 landscape:grid landscape:grid-cols-[2fr_1fr] landscape:items-start">
          {/* keyed swap: the feature changing is a cut, softened by fade-swap */}
          <div key={featured.id} className="fade-swap flex-1">
            <JumbotronCard game={featured} demo={demo} />
          </div>
          <JumbotronRail games={rail} demo={demo} />
        </div>
      ) : (
        <section aria-label="Next kickoffs" className="flex flex-1 flex-col justify-center">
          <p className="stat text-center text-[11px] uppercase tracking-[0.2em] text-dim">
            Nothing is live · next kickoffs
          </p>
          {board.length === 0 ? (
            <p className="mt-4 text-center text-sm text-dim">
              The week&rsquo;s board is empty — check back closer to gameday.
            </p>
          ) : (
            <ul className="mx-auto mt-5 w-full max-w-md space-y-2">
              {board.map((g) => (
                <li key={g.id} className="flex min-h-11 items-center justify-between gap-3">
                  <span className="scorebug text-lg text-chalk">
                    {g.away.abbr} <span className="text-chalk/40">at</span> {g.home.abbr}
                  </span>
                  <span className="stat text-sm text-dim">
                    {g.startTs ? `${kickParts(g.startTs, tz).day} ${kickParts(g.startTs, tz).time}` : "TBD"}
                    {g.tv ? ` · ${g.tv}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!demo &&
        (data.buckets ?? []).map((b) => (
          <BucketRealtime
            key={`${b.seasonId}:${b.week}`}
            seasonId={b.seasonId}
            week={b.week}
            enabled={liveGames.length > 0}
            onRow={handleRow}
          />
        ))}
    </div>
  );
}
