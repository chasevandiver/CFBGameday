/**
 * Does `/scoreboard` actually update during a live game?
 *
 * Nothing in the codebase knows. `probe-cfbd.ts` proved the endpoint is
 * *reachable* on this key (889 rows, Aug 12) and `scoreboardJob` has a tested
 * diff — but neither has ever seen a game in progress, because `/scoreboard`
 * takes no year/week parameter and there is no historical replay to test
 * against. The liveness half of the contract is assumed.
 *
 * That assumption fails silently. `scoreboardPatch` matches the status string
 * exactly:
 *
 *     g.status === "in_progress" ? "in_progress" : g.status === "completed" ? "final" : "scheduled"
 *     if (status === "scheduled") return null;   // no write
 *
 * so if CFBD says `in-progress`, or renames `homeTeam.points`, every game
 * stays scheduled forever, `scoreboardJob` returns `{live_or_final: 0}`, and
 * the run goes GREEN. The watchdog does not catch it either: it only checks
 * scoreboard freshness `if (gameLive)`, and `gameLive` is read from our own
 * `games` table — which in this failure never flips.
 *
 * So this module turns the opener into a measurement. It samples the board
 * through a live window and answers, with evidence:
 *
 *   - what status strings CFBD actually emits (the rename check)
 *   - how long after kickoff a game flips off `scheduled` (status lag)
 *   - whether scores/period/clock mutate at all, and how often (the cadence
 *     that sets our real freshness ceiling — the 30s poll is only an upper
 *     bound if CFBD itself is faster than 30s)
 *   - whether `situation` / `lastPlay` / `possession` ever populate, since
 *     the cover-flip detector reads all three
 *
 * Everything here is a pure fold over samples: no network, no clock, no DB.
 * `scripts/observe-scoreboard.ts` collects the samples and prints the report.
 */

import type { CfbdScoreboardGame } from "../../src/lib/cfbd";

/** One poll of the board, already narrowed to the games worth watching. */
export interface BoardSample {
  /** Wall clock (ms since epoch) when the response landed. */
  at: number;
  games: CfbdScoreboardGame[];
}

/**
 * The fields the live layer actually consumes — `SCOREBOARD_COLS` minus the
 * columns that come from elsewhere. Diffing anything else would report churn
 * we do not care about as evidence that the feed is alive.
 */
export const WATCHED_FIELDS = [
  "status",
  "period",
  "clock",
  "homePoints",
  "awayPoints",
  "situation",
  "lastPlay",
  "possession",
] as const;

export type WatchedField = (typeof WATCHED_FIELDS)[number];

/** What `scoreboardPatch` is prepared to understand. Anything else is drift. */
export const KNOWN_STATUSES = new Set(["scheduled", "in_progress", "completed"]);

export type Snapshot = Record<WatchedField, string | number | null>;

export interface FieldChange {
  gameId: number;
  field: WatchedField;
  from: string | number | null;
  to: string | number | null;
  at: number;
}

export interface GameObservation {
  id: number;
  label: string;
  startDate: string;
  /** Distinct status strings, in the order first seen. */
  statusTrail: string[];
  /** First sample where status left `scheduled`, or null. */
  wentLiveAt: number | null;
  /** wentLiveAt − startDate, ms. Negative means CFBD flipped it early. */
  statusLagMs: number | null;
  changes: FieldChange[];
  /** Samples in which this game held a live (`in_progress`) status. */
  liveSamples: number;
  /** Non-null counts across live samples — cover-flip inputs. */
  populatedWhileLive: Record<WatchedField, number>;
  /** Longest live stretch with no watched field changing, ms. */
  maxQuietMs: number;
  /** Clock ran UP inside one period — a correction, or a parse we got wrong. */
  clockRegressions: number;
}

export type Verdict = "OK" | "STALE" | "UNKNOWN_STATUS" | "NO_LIVE_GAMES";

export interface Observation {
  samples: number;
  firstAt: number | null;
  lastAt: number | null;
  /** Every raw status string seen, with counts. The rename check. */
  statusCounts: Record<string, number>;
  games: GameObservation[];
  verdict: Verdict;
  notes: string[];
}

/**
 * `/scoreboard` returns the whole season (889 rows in 2026) and takes no week
 * parameter, so every sample would otherwise carry ~880 games that cannot
 * change today. Keep anything already off `scheduled`, plus everything
 * kicking within the window either side — the pre-kickoff rows have to stay,
 * because "never left scheduled" is the failure being hunted.
 */
export function relevant(
  games: CfbdScoreboardGame[],
  now: number,
  windowH = 6,
): CfbdScoreboardGame[] {
  const span = windowH * 3600_000;
  return games.filter((g) => {
    if (g.status !== "scheduled") return true;
    const start = Date.parse(g.startDate);
    return Number.isFinite(start) && Math.abs(start - now) <= span;
  });
}

export function snapshotOf(g: CfbdScoreboardGame): Snapshot {
  return {
    status: g.status,
    period: g.period,
    clock: g.clock,
    homePoints: g.homeTeam.points,
    awayPoints: g.awayTeam.points,
    situation: g.situation,
    lastPlay: g.lastPlay,
    possession: g.possession,
  };
}

/**
 * Seconds remaining, from CFBD's "MM:SS". Returns null on anything else —
 * an unparseable clock is not a regression, it is a format we do not know,
 * and calling it a fault would bury the real signal.
 */
export function clockSeconds(clock: string | null): number | null {
  if (!clock) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function emptyCounts(): Record<WatchedField, number> {
  return Object.fromEntries(WATCHED_FIELDS.map((f) => [f, 0])) as Record<WatchedField, number>;
}

/**
 * Fold samples into the report.
 *
 * Deliberately tolerant of a game appearing or vanishing between samples —
 * `/scoreboard` returns the whole season, but the caller narrows to a window
 * and a game can cross that boundary mid-run. A first sighting seeds state
 * rather than counting as a change.
 */
export function observe(samples: BoardSample[]): Observation {
  const ordered = [...samples].sort((a, b) => a.at - b.at);
  const statusCounts: Record<string, number> = {};
  const byGame = new Map<
    number,
    { obs: GameObservation; prev: Snapshot; prevAt: number; lastChangeAt: number }
  >();

  for (const sample of ordered) {
    for (const g of sample.games) {
      statusCounts[g.status] = (statusCounts[g.status] ?? 0) + 1;
      const next = snapshotOf(g);
      const live = g.status === "in_progress";
      const entry = byGame.get(g.id);

      if (!entry) {
        const obs: GameObservation = {
          id: g.id,
          label: `${g.awayTeam.name} @ ${g.homeTeam.name}`,
          startDate: g.startDate,
          statusTrail: [g.status],
          wentLiveAt: g.status !== "scheduled" ? sample.at : null,
          statusLagMs:
            g.status !== "scheduled" ? sample.at - Date.parse(g.startDate) : null,
          changes: [],
          liveSamples: live ? 1 : 0,
          populatedWhileLive: emptyCounts(),
          maxQuietMs: 0,
          clockRegressions: 0,
        };
        if (live) countPopulated(obs, next);
        byGame.set(g.id, {
          obs,
          prev: next,
          prevAt: sample.at,
          lastChangeAt: sample.at,
        });
        continue;
      }

      const { obs, prev } = entry;
      if (obs.statusTrail[obs.statusTrail.length - 1] !== g.status) obs.statusTrail.push(g.status);
      if (obs.wentLiveAt === null && g.status !== "scheduled") {
        obs.wentLiveAt = sample.at;
        obs.statusLagMs = sample.at - Date.parse(g.startDate);
      }
      if (live) {
        obs.liveSamples++;
        countPopulated(obs, next);
      }

      let changed = false;
      for (const field of WATCHED_FIELDS) {
        if (prev[field] === next[field]) continue;
        changed = true;
        obs.changes.push({ gameId: g.id, field, from: prev[field], to: next[field], at: sample.at });
      }

      // A clock that climbs inside one period is worth surfacing but is not a
      // failure: CFBD corrects them, and an untimed period change reads the
      // same way. Only meaningful when the period held steady.
      if (prev.period === next.period) {
        const before = clockSeconds(prev.clock as string | null);
        const after = clockSeconds(next.clock as string | null);
        if (before !== null && after !== null && after > before) obs.clockRegressions++;
      }

      // Quiet stretches only count while the game was live in BOTH samples —
      // the hours a scheduled game sits still are not staleness.
      if (live && prev.status === "in_progress") {
        const quiet = sample.at - entry.lastChangeAt;
        if (quiet > obs.maxQuietMs) obs.maxQuietMs = quiet;
      }
      if (changed) entry.lastChangeAt = sample.at;

      entry.prev = next;
      entry.prevAt = sample.at;
    }
  }

  const games = [...byGame.values()].map((e) => e.obs);
  return {
    samples: ordered.length,
    firstAt: ordered[0]?.at ?? null,
    lastAt: ordered[ordered.length - 1]?.at ?? null,
    statusCounts,
    games,
    ...verdictOf(statusCounts, games),
  };
}

function countPopulated(obs: GameObservation, s: Snapshot): void {
  for (const f of WATCHED_FIELDS) if (s[f] !== null && s[f] !== undefined) obs.populatedWhileLive[f]++;
}

/**
 * The four answers, and why NO_LIVE_GAMES is not a pass.
 *
 * An empty window proves nothing, and reporting it green is exactly the trap
 * `emptyIsHealthy` set in the access probe: a working key looked identical to
 * a broken one because nobody separated "we asked and it said no" from "we
 * never got to ask". Observing zero live games means the run was mistimed,
 * not that the feed is fine.
 *
 * UNKNOWN_STATUS outranks STALE. If CFBD emits a string `scoreboardPatch`
 * cannot read, "nothing changed" is a symptom and the enum is the cause —
 * reporting the symptom would send someone hunting a polling bug.
 */
export function verdictOf(
  statusCounts: Record<string, number>,
  games: GameObservation[],
): { verdict: Verdict; notes: string[] } {
  const notes: string[] = [];
  const unknown = Object.keys(statusCounts).filter((s) => !KNOWN_STATUSES.has(s));
  if (unknown.length > 0) {
    notes.push(
      `CFBD emitted status ${unknown.map((s) => `"${s}"`).join(", ")}, which scoreboardPatch ` +
        `reads as "scheduled" and drops. The live layer writes NOTHING for these games.`,
    );
    return { verdict: "UNKNOWN_STATUS", notes };
  }

  const live = games.filter((g) => g.liveSamples > 0);
  if (live.length === 0) {
    notes.push(
      "No game held an in_progress status for the whole window — this run proves nothing " +
        "about liveness. Re-run it over a kickoff.",
    );
    const lagging = games.filter(
      (g) => g.wentLiveAt === null && Date.parse(g.startDate) < (g.changes[0]?.at ?? Infinity),
    );
    if (lagging.length > 0)
      notes.push(`${lagging.length} game(s) were past their start time and still "scheduled".`);
    return { verdict: "NO_LIVE_GAMES", notes };
  }

  const moved = live.filter((g) => g.changes.length > 0);
  if (moved.length === 0) {
    notes.push(
      `${live.length} game(s) were in_progress and not one watched field ever changed. ` +
        "Either the feed is frozen or we are reading the wrong shape.",
    );
    return { verdict: "STALE", notes };
  }

  if (moved.length < live.length)
    notes.push(
      `${live.length - moved.length} of ${live.length} live game(s) never changed a field — ` +
        "check whether they were in a stoppage or genuinely frozen.",
    );

  const blind = live.filter((g) => g.populatedWhileLive.lastPlay === 0);
  if (blind.length > 0)
    notes.push(
      `${blind.length} of ${live.length} live game(s) never carried a lastPlay. detectCoverFlips ` +
        "reads it for the flip description, so those flips log without one.",
    );

  return { verdict: "OK", notes };
}

/** Median, for cadence — the mean is hostage to one halftime. */
export function medianGapMs(changes: FieldChange[]): number | null {
  const ts = [...new Set(changes.map((c) => c.at))].sort((a, b) => a - b);
  if (ts.length < 2) return null;
  const gaps = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid] : Math.round((gaps[mid - 1] + gaps[mid]) / 2);
}

const secs = (ms: number | null): string => (ms === null ? "–" : `${(ms / 1000).toFixed(0)}s`);

export function formatObservation(o: Observation): string {
  const lines: string[] = [];
  const windowMin =
    o.firstAt !== null && o.lastAt !== null ? ((o.lastAt - o.firstAt) / 60_000).toFixed(1) : "0";
  lines.push(
    `/scoreboard liveness — ${o.samples} samples over ${windowMin} min, ${o.games.length} games watched`,
  );
  lines.push("─".repeat(100));

  lines.push("status strings CFBD emitted (scoreboardPatch understands scheduled/in_progress/completed):");
  for (const [s, n] of Object.entries(o.statusCounts).sort((a, b) => b[1] - a[1]))
    lines.push(`  ${KNOWN_STATUSES.has(s) ? " ok " : "DRIFT"}  ${s.padEnd(16)} ${n}`);
  lines.push("");

  const live = o.games.filter((g) => g.liveSamples > 0);
  if (live.length > 0) {
    lines.push(
      "game                                    live   chg   med gap   max quiet   lag@kick   never populated",
    );
    lines.push("─".repeat(100));
    for (const g of live.sort((a, b) => b.changes.length - a.changes.length)) {
      // Absence is the actionable half: listing all eight fields that DID
      // arrive buries the one that never did.
      const missing = WATCHED_FIELDS.filter((f) => g.populatedWhileLive[f] === 0);
      const seen = missing.length > 0 ? missing.join(",") : "– (all present)";
      lines.push(
        `${g.label.slice(0, 38).padEnd(38)}  ${String(g.liveSamples).padStart(4)}  ` +
          `${String(g.changes.length).padStart(4)}  ${secs(medianGapMs(g.changes)).padStart(8)}  ` +
          `${secs(g.maxQuietMs).padStart(10)}  ${secs(g.statusLagMs).padStart(9)}   ${seen}`,
      );
      if (g.clockRegressions > 0)
        lines.push(`${" ".repeat(40)}↳ clock ran up ${g.clockRegressions}× inside a period`);
    }
    lines.push("");
    lines.push(
      "med gap = median seconds between any watched field changing. THIS is the freshness " +
        "floor —\n  polling faster than it just re-reads the same board.",
    );
    lines.push("max quiet = longest live stretch with nothing moving (halftime shows up here).");
    lines.push("lag@kick = delay from scheduled kickoff to CFBD leaving `scheduled`.");
  } else {
    lines.push("No game was ever in_progress during this window.");
  }

  lines.push("");
  lines.push(`VERDICT: ${o.verdict}`);
  for (const n of o.notes) lines.push(`  • ${n}`);
  return lines.join("\n");
}
