/**
 * Ticket stubs (FUN-7) — a stub per graded week, derived on every read the
 * way trophies and streaks are: nothing stored, nothing to backfill, and a
 * re-graded week silently reprints the stub, which is correct.
 *
 * Picks only, deliberately. Bets carry no week of their own (a future has no
 * game), and a stub is an attendance token — "I was in that Saturday" — which
 * is what making picks means. A week mints once every one of its picks is
 * graded and at least one of them decided; a void-only week bought no ticket.
 */

export interface StubPickRow {
  week: number;
  result: "win" | "loss" | "push" | "void" | null;
}

export interface WeekStub {
  week: number;
  w: number;
  l: number;
  p: number;
}

export function stubsFor(rows: StubPickRow[]): WeekStub[] {
  const byWeek = new Map<number, { w: number; l: number; p: number; open: boolean }>();
  for (const r of rows) {
    const t = byWeek.get(r.week) ?? { w: 0, l: 0, p: 0, open: false };
    if (r.result === "win") t.w++;
    else if (r.result === "loss") t.l++;
    else if (r.result === "push") t.p++;
    else if (r.result === null) t.open = true;
    // voids count for nothing, in either direction
    byWeek.set(r.week, t);
  }
  return [...byWeek.entries()]
    .filter(([, t]) => !t.open && t.w + t.l + t.p > 0)
    .map(([week, t]) => ({ week, w: t.w, l: t.l, p: t.p }))
    .sort((a, b) => a.week - b.week);
}
