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

  /* UX-34 — the marquee's two measurements.
     `still` is whether there is anything to scroll past: one copy of the chips
     narrower than the frame has nowhere to go, and sliding it would be motion
     for its own sake. `duration` holds the speed constant in px/sec, so a
     sixty-game Saturday travels further rather than faster.
     Measured after paint from the real laid-out width — the chips are variable
     width (an NFL tag, a live dot, a four-letter abbreviation) and estimating
     from `games.length` would drift. Re-measured on resize and whenever the
     game list changes, which a poll can do every 30 seconds. */
  const trackRef = useRef<HTMLDivElement>(null);
  const [still, setStill] = useState(true);
  const [held, setHeld] = useState(false);
  const [duration, setDuration] = useState(40);
  useEffect(() => {
    const measure = () => {
      const track = trackRef.current;
      // The viewport, not the sticky wrapper: the wrapper is full-bleed while
      // the strip inside it is capped at max-w-7xl, so measuring the wrapper
      // would call a full desktop ticker "fits" and leave it motionless.
      const frame = track?.parentElement;
      if (!track || !frame) return;
      // The track holds one copy while `still`, two once it scrolls; either
      // way the first copy is the unit of travel.
      const copy = track.firstElementChild as HTMLElement | null;
      const contentWidth = copy?.scrollWidth ?? 0;
      const fits = contentWidth <= frame.clientWidth;
      setStill(fits);
      // ~55 px/sec: slow enough to read a score in passing, quick enough that
      // a game at the far end comes round inside a commercial break.
      if (!fits) setDuration(Math.max(20, Math.round(contentWidth / 55)));
    };

    /* A ResizeObserver, not a dependency on the game COUNT. Chip width moves a
       long way without the count changing: "7:00 PM" becomes "1st 12:43" at
       kickoff, and each score adds glyphs to both sides. A five-game strip
       measured as fitting before kickoff would have stayed `still` once the
       clocks appeared — and since the track is then `width:100%`, the chips
       `shrink-0` and the viewport clipped, the overflow would have been
       unreachable: no animation and no swipe. It also fixes the narrower
       version of the same bug, measuring before webfonts settle. */
    const copy = trackRef.current?.firstElementChild;
    const ro = new ResizeObserver(measure);
    if (copy) ro.observe(copy);
    measure();
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [data]);

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

  const chips = (ariaHidden: boolean) => (
    <div className="flex shrink-0 items-center gap-1 px-2" aria-hidden={ariaHidden || undefined}>
      {data.games.map((g) =>
        isDemo ? (
          <span key={g.id} className={chipClass(g.mine)}>
            <ChipBody g={g} />
          </span>
        ) : (
          <Link
            key={g.id}
            href={`/game/${g.id}`}
            /* The duplicate copy exists for the seamless wrap, not for the
               reader — it is aria-hidden and untabbable, so Tab walks the
               games once. */
            tabIndex={ariaHidden ? -1 : undefined}
            className={`${chipClass(g.mine)} transition-colors hover:bg-surface hover:text-chalk`}
          >
            <ChipBody g={g} />
          </Link>
        ),
      )}
    </div>
  );

  return (
    <div
      ref={stripRef}
      className="sticky top-12 z-[15] border-b border-chalk/10 bg-background/85 backdrop-blur-md"
    >
      <div className="ticker-viewport scroll-thin mx-auto max-w-7xl py-1">
        <div
          ref={trackRef}
          className="ticker-track"
          data-still={still ? "1" : undefined}
          data-held={held ? "1" : undefined}
          /* Constant speed rather than constant duration: 60 chips on a
             Saturday would otherwise blur past at twelve times the pace of
             five on a Tuesday. */
          style={{ "--ticker-duration": `${duration}s` } as React.CSSProperties}
          /* Pointer CAPTURE, not a bare pointerup. Touch captures implicitly so
             it was fine; a mouse does not — press on a chip, drag off the strip,
             release, and the pointerup targets something else, `held` never
             clears, and the marquee is paused for the rest of the session. */
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setHeld(true);
          }}
          onPointerUp={() => setHeld(false)}
          onPointerCancel={() => setHeld(false)}
          onLostPointerCapture={() => setHeld(false)}
        >
          {chips(false)}
          {!still && chips(true)}
        </div>
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

/**
 * Which side the ticker should brighten.
 *
 * Only once there is a score to read: a scheduled game has no leader, and a tie
 * has two. Ties are rare in the NFL and impossible in CFB, but "highlight the
 * one in front" has to answer for them, and highlighting both would say the
 * opposite of what a tie is. Null means nobody is picked out and the chip reads
 * exactly as it did before.
 */
export function leadingSide(g: TickerGame): "home" | "away" | null {
  if (g.status !== "in_progress" && g.status !== "final") return null;
  const h = g.homePoints ?? 0;
  const a = g.awayPoints ?? 0;
  if (h === a) return null;
  return h > a ? "home" : "away";
}

/* Weight and brightness, not colour: the ticker already spends colour on the
   viewer's own verdict (the `mine` underline), and a second hue on the same
   chip would be two signals competing at 11px. */
const sideClass = (leading: "home" | "away" | null, side: "home" | "away"): string =>
  leading === null
    ? "font-medium text-chalk"
    : leading === side
      ? "font-bold text-chalk"
      : "font-medium text-chalk/45";

function ChipBody({ g }: { g: TickerGame }) {
  const live = g.status === "in_progress";
  const final = g.status === "final";
  const leading = leadingSide(g);
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
      <span className={sideClass(leading, "away")}>
        {g.awayAbbr} {live || final ? (g.awayPoints ?? 0) : ""}
      </span>
      <span className="text-chalk/30">–</span>
      <span className={sideClass(leading, "home")}>
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
