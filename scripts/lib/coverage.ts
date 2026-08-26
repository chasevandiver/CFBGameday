/**
 * Does CFBD actually have the auxiliary feeds a tuner needs, for the seasons
 * that tuner is about to score?
 *
 * `loadSeason` fetches four things per season, and one of them —
 * `/stats/game/advanced` — is swallowed with `.catch(() => [])` on the stated
 * grounds that a key without that tier should degrade to the score-only model
 * rather than break the backtest. That is right at a three-season window where
 * every feed is known-present. At eleven seasons it is the `emptyIsHealthy`
 * defect wearing another hat: a tuner whose feed is empty for 2015-2017 does
 * not fail, it quietly scores eight seasons and prints a number labelled as
 * eleven.
 *
 * So: every tuner declares the feeds it consumes, and the window is checked
 * against a COMMITTED manifest before a single season is fetched. The manifest
 * is a reviewed fact produced by `scripts/probe-cfbd-history.ts`, not a live
 * re-probe, so this check costs zero CFBD calls and runs in CI without a key.
 *
 * Two layers, because either alone can lie. This file is the pre-flight; the
 * runtime floor (does the name->id join actually land for an old season?) is
 * asserted by the caller after the feed is loaded, and catches the case a
 * manifest cannot: the feed is present and the join is not.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Feed keys are the CFBD route, so a manifest row is greppable to a call. */
export type FeedKey =
  | "ratings/sp"
  | "talent"
  | "player/returning"
  | "stats/game/advanced"
  | "ratings/elo@wk1"
  | "ratings/elo@weekly"
  | "rankings@wk1"
  | "recruiting/teams";

export type CoverageVerdict = "OK" | "THIN" | "EMPTY" | "DENIED" | "ERROR" | "UNPROBED";

export interface CoverageRow {
  season: number;
  feed: FeedKey;
  verdict: CoverageVerdict;
  rows: number | null;
}

export interface CoverageManifest {
  /** ISO date of the probe run, or null if this has never been probed. */
  probedAt: string | null;
  note: string;
  rows: CoverageRow[];
}

/**
 * Which feeds each experiment consumes. Derived by reading each tuner's own
 * `cached(...)` calls — if a tuner gains a feed, it gains a row here, and the
 * test that pins this map is what makes that non-optional.
 */
export const FEED_REQUIREMENTS: Record<string, FeedKey[]> = {
  report: ["ratings/sp"],
  "tune": ["ratings/sp"],
  "tune-hfa": ["ratings/sp"],
  "tune-sigma": ["ratings/sp"],
  "tune-fcs": ["ratings/sp"],
  "tune-team-hfa": ["ratings/sp"],
  "tune-prior": ["ratings/sp", "talent"],
  "tune-sp-blend": ["ratings/sp", "talent"],
  "tune-preseason-tilts": ["ratings/sp"],
  "tune-coaching": ["ratings/sp", "talent"],
  "tune-coaching-split": ["ratings/sp", "talent"],
  "tune-churn": ["ratings/sp", "talent", "player/returning"],
  "tune-anchors": ["ratings/sp", "talent", "ratings/elo@wk1", "rankings@wk1"],
  "tune-ensemble": ["ratings/sp", "ratings/elo@weekly"],
  "tune-epa": ["ratings/sp", "stats/game/advanced"],
  "diagnose-edges": ["ratings/sp"],
  "diagnose-tiers": ["ratings/sp", "talent"],
  "tune-tier-recenter": ["ratings/sp", "talent"],
  // The manifest attests recruiting/teams at the SEASON being entered; the
  // trailing classes behind it (season−3…) predate the manifest's own range
  // for the oldest seasons, so the tuner also prints a per-season matched
  // count and its Gate 0 refuses thin coverage at runtime — the second layer
  // this file's header says a manifest cannot replace.
  "tune-talent-source": ["ratings/sp", "talent", "recruiting/teams"],
};

const MANIFEST_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "cfbd-coverage.json",
);

export function loadCoverageManifest(file = MANIFEST_PATH): CoverageManifest {
  return JSON.parse(readFileSync(file, "utf8")) as CoverageManifest;
}

/**
 * Rows are a floor, not a count: `/talent` answering with 42 teams for a
 * season is not EMPTY, and it is also not usable. The existing probe has no
 * concept of THIN because at one season it never needed one.
 */
export function coverageVerdict(
  outcome: { status: "OK" | "EMPTY" | "DENIED" | "ERROR"; rows: number | null },
  minRows: number,
): CoverageVerdict {
  if (outcome.status !== "OK") return outcome.status;
  return (outcome.rows ?? 0) >= minRows ? "OK" : "THIN";
}

/** Per-feed floor for "the join will actually land". */
export const FEED_FLOORS: Record<FeedKey, number> = {
  "ratings/sp": 100,
  talent: 100,
  "player/returning": 100,
  "stats/game/advanced": 100,
  "ratings/elo@wk1": 100,
  "ratings/elo@weekly": 100,
  "rankings@wk1": 20,
  // The feed lists ranked classes, not the FBS: some G5 classes go unranked
  // in older years, and the trailing-4-class construction tolerates gaps
  // (MIN_CLASSES in recruiting-talent.ts). 80 is "the join will land for the
  // bulk of the pool", not "every team is present".
  "recruiting/teams": 80,
};

export interface CoverageComplaint {
  feed: FeedKey;
  seasons: number[];
  verdict: CoverageVerdict;
}

/**
 * Which scored seasons fail which feed. Pure, so the reasoning is tested
 * without a network or a key — the same split `classifyProbe` uses.
 */
export function coverageComplaints(
  experiment: string,
  scored: readonly number[],
  manifest: CoverageManifest,
): CoverageComplaint[] {
  const feeds = FEED_REQUIREMENTS[experiment] ?? [];
  const complaints: CoverageComplaint[] = [];
  for (const feed of feeds) {
    const bad = new Map<CoverageVerdict, number[]>();
    for (const season of scored) {
      const row = manifest.rows.find((r) => r.season === season && r.feed === feed);
      const verdict = row?.verdict ?? "UNPROBED";
      if (verdict === "OK") continue;
      bad.set(verdict, [...(bad.get(verdict) ?? []), season]);
    }
    for (const [verdict, seasons] of bad) complaints.push({ feed, seasons, verdict });
  }
  return complaints;
}

/**
 * The widest suffix of the window that clears every required feed — i.e. the
 * narrower window that WOULD work. An error that names the fix is the
 * difference between a stop and a redirect.
 */
export function narrowestWorkingWindow(
  experiment: string,
  scored: readonly number[],
  manifest: CoverageManifest,
): number[] {
  const feeds = FEED_REQUIREMENTS[experiment] ?? [];
  const ok = (season: number) =>
    feeds.every(
      (feed) =>
        manifest.rows.find((r) => r.season === season && r.feed === feed)?.verdict === "OK",
    );
  // Walk back from the newest season while every feed still clears; the old
  // end is where coverage dies, so a suffix is the shape the answer takes.
  const asc = [...scored].sort((a, b) => a - b);
  let start = asc.length;
  while (start > 0 && ok(asc[start - 1])) start--;
  return asc.slice(start);
}

export class CoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoverageError";
  }
}

/**
 * Refuse loudly, or warn loudly, but never proceed silently.
 *
 * An UNPROBED manifest warns rather than throws: the probe costs ~78 CFBD
 * calls and one dispatch, and blocking every backtest run behind it would make
 * the honest thing the annoying thing. A feed PROBED and found empty or thin
 * for a scored season throws, because that number would be a lie.
 */
export function assertFeedCoverage(
  experiment: string,
  window: { scored: number[]; label: string },
  manifest: CoverageManifest,
  log: (s: string) => void = console.log,
): void {
  const complaints = coverageComplaints(experiment, window.scored, manifest);
  if (complaints.length === 0) return;

  const unprobed = complaints.filter((c) => c.verdict === "UNPROBED");
  const real = complaints.filter((c) => c.verdict !== "UNPROBED");

  if (unprobed.length > 0 && manifest.probedAt === null) {
    log(
      `!! Feed coverage for --${experiment} over ${window.label} is UNVERIFIED — no probe has ` +
        `run.\n   ${unprobed.map((c) => c.feed).join(", ")} may be empty or thin for the older ` +
        `seasons, and\n   a tuner that silently scores fewer seasons than its label claims is ` +
        `the defect this\n   check exists to prevent. Run: npm run probe:history`,
    );
  } else if (unprobed.length > 0) {
    log(
      `!! Manifest probed ${manifest.probedAt} but has no row for ` +
        `${unprobed.map((c) => `${c.feed} (${c.seasons.join(", ")})`).join("; ")}. Re-probe.`,
    );
  }

  if (real.length === 0) return;

  const detail = real
    .map((c) => `${c.feed} is ${c.verdict} for ${c.seasons.join(", ")}`)
    .join("; ");
  const working = narrowestWorkingWindow(experiment, window.scored, manifest);
  const fix =
    working.length >= 2
      ? `Re-dispatch with --seasons=${working[0] - 1}-${working[working.length - 1]}`
      : `No sub-window of ${window.label} clears these feeds`;

  throw new CoverageError(
    `--${experiment} refuses window ${window.label}: ${detail} (all scored seasons).\n` +
      `Scoring the remaining seasons silently would make this number incomparable to every ` +
      `other --${experiment} run.\n${fix}, or re-run scripts/probe-cfbd-history.ts to refresh ` +
      `the manifest.`,
  );
}
