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

/**
 * The NFL playoff rounds, by stored week (NFL-6).
 *
 * ESPN numbers its postseason 1 Wild Card · 2 Divisional · 3 Conference ·
 * 4 Pro Bowl · 5 Super Bowl. `nflStoredWeek` drops the Pro Bowl and stores the
 * Super Bowl at 4, so these are the stored numbers, not ESPN's — reading
 * `src/lib/espn.ts:418` and this list together is the only way that mapping
 * stays legible.
 *
 * Named rather than numbered because nobody calls it "postseason week 3". A
 * selector reading "Playoffs" for all four, which is what shipped, cannot say
 * which round you are looking at and cannot get you to the other three.
 */
export const NFL_PLAYOFF_ROUNDS = [
  { week: 1, label: "Wild Card" },
  { week: 2, label: "Divisional" },
  { week: 3, label: "Conference" },
  { week: 4, label: "Super Bowl" },
] as const;

/** The round name for a stored postseason week, or null outside 1–4. */
export function nflPlayoffLabel(week: number): string | null {
  return NFL_PLAYOFF_ROUNDS.find((r) => r.week === week)?.label ?? null;
}
