"use client";

import { ChevronDown, RefreshCw, Search, SearchX, Ticket, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { onBetsChanged } from "../../lib/bets-changed";
import { useFocusedGames, useStarred, useViewerTz } from "../../lib/client-store";
import type { GameRow } from "../../lib/db-types";
import { clockTime, dayKey, dayTabLabel, dayTabLabels, kickSlot, nflKickSlot, DEFAULT_TZ, tzLabel } from "../../lib/kick";
import { liveUrgency } from "../../lib/live-status";
import { useGamesRealtime } from "../../lib/use-games-realtime";
import { useLiveRefresh } from "../../lib/use-live-refresh";
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
  minWeek = 1,
  favoriteTeamIds = [],
  displayName = "",
  demo = false,
}: {
  initial: SlateData;
  currentWeek: number;
  /** 0 in seasons that have a Week 0 (CFBD merges it into week 1 — see scripts/lib/weeks.ts). */
  minWeek?: number;
  /** Server-side favorites (/me) — pinned like local stars, roam across devices */
  favoriteTeamIds?: number[];
  /** Titles the slip's share card: "<display_name> Bets". */
  displayName?: string;
  /**
   * Sample slate, no database behind it (`/demo`).
   *
   * Everything that would reach past this component is switched off: the poll,
   * the realtime channel, the week selector and the slip's writer. The first
   * poll is the one that matters — it would replace the sample week with the
   * real signed-out one and the demo would empty out while somebody watched.
   */
  demo?: boolean;
}) {
  const [data, setData] = useState<SlateData>(initial);
  const [loading, setLoading] = useState(false);
  const tz = useViewerTz(DEFAULT_TZ);
  const [starred, toggleStar] = useStarred();
  const [focusedIds, toggleFocus] = useFocusedGames();
  const [day, setDay] = useState<string>("all");
  const [conference, setConference] = useState("all");
  const [network, setNetwork] = useState("all");
  const [spreadRange, setSpreadRange] = useState<string>("any");
  const [rankedOnly, setRankedOnly] = useState(false);
  // Two products, two filters. "Mine" used to mean "a pool pick OR a bet",
  // which is unusable the moment you keep a real ledger: you cannot ask "what
  // do I have money on this Saturday" without the pool's picks coming along.
  // Both on is the old behaviour, and the legacy `mine=1` link still sets it.
  const [betsOnly, setBetsOnly] = useState(false);
  const [picksOnly, setPicksOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("kickoff");
  const [query, setQuery] = useState("");

  /* ---- URL state: filters are shareable and survive refresh ------------- */

  // Apply ?conf=&tv=&spread=&ranked=&mine=&sort=&q=&day= once after mount
  // (SSR renders defaults; the URL wins a beat later), then mirror every
  // change back into the query string.
  const urlReady = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => {
      const sp = new URLSearchParams(window.location.search);
      const conf = sp.get("conf");
      if (conf) setConference(conf);
      const net = sp.get("tv");
      if (net) setNetwork(net);
      const spr = sp.get("spread");
      if (spr && SPREAD_RANGES.some((r) => r.key === spr)) setSpreadRange(spr);
      if (sp.get("ranked") === "1") setRankedOnly(true);
      // `mine=1` predates the split and meant both.
      if (sp.get("mine") === "1") {
        setBetsOnly(true);
        setPicksOnly(true);
      }
      if (sp.get("bets") === "1") setBetsOnly(true);
      if (sp.get("picks") === "1") setPicksOnly(true);
      const s = sp.get("sort");
      if (s && SORTS.some((x) => x.key === s)) setSort(s as SortKey);
      const q = sp.get("q");
      if (q) setQuery(q);
      const d = sp.get("day");
      if (d) setDay(d);
      urlReady.current = true;
    }, 0);
    return () => clearTimeout(t);
  }, []);

  /* ---- data refresh ---------------------------------------------------- */

  const week = data.week;
  // tracks the week the user is looking at so stale fetches never clobber it;
  // updated only in changeWeek (render never mutates it)
  const weekRef = useRef(initial.week);
  // per-game timestamp of the last realtime event, so an in-flight poll that
  // started before an event never rolls a fresher score back
  const liveEventAt = useRef(new Map<number, number>());

  const seasonType = data.seasonType;
  const sport = data.sport;
  // UX-36: the cross-league Live view. `sport` still says which league the
  // games were loaded under and is meaningless to display here, which is why
  // the week selector, the day tabs and the conference filter all sit behind
  // this flag.
  const liveView = data.live === true;
  const refresh = useCallback(async (targetWeek: number, showSkeleton: boolean, st?: string) => {
    if (demo) return;
    if (showSkeleton) setLoading(true);
    const fetchStart = Date.now();
    try {
      const res = await fetch(
        liveView
          ? "/api/slate?sport=live"
          : `/api/slate?week=${targetWeek}&st=${st ?? "regular"}&sport=${sport}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const next = (await res.json()) as SlateData;
        /* The week guard drops a response for a week the reader has already
           navigated away from. The Live view has no week to compare — its
           `week` is a placeholder — so the guard would reject every poll and
           the one view that must stay current would be the only one that never
           updated. */
        if (liveView || next.week === weekRef.current) {
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
  }, [demo, sport, liveView]);

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
  useGamesRealtime({
    // "regular week that isn't current" is the one browsing state with nothing
    // live to push; pre- and postseason views ride the pointer's own calendar.
    enabled: !demo && (seasonType !== "regular" || week === currentWeek) && anyImminent,
    week,
    seasonId: data.seasonId,
    onGameUpdate: handleGameUpdate,
  });

  /* Realtime carries scores the instant they land; this heals missed events and
     is the only thing that refreshes lines, predictions and the sheet.

     The cadence used to slow to 180s whenever the realtime channel reported
     `SUBSCRIBED`, which made a socket that had quietly died — the normal
     outcome of an iPad sleeping — indistinguishable from a working one, with
     three minutes of nothing behind it. The channel's own status is no longer
     an input: while a game is live this matches the 30s ESPN pull behind it
     (migration 0043), and a hidden tab still costs nothing. */
  const pollMs = anyLive ? 30_000 : anyImminent ? 60_000 : 120_000;
  const poll = useCallback(
    () => void refresh(weekRef.current, false, seasonType),
    [refresh, seasonType],
  );
  useLiveRefresh(poll, pollMs, !demo);

  // Logging or voiding a bet is the one data change that comes from inside this
  // page rather than from the scoreboard job, and the poll is much too slow to
  // serve as the confirmation: pregame it is 90s, which reads as a dead button.
  // The actions' revalidatePath can't reach us — the slate lives in useState —
  // so the writers say so directly and we refetch on the spot.
  useEffect(
    () => onBetsChanged(() => void refresh(weekRef.current, false, seasonType)),
    [refresh, seasonType],
  );

  const changeWeek = (sel: number | "post" | `pre-${number}`) => {
    // Every other week is a fetch, and the demo has nothing to fetch — changing
    // week would empty the grid and leave it that way.
    if (demo) return;
    const pre = typeof sel === "string" && sel.startsWith("pre-");
    const post = sel === "post";
    const w = post ? 1 : pre ? Number((sel as string).slice(4)) : (sel as number);
    const st = post ? "postseason" : pre ? "preseason" : "regular";
    if (w === week && st === seasonType) return;
    weekRef.current = w;
    setData((d) => ({ ...d, week: w, seasonType: st, games: [] }));
    setDay("all");
    // the URL-sync effect below rewrites the query string
    void refresh(w, true, st);
  };

  /* Mirror week + filters into the query string (replaceState — no history spam).
   *
   * Starts from the URL that is actually there and edits only the keys this
   * component owns. It used to build a fresh `URLSearchParams()` and overwrite
   * the whole string, which silently destroyed every param it did not know
   * about — and one of those is `sport`, which belongs to the SERVER, not to
   * this component.
   *
   * That was invisible while the league toggle was a plain `<a>`: a full page
   * load meant this effect only ever ran after the server had already resolved
   * the league, so it re-derived the right value. The moment the toggle became
   * a `<Link>` (a soft navigation, made to stop the full reload stealing scroll
   * position), this started racing that navigation and winning — tapping NFL
   * went to `/slate?sport=nfl` and was immediately rewritten to `/slate?week=0`,
   * snapping straight back to CFB. Tapping Live was worse: `sport=live` was not
   * in the reconstruction at all, so it was stripped every single time.
   *
   * Preserving rather than reconstructing fixes both, and fixes the same bug
   * for `?g=<group>` (a shared sheet link) which was also being eaten. The
   * `sport === "nfl"` special case is gone because nothing needs to re-add a
   * param that was never removed.
   */
  useEffect(() => {
    if (!urlReady.current) return;
    const sp = new URLSearchParams(window.location.search);
    // Every key below is re-decided from state on each run, so each one is
    // cleared first — otherwise a filter turned OFF would keep its stale value.
    for (const k of ["st", "week", "conf", "tv", "spread", "ranked", "mine", "bets", "picks", "sort", "q", "day"]) {
      sp.delete(k);
    }
    if (seasonType === "postseason") sp.set("st", "post");
    else if (seasonType === "preseason") {
      sp.set("st", "pre");
      sp.set("week", String(week));
    } else if (week !== currentWeek) sp.set("week", String(week));
    if (conference !== "all") sp.set("conf", conference);
    if (network !== "all") sp.set("tv", network);
    if (spreadRange !== "any") sp.set("spread", spreadRange);
    if (rankedOnly) sp.set("ranked", "1");
    if (betsOnly && picksOnly) sp.set("mine", "1");
    else if (betsOnly) sp.set("bets", "1");
    else if (picksOnly) sp.set("picks", "1");
    if (sort !== "kickoff") sp.set("sort", sort);
    if (query.trim()) sp.set("q", query.trim());
    if (day !== "all") sp.set("day", day);
    const qs = sp.toString();
    const next = qs ? `/slate?${qs}` : "/slate";
    // No-op writes are not free here: a replaceState during a pending soft
    // navigation is what desynced the router in the first place, so the cheapest
    // way not to interfere is not to write when nothing changed.
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, "", next);
    }
  }, [week, seasonType, sport, currentWeek, conference, network, spreadRange, rankedOnly, betsOnly, picksOnly, sort, query, day]);

  /* ---- derived --------------------------------------------------------- */

  const games = data.games;
  const liveCount = games.filter(isLive).length;

  // Labels come back disambiguated: week 1 has two Saturdays, and two chips
  // both reading "Sat" are unusable.
  const dayTabs = useMemo(
    () => dayTabLabels(games.map((g) => g.startTs).filter((t): t is string => t !== null), tz),
    [games, tz],
  );

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
      // Independent, and OR'd when both are on: "show me everything I'm in on"
      // is still one tap away, but "show me only what I have money on" is now
      // expressible at all.
      if (betsOnly || picksOnly) {
        const hit =
          (betsOnly && g.myBets.length > 0) || (picksOnly && g.myPicks.length > 0);
        if (!hit) return false;
      }
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
  }, [games, day, conference, network, rankedOnly, betsOnly, picksOnly, spreadRange, query, tz]);

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

  /* Game of the Week: highlighted in place in the grid, not a separate hero.
     Picked from the whole week rather than from what is currently on screen —
     it is a fact about the slate, not about your filter. It used to be
     computed from the filtered list and suppressed entirely unless the board
     was untouched, so choosing a conference either moved the crown to a
     different game or made it disappear, both surprising. Now the same game
     wears it whenever it is on screen, and nothing wears it when it isn't. */
  const featuredId = useMemo(() => pickHero(games)?.id ?? null, [games]);

  // High-powered day structure: live games lead, then pregame by kickoff
  // slot (Noon / Afternoon / Primetime / Late — spec §7), then finals.
  // Only when sorted by kickoff — explicit sorts stay a flat grid.
  const sections = useMemo(() => {
    if (sort !== "kickoff") return null;
    // within Live, the sweats lead: closest to the number first, no pick last
    const liveGames = [...sorted.filter(isLive)].sort((a, b) => liveUrgency(a) - liveUrgency(b));
    const finalGames = sorted.filter(isFinal);
    const upcoming = sorted.filter((g) => !isLive(g) && !isFinal(g));
    // big slates get the broadcast-window structure; small ones stay one block
    const slotted: Array<{ key: string; title: string; games: GameView[] }> = [];
    if (upcoming.length >= 8) {
      // each league's own broadcast vocabulary: Noon/Afternoon/Primetime/Late
      // for CFB Saturdays, Early/Late window/Primetime for NFL Sundays
      const slotOf = sport === "nfl" ? nflKickSlot : kickSlot;
      for (const g of upcoming) {
        const title = g.startTs
          ? `${dayTabLabel(g.startTs, tz)} · ${slotOf(g.startTs)}`
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
  }, [sorted, sort, tz, sport]);

  const rankedCount = games.filter(isRankedMatchup).length;
  const record = weekModelRecord(games);
  const finals = games.filter(isFinal).length;

  // multi-game focus: pinned games ride above everything, unfiltered —
  // you pinned them, you get them (kickoff order, live first)
  const focusedGames = useMemo(() => {
    const set = new Set(focusedIds);
    return games
      .filter((g) => set.has(g.id))
      .sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || (a.startTs ?? "").localeCompare(b.startTs ?? ""));
  }, [games, focusedIds]);

  /* ---- render ---------------------------------------------------------- */

  return (
    <>
      {/* sticky control bar — offsets below the nav plus the (dynamic) ticker */}
      <div
        className="sticky z-10 -mx-4 border-b border-chalk/10 bg-background/85 px-4 backdrop-blur-md"
        style={{ top: "calc(3rem + var(--ticker-h, 0px))" }}
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
          {/* Switching league is a full server refetch with its own current
              week, so these are links, not state (the LedgerTabs pattern) —
              and the demo holds one CFB week, so there they'd 404 the point. */}
          {!demo && <SportToggle sport={sport} live={liveView} liveCount={liveCount} />}
          {/* Neither control means anything across leagues and weeks (UX-36):
              a week number describes one league's calendar, and a day tab on a
              list that is by definition happening right now is a filter with
              one value. They are hidden rather than disabled — a disabled
              control still says "there is a choice here". */}
          {!liveView && (
            <>
              <WeekSelect
                week={week}
                seasonType={seasonType}
                sport={sport}
                currentWeek={currentWeek}
                minWeek={minWeek}
                onChange={changeWeek}
                disabled={demo}
              />

              {/* toggle buttons, not ARIA tabs — no tabpanel/arrow-key contract here */}
              <div className="flex items-center gap-1" aria-label="Filter by day">
                <DayTab label="All" active={day === "all"} onClick={() => setDay("all")} />
                {dayTabs.map(({ key, label }) => (
                  <DayTab key={key} label={label} active={day === key} onClick={() => setDay(key)} />
                ))}
              </div>
            </>
          )}

          <div className="ml-auto flex items-center gap-3">
            {liveCount > 0 && (
              <span className="stat flex items-center gap-1.5 text-xs font-semibold text-live">
                <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-live" />
                {liveCount} live
              </span>
            )}
            {/* the LINES' capture time, not the page fetch — with 2x-daily
                refreshes plus close passes those differ by hours, and a
                betting product must say which clock it is showing. Visible on
                phones too: it used to be hidden below sm, which meant the one
                device this product is built for had no staleness cue at all
                (audit 08/UX-09). */}
            <span className="stat flex items-center gap-1 text-[10.5px] text-chalk/50">
              <RefreshCw size={10} aria-hidden className={loading ? "animate-spin" : ""} />
              {data.linesAsOf
                ? `lines ${clockTime(data.linesAsOf, tz)} ${tzLabel(tz)}`
                : `${clockTime(data.fetchedAt, tz)} ${tzLabel(tz)}`}
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
            options={[
              [
                "all",
                // Across leagues the list mixes SEC with AFC West, and neither
                // word covers both (UX-36).
                liveView ? "All leagues" : sport === "nfl" ? "All divisions" : "All conferences",
              ],
              ...conferences.map((c): [string, string] => [c, c]),
            ]}
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
          {/* The two products, side by side and independent. Icons because the
              distinction is the point and two words that both start with "my"
              do not carry it at a glance. */}
          <FilterToggle
            label="My bets"
            icon={Ticket}
            active={betsOnly}
            onClick={() => setBetsOnly(!betsOnly)}
          />
          <FilterToggle
            label="My picks"
            icon={Users}
            active={picksOnly}
            onClick={() => setPicksOnly(!picksOnly)}
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
        {focusedGames.length > 0 && !loading && (
          <section aria-label="Focused games" className="mb-7">
            <SectionHeader
              title="Focus"
              count={focusedGames.length}
              live={focusedGames.some(isLive)}
            />
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {focusedGames.map((g, i) => (
                <GameCard
                  key={`focus-${g.id}`}
                  game={g}
                  tz={tz}
                  starred={starred}
                  onStar={toggleStar}
                  index={i}
                  focused
                  onFocus={toggleFocus}
                  demo={demo}
                />
              ))}
            </div>
          </section>
        )}
        {loading ? (
          <SkeletonSlate />
        ) : games.length === 0 ? (
          liveView ? (
            /* UX-36. The honest empty state for this view is "nothing is on",
               which is true most of the week — not "the schedule hasn't been
               posted", which would be wrong and alarming on a Tuesday. */
            <EmptyState
              title="Nothing is live right now"
              hint="This view fills up the moment a game kicks off, in either league. Until then, CFB and NFL have the week's board."
            />
          ) : (
            <EmptyState
              title={`No games on the board for week ${week} yet`}
              hint="Games appear here once the week's schedule is posted — check back closer to kickoff."
            />
          )
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
                focusedIds={focusedIds}
                onFocus={toggleFocus}
                demo={demo}
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
            focusedIds={focusedIds}
            onFocus={toggleFocus}
            demo={demo}
          />
        )}
      </div>

      <BetSlip seasonId={data.seasonId} week={week} tz={tz} demo={demo} displayName={displayName} />
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
  focusedIds,
  onFocus,
  demo,
}: {
  games: GameView[];
  tz: string;
  starred: number[];
  onStar: (teamId: number) => void;
  featuredId: number | null;
  focusedIds: number[];
  onFocus: (gameId: number) => void;
  demo?: boolean;
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
          focused={focusedIds.includes(g.id)}
          onFocus={onFocus}
          demo={demo}
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

/**
 * CFB | NFL, as links. A league switch replaces the whole slate — different
 * season row, different current week — so it goes through the server like the
 * ledger's tabs do, and Back returns to the other league.
 *
 * ## Plain `<a>`, deliberately. Do not "fix" this to `next/link`.
 *
 * It was changed to `<Link>` once, to remove the full-reload seam a design
 * review flagged, and that broke the control outright — verified in a browser,
 * which is how it should have been checked the first time. Two independent
 * reasons, either one fatal:
 *
 *   1. `SlateView` seeds its state with `useState(initial)`, which reads its
 *      argument only on first mount. A soft navigation REUSES the component, so
 *      the URL changed to `?sport=nfl` and the slate kept rendering CFB. Keying
 *      the component to force a remount was tried and did not resolve it.
 *   2. The URL-mirroring effect below `replaceState`s on its own schedule, and
 *      under a soft navigation that races the router rather than following it.
 *
 * A full page load makes both moot: everything remounts with the server's
 * answer. The seam is real and is the accepted cost until `SlateView` derives
 * its data from props instead of owning a copy — which is a rewrite of its
 * state machine (poll merge, realtime merge, stale-week guard), not a one-line
 * swap. Tracked as UX-36b.
 */
function SportToggle({
  sport,
  live,
  liveCount,
}: {
  sport: "cfb" | "nfl";
  /** UX-36: the cross-league Live view is selected. */
  live: boolean;
  /** Live games in the CURRENT view, used only to badge the segment. */
  liveCount: number;
}) {
  /* 44px of finger, 32px of ink. The segment reads at h-8 like the rest of the
     control bar, and the padding + negative margin grow the hit area outward
     into the bar's own py-2.5 without moving anything — the same trick
     VoidBetButton and DeleteWagerButton use for DESIGN.md's 44px rule (UX-08).
     A three-segment control at 32px tall is a genuinely hard target on a phone,
     and this one is the first thing a thumb reaches for. */
  const seg = (active: boolean) =>
    `flex min-h-11 -my-1.5 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${
      active ? "bg-accent text-accent-ink" : "text-dim hover:bg-surface hover:text-chalk"
    }`;
  return (
    <nav aria-label="View" className="flex shrink-0 items-center gap-1">
      {/* Live leads: on a Saturday it is the only one anybody wants, and it is
          the leftmost thumb reach. It spans both leagues and every week, so it
          is a peer of the two league tabs rather than a filter inside one. */}
      <a
        href="/slate?sport=live"
        className={seg(live)}
        aria-current={live ? "page" : undefined}
      >
        {/* The dot is not decoration — it is what makes "Live" read as a state
            rather than as a third league. It only pulses on games actually in
            progress, and only where the count is known to be about this view. */}
        {(live || liveCount > 0) && (
          <span
            aria-hidden
            className={`live-dot inline-block h-1.5 w-1.5 rounded-full ${live ? "bg-accent-ink" : "bg-live"}`}
          />
        )}
        Live
      </a>
      <a
        href="/slate"
        className={seg(!live && sport === "cfb")}
        aria-current={!live && sport === "cfb" ? "page" : undefined}
      >
        CFB
      </a>
      <a
        href="/slate?sport=nfl"
        className={seg(!live && sport === "nfl")}
        aria-current={!live && sport === "nfl" ? "page" : undefined}
      >
        NFL
      </a>
    </nav>
  );
}

function WeekSelect({
  week,
  seasonType,
  sport,
  currentWeek,
  minWeek = 1,
  onChange,
  disabled = false,
}: {
  week: number;
  seasonType: "preseason" | "regular" | "postseason";
  sport: "cfb" | "nfl";
  currentWeek: number;
  /** 0 when the season has a Week 0 — the last Saturday of August. */
  minWeek?: number;
  onChange: (w: number | "post" | `pre-${number}`) => void;
  /** The demo holds one week. A control that changes nothing is worse than none. */
  disabled?: boolean;
}) {
  const maxWeek = sport === "nfl" ? 18 : 16;
  return (
    <label className="relative shrink-0">
      <span className="sr-only">Week</span>
      <select
        value={seasonType === "postseason" ? "post" : seasonType === "preseason" ? `pre-${week}` : week}
        disabled={disabled}
        onChange={(e) =>
          onChange(
            e.target.value === "post"
              ? "post"
              : e.target.value.startsWith("pre-")
                ? (e.target.value as `pre-${number}`)
                : Number(e.target.value),
          )
        }
        className="display h-8 appearance-none rounded-lg border border-chalk/12 bg-surface pl-3 pr-8 text-base text-chalk focus:border-accent/60 focus:outline-none disabled:opacity-60"
      >
        {/* August is real on the NFL side: week 1 is the Hall of Fame game */}
        {sport === "nfl" &&
          [1, 2, 3, 4].map((w) => (
            <option key={`pre-${w}`} value={`pre-${w}`}>
              Pre {w}
              {w === currentWeek && seasonType === "preseason" ? " ·" : ""}
            </option>
          ))}
        {Array.from({ length: maxWeek + (1 - minWeek) }, (_, i) => i + minWeek).map((w) => (
          <option key={w} value={w}>
            Week {w}
            {w === currentWeek && seasonType === "regular" ? " ·" : ""}
          </option>
        ))}
        <option value="post">{sport === "nfl" ? "Playoffs" : "Bowls & CFP"}</option>
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
  icon: Icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
        active
          ? "border-accent/60 bg-accent/15 text-accent"
          : "border-chalk/12 bg-surface text-dim hover:text-chalk"
      }`}
    >
      {Icon && <Icon size={12} aria-hidden />}
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
