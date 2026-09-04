/**
 * Read every row of a query, a page at a time.
 *
 * PostgREST answers at most 1,000 rows per request (Supabase's `max-rows`),
 * and it does so **silently** — no error, no flag, the 1,001st row simply is
 * not there. Any read whose result can grow past that has to page, or it
 * truncates one day and nothing tells you.
 *
 * That day was 2026-09-03 (FREEZE-3). The Thursday freeze read every line
 * snapshot for the week's games in one request; Week 0 had 8 games and ~560
 * snapshots and worked, Week 1 had 91 games and 4,423 snapshots and got the
 * first 1,000 — which covered 20 games. The other 71 receipts were stamped
 * with no market line: no lean, no edge, no CLV, and a season record on a
 * fifth of the slate. The grader's closing-line read had the same shape.
 *
 * Lifted from `salience-data.ts`, where it was private, so the jobs and the
 * pages read through one implementation. The caller supplies the query with a
 * **stable order** — paging an unordered query can repeat or skip rows.
 */

/** PostgREST's ceiling. Read in pages of this and stop on a short one. */
export const PAGE = 1000;

export async function pageAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(String((error as { message?: string }).message ?? error));
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}
