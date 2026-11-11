"use client";

/**
 * The card strip for the Fire TV overlay (/tv/cards, TV-8, TV-9).
 *
 * A continuous crawl stutters over live video on Fire TV hardware, web or
 * native (TV-5, TV-7). Cards don't move: a page of games holds for a few
 * seconds, then the next page fades in. That buys room for detail a crawl
 * can't carry: who has the ball, down and distance, where on the field, and
 * both numbers. Order: the viewer's summary, their games, then everyone else.
 *
 * When one of the viewer's games scores, that game takes the whole strip for
 * a few seconds (TV-9), then the rotation picks up where it was.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TickerGame, TickerSummary } from "../../lib/ticker";
import { fieldPosition, isRedZone, parseSituation } from "../../lib/slate";
import { leadingSide } from "../ScoreTicker";
import { lineClass, marketSpread, teamClass, tvStatus, VerdictWords } from "./TvChip";
import { useTickerFeed } from "./use-ticker-feed";

const HOLD_MS = 7_000;
const FADE_MS = 260;
const ALERT_MS = 9_000;

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

export interface ScoreAlert {
  gameId: number;
  side: "home" | "away";
  label: string;
  key: number;
}

/** What a jump in one team's points most likely was, from the size of the jump. */
export function scoreLabel(delta: number): string {
  if (delta >= 6) return "TOUCHDOWN";
  if (delta === 3) return "FIELD GOAL";
  if (delta === 2) return "SAFETY";
  if (delta === 1) return "EXTRA POINT";
  return "SCORE";
}

/**
 * Scores that moved on the viewer's games between two polls. The first poll
 * after load has nothing to compare with and announces nothing.
 */
export function newScores(
  prev: Map<number, { h: number; a: number }> | null,
  games: TickerGame[],
  key: number,
): ScoreAlert[] {
  if (!prev) return [];
  const out: ScoreAlert[] = [];
  for (const g of games) {
    if (!g.mine || (g.status !== "in_progress" && g.status !== "final")) continue;
    const p = prev.get(g.id);
    if (!p) continue;
    const dh = (g.homePoints ?? 0) - p.h;
    const da = (g.awayPoints ?? 0) - p.a;
    if (da > 0)
      out.push({ gameId: g.id, side: "away", label: scoreLabel(da), key: key + out.length });
    if (dh > 0)
      out.push({ gameId: g.id, side: "home", label: scoreLabel(dh), key: key + out.length });
  }
  return out;
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

type Item = { kind: "summary"; s: TickerSummary } | { kind: "game"; g: TickerGame };

export function TvCards() {
  const data = useTickerFeed();
  const games = data ? cardOrder(data.games) : [];
  const items: Item[] = [
    ...(data?.summary ? [{ kind: "summary" as const, s: data.summary }] : []),
    ...games.map((g) => ({ kind: "game" as const, g })),
  ];

  // ── Scoring alerts ──────────────────────────────────────────────────────
  const prevScores = useRef<Map<number, { h: number; a: number }> | null>(null);
  const alertSeq = useRef(0);
  const [alerts, setAlerts] = useState<ScoreAlert[]>([]);
  useEffect(() => {
    if (!data) return;
    const found = newScores(prevScores.current, data.games, alertSeq.current);
    alertSeq.current += found.length;
    prevScores.current = new Map(
      data.games.map((g) => [g.id, { h: g.homePoints ?? 0, a: g.awayPoints ?? 0 }]),
    );
    if (found.length > 0) setAlerts((q) => [...q, ...found]);
  }, [data]);
  const alert = alerts[0] ?? null;
  useEffect(() => {
    if (!alert) return;
    const t = setTimeout(() => setAlerts((q) => q.slice(1)), ALERT_MS);
    return () => clearTimeout(t);
  }, [alert]);
  const alertGame = alert ? data?.games.find((g) => g.id === alert.gameId) : undefined;

  // ── Pages ───────────────────────────────────────────────────────────────
  const areaRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<number[][]>([]);
  // Re-pack whenever what the cards say could change their width.
  const signature =
    (data?.summary ? `s:${JSON.stringify(data.summary)}|` : "") +
    games
      .map(
        (g) =>
          `${g.id}:${g.status}:${g.situation ?? ""}:${g.possession ?? ""}:${g.mine ?? ""}:${g.total ?? ""}`,
      )
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
  const shown = (layout[page] ?? []).map((i) => items[i]).filter(Boolean);

  return (
    <main className="tv-strip tv-panel tv-cards">
      <div className="tv-brand">
        <span>THE SLATE</span>
        {data && <span className="tv-week">WK {data.week}</span>}
      </div>
      {/* Off-screen copy of every card at its natural width, for packing. */}
      <div className="tv-card-measure" ref={measureRef} aria-hidden>
        {items.map((it) => (
          <ItemCard key={it.kind === "game" ? it.g.id : "summary"} item={it} />
        ))}
      </div>
      <div className="tv-card-area" ref={areaRef} data-fading={fading && !alert ? "1" : undefined}>
        {alert && alertGame ? (
          <AlertCard key={alert.key} alert={alert} g={alertGame} />
        ) : shown.length === 0 ? (
          <span className="tv-empty">{data ? "No games on right now" : "Loading scores"}</span>
        ) : (
          shown.map((it) => <ItemCard key={it.kind === "game" ? it.g.id : "summary"} item={it} />)
        )}
      </div>
      {pages > 1 && !alert && (
        <div className="tv-card-count stat" aria-hidden>
          {page + 1}/{pages}
        </div>
      )}
    </main>
  );
}

function ItemCard({ item }: { item: Item }) {
  return item.kind === "summary" ? <SummaryCard s={item.s} /> : <Card g={item.g} />;
}

/** "+1.4U" / "-2U", one decimal at most. */
function fmtUnits(u: number): string {
  const r = Math.round(u * 10) / 10;
  return `${r > 0 ? "+" : ""}${r}U`;
}

function SummaryCard({ s }: { s: TickerSummary }) {
  const decided = s.record !== "0-0";
  const unitCls = s.units > 0 ? "tv-v-covering" : s.units < 0 ? "tv-v-losing" : "text-dim";
  return (
    <div className="tv-card tv-summary" data-mine="1">
      <span className="tv-summary-label">YOUR BETS</span>
      {decided ? (
        <>
          <span className="stat text-chalk">{s.record}</span>
          <span className={`stat ${unitCls}`}>{fmtUnits(s.units)}</span>
        </>
      ) : (
        <span className="tv-card-sit text-dim">NO RESULTS YET</span>
      )}
      {s.live > 0 && <span className="tv-status stat text-live">{s.live} LIVE</span>}
      {s.upcoming > 0 && <span className="tv-status stat text-dim">{s.upcoming} UP NEXT</span>}
    </div>
  );
}

/* The two numbers on a card: spread side and total. The viewer's ticket
   replaces the market number it's on; the other market stays, dimmed. */
function Markets({ g }: { g: TickerGame }) {
  const totalTicket = g.stake?.side === "over" || g.stake?.side === "under";
  const spreadMine = Boolean(g.stake && !totalTicket);
  const spreadText = spreadMine ? g.stake!.label : marketSpread(g);
  const totalText = totalTicket
    ? g.stake!.label
    : g.total !== null && g.total !== undefined
      ? `O/U ${g.total}`
      : null;
  return (
    <>
      {spreadText && (
        <span className={`tv-line stat ${spreadMine ? lineClass(g, true) : "tv-line-market"}`}>
          {spreadText}
        </span>
      )}
      {totalText && (
        <span className={`tv-line stat ${totalTicket ? lineClass(g, true) : "tv-line-market"}`}>
          {totalText}
        </span>
      )}
    </>
  );
}

/** WON / LOST / PUSH on a finished game the viewer had money on. */
function Result({ g }: { g: TickerGame }) {
  if (g.status !== "final") return null;
  const r =
    g.mine === "covering"
      ? ["WON", "tv-v-covering"]
      : g.mine === "losing"
        ? ["LOST", "tv-v-losing"]
        : g.mine === "push"
          ? ["PUSH", "tv-v-push"]
          : null;
  return r ? <span className={`tv-result stat ${r[1]}`}>{r[0]}</span> : null;
}

function Card({ g }: { g: TickerGame }) {
  const live = g.status === "in_progress";
  const scored = live || g.status === "final";
  const lead = leadingSide(g);
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
      <Markets g={g} />
      <span className={`tv-status stat ${live ? "text-live" : "text-dim"}`}>{tvStatus(g)}</span>
      <Result g={g} />
      {sit && (
        <span className={`tv-card-sit ${redZone ? "text-live" : "text-chalk/80"}`}>{sit}</span>
      )}
      {spot && <Field x={spot.x} redZone={redZone} />}
      <VerdictWords g={g} />
    </div>
  );
}

/** One of the viewer's games just scored: it takes the strip for a few seconds. */
function AlertCard({ alert, g }: { alert: ScoreAlert; g: TickerGame }) {
  const abbr = alert.side === "home" ? g.homeAbbr : g.awayAbbr;
  return (
    <div className="tv-card tv-alert" data-mine="1">
      <span className="tv-alert-what">
        {alert.label} {abbr}
      </span>
      <Card g={g} />
    </div>
  );
}

/** Possession marker, drawn in em so it scales with the strip. */
function Ball() {
  return (
    <svg className="tv-ball" viewBox="0 0 17 11" aria-label="has the ball" role="img">
      <ellipse
        cx="8.5"
        cy="5.5"
        rx="7.8"
        ry="4.7"
        fill="#9A6430"
        stroke="#5C3A18"
        strokeWidth="0.8"
      />
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
function Field({ x, redZone }: { x: number; redZone: boolean }) {
  return (
    <span className="tv-field" data-red={redZone ? "1" : undefined} aria-hidden>
      <span className="tv-field-mid" />
      {/* x is 0-100 between the goal lines; each end zone takes 7%. */}
      <span className="tv-field-ball" style={{ left: `${7 + x * 0.86}%` }} />
    </span>
  );
}
