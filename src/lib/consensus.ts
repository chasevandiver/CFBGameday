/**
 * Line-consensus math — the single implementation shared by the app
 * (src/lib/queries.ts), the jobs (scripts/lib/jobs-core.ts), and mirrored by
 * the line_consensus view (supabase/migrations/0015) and make_pick (0021). The
 * audit found two hand-rolled copies that had already drifted; this is the only
 * one now.
 *
 * "Mirrored" is a standing obligation, not a note: the SQL sites compute the
 * same number for the same game, and when they disagree a pick is graded
 * against a line the app never showed. DQ-15's aggregate rule therefore landed
 * in all three at once (migration 0074), and `consensus.test.ts` asserts the
 * SQL and the TypeScript name the same aggregates.
 */
import { AGGREGATE_PROVIDERS } from "./providers";


export interface SnapshotLike {
  provider: string;
  captured_at: string;
  spread: number | null;
  total?: number | null;
  spread_open?: number | null;
  total_open?: number | null;
  ml_home?: number | null;
  ml_away?: number | null;
}

export interface Consensus {
  spread: number | null;
  open: number | null;
  total: number | null;
  totalOpen: number | null;
  mlHome: number | null;
  mlAway: number | null;
}

/**
 * Books only hang lines in half-point increments, so consensus must land on one.
 *
 * Ties round half away from zero to match Postgres `round()` — the SQL
 * consensus sites (`line_consensus` in 0015, `make_pick` in 0021) use
 * `round(avg * 2) / 2`, and numeric `round(-6.5)` is −7 where JS
 * `Math.round(-6.5)` is −6. Before this matched, a −3.25 mean snapped to −3.0
 * here and −3.5 in SQL: the same snapshots produced two different "consensus"
 * lines, and a pick graded against the JS close could bank ±0.5 of phantom CLV
 * on a line that never moved.
 */
export function snapToHalf(v: number): number {
  return v < 0 ? -Math.round(-v * 2) / 2 : Math.round(v * 2) / 2;
}

/**
 * Consensus of the most recent snapshot per provider. Pass `before` (usually
 * kickoff) to get the closing consensus — the same cutoff the grading job
 * uses — instead of the latest one.
 */
/**
 * The columns `consensusFromSnapshots` actually reads.
 *
 * Lives here rather than at a call site because it is a property of this
 * function: change what the consensus consults and this list has to move with
 * it. `jobs-core.ts` re-exports it as `SNAPSHOT_COLS` (its original name, which
 * a test asserts on), and `queries.ts` uses it to stop `fetchTeamAtsSeason`
 * pulling `select("*")` — that path ran per game-page view over every final
 * either team had played, which the performance audit measured at ~700 KB by
 * November (09:P-6).
 *
 * `spread_open` is in the list for the grading path, not this one: without it
 * the opener silently falls back to the current line and every receipt reads
 * zero movement. Keeping one list for both readers is the point — two lists is
 * how that fallback gets reintroduced.
 */
export const SNAPSHOT_COLS = "game_id, provider, spread, spread_open, total, captured_at";

/**
 * The OPENING line (R2-C1): the number a line guess grades against, shared by
 * the grading job and the reveal display so they cannot disagree. NFL
 * snapshots carry the book's own opener (`spread_open`) and the consensus
 * `open` is a true open; CFB snapshots don't, and there the honest proxy is
 * the EARLIEST capture per provider — the same first-snapshot convention the
 * receipts use. Mixing the two (consensus `open` falls back to the CURRENT
 * spread when spread_open is null) would grade a guess against a line that
 * had already moved.
 */
export function openingSpread(snapshots: SnapshotLike[]): number | null {
  if (snapshots.some((s) => s.spread_open !== null && s.spread_open !== undefined)) {
    return consensusFromSnapshots(snapshots).open;
  }
  const earliest = new Map<string, SnapshotLike>();
  for (const s of snapshots) {
    const prev = earliest.get(s.provider);
    if (!prev || s.captured_at < prev.captured_at) earliest.set(s.provider, s);
  }
  return consensusFromSnapshots([...earliest.values()]).spread;
}

export function consensusFromSnapshots(snapshots: SnapshotLike[], before?: string): Consensus {
  const latestByProvider = new Map<string, SnapshotLike>();
  for (const s of snapshots) {
    if (before !== undefined && s.captured_at >= before) continue;
    const prev = latestByProvider.get(s.provider);
    if (!prev || s.captured_at > prev.captured_at) latestByProvider.set(s.provider, s);
  }
  /* DQ-15. CFBD's `/lines` returns a synthetic `consensus` provider ALONGSIDE
     the individual books, and the archive backfill stored it like any other —
     so this mean was averaging a blend against its own components, which is
     DQ-14's double-count with a different name and about seventy times the
     reach. 6,029 games carry it beside a real book and the snapped line moves
     on 1,813 of them, by 0.85 points where it moves at all.

     `books.length > 0 ? books : all` rather than a plain filter, and that
     fallback is the whole design. 486 games have `consensus` and NOTHING else,
     and 2015-2018 has no per-book coverage at all — dropping the aggregate
     outright would not correct those games, it would delete their market and
     take the early seasons of the puzzle archive with them. An aggregate is a
     bad thing to average WITH a book and a perfectly good thing to use INSTEAD
     of one. */
  const latest = [...latestByProvider.values()];

  /* PER MARKET, not per row — and the difference is not hypothetical. Applying
     the rule to whole snapshots drops the aggregate whenever ANY book is
     present, even a book that quotes a different market. Three archive games
     are exactly that shape: `consensus` posts a spread and no total, while
     teamrankings and numberfire post a total and no spread. A row-level filter
     dropped the only spread those games had and returned null for it — the fix
     making a line disappear, found by checking the view against the rule
     rather than by trusting that it did what it said. */
  const quoting = (pick: (s: SnapshotLike) => number | null | undefined): number[] => {
    const quoted = latest.filter((s) => {
      const v = pick(s);
      return v !== null && v !== undefined;
    });
    const books = quoted.filter((s) => !AGGREGATE_PROVIDERS.has(s.provider));
    return (books.length > 0 ? books : quoted).map((s) => pick(s) as number);
  };
  const mean = (vals: number[]): number | null =>
    vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0) / vals.length;
  const line = (pick: (s: SnapshotLike) => number | null | undefined): number | null => {
    const m = mean(quoting(pick));
    return m === null ? null : snapToHalf(m);
  };
  const price = (pick: (s: SnapshotLike) => number | null | undefined): number | null => {
    const m = mean(quoting(pick));
    return m === null ? null : Math.round(m);
  };
  return {
    spread: line((s) => s.spread),
    open: line((s) => s.spread_open ?? s.spread),
    total: line((s) => s.total),
    totalOpen: line((s) => s.total_open ?? s.total),
    mlHome: price((s) => s.ml_home),
    mlAway: price((s) => s.ml_away),
  };
}
