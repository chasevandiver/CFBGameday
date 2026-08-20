"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useViewerTz } from "../../lib/client-store";
import { funOn, overriddenGameday, useFunPrefs, type GamedayKind } from "../../lib/fun-mode";
import { DEFAULT_TZ, kickParts } from "../../lib/kick";
import { seasonYearOf } from "../../lib/league";
import { fmtSpread, pickHero, type GameView, type SlateData } from "../../lib/slate";

/**
 * The Cover (FUN-8): on a gameday morning, the site opens as the front of a
 * gameday program — masthead, issue line, the marquee matchup as the cover
 * story — once, and a tap puts it away until next week.
 *
 * A client island over the hub, not a route: it draws on `.brand-surface`
 * (the identity palette pinned to an element, the `/welcome` idiom), fetches
 * the current slate from the same `/api/slate` the board polls, and computes
 * the cover story with the slate's own `pickHero`. Nothing new is asked of
 * the server. Signed-out visitors get it too — the week's shape is public.
 *
 * Once per gameday per device (`slate-cover-seen`). A `?funday=` preview
 * never writes the stamp, so posing a Saturday on a Tuesday stays repeatable.
 */

const SEEN_KEY = "slate-cover-seen";

function stampFor(kind: GamedayKind, d: Date): string {
  return `${kind}:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Earliest kickoff still ahead, or null once the day is under way. */
function firstKick(games: GameView[], now: Date): string | null {
  let min: string | null = null;
  for (const g of games) {
    if (!g.startTs || new Date(g.startTs) <= now) continue;
    if (min === null || g.startTs < min) min = g.startTs;
  }
  return min;
}

function TeamLine({ team }: { team: GameView["home"] }) {
  return (
    <p className="display text-4xl leading-[1.05] text-chalk sm:text-6xl">
      {team.pollRank !== null && (
        <span className="mr-2 align-top text-lg text-accent sm:text-2xl">{team.pollRank}</span>
      )}
      {team.school}
    </p>
  );
}

export function GamedayCover() {
  const [prefs] = useFunPrefs();
  const tz = useViewerTz(DEFAULT_TZ);
  const [slate, setSlate] = useState<SlateData | null>(null);
  const [kind, setKind] = useState<GamedayKind>(null);
  const [preview, setPreview] = useState(false);
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const coverOn = funOn(prefs, "cover");

  useEffect(() => {
    if (!coverOn) return;
    const now = new Date();
    const search = new URLSearchParams(window.location.search);
    const day = overriddenGameday(search, now);
    if (!day) return;
    const isPreview = search.has("funday");
    if (!isPreview) {
      try {
        if (localStorage.getItem(SEEN_KEY) === stampFor(day, now)) return;
      } catch {
        /* private mode: show it, the stamp just won't stick */
      }
    }
    let alive = true;
    (async () => {
      const res = await fetch(`/api/slate?sport=${day}`);
      if (!res.ok) return;
      const data = (await res.json()) as SlateData;
      if (!alive || data.games.length === 0) return;
      setSlate(data);
      setKind(day);
      setPreview(isPreview);
      setOpen(true);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [coverOn]);

  const dismiss = useCallback(() => {
    setOpen(false);
    if (!preview && kind) {
      try {
        localStorage.setItem(SEEN_KEY, stampFor(kind, new Date()));
      } catch {
        /* private mode */
      }
    }
  }, [preview, kind]);

  // The cover is a full-screen sheet; the page under it must not scroll away.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, dismiss]);

  if (!open || !slate || !kind) return null;
  const hero = pickHero(slate.games);
  if (!hero) return null;

  const now = new Date(slate.fetchedAt);
  const kick = firstKick(slate.games, now);
  const heroKick = hero.startTs ? kickParts(hero.startTs, tz) : null;
  const spread = hero.lines.spread;
  const w = hero.dome ? null : hero.weather;
  const showWeather = w !== null && (w.tempF !== null || w.windMph !== null);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={kind === "nfl" ? "Sunday program cover" : "Saturday program cover"}
      className="brand-surface bg-background fade-swap fixed inset-0 z-[80] flex flex-col overflow-y-auto"
      onClick={dismiss}
      style={{
        paddingTop: "max(env(safe-area-inset-top), 20px)",
        paddingBottom: "max(env(safe-area-inset-bottom), 20px)",
      }}
    >
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-6">
        {/* masthead */}
        <header className="pt-6 text-center">
          <p className="stat text-[10px] uppercase tracking-[0.24em] text-dim">
            {kind === "nfl" ? "Sunday edition" : "Saturday program"} · Vol. {seasonYearOf(slate.seasonId)} ·
            No. {slate.week}
          </p>
          <h1 className="mt-3 text-5xl leading-none text-chalk sm:text-6xl">The Slate</h1>
          <div className="mx-auto mt-5 w-full border-t-2 border-accent/80" aria-hidden />
          <div className="mx-auto mt-[3px] w-full border-t border-chalk/20" aria-hidden />
        </header>

        {/* cover story */}
        <section className="flex flex-1 flex-col justify-center py-10 text-center">
          <p className="stat text-[10px] uppercase tracking-[0.24em] text-accent">Cover story</p>
          <div className="mt-4 space-y-1.5">
            <TeamLine team={hero.away} />
            <p className="stat text-sm uppercase tracking-[0.2em] text-dim">
              {hero.neutralSite ? "vs" : "at"}
            </p>
            <TeamLine team={hero.home} />
          </div>
          <p className="stat mt-5 text-sm text-chalk">
            {spread !== null && (
              <>
                {hero.home.abbr} {fmtSpread(spread)}
                {" · "}
              </>
            )}
            {heroKick ? `${heroKick.day} ${heroKick.time}` : "TBD"}
            {hero.tv ? ` · ${hero.tv}` : ""}
          </p>
          {showWeather && w && (
            <p className="stat mt-1.5 text-xs text-dim">
              {w.tempF !== null ? `${Math.round(w.tempF)}°` : ""}
              {w.windMph !== null && w.windMph >= 10 ? ` · ${Math.round(w.windMph)} mph wind` : ""}
              {w.precipProb !== null && w.precipProb >= 30 ? ` · ${Math.round(w.precipProb)}% precip` : ""}
            </p>
          )}
        </section>

        {/* the day, then the way in */}
        <footer className="pb-4 text-center">
          <div className="mx-auto w-full border-t border-chalk/20" aria-hidden />
          <p className="stat mt-4 text-xs uppercase tracking-[0.14em] text-dim">
            {kick
              ? `First kick ${kickParts(kick, tz).time}`
              : slate.games.some((g) => g.status === "in_progress")
                ? "Games are live"
                : "The day is under way"}
            {" · "}
            {slate.games.length} games on the slate
          </p>
          <button
            ref={closeRef}
            onClick={dismiss}
            className="mt-4 min-h-11 w-full rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90"
          >
            Open the slate
          </button>
        </footer>
      </div>
    </div>
  );
}
