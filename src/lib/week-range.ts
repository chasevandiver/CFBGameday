/**
 * One week range, one place.
 *
 * Eight routes used to carry their own `parsed >= 1 && parsed <= 20`. `UX-17`
 * aligned the numbers; it did not stop them being eight copies, and the moment
 * Week 0 became real (see `scripts/lib/weeks.ts`) every one of them was wrong
 * in the same way — an Aug 29 slate that 404s or silently redirects to Week 1
 * is exactly the bug the audit's "one week range everywhere" item was about.
 *
 * Week 0 is a real week: the last Saturday of August, and where this product's
 * season starts (SPEC §249). Week 20 is generous headroom over a 15-week
 * regular season plus championship week; the postseason is addressed by
 * `season_type`, not by week number.
 */

export const MIN_WEEK = 0;
export const MAX_WEEK = 20;

/** True for an integer inside the addressable week range. */
export function isValidWeek(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= MIN_WEEK && (n as number) <= MAX_WEEK;
}

/**
 * A `?week=` param as a number, or null when absent//out of range — so callers
 * fall back to the current week instead of rendering an empty slate.
 */
export function parseWeekParam(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return isValidWeek(n) ? n : null;
}
