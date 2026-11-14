"use client";

/**
 * The card strip for the Fire TV overlay (/tv/cards, TV-8, TV-9, TV-10).
 *
 * A continuous crawl stutters over live video on Fire TV hardware, web or
 * native (TV-5, TV-7). Cards don't move: a page of games holds for a few
 * seconds, then the next page fades in. That buys room for detail a crawl
 * can't carry: who has the ball, down and distance, where on the field, and
 * both numbers. Order: the viewer's summary, their games, then everyone else.
 *
 * When one of the viewer's games scores, that game takes the whole strip for
 * a few seconds (TV-9), then the rotation picks up where it was. The same
 * takeover announces a ticket changing sides of its number (TV-24) and a bet
 * settling at the final whistle (TV-23); a score that causes either is folded
 * into that banner rather than shown twice.
 *
 * TV-10 is the broadcast look (public/design/tv-direction-f.html): every game
 * is a tile with both logos, the clock and down in the middle, the channel,
 * and a field along its bottom. The viewer's bets tint the whole tile by how
 * they're going. Pages are grouped (your bets, live, up next, final) so the
 * label at the left always names what's on screen.
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  ticketsOf,
  type TickerGame,
  type TickerSummary,
  type TickerTicket,
} from "../../lib/ticker";
import { fieldPosition, isRedZone, parseSituation } from "../../lib/slate";
import { leadingSide } from "../ScoreTicker";
import { marketSpread, Rank, SportTag, tvStatus, VerdictWords } from "./TvChip";
import { useTickerFeed } from "./use-ticker-feed";
import { useFantasy } from "./use-fantasy";
import type { FantasyMatchup } from "../../lib/fantasy";

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
    // TV-20, owner call: no banner when a basketball bet scores. A football
    // score is an event, a handful a game; a basketball score is every
    // thirty seconds, and a strip that took over the screen for each one
    // would never show anything else.
    if (g.sport === "cbb") continue;
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

/** The two verdicts a ticket can flip between; a push is only passing through. */
export type Decided = "covering" | "losing";

/** One or more of the viewer's tickets on a game just changed sides (TV-24). */
export interface FlipAlert {
  kind: "flip";
  gameId: number;
  to: Decided;
  tickets: TickerTicket[];
  /** What scored to cause it ("TOUCHDOWN"), when the same poll shows it. */
  cause: string | null;
  key: number;
}

/** One of the viewer's games just went final (TV-23). */
export interface FinalAlert {
  kind: "final";
  gameId: number;
  key: number;
}

export type Banner = ({ kind: "score" } & ScoreAlert) | FlipAlert | FinalAlert;

/** What the last poll looked like, for the three announcers to compare with. */
export interface Snapshot {
  scores: Map<number, { h: number; a: number }>;
  status: Map<number, string>;
  /** Each ticket's last DECISIVE verdict, keyed `gameId:label`. */
  decided: Map<string, Decided>;
}

const ticketKey = (g: TickerGame, t: TickerTicket) => `${g.id}:${t.label}`;

/**
 * Carry the snapshot forward one poll. A ticket sitting on the number, or one
 * a score can't grade, keeps the verdict it last had: covering, push, then
 * not covering is one flip, and it is announced when it lands.
 */
export function snapshot(prev: Snapshot | null, games: TickerGame[]): Snapshot {
  const decided = new Map(prev?.decided ?? []);
  for (const g of games) {
    if (g.status !== "in_progress" && g.status !== "final") continue;
    for (const t of ticketsOf(g)) {
      if (t.state === "covering" || t.state === "losing") decided.set(ticketKey(g, t), t.state);
    }
  }
  return {
    scores: new Map(games.map((g) => [g.id, { h: g.homePoints ?? 0, a: g.awayPoints ?? 0 }])),
    status: new Map(games.map((g) => [g.id, g.status])),
    decided,
  };
}

/**
 * TV-24: tickets that changed sides of their number since the last poll, one
 * alert per game and direction. Live games only — a final is TV-23's to
 * announce — and never basketball, for the reason its scores aren't announced
 * (TV-20): a spread there trades sides all night.
 */
export function newFlips(prev: Snapshot | null, games: TickerGame[], key: number): FlipAlert[] {
  if (!prev) return [];
  const out: FlipAlert[] = [];
  for (const g of games) {
    if (g.status !== "in_progress" || g.sport === "cbb") continue;
    for (const to of ["covering", "losing"] as const) {
      const tickets = ticketsOf(g).filter((t) => {
        const was = prev.decided.get(ticketKey(g, t));
        return t.state === to && was !== undefined && was !== to;
      });
      if (tickets.length > 0)
        out.push({ kind: "flip", gameId: g.id, to, tickets, cause: null, key: key + out.length });
    }
  }
  return out;
}

/**
 * TV-23: the viewer's games that went final since the last poll, when at
 * least one ticket on them has a verdict to announce. Basketball included: a
 * bet settles once, however often the game scored.
 */
export function newFinals(prev: Snapshot | null, games: TickerGame[], key: number): FinalAlert[] {
  if (!prev) return [];
  const out: FinalAlert[] = [];
  for (const g of games) {
    const was = prev.status.get(g.id);
    if (g.status !== "final" || was === undefined || was === "final") continue;
    if (!ticketsOf(g).some((t) => t.state !== "on")) continue;
    out.push({ kind: "final", gameId: g.id, key: key + out.length });
  }
  return out;
}

/**
 * Everything worth taking the strip over for, in the order it is shown. One
 * banner per event: the final whistle outranks whatever score ended the game,
 * and a flip carries the score that caused it as its caption.
 */
export function newBanners(prev: Snapshot | null, games: TickerGame[], key: number): Banner[] {
  if (!prev) return [];
  const finals = newFinals(prev, games, 0);
  const settled = new Set(finals.map((f) => f.gameId));
  const scores = newScores(prev.scores, games, 0).filter((a) => !settled.has(a.gameId));
  const flips = newFlips(prev, games, 0).map((f) => ({
    ...f,
    cause: scores.find((a) => a.gameId === f.gameId)?.label ?? null,
  }));
  const flipped = new Set(flips.map((f) => f.gameId));
  const out: Banner[] = [
    ...scores.filter((a) => !flipped.has(a.gameId)).map((a) => ({ kind: "score" as const, ...a })),
    ...flips,
    ...finals,
  ];
  return out.map((b, i) => ({ ...b, key: key + i }));
}

/** WON / LOST / PUSH when every graded ticket agrees, SPLIT when they don't. */
export function finalWord(tickets: TickerTicket[]): "WON" | "LOST" | "PUSH" | "SPLIT" | null {
  const graded = tickets.filter((t) => t.state !== "on");
  if (graded.length === 0) return null;
  const all = (s: TickerTicket["state"]) => graded.every((t) => t.state === s);
  return all("covering") ? "WON" : all("losing") ? "LOST" : all("push") ? "PUSH" : "SPLIT";
}

/** Units across the tickets that were priced; null when none were (picks). */
export function finalUnits(tickets: TickerTicket[]): number | null {
  const priced = tickets.filter((t) => typeof t.units === "number");
  if (priced.length === 0) return null;
  return Math.round(priced.reduce((n, t) => n + (t.units ?? 0), 0) * 100) / 100;
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

/** Network badges, short enough for a tile. */
const NETWORKS: Record<string, string> = {
  "The CW Network": "CW",
  "ACC Network": "ACCN",
  "SEC Network": "SECN",
  "Big Ten Network": "BTN",
  "USA Net": "USA",
  Fox: "FOX",
};
export function network(tv: string | null | undefined): string | null {
  if (!tv) return null;
  const first = tv.split("|")[0].trim();
  return NETWORKS[first] ?? (first.length > 7 ? first.slice(0, 7) : first);
}

type Section = "fantasy" | "bets" | "live" | "next" | "final";
export function sectionOf(g: TickerGame): Section {
  if (g.mine) return "bets";
  return g.status === "in_progress" ? "live" : g.status === "scheduled" ? "next" : "final";
}

type Item =
  | { kind: "summary"; s: TickerSummary }
  | { kind: "fantasy"; m: FantasyMatchup }
  | { kind: "game"; g: TickerGame };
type Page = { section: Section | "summary"; items: number[] };

/** Pack each run of same-section items on its own, so a page never mixes labels. */
export function packSections(
  sections: (Section | "summary")[],
  widths: number[],
  room: number,
): Page[] {
  const pages: Page[] = [];
  let start = 0;
  while (start < sections.length) {
    let end = start;
    while (end < sections.length && sections[end] === sections[start]) end++;
    for (const pg of packPages(widths.slice(start, end), room)) {
      pages.push({ section: sections[start], items: pg.map((i) => i + start) });
    }
    start = end;
  }
  return pages;
}

const VERDICT: Record<string, string> = {
  covering: "var(--win)",
  losing: "var(--loss)",
  push: "var(--accent)",
};

export function TvCards() {
  const data = useTickerFeed();
  const games = data ? cardOrder(data.games) : [];
  // TV-12: the viewer's fantasy matchup always; the rest of the league only
  // while NFL games are on, so a college Saturday isn't padded with zeros.
  const fantasy = useFantasy();
  const fantasyShown = (fantasy?.matchups ?? []).filter((m) => m.mine || fantasy?.live);
  const items: Item[] = [
    ...(data?.summary ? [{ kind: "summary" as const, s: data.summary }] : []),
    ...fantasyShown.map((m) => ({ kind: "fantasy" as const, m })),
    ...games.map((g) => ({ kind: "game" as const, g })),
  ];
  const sections = items.map((it) =>
    it.kind === "summary" ? "summary" : it.kind === "fantasy" ? "fantasy" : sectionOf(it.g),
  );

  // ── Alerts: a score, a ticket changing sides, a bet settling ────────────
  const prevPoll = useRef<Snapshot | null>(null);
  const alertSeq = useRef(0);
  const [alerts, setAlerts] = useState<Banner[]>([]);
  useEffect(() => {
    if (!data) return;
    const found = newBanners(prevPoll.current, data.games, alertSeq.current);
    alertSeq.current += found.length;
    prevPoll.current = snapshot(prevPoll.current, data.games);
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
  const [layout, setLayout] = useState<Page[]>([]);
  // Re-pack whenever what the tiles say could change their width.
  const signature =
    (data?.summary ? `s:${JSON.stringify(data.summary)}|` : "") +
    fantasyShown.map((m) => `f${m.id}:${m.a.score}:${m.b.score}:${m.final}`).join("|") +
    games
      .map(
        (g) =>
          `${g.id}:${g.status}:${g.situation ?? ""}:${g.possession ?? ""}:${g.mine ?? ""}:${g.total ?? ""}:${g.clock ?? ""}:${g.homeRank ?? ""}:${g.awayRank ?? ""}:${ticketsOf(g)
            .map((t) => t.label + t.state)
            .join("+")}`,
      )
      .join("|");
  const sectionKey = sections.join(",");
  useLayoutEffect(() => {
    const pack = () => {
      const area = areaRef.current;
      const meas = measureRef.current;
      if (!area || !meas) return;
      const widths = Array.from(meas.children).map((c) => (c as HTMLElement).offsetWidth);
      // The gap between tiles counts against the room on each page.
      setLayout(
        packSections(
          sectionKey.split(",") as Page["section"][],
          widths.map((w) => w + 7),
          area.clientWidth - 7,
        ),
      );
    };
    pack();
    window.addEventListener("resize", pack);
    return () => window.removeEventListener("resize", pack);
  }, [signature, sectionKey]);

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
  const current = layout[page];
  const shown = (current?.items ?? []).map((i) => items[i]).filter(Boolean);

  if (alert && alertGame) {
    return (
      <main className="tv-strip tv-panel tvb brand-surface">
        {alert.kind === "score" ? (
          <Touchdown key={alert.key} alert={alert} g={alertGame} />
        ) : alert.kind === "flip" ? (
          <CoverFlip key={alert.key} alert={alert} g={alertGame} />
        ) : (
          <Settled key={alert.key} g={alertGame} />
        )}
      </main>
    );
  }

  return (
    <main className="tv-strip tv-panel tvb brand-surface">
      <div className="tvb-brand">
        {/* The S is the primary brand asset (BRAND §36-37); the wordmark sits
            beside it and never competes. Supplied artwork, never redrawn. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, sized in vh */}
        <img className="tvb-mark" src="/brand/slate-mark.png" alt="" />
        <span>THE SLATE</span>
      </div>
      {/* Off-screen copy of every tile at its natural width, for packing. */}
      <div className="tvb-measure" ref={measureRef} aria-hidden>
        {items.map((it) => (
          <ItemTile key={itemKey(it)} item={it} games={games} />
        ))}
      </div>
      {current && current.section !== "summary" && <SectionLabel section={current.section} />}
      <div className="tvb-area" ref={areaRef} data-fading={fading ? "1" : undefined}>
        {shown.length === 0 ? (
          <span className="tvb-k">{data ? "NO GAMES ON RIGHT NOW" : "LOADING SCORES"}</span>
        ) : (
          shown.map((it) => <ItemTile key={itemKey(it)} item={it} games={games} />)
        )}
      </div>
      {pages > 1 && (
        <div className="tvb-count" aria-hidden>
          {page + 1}/{pages}
        </div>
      )}
    </main>
  );
}

function itemKey(it: Item): string {
  return it.kind === "game" ? `g${it.g.id}` : it.kind === "fantasy" ? `f${it.m.id}` : "summary";
}

function SectionLabel({ section }: { section: Section }) {
  if (section === "fantasy") return <span className="tvb-label tvb-k tvb-gold">FANTASY</span>;
  if (section === "bets") return <span className="tvb-label tvb-k tvb-gold">YOUR BETS</span>;
  if (section === "live")
    return (
      <span className="tvb-label tvb-k">
        <span className="tvb-dot" /> LIVE
      </span>
    );
  return <span className="tvb-label tvb-k">{section === "next" ? "UP NEXT" : "FINAL"}</span>;
}

function ItemTile({ item, games }: { item: Item; games: TickerGame[] }) {
  if (item.kind === "summary") return <Summary s={item.s} games={games} />;
  if (item.kind === "fantasy") return <FantasyTile m={item.m} />;
  const g = item.g;
  if (g.status === "in_progress") return <LiveTile g={g} />;
  if (g.status === "scheduled") return <NextTile g={g} />;
  return <FinalTile g={g} />;
}

/** School logo, or a badge in the school's colour when there is none. */
function Logo({
  src,
  abbr,
  color,
  size,
}: {
  src?: string | null;
  abbr: string;
  color?: string | null;
  size: number;
}) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <span
        className="tvb-badge"
        style={{ width: size, height: size, background: color ?? "var(--elev)" }}
      >
        {abbr
          .replace(/[^A-Za-z0-9]/g, "")
          .slice(0, 3)
          .toUpperCase()}
      </span>
    );
  }
  // Fantasy logos are whatever URL a league member pasted; an http one won't
  // load on an https page, so try it over https first (TV-12).
  const safe = src.startsWith("http://") ? `https://${src.slice(7)}` : src;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote logos on a TV; no optimiser round-trip
    <img
      className="tvb-logo"
      src={safe}
      alt=""
      width={size}
      height={size}
      onError={() => setBroken(true)}
    />
  );
}

function Ball() {
  return (
    <svg className="tvb-ball" viewBox="0 0 17 11" role="img" aria-label="has the ball">
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

/** A tile has room for this many tickets; the rest are counted. */
const MAX_TICKETS = 3;

/**
 * The viewer's tickets as chips, else the market spread, dimmed. Every ticket
 * (TV-22), each in the colour of its OWN verdict: the tile tints by the first,
 * and a second that is going the other way has to be able to say so.
 */
function Line({ g }: { g: TickerGame }) {
  const tickets = ticketsOf(g);
  if (tickets.length === 0) {
    const m = marketSpread(g);
    return m ? <span className="tvb-mkt">{m}</span> : null;
  }
  return (
    <>
      {tickets.slice(0, MAX_TICKETS).map((t, i) => {
        const v = VERDICT[t.state];
        const cls = v ? `tvb-tk-graded ${t.state === g.mine ? "" : "tvb-tk-other"}` : "tvb-tk-plain";
        return (
          <span
            key={i}
            className={`tvb-ticket ${cls}`}
            style={v ? ({ "--vc": v } as CSSProperties) : undefined}
          >
            {t.label}
          </span>
        );
      })}
      {tickets.length > MAX_TICKETS && (
        <span className="tvb-mkt tvb-bright">+{tickets.length - MAX_TICKETS}</span>
      )}
    </>
  );
}

function Net({ g }: { g: TickerGame }) {
  const n = network(g.tv);
  return n ? <span className="tvb-net">{n}</span> : null;
}

/** Inline style for a tile: team colours, and the verdict when it's the viewer's. */
function tileStyle(g: TickerGame, ticket?: TickerTicket): CSSProperties {
  const style: Record<string, string> = {
    "--ta": g.awayColor ?? "transparent",
    "--th": g.homeColor ?? "transparent",
  };
  const state = ticket ? ticket.state : g.mine;
  const v = state ? VERDICT[state] : undefined;
  if (v) {
    style["--vc"] = v;
    style["--vdir"] = (ticket ?? g.stake)?.side === "home" ? "270deg" : "90deg";
  }
  return style as CSSProperties;
}

function LiveTile({ g }: { g: TickerGame }) {
  const lead = leadingSide(g);
  const graded = Boolean(g.mine && VERDICT[g.mine]);
  const view = {
    status: g.status,
    possession: g.possession ?? null,
    situation: g.situation ?? null,
    home: { abbr: g.homeAbbr },
    away: { abbr: g.awayAbbr },
  };
  const spot = fieldPosition(view);
  const redZone = isRedZone(view);
  const sit = situationText(g.situation);

  const score = (s: "home" | "away") => {
    const pts = (s === "home" ? g.homePoints : g.awayPoints) ?? 0;
    return <span className={`tvb-s ${lead !== null && lead !== s ? "tvb-trail" : ""}`}>{pts}</span>;
  };
  const name = (s: "home" | "away") => (
    <span className={`tvb-ab ${graded && g.stake?.side === s ? "tvb-me" : ""}`}>
      <Rank n={s === "home" ? g.homeRank : g.awayRank} className="tvb-rk" />
      {s === "home" ? g.homeAbbr : g.awayAbbr}
    </span>
  );

  const cls = [
    "tvb-tile",
    graded ? "tvb-bet" : g.stake ? "tvb-mine" : "",
    !graded && redZone ? "tvb-rz" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} style={tileStyle(g)}>
      <span className="tvb-wash" />
      <SportTag g={g} className="tvb-tag" />
      <Logo src={g.awayLogo} abbr={g.awayAbbr} color={g.awayColor} size={28} />
      {name("away")}
      {g.possession === "away" && <Ball />}
      {score("away")}
      <span className="tvb-ctr">
        <span className="tvb-clk">
          <span className="tvb-dot" />
          {tvStatus(g)}
        </span>
        {sit && <span className={`tvb-dd ${redZone ? "tvb-red" : ""}`}>{sit}</span>}
      </span>
      {score("home")}
      {g.possession === "home" && <Ball />}
      {name("home")}
      <Logo src={g.homeLogo} abbr={g.homeAbbr} color={g.homeColor} size={28} />
      {!graded && redZone && <span className="tvb-rzt">RED ZONE</span>}
      <Line g={g} />
      <Net g={g} />
      {spot && (
        <span className={`tvb-field ${redZone ? "tvb-red" : ""}`} aria-hidden>
          <span className="tvb-ez" style={{ background: g.awayColor ?? undefined }} />
          <span className="tvb-turf">
            <span className="tvb-spot" style={{ left: `${spot.x}%` }} />
          </span>
          <span className="tvb-ez" style={{ background: g.homeColor ?? undefined }} />
        </span>
      )}
      <VerdictWords g={g} />
    </div>
  );
}

function NextTile({ g }: { g: TickerGame }) {
  const [time, mer] = tvStatus(g).split(" ");
  return (
    <div className={`tvb-tile ${g.stake ? "tvb-mine" : ""}`} style={tileStyle(g)}>
      <span className="tvb-wash" />
      <SportTag g={g} className="tvb-tag" />
      <span className="tvb-ko">
        {time}
        {mer && <small>{mer}</small>}
      </span>
      <Logo src={g.awayLogo} abbr={g.awayAbbr} color={g.awayColor} size={26} />
      <span className="tvb-ab">
        <Rank n={g.awayRank} className="tvb-rk" />
        {g.awayAbbr}
      </span>
      <span className="tvb-at">AT</span>
      <Logo src={g.homeLogo} abbr={g.homeAbbr} color={g.homeColor} size={26} />
      <span className="tvb-ab">
        <Rank n={g.homeRank} className="tvb-rk" />
        {g.homeAbbr}
      </span>
      <Line g={g} />
      <Net g={g} />
    </div>
  );
}

function FinalTile({ g }: { g: TickerGame }) {
  const lead = leadingSide(g);
  const v = g.mine ? VERDICT[g.mine] : undefined;
  const tickets = ticketsOf(g);
  return (
    <div
      className={`tvb-tile tvb-fin ${g.mine ? "tvb-mine" : ""} ${v ? "tvb-bet" : ""}`}
      style={tileStyle(g)}
    >
      <SportTag g={g} className="tvb-tag" />
      <Logo src={g.awayLogo} abbr={g.awayAbbr} color={g.awayColor} size={24} />
      <span className={`tvb-s ${lead === "away" ? "tvb-w" : ""}`}>{g.awayPoints ?? 0}</span>
      <span className="tvb-at">–</span>
      <span className={`tvb-s ${lead === "home" ? "tvb-w" : ""}`}>{g.homePoints ?? 0}</span>
      <Logo src={g.homeLogo} abbr={g.homeAbbr} color={g.homeColor} size={24} />
      {/* tvStatus, not the literal: a basketball final that needed overtime
          says FINAL/OT (TV-20). Football's reads FINAL exactly as before. */}
      <span className="tvb-k tvb-dim">{tvStatus(g)}</span>
      {/* TV-22: each ticket with its own result, not one badge for the game. */}
      {tickets.slice(0, MAX_TICKETS).map((t, i) => (
        <span key={i} className="tvb-fin-tk">
          <span className="tvb-mkt tvb-bright">{t.label}</span>
          {VERDICT[t.state] && (
            <span className="tvb-res" style={{ background: VERDICT[t.state] }}>
              {RESULT[t.state]}
            </span>
          )}
        </span>
      ))}
      {tickets.length > MAX_TICKETS && (
        <span className="tvb-mkt tvb-bright">+{tickets.length - MAX_TICKETS}</span>
      )}
      <VerdictWords g={g} />
    </div>
  );
}

const RESULT: Record<string, string> = { covering: "WON", losing: "LOST", push: "PUSH" };

/** "+1.4U" / "-2U", one decimal at most; "EVEN" at zero, since "0U" reads as OU. */
function fmtUnits(u: number): string {
  const r = Math.round(u * 10) / 10;
  if (r === 0) return "EVEN";
  return `${r > 0 ? "+" : ""}${r}U`;
}

function Summary({ s, games }: { s: TickerSummary; games: TickerGame[] }) {
  const live = games.filter((g) => g.mine && g.status === "in_progress");
  const next = games.filter((g) => g.mine && g.status === "scheduled");
  const ucls = s.units > 0 ? "tvb-up" : s.units < 0 ? "tvb-down" : "";
  return (
    <div className="tvb-sum">
      <span className="tvb-stat">
        <span className="tvb-rec">{s.record}</span>
        <span className="tvb-cap">YOUR NIGHT</span>
      </span>
      <span className={`tvb-units ${ucls}`}>{fmtUnits(s.units)}</span>
      {live.length > 0 && <span className="tvb-k">LIVE</span>}
      {live.flatMap((g) => ticketsOf(g).map((t, i) => <MiniBet key={`${g.id}:${i}`} g={g} t={t} />))}
      {next.length > 0 && <span className="tvb-k">UP NEXT</span>}
      {next.flatMap((g) =>
        ticketsOf(g).map((t, i) => (
          <MiniBet key={`${g.id}:${i}`} g={g} t={t} when={tvStatus(g).split(" ")[0]} />
        )),
      )}
    </div>
  );
}

/** One ticket on the night card: the side's logo and the line, tinted by how it's going. */
function MiniBet({ g, t, when }: { g: TickerGame; t: TickerTicket; when?: string }) {
  const away = t.side === "away";
  const v = VERDICT[t.state];
  return (
    <span className={`tvb-mini ${v ? "tvb-bet" : ""}`} style={tileStyle(g, t)}>
      <SportTag g={g} className="tvb-tag" />
      <Logo
        src={away ? g.awayLogo : g.homeLogo}
        abbr={away ? g.awayAbbr : g.homeAbbr}
        color={away ? g.awayColor : g.homeColor}
        size={24}
      />
      <span className="tvb-mini-l">{t.label}</span>
      {when && <span className="tvb-k tvb-bright">{when}</span>}
      <VerdictWords g={g} />
    </span>
  );
}

/** One of the viewer's games just scored: the strip floods in that school's colour. */
function Touchdown({ alert, g }: { alert: ScoreAlert; g: TickerGame }) {
  const home = alert.side === "home";
  const color = (home ? g.homeColor : g.awayColor) ?? "var(--elev)";
  const v = g.mine ? VERDICT[g.mine] : undefined;
  // TV-18: full names, the scoring side bright and the other dimmed, and the
  // viewer's ticket as a solid chip in the colour it's now running.
  const team = (s: "home" | "away") => (
    <BannerName g={g} s={s} dim={alert.side !== s} />
  );
  return (
    <div className="tvb-td" style={{ "--tc": color } as CSSProperties}>
      <span className="tvb-td-word">{alert.label}</span>
      <Logo
        src={home ? g.homeLogo : g.awayLogo}
        abbr={home ? g.homeAbbr : g.awayAbbr}
        color={color}
        size={40}
      />
      <span className="tvb-td-score">
        {team("away")}
        <span className="tvb-td-pts">{g.awayPoints ?? 0}</span>
        <span className="tvb-td-dash">–</span>
        <span className="tvb-td-pts">{g.homePoints ?? 0}</span>
        {team("home")}
      </span>
      {g.stake && (
        <span className="tvb-td-bet">
          <span className="tvb-td-cap">YOUR BET</span>
          <span className="tvb-td-ticket" style={v ? ({ "--vc": v } as CSSProperties) : undefined}>
            {g.stake.label}
          </span>
        </span>
      )}
      <VerdictWords g={g} />
    </div>
  );
}

/** A school's full name on a banner, its rank ahead of it (TV-18, TV-21). */
function BannerName({ g, s, dim }: { g: TickerGame; s: "home" | "away"; dim?: boolean }) {
  return (
    <span className={`tvb-td-name ${dim ? "tvb-td-other" : ""}`}>
      <Rank n={s === "home" ? g.homeRank : g.awayRank} className="tvb-rk" />
      {(s === "home" ? g.homeName : g.awayName) ?? (s === "home" ? g.homeAbbr : g.awayAbbr)}
    </span>
  );
}

/* A banner floods in a verdict colour, darkened so white type holds on the
   gold of a push as well as on green and red. Its ticket chips go white:
   a chip in the verdict colour would vanish into the flood. */
const flood = (v: string): CSSProperties =>
  ({ "--tc": `color-mix(in srgb, ${v} 72%, #000)` }) as CSSProperties;
const CHIP_ON_FLOOD = { "--vc": "rgba(255, 255, 255, 0.94)" } as CSSProperties;

function BannerScore({ g, dim }: { g: TickerGame; dim?: "home" | "away" | null }) {
  return (
    <span className="tvb-td-score">
      <BannerName g={g} s="away" dim={dim === "away"} />
      <span className="tvb-td-pts">{g.awayPoints ?? 0}</span>
      <span className="tvb-td-dash">–</span>
      <span className="tvb-td-pts">{g.homePoints ?? 0}</span>
      <BannerName g={g} s="home" dim={dim === "home"} />
    </span>
  );
}

/**
 * TV-24: one of the viewer's tickets just changed sides of its number. The
 * strip floods green or red and says which way; the score that did it, when
 * the same poll caught it, is the caption rather than a banner of its own.
 */
function CoverFlip({ alert, g }: { alert: FlipAlert; g: TickerGame }) {
  const side = alert.tickets[0]?.side;
  const home = side === "home";
  return (
    <div className="tvb-td" style={flood(VERDICT[alert.to])}>
      <span className="tvb-td-word">
        {alert.to === "covering" ? "NOW COVERING" : "NO LONGER COVERING"}
      </span>
      {(side === "home" || side === "away") && (
        <Logo
          src={home ? g.homeLogo : g.awayLogo}
          abbr={home ? g.homeAbbr : g.awayAbbr}
          color={home ? g.homeColor : g.awayColor}
          size={40}
        />
      )}
      <BannerScore g={g} />
      <span className="tvb-td-bet">
        <span className="tvb-td-cap">{alert.cause ?? "YOUR BET"}</span>
        {alert.tickets.map((t, i) => (
          <span key={i} className="tvb-td-ticket" style={CHIP_ON_FLOOD}>
            {t.label}
          </span>
        ))}
      </span>
      <span className="sr-only">
        {alert.to === "covering" ? "You're now covering." : "You're no longer covering."}
      </span>
    </div>
  );
}

/**
 * TV-23: one of the viewer's games just went final. The result, the score,
 * each ticket, and what the game paid. Tickets that disagree read SPLIT, each
 * chip in its own colour; a ticket nothing has graded yet is left off.
 */
function Settled({ g }: { g: TickerGame }) {
  const tickets = ticketsOf(g).filter((t) => t.state !== "on");
  const word = finalWord(tickets);
  const units = finalUnits(tickets);
  const lead = leadingSide(g);
  const split = word === "SPLIT";
  // A split floods gold, like a push: neither won nor lost, and the units
  // figure beside the chips says which way it came out.
  const color =
    word === "WON" ? VERDICT.covering : word === "LOST" ? VERDICT.losing : VERDICT.push;
  return (
    <div className="tvb-td" style={flood(color)}>
      <span className="tvb-td-word">{word}</span>
      <span className="tvb-td-cap">{tvStatus(g)}</span>
      <BannerScore g={g} dim={lead === "home" ? "away" : lead === "away" ? "home" : null} />
      <span className="tvb-td-bet">
        {tickets.slice(0, MAX_TICKETS).map((t, i) => (
          <span
            key={i}
            className="tvb-td-ticket"
            style={split ? ({ "--vc": VERDICT[t.state] } as CSSProperties) : CHIP_ON_FLOOD}
          >
            {t.label}
          </span>
        ))}
        {units !== null && <span className="tvb-td-units">{fmtUnits(units)}</span>}
      </span>
      <span className="sr-only">
        {word === "WON"
          ? "Your bet won."
          : word === "LOST"
            ? "Your bet lost."
            : word === "PUSH"
              ? "Your bet pushed."
              : "Your bets split."}
      </span>
    </div>
  );
}

/** "18.4" / "102": fantasy scores to one decimal, no trailing zero. */
function pts(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/**
 * A fantasy matchup in the broadcast tile (TV-12). The viewer's matchup reads
 * like their bets: the whole tile goes green leading, red trailing, gold
 * level. ESPN's win probability and the starters left
 * to play sit in the middle where a game's clock would be.
 */
function FantasyTile({ m }: { m: FantasyMatchup }) {
  const started = m.a.score > 0 || m.b.score > 0 || m.final;
  const diff = m.a.score - m.b.score;
  const verdict =
    !m.mine || !started ? undefined : diff > 0 ? "covering" : diff < 0 ? "losing" : "push";
  const v = verdict ? VERDICT[verdict] : undefined;
  const style = (
    v ? { "--vc": v, "--vdir": "90deg", "--ta": "transparent", "--th": "transparent" } : {}
  ) as CSSProperties;
  const prob = m.a.winProb;
  const left = (s: FantasyMatchup["a"]) =>
    s.playing > 0
      ? `${s.playing} LIVE · ${s.toPlay} LEFT`
      : s.toPlay > 0
        ? `${s.toPlay} TO PLAY`
        : "DONE";

  const side = (s: FantasyMatchup["a"], me: boolean) => (
    <>
      <Logo src={s.logo} abbr={s.abbrev} color={null} size={28} />
      <span className={`tvb-ab tvb-fname ${me && v ? "tvb-me" : ""}`}>{s.name}</span>
    </>
  );
  const score = (s: FantasyMatchup["a"], other: FantasyMatchup["a"]) => (
    <span className={`tvb-s ${started && s.score < other.score ? "tvb-trail" : ""}`}>
      {pts(s.score)}
    </span>
  );

  return (
    <div className={`tvb-tile tvb-ff ${v ? "tvb-bet" : m.mine ? "tvb-mine" : ""}`} style={style}>
      <span className="tvb-wash" />
      {side(m.a, m.mine)}
      {score(m.a, m.b)}
      <span className="tvb-ctr">
        <span className="tvb-clk">
          {m.final ? (
            "FINAL"
          ) : prob !== null ? (
            <>
              {m.a.playing + m.b.playing > 0 && <span className="tvb-dot" />}
              {Math.round(prob * 100)}% WIN
            </>
          ) : (
            "LIVE"
          )}
        </span>
        <span className="tvb-dd">
          {m.final ? `${m.a.record} · ${m.b.record}` : `PROJ ${pts(m.a.projected)} · ${left(m.a)}`}
        </span>
      </span>
      {score(m.b, m.a)}
      {side(m.b, false)}
      {m.final && m.mine && v && (
        <span className="tvb-res" style={{ background: v }}>
          {diff > 0 ? "WON" : diff < 0 ? "LOST" : "TIE"}
        </span>
      )}
    </div>
  );
}
