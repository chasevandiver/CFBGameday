/**
 * The Tuesday Drop's arithmetic (R2-B2) — pure, so vitest owns it and the
 * producer (scripts/generate-drop.ts) stays a thin IO shell, the same split
 * jobs-core keeps everywhere else.
 *
 * "Movement" and "dissent" are presentation math over rows that already
 * exist; nothing here touches the model. Movers compare the newest ratings
 * week to the one before it; dissent compares the model's own ordering to the
 * current human poll — the comparison /rankings already renders, condensed to
 * the one number a paragraph can defend.
 */

export interface DropRatingRow {
  team_id: number;
  week: number;
  overall: number;
}

export interface DropPollRow {
  team_id: number;
  rank: number;
}

export interface Mover {
  teamId: number;
  delta: number;
  overall: number;
}

export interface Dissent {
  teamId: number;
  pollRank: number;
  modelRank: number;
  /** poll − model: positive = the poll likes them more than we do. */
  gap: number;
}

/** Newest ratings week and the one before it, or null with fewer than two. */
export function weekPair(rows: DropRatingRow[]): { week: number; prev: number } | null {
  const weeks = [...new Set(rows.map((r) => r.week))].sort((a, b) => b - a);
  if (weeks.length < 2) return null;
  return { week: weeks[0]!, prev: weeks[1]! };
}

/** Biggest absolute movers, newest week vs previous. */
export function topMovers(rows: DropRatingRow[], week: number, prev: number, n = 8): Mover[] {
  const before = new Map(
    rows.filter((r) => r.week === prev).map((r) => [r.team_id, Number(r.overall)]),
  );
  return rows
    .filter((r) => r.week === week && before.has(r.team_id))
    .map((r) => ({
      teamId: r.team_id,
      delta: Number(r.overall) - before.get(r.team_id)!,
      overall: Number(r.overall),
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, n);
}

/** The model's 1-based rank per team at one ratings week. */
export function modelRanks(rows: DropRatingRow[], week: number): Map<number, number> {
  const atWeek = rows
    .filter((r) => r.week === week)
    .sort((a, b) => Number(b.overall) - Number(a.overall));
  return new Map(atWeek.map((r, i) => [r.team_id, i + 1]));
}

/** Where the model and the poll disagree, biggest gap first. */
export function dissents(ranks: Map<number, number>, poll: DropPollRow[]): Dissent[] {
  return poll
    .map((p) => {
      const modelRank = ranks.get(p.team_id);
      if (modelRank === undefined) return null;
      return { teamId: p.team_id, pollRank: p.rank, modelRank, gap: p.rank - modelRank };
    })
    .filter((d): d is Dissent => d !== null)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
}

/**
 * The week's argument: the position the paragraph defends. The largest
 * poll-vs-model gap wins; with no poll yet (early September), the biggest
 * mover carries the drop instead. Null means there is nothing defensible to
 * say — the producer skips rather than padding.
 */
export function pickSubject(
  m: Mover[],
  d: Dissent[],
): { kind: "dissent"; d: Dissent } | { kind: "mover"; m: Mover } | null {
  if (d.length > 0 && Math.abs(d[0]!.gap) >= 3) return { kind: "dissent", d: d[0]! };
  if (m.length > 0) return { kind: "mover", m: m[0]! };
  if (d.length > 0) return { kind: "dissent", d: d[0]! };
  return null;
}
