"use client";

/**
 * The card strip for the Fire TV overlay (/tv/cards, TV-8).
 *
 * A continuous crawl stutters over live video on Fire TV hardware, web or
 * native (TV-5, TV-7). Cards don't move: a page of games holds for a few
 * seconds, then the next page fades in. That also buys room for detail a
 * crawl can't carry: who has the ball, down and distance, and where on the
 * field. The viewer's own games come first, then everything else.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TickerGame } from "../../lib/ticker";
import { fieldPosition, isRedZone, parseSituation } from "../../lib/slate";
import { leadingSide } from "../ScoreTicker";
import { lineClass, teamClass, tvLine, tvStatus, VerdictWords } from "./TvChip";
import { useTickerFeed } from "./use-ticker-feed";

const HOLD_MS = 7_000;
const FADE_MS = 260;

/**
 * Greedy pages: as many cards as fit the strip, in order. A live card with
 * down, distance and the field is wide; a final or an upcoming game is short,
 * so those pair up. A card wider than the strip still gets a page of its own.
 */
export function packPages(widths: number[], room: number): number[][] {
  const pages: number[][] = [];
  let cur: number[] = [];
  let used = 0;
  widths.forEach((w, i) => {
    if (cur.length > 0 && used + w > room) {
      pages.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(i);
    used += w;
  });
  if (cur.length > 0) pages.push(cur);
  return pages;
}

/** Your games (live, next, final), then everyone else's in the same order. */
export function cardOrder(games: TickerGame[]): TickerGame[] {
  const status = (g: TickerGame) =>
    g.status === "in_progress" ? 0 : g.status === "scheduled" ? 1 : 2;
  return [...games].sort(
    (a, b) =>
      (a.mine ? 0 : 1) - (b.mine ? 0 : 1) ||
      status(a) - status(b) ||
      (a.startTs ?? "").localeCompare(b.startTs ?? ""),
  );
}

const DOWN = ["", "1st", "2nd", "3rd", "4th"];

/** "2nd & 7 · MOH 34", or the raw string when it doesn't parse. */
function situationText(s: string | null | undefined): string | null {
  if (!s) return null;
  const p = parseSituation(s);
  if (!p) return s;
  const dist = p.distance === "Goal" ? "Goal" : p.distance;
  const spot = p.sideToken ? `${p.sideToken} ${p.yardLine}` : "50";
  return `${DOWN[p.down] ?? p.down} & ${dist} · ${spot}`;
}

export function TvCards() {
  const data = useTickerFeed();
  const games = data ? cardOrder(data.games) : [];

  const areaRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<number[][]>([]);
  // Re-pack whenever what the cards say could change their width.
  const signature = games
    .map((g) => `${g.id}:${g.status}:${g.situation ?? ""}:${g.possession ?? ""}:${g.mine ?? ""}`)
    .join("|");
  useLayoutEffect(() => {
    const pack = () => {
      const area = areaRef.current;
      const meas = measureRef.current;
      if (!area || !meas) return;
      const widths = Array.from(meas.children).map((c) => (c as HTMLElement).offsetWidth);
      setLayout(packPages(widths, area.clientWidth));
    };
    pack();
    window.addEventListener("resize", pack);
    return () => window.removeEventListener("resize", pack);
  }, [signature]);

  const pages = Math.max(1, layout.length);
  const [tick, setTick] = useState(0);
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (pages < 2) return;
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    const t = setInterval(() => {
      setFading(true);
      fadeTimer = setTimeout(() => {
        setTick((n) => n + 1);
        setFading(false);
      }, FADE_MS);
    }, HOLD_MS);
    return () => {
      clearInterval(t);
      if (fadeTimer) clearTimeout(fadeTimer);
    };
  }, [pages]);
  // Derived, so a poll that shrinks the list can't strand us on a dead page.
  const page = tick % pages;
  const shown = (layout[page] ?? []).map((i) => games[i]).filter(Boolean);

  return (
    <main className="tv-strip tv-panel tv-cards">
      <div className="tv-brand">
        <span>THE SLATE</span>
        {data && <span className="tv-week">WK {data.week}</span>}
      </div>
      {/* Off-screen copy of every card at its natural width, for packing. */}
      <div className="tv-card-measure" ref={measureRef} aria-hidden>
        {games.map((g) => (
          <Card key={g.id} g={g} />
        ))}
      </div>
      <div className="tv-card-area" ref={areaRef} data-fading={fading ? "1" : undefined}>
        {shown.length === 0 ? (
          <span className="tv-empty">{data ? "No games on right now" : "Loading scores"}</span>
        ) : (
          shown.map((g) => <Card key={g.id} g={g} />)
        )}
      </div>
      {pages > 1 && (
        <div className="tv-card-count stat" aria-hidden>
          {page + 1}/{pages}
        </div>
      )}
    </main>
  );
}

function Card({ g }: { g: TickerGame }) {
  const live = g.status === "in_progress";
  const scored = live || g.status === "final";
  const lead = leadingSide(g);
  const line = tvLine(g);
  const view = {
    status: g.status,
    possession: g.possession ?? null,
    situation: g.situation ?? null,
    home: { abbr: g.homeAbbr },
    away: { abbr: g.awayAbbr },
  };
  const spot = live ? fieldPosition(view) : null;
  const redZone = live && isRedZone(view);
  const sit = live ? situationText(g.situation) : null;

  const team = (abbr: string, pts: number | null, s: "home" | "away") => (
    <span className={`tv-card-team ${teamClass(g, s)}`}>
      {g.possession === s && <Ball />}
      <span style={{ fontWeight: lead === s ? 700 : 500 }}>{abbr}</span>
      {scored && <span className="stat">{pts ?? 0}</span>}
    </span>
  );

  return (
    <div className="tv-card" data-mine={g.mine ? "1" : undefined}>
      {g.sport === "nfl" && <span className="tv-tag">NFL</span>}
      {team(g.awayAbbr, g.awayPoints, "away")}
      {team(g.homeAbbr, g.homePoints, "home")}
      {line && <span className={`tv-line stat ${lineClass(g, line.mine)}`}>{line.text}</span>}
      <span className={`tv-status stat ${live ? "text-live" : "text-dim"}`}>{tvStatus(g)}</span>
      {sit && (
        <span className={`tv-card-sit ${redZone ? "text-live" : "text-chalk/80"}`}>{sit}</span>
      )}
      {spot && <Field x={spot.x} dir={spot.dir} redZone={redZone} />}
      <VerdictWords g={g} />
    </div>
  );
}

/** Possession marker, drawn in em so it scales with the strip. */
function Ball() {
  return (
    <svg className="tv-ball" viewBox="0 0 17 11" aria-label="has the ball" role="img">
      <ellipse cx="8.5" cy="5.5" rx="7.8" ry="4.7" fill="#9A6430" stroke="#5C3A18" strokeWidth="0.8" />
      <path
        d="M5.4 5.5h6.2M6.9 4.2v2.6M8.5 4.2v2.6M10.1 4.2v2.6"
        stroke="#F4EFE6"
        strokeWidth="0.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A tiny field: away end zone left, home right, the ball where it sits. */
function Field({ x, dir, redZone }: { x: number; dir: "left" | "right"; redZone: boolean }) {
  return (
    <span className="tv-field" data-red={redZone ? "1" : undefined} aria-hidden>
      <span className="tv-field-mid" />
      <span className="tv-field-ball" data-dir={dir} style={{ left: `${7 + x * 0.86}%` }} />
    </span>
  );
}
