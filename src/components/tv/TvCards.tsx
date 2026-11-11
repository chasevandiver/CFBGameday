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
 * a few seconds (TV-9), then the rotation picks up where it was.
 *
 * TV-10 is the broadcast look (public/design/tv-direction-f.html): every game
 * is a tile with both logos, the clock and down in the middle, the channel,
 * and a field along its bottom. The viewer's bets tint the whole tile by how
 * they're going. Pages are grouped (your bets, live, up next, final) so the
 * label at the left always names what's on screen.
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { TickerGame, TickerSummary } from "../../lib/ticker";
import { fieldPosition, isRedZone, parseSituation } from "../../lib/slate";
import { leadingSide } from "../ScoreTicker";
import { marketSpread, tvStatus, VerdictWords } from "./TvChip";
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
  const [layout, setLayout] = useState<Page[]>([]);
  // Re-pack whenever what the tiles say could change their width.
  const signature =
    (data?.summary ? `s:${JSON.stringify(data.summary)}|` : "") +
    fantasyShown.map((m) => `f${m.id}:${m.a.score}:${m.b.score}:${m.final}`).join("|") +
    games
      .map(
        (g) =>
          `${g.id}:${g.status}:${g.situation ?? ""}:${g.possession ?? ""}:${g.mine ?? ""}:${g.total ?? ""}:${g.clock ?? ""}`,
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
        <Touchdown key={alert.key} alert={alert} g={alertGame} />
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
        {abbr.slice(0, 4)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote logos on a TV; no optimiser round-trip
    <img
      className="tvb-logo"
      src={src}
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

/** The viewer's ticket as a gold chip, else the market spread, dimmed. */
function Line({ g }: { g: TickerGame }) {
  if (g.stake) return <span className="tvb-ticket">{g.stake.label}</span>;
  const m = marketSpread(g);
  return m ? <span className="tvb-mkt">{m}</span> : null;
}

function Net({ g }: { g: TickerGame }) {
  const n = network(g.tv);
  return n ? <span className="tvb-net">{n}</span> : null;
}

/** Inline style for a tile: team colours, and the verdict when it's the viewer's. */
function tileStyle(g: TickerGame): CSSProperties {
  const style: Record<string, string> = {
    "--ta": g.awayColor ?? "transparent",
    "--th": g.homeColor ?? "transparent",
  };
  const v = g.mine ? VERDICT[g.mine] : undefined;
  if (v) {
    style["--vc"] = v;
    style["--vdir"] = g.stake?.side === "home" ? "270deg" : "90deg";
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
  const totalTicket = g.stake?.side === "over" || g.stake?.side === "under";

  const score = (s: "home" | "away") => {
    const pts = (s === "home" ? g.homePoints : g.awayPoints) ?? 0;
    if (graded && !totalTicket && g.stake?.side === s) {
      return <span className="tvb-s tvb-s-v">{pts}</span>;
    }
    return <span className={`tvb-s ${lead !== null && lead !== s ? "tvb-trail" : ""}`}>{pts}</span>;
  };
  const name = (s: "home" | "away") => (
    <span className={`tvb-ab ${graded && g.stake?.side === s ? "tvb-me" : ""}`}>
      {s === "home" ? g.homeAbbr : g.awayAbbr}
    </span>
  );

  const cls = [
    "tvb-tile",
    graded ? "tvb-bet" : g.stake ? "tvb-mine" : "",
    graded && totalTicket ? "tvb-total" : "",
    !graded && redZone ? "tvb-rz" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} style={tileStyle(g)}>
      <span className="tvb-wash" />
      {g.sport === "nfl" && <span className="tvb-tag">NFL</span>}
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
      <span className="tvb-ko">
        {time}
        {mer && <small>{mer}</small>}
      </span>
      <Logo src={g.awayLogo} abbr={g.awayAbbr} color={g.awayColor} size={26} />
      <span className="tvb-ab">{g.awayAbbr}</span>
      <span className="tvb-at">AT</span>
      <Logo src={g.homeLogo} abbr={g.homeAbbr} color={g.homeColor} size={26} />
      <span className="tvb-ab">{g.homeAbbr}</span>
      <Line g={g} />
      <Net g={g} />
    </div>
  );
}

function FinalTile({ g }: { g: TickerGame }) {
  const lead = leadingSide(g);
  const res =
    g.mine === "covering"
      ? "WON"
      : g.mine === "losing"
        ? "LOST"
        : g.mine === "push"
          ? "PUSH"
          : null;
  const v = g.mine ? VERDICT[g.mine] : undefined;
  return (
    <div className={`tvb-tile tvb-fin ${g.mine ? "tvb-mine" : ""}`} style={tileStyle(g)}>
      <Logo src={g.awayLogo} abbr={g.awayAbbr} color={g.awayColor} size={24} />
      <span className={`tvb-s ${lead === "away" ? "tvb-w" : ""}`}>{g.awayPoints ?? 0}</span>
      <span className="tvb-at">–</span>
      <span className={`tvb-s ${lead === "home" ? "tvb-w" : ""}`}>{g.homePoints ?? 0}</span>
      <Logo src={g.homeLogo} abbr={g.homeAbbr} color={g.homeColor} size={24} />
      <span className="tvb-k tvb-dim">FINAL</span>
      {g.stake && <span className="tvb-mkt tvb-bright">{g.stake.label}</span>}
      {res && v && (
        <span className="tvb-res" style={{ background: v }}>
          {res}
        </span>
      )}
      <VerdictWords g={g} />
    </div>
  );
}

/** "+1.4U" / "-2U", one decimal at most. */
function fmtUnits(u: number): string {
  const r = Math.round(u * 10) / 10;
  return `${r > 0 ? "+" : ""}${r}U`;
}

function Summary({ s, games }: { s: TickerSummary; games: TickerGame[] }) {
  const live = games.filter((g) => g.mine && g.status === "in_progress");
  const next = games.filter((g) => g.mine && g.status === "scheduled");
  const ubg = s.units > 0 ? "var(--win)" : s.units < 0 ? "var(--loss)" : "var(--elev)";
  return (
    <div className="tvb-sum">
      <span className="tvb-k">YOUR NIGHT</span>
      <span className="tvb-rec">{s.record}</span>
      <span className="tvb-units" style={{ background: ubg }}>
        {fmtUnits(s.units)}
      </span>
      {live.length > 0 && <span className="tvb-k">LIVE</span>}
      {live.map((g) => {
        const mineAway = g.stake?.side === "away";
        const v = g.mine ? (VERDICT[g.mine] ?? "var(--text-dim)") : "var(--text-dim)";
        return (
          <span key={g.id} className="tvb-mini">
            <Logo
              src={mineAway ? g.awayLogo : g.homeLogo}
              abbr={mineAway ? g.awayAbbr : g.homeAbbr}
              color={mineAway ? g.awayColor : g.homeColor}
              size={24}
            />
            <span className="tvb-light" style={{ background: v, boxShadow: `0 0 8px ${v}` }} />
          </span>
        );
      })}
      {next.length > 0 && <span className="tvb-k">UP NEXT</span>}
      {next.map((g) => {
        const mineAway = g.stake?.side === "away";
        return (
          <span key={g.id} className="tvb-mini">
            <Logo
              src={mineAway ? g.awayLogo : g.homeLogo}
              abbr={mineAway ? g.awayAbbr : g.homeAbbr}
              color={mineAway ? g.awayColor : g.homeColor}
              size={24}
            />
            <span className="tvb-k">{tvStatus(g).split(" ")[0]}</span>
          </span>
        );
      })}
    </div>
  );
}

/** One of the viewer's games just scored: the strip floods in that school's colour. */
function Touchdown({ alert, g }: { alert: ScoreAlert; g: TickerGame }) {
  const home = alert.side === "home";
  const color = (home ? g.homeColor : g.awayColor) ?? "var(--elev)";
  return (
    <div className="tvb-td" style={{ "--tc": color } as CSSProperties}>
      <span className="tvb-td-word">{alert.label}</span>
      <Logo
        src={home ? g.homeLogo : g.awayLogo}
        abbr={home ? g.homeAbbr : g.awayAbbr}
        color={color}
        size={40}
      />
      <span className="tvb-td-team">{home ? g.homeAbbr : g.awayAbbr}</span>
      <span className="tvb-td-score">
        {g.awayAbbr} {g.awayPoints ?? 0}
        <span className="tvb-dim"> – </span>
        {g.homePoints ?? 0} {g.homeAbbr}
      </span>
      {g.stake && <span className="tvb-ticket tvb-push-right">{g.stake.label}</span>}
      <VerdictWords g={g} />
    </div>
  );
}

/** "18.4" / "102": fantasy scores to one decimal, no trailing zero. */
function pts(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/**
 * A fantasy matchup in the broadcast tile (TV-12). The viewer's matchup reads
 * like their bets: the tile, their name and their score go green leading,
 * orange trailing, gold level. ESPN's win probability and the starters left
 * to play sit in the middle where a game's clock would be.
 */
function FantasyTile({ m }: { m: FantasyMatchup }) {
  const started = m.a.score > 0 || m.b.score > 0 || m.final;
  const diff = m.a.score - m.b.score;
  const verdict =
    !m.mine || !started ? undefined : diff > 0 ? "covering" : diff < 0 ? "losing" : "push";
  const v = verdict ? VERDICT[verdict] : undefined;
  const style = (v ? { "--vc": v, "--vdir": "90deg" } : {}) as CSSProperties;
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
  const score = (s: FantasyMatchup["a"], me: boolean, other: FantasyMatchup["a"]) =>
    me && v ? (
      <span className="tvb-s tvb-s-v">{pts(s.score)}</span>
    ) : (
      <span className={`tvb-s ${started && s.score < other.score ? "tvb-trail" : ""}`}>
        {pts(s.score)}
      </span>
    );

  return (
    <div className={`tvb-tile tvb-ff ${v ? "tvb-bet" : m.mine ? "tvb-mine" : ""}`} style={style}>
      <span className="tvb-wash" />
      {side(m.a, m.mine)}
      {score(m.a, m.mine, m.b)}
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
      {score(m.b, false, m.a)}
      {side(m.b, false)}
      {m.final && m.mine && v && (
        <span className="tvb-res" style={{ background: v }}>
          {diff > 0 ? "WON" : diff < 0 ? "LOST" : "TIE"}
        </span>
      )}
    </div>
  );
}
