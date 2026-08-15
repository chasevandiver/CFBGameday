/**
 * Line-consensus math — the single implementation shared by the app
 * (src/lib/queries.ts), the jobs (scripts/lib/jobs-core.ts), and mirrored by
 * the line_consensus view (supabase/migrations/0015). The audit found two
 * hand-rolled copies that had already drifted; this is the only one now.
 */

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

export function consensusFromSnapshots(snapshots: SnapshotLike[], before?: string): Consensus {
  const latestByProvider = new Map<string, SnapshotLike>();
  for (const s of snapshots) {
    if (before !== undefined && s.captured_at >= before) continue;
    const prev = latestByProvider.get(s.provider);
    if (!prev || s.captured_at > prev.captured_at) latestByProvider.set(s.provider, s);
  }
  const latest = [...latestByProvider.values()];
  const mean = (vals: Array<number | null | undefined>): number | null => {
    const nums = vals.filter((v): v is number => v !== null && v !== undefined);
    return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length;
  };
  const line = (vals: Array<number | null | undefined>): number | null => {
    const m = mean(vals);
    return m === null ? null : snapToHalf(m);
  };
  const price = (vals: Array<number | null | undefined>): number | null => {
    const m = mean(vals);
    return m === null ? null : Math.round(m);
  };
  return {
    spread: line(latest.map((s) => s.spread)),
    open: line(latest.map((s) => s.spread_open ?? s.spread)),
    total: line(latest.map((s) => s.total)),
    totalOpen: line(latest.map((s) => s.total_open ?? s.total)),
    mlHome: price(latest.map((s) => s.ml_home)),
    mlAway: price(latest.map((s) => s.ml_away)),
  };
}
