"use client";

import { ChevronDown, RefreshCw, Search, SearchX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStarred, useViewerTz } from "../../lib/client-store";
import type { GameRow } from "../../lib/db-types";
import { clockTime, dayKey, dayTabLabel, kickSlot, DEFAULT_TZ, tzLabel } from "../../lib/kick";
import { liveUrgency } from "../../lib/live-status";
import { useGamesRealtime } from "../../lib/use-games-realtime";
import {
  displayRank,
  isDead,
  isFinal,
  isLive,
  pickHero,
  watchability,
  weekModelRecord,
  type GameView,
  type SlateData,
} from "../../lib/slate";
import { BetSlip } from "./BetSlip";
import { GameCard } from "./GameCard";
import { SkeletonCard } from "./SkeletonCard";

const SORTS = [
  { key: "kickoff", label: "Kickoff" },
  { key: "watch", label: "Watchability" },
  { key: "spread-big", label: "Biggest spread" },
  { key: "spread-close", label: "Closest spread" },
  { key: "total", label: "Highest total" },
  { key: "edge", label: "Best edge" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

const SPREAD_RANGES = [
  { key: "any", label: "Any spread", max: Infinity },
  { key: "3", label: "≤ 3", max: 3 },
  { key: "7", label: "≤ 7", max: 7 },
  { key: "14", label: "≤ 14", max: 14 },
] as const;

export function SlateView({
  initial,
  currentWeek,
  favoriteTeamIds = [],
}: {
  initial: SlateData;
  currentWeek: number;
  /** Server-side favorites (/me) — pinned like local stars, roam across devices */
  favoriteTeamIds?: number[];
}) {
  const [data, setData] = useState<SlateData>(initial);
  const [loading, setLoading] = useState(false);
  const tz = useViewerTz(DEFAULT_TZ);
  const [starred, toggleStar] = useStarred();
  const [day, setDay] = useState<string>("all");
  const [conference, setConference] = useState("all");
  const [network, setNetwork] = useState("all");
  const [spreadRange, setSpreadRange] = useState<string>("any");
  const [rankedOnly, setRankedOnly] = useState(false);
  const [myPicksOnly, setMyPicksOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("kickoff");
  const [query, setQuery] = useState("");

  /* ---- data refresh ---------------------------------------------------- */

  const week = data.week;
  // tracks the week the user is looking at so stale fetches never clobber it;
  // updated only in changeWeek (render never mutates it)
  const weekRef = useRef(initial.week);
  // per-game timestamp of the last realtime event, so an in-flight poll that
  // started before an event never rolls a fresher score back
  const liveEventAt = useRef(new Map<number, number>());

  const seasonType = data.seasonType;
  const refresh = useCallback(async (targetWeek: number, showSkeleton: boolean, st?: string) => {
    if (showSkeleton) setLoading(true);
    const fetchStart = Date.now();
    try {
      const res = await fetch(`/api/slate?week=${targetWeek}&st=${st ?? "regular"}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const next = (await res.json()) as SlateData;
        if (next.week === weekRef.current) {
          setData((cur) => ({
            ...next,
            games: next.games.map((g) => {
              const evt = liveEventAt.current.get(g.id);
              if (evt === undefined || evt <= fetchStart) return g;
              const held = cur.games.find((x) => x.id === g.id);
              if (!held) return g;
              return {
                ...g,
                status: held.status,
                homePoints: held.homePoints,
                awayPoints: held.awayPoints,
                period: held.period,
                clock: held.clock,
                situation: held.situation,
                lastPlay: held.lastPlay,
                possession: held.possession,
              };
            }),
          }));
        }
      }
    } catch {
      /* transient network error — next poll retries */
    } finally {
      if (showSkeleton) setLoading(false);
    }
  }, []);

  const handleGameUpdate = useCallback((row: GameRow) => {
    liveEventAt.current.set(row.id, Date.now());
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

  const anyLive = data.games.some(isLive);
  // realtime only for the current week when games are live or kicking off soon;
  // off-week browsing costs nothing. "Now" is the fetch stamp — deterministic
  // per payload, and every poll refreshes it.
  const anyImminent = useMemo(() => {
    const now = Date.parse(data.fetchedAt);
    return data.games.some((g) => {
      if (isLive(g)) return true;
      if (g.status !== "scheduled" || !g.startTs) return false;
      const dt = Date.parse(g.startTs) - now;
      return dt > -3 * 3600_000 && dt < 6 * 3600_000;
    });
  }, [data.games, data.fetchedAt]);
  const { connected } = useGamesRealtime({
    enabled: week === currentWeek && anyImminent,
    week,
    seasonId: data.seasonId,
    onGameUpdate: handleGameUpdate,
  });

  useEffect(() => {
    // realtime carries scores; the slower connected poll still heals missed
    // events and refreshes lines/predictions
    const ms = connected ? 180_000 : anyLive ? 30_000 : 90_000;
    const id = setInterval(() => {
      if (document.visibilityState === "visible")
        void refresh(weekRef.current, false, seasonType);
    }, ms);
    return () => clearInterval(id);
  }, [anyLive, connected, refresh, seasonType]);

  const changeWeek = (w: number) => {
    if (w === week) return;
    weekRef.current = w;
    setData((d) => ({ ...d, week: w, seasonType: "regular", games: [] }));
    setDay("all");
    window.history.replaceState(null, "", w === currentWeek ? "/slate" : `/slate?week=${w}`);
    void refresh(w, true, "regular");
  };

  /* ---- derived --------------------------------------------------------- */

  const games = data.games;
  const liveCount = games.filter(isLive).length;

  const dayTabs = useMemo(() => {
    const seen = new Map<string, string>();
    for (const g of games) {
      if (!g.startTs) continue;
      const k = dayKey(g.startTs, tz);
      if (!seen.has(k)) seen.set(k, dayTabLabel(g.startTs, tz));
    }
    return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [games, tz]);

  const conferences = useMemo(
    () =>
      [...new Set(games.flatMap((g) => [g.home.conference, g.away.conference]))]
        .filter((c): c is string => !!c)
        .sort(),
    [games],
  );
  const networks = useMemo(
    () => [...new Set(games.map((g) => g.tv).filter((t): t is string => !!t))].sort(),
    [games],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const maxSpread = SPREAD_RANGES.find((r) => r.key === spreadRange)?.max ?? Infinity;
    return games.filter((g) => {
      if (day !== "all" && (!g.startTs || dayKey(g.startTs, tz) !== day)) return false;
      if (conference !== "all" && g.home.conference !== conference && g.away.conference !== conference)
        return false;
      if (network !== "all" && g.tv !== network) return false;
      if (rankedOnly && !isRankedMatchup(g)) return false;
      if (myPicksOnly && !g.myPick) return false;
      if (
        maxSpread !== Infinity &&
        (g.lines.spread === null || Math.abs(g.lines.spread) > maxSpread)
      )
        return false;
      if (
        q &&
        !g.home.school.toLowerCase().includes(q) &&
        !g.away.school.toLowerCase().includes(q) &&
        !g.home.abbr.toLowerCase().includes(q) &&
        !g.away.abbr.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [games, day, conference, network, rankedOnly, myPicksOnly, spreadRange, query, tz]);

  const sorted = useMemo(() => {
    const starredSet = new Set([...starred, ...favoriteTeamIds]);
    const isPinned = (g: GameView) => starredSet.has(g.home.id) || starredSet.has(g.away.id);
    const cmp = (a: GameView, b: GameView): number => {
      switch (sort) {
        case "watch":
          return (watchability(b) ?? -1) - (watchability(a) ?? -1);
        case "spread-big":
          return absOr(b.lines.spread, -1) - absOr(a.lines.spread, -1);
        case "spread-close":
          return absOr(a.lines.spread, Infinity) - absOr(b.lines.spread, Infinity);
        case "total":
          return (b.lines.total ?? -1) - (a.lines.total ?? -1);
        case "edge":
          return absOr(b.prediction?.edge ?? null, -1) - absOr(a.prediction?.edge ?? null, -1);
        default:
          return (a.startTs ?? "9999").localeCompare(b.startTs ?? "9999");
      }
    };
    return [...filtered].sort((a, b) => {
      const pin = Number(isPinned(b)) - Number(isPinned(a));
      if (pin !== 0) return pin;
      // dead games sink
      const dead = Number(isDead(a)) - Number(isDead(b));
      if (dead !== 0) return dead;
      return cmp(a, b);
    });
  }, [filtered, sort, starred, favoriteTeamIds]);

  const noFilters =
    day === "all" &&
    conference === "all" &&
    network === "all" &&
    !rankedOnly &&
    !myPicksOnly &&
    spreadRange === "any" &&
    query.trim() === "";

  // Game of the Week: highlighted in place in the grid, not a separate hero
  const featuredId = useMemo(
    () => (sort === "kickoff" && noFilters ? (pickHero(sorted)?.id ?? null) : null),
    [sorted, sort, noFilters],
  );

  // High-powered day structure: live games lead, then pregame by kickoff
  // slot (Noon / Afternoon / Primetime / Late — spec §7), then finals.
  // Only when sorted by kickoff — explicit sorts stay a flat grid.
  const sections = useMemo(() => {
    if (sort !== "kickoff") return null;
    // within Live, the sweats lead: bubble picks, then losing, covering, no pick
    const liveGames = [...sorted.filter(isLive)].sort((a, b) => liveUrgency(a) - liveUrgency(b));
    const finalGames = sorted.filter(isFinal);
    const upcoming = sorted.filter((g) => !isLive(g) && !isFinal(g));
    // big slates get the broadcast-window structure; small ones stay one block
    const slotted: Array<{ key: string; title: string; games: GameView[] }> = [];
    if (upcoming.length >= 8) {
      for (const g of upcoming) {
        const title = g.startTs
          ? `${dayTabLabel(g.startTs, tz)} · ${kickSlot(g.startTs)}`
          : "Kickoff TBD";
        const last = slotted[slotted.length - 1];
        if (last && last.title === title) last.games.push(g);
        else slotted.push({ key: `pre-${slotted.length}`, title, games: [g] });
      }
    } else if (upcoming.length > 0) {
      slotted.push({ key: "pregame", title: "Pregame", games: upcoming });
    }
    if (liveGames.length === 0 && finalGames.length === 0 && slotted.length <= 1) return null;
    return [
      { key: "live", title: "Live", games: liveGames },
      ...slotted,
      { key: "final", title: "Final", games: finalGames },
    ].filter((s) => s.games.length > 0);
  }, [sorted, sort, tz]);

  const rankedCount = games.filter(isRankedMatchup).length;
  const record = weekModelRecord(games);
  const finals = games.filter(isFinal).length;

  /* ---- render ---------------------------------------------------------- */

  return (
    <>
      {/* sticky control bar */}
      <div className="sticky top-[49px] z-10 -mx-4 border-b border-chalk/10 bg-background/85 px-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
          <WeekSelect week={week} currentWeek={currentWeek} onChange={changeWeek} />

          {/* toggle buttons, not ARIA tabs — no tabpanel/arrow-key contract here */}
          <div className="flex items-center gap-1" aria-label="Filter by day">
            <DayTab label="All" active={day === "all"} onClick={() => setDay("all")} />
            {dayTabs.map(([k, label]) => (
              <DayTab key={k} label={label} active={day === k} onClick={() => setDay(k)} />
            ))}
          </div>

          <div className="ml-auto flex items-center gap-3">
            {liveCount > 0 && (
              <span className="stat flex items-center gap-1.5 text-xs font-semibold text-live">
                <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-live" />
                {liveCount} live
              </span>
            )}
            <span className="stat hidden items-center gap-1 text-[10.5px] text-chalk/35 sm:flex">
              <RefreshCw size={10} aria-hidden className={loading ? "animate-spin" : ""} />
              {clockTime(data.fetchedAt, tz)} {tzLabel(tz)}
            </span>
          </div>
        </div>
      </div>

      {/* summary strip */}
      <div className="mx-auto mt-4 max-w-7xl">
        <div className="scroll-thin flex items-stretch gap-2 overflow-x-auto pb-1">
          <SummaryStat label="Games" value={String(games.length)} />
          <SummaryStat label="Ranked" value={String(rankedCount)} />
          <SummaryStat label="Finals" value={`${finals}/${games.length}`} />
          {record.wins + record.losses + record.pushes > 0 && (
            <SummaryStat
              label="Model ATS"
              value={`${record.wins}-${record.losses}${record.pushes ? `-${record.pushes}` : ""}`}
              tone={record.wins >= record.losses ? "win" : "loss"}
            />
          )}
        </div>

        {/* filters */}
        <div className="scroll-thin mt-3 flex items-center gap-2 overflow-x-auto pb-1">
          <label className="relative shrink-0">
            <Search
              size={13}
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-dim"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search teams"
              aria-label="Search by team name"
              className="h-8 w-40 rounded-lg border border-chalk/12 bg-surface pl-8 pr-2 text-sm text-chalk placeholder:text-chalk/35 focus:border-accent/60 focus:outline-none"
            />
          </label>
          <FilterSelect
            value={conference}
            onChange={setConference}
            options={[["all", "All conferences"], ...conferences.map((c): [string, string] => [c, c])]}
          />
          <FilterSelect
            value={network}
            onChange={setNetwork}
            options={[["all", "All networks"], ...networks.map((n): [string, string] => [n, n])]}
          />
          <FilterSelect
            value={spreadRange}
            onChange={setSpreadRange}
            options={SPREAD_RANGES.map((r): [string, string] => [r.key, r.label])}
          />
          <FilterToggle label="Ranked" active={rankedOnly} onClick={() => setRankedOnly(!rankedOnly)} />
          <FilterToggle
            label="My picks"
            active={myPicksOnly}
            onClick={() => setMyPicksOnly(!myPicksOnly)}
          />
          <span className="mx-1 h-5 w-px shrink-0 bg-chalk/10" aria-hidden />
          <FilterSelect
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            options={SORTS.map((s): [string, string] => [s.key, s.label])}
            label="Sort"
          />
        </div>
      </div>

      {/* slate */}
      <div className="mx-auto mt-4 max-w-7xl pb-12">
        {loading ? (
          <SkeletonSlate />
        ) : games.length === 0 ? (
          <EmptyState
            title={`No games loaded for week ${week} yet`}
            hint="The slate fills in when data ingestion runs."
          />
        ) : sorted.length === 0 ? (
          <EmptyState
            title="No games match your filters"
            hint="Loosen a filter or clear the search to see the rest of the slate."
          />
        ) : sections ? (
          sections.map((s) => (
            <section key={s.key} aria-label={s.title} className="mt-7 first:mt-0">
              <SectionHeader title={s.title} count={s.games.length} live={s.key === "live"} />
              <CardGrid
                games={s.games}
                tz={tz}
                starred={starred}
                onStar={toggleStar}
                featuredId={featuredId}
              />
            </section>
          ))
        ) : (
          <CardGrid
            games={sorted}
            tz={tz}
            starred={starred}
            onStar={toggleStar}
            featuredId={featuredId}
          />
        )}
      </div>

      <BetSlip seasonId={data.seasonId} />
    </>
  );
}

/* ---- little pieces ----------------------------------------------------- */

function CardGrid({
  games,
  tz,
  starred,
  onStar,
  featuredId,
}: {
  games: GameView[];
  tz: string;
  starred: number[];
  onStar: (teamId: number) => void;
  featuredId: number | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {games.map((g, i) => (
        <GameCard
          key={g.id}
          game={g}
          tz={tz}
          starred={starred}
          onStar={onStar}
          index={i}
          featured={g.id === featuredId}
        />
      ))}
    </div>
  );
}

function SectionHeader({ title, count, live }: { title: string; count: number; live: boolean }) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      {live && <span className="live-dot h-2 w-2 shrink-0 rounded-full bg-live" aria-hidden />}
      <h2 className={`text-sm ${live ? "text-live" : "text-chalk/70"}`}>{title}</h2>
      <span className="stat text-xs text-dim">{count}</span>
      <span className="h-px flex-1 bg-chalk/10" aria-hidden />
    </div>
  );
}

function isRankedMatchup(g: GameView): boolean {
  const hr = displayRank(g.home);
  const ar = displayRank(g.away);
  return hr !== null && hr <= 25 && ar !== null && ar <= 25;
}

function absOr(v: number | null, fallback: number): number {
  return v === null ? fallback : Math.abs(v);
}

function WeekSelect({
  week,
  currentWeek,
  onChange,
}: {
  week: number;
  currentWeek: number;
  onChange: (w: number) => void;
}) {
  return (
    <label className="relative shrink-0">
      <span className="sr-only">Week</span>
      <select
        value={week}
        onChange={(e) => onChange(Number(e.target.value))}
        className="display h-8 appearance-none rounded-lg border border-chalk/12 bg-surface pl-3 pr-8 text-base text-chalk focus:border-accent/60 focus:outline-none"
      >
        {Array.from({ length: 16 }, (_, i) => i + 1).map((w) => (
          <option key={w} value={w}>
            Week {w}
            {w === currentWeek ? " ·" : ""}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-dim"
      />
    </label>
  );
}

function DayTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1 text-sm font-medium transition-colors ${
        active ? "bg-accent text-accent-ink" : "text-dim hover:bg-surface hover:text-chalk"
      }`}
    >
      {label}
    </button>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "win" | "loss";
}) {
  return (
    <div className="card flex shrink-0 flex-col justify-center px-3.5 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-chalk/40">
        {label}
      </span>
      <span
        className={`stat text-sm font-semibold leading-tight ${
          tone === "win" ? "text-win" : tone === "loss" ? "text-loss" : "text-chalk"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
  label?: string;
}) {
  return (
    <label className="relative shrink-0">
      {label && <span className="sr-only">{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 appearance-none rounded-lg border border-chalk/12 bg-surface pl-3 pr-7 text-xs font-medium text-chalk focus:border-accent/60 focus:outline-none"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {label ? `${label}: ${l}` : l}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-dim"
      />
    </label>
  );
}

function FilterToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`h-8 shrink-0 rounded-lg border px-3 text-xs font-medium transition-colors ${
        active
          ? "border-accent/60 bg-accent/15 text-accent"
          : "border-chalk/12 bg-surface text-dim hover:text-chalk"
      }`}
    >
      {label}
    </button>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
      <SearchX size={28} aria-hidden className="text-chalk/25" />
      <p className="display text-lg text-chalk/80">{title}</p>
      <p className="max-w-sm text-sm text-dim">{hint}</p>
    </div>
  );
}

export function SkeletonSlate({ cards = 9 }: { cards?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: cards }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
