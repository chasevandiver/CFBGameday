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

/** Books only hang lines in half-point increments, so consensus must land on one. */
export function snapToHalf(v: number): number {
  return Math.round(v * 2) / 2;
}

/**
 * Consensus of the most recent snapshot per provider. Pass `before` (usually
 * kickoff) to get the closing consensus — the same cutoff the grading job
 * uses — instead of the latest one.
 */
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
