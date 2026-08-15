/**
 * A group's week calendar — preseason, regular season and postseason as three
 * separate runs of weeks rather than one ambiguous number.
 *
 * ## The bug this exists for
 *
 * Owner report, 2026-08-15: "The Groups tab doesn't have the correct weeks in
 * order. It says preseason week 2 is listed on the groups tab as week 2, with
 * the first set of games not being listed on the week 5."
 *
 * Exactly right, and the cause is that the group pages carried **week** in the
 * URL and took **season type** from whatever the calendar happened to be
 * pointing at (`fetchCurrentSeasonWeek`). In the middle of August that pointer
 * says `preseason`, so:
 *
 *   * "Week 2" on a group page was NFL *preseason* week 2, labelled as if it
 *     were the second week of the season;
 *   * every `?week=` link stayed inside the preseason, so weeks 5+ resolved to
 *     a season type with nothing in it and the board came up empty;
 *   * the regular season — the "first set of games" — had no reachable link at
 *     all, because nothing in the group UI could change the season type.
 *
 * The slate has had this right since NFL-6: it carries `?st=pre|post` beside
 * `?week=`. This module is that model, shared, so the group pages can walk the
 * same ordered list instead of doing week arithmetic on a number whose meaning
 * changes underneath them.
 *
 * Pure. The week *lists* are structural (the NFL plays four preseason weeks and
 * eighteen regular ones; a CFB season may or may not open with Week 0, which is
 * why `minWeek` is passed in from `fetchCurrentSeasonWeek`), so nothing here
 * needs a database.
 */

import type { Sport } from "./league";
import type { SeasonType } from "./season";
import { NFL_PLAYOFF_ROUNDS, nflPlayoffLabel } from "./week-range";

export interface WeekRef {
  seasonType: SeasonType;
  week: number;
}

/** Last week of the regular season, by league. */
const LAST_REGULAR: Record<Sport, number> = { cfb: 16, nfl: 18 };

/**
 * Every week a league's season addresses, in the order they are played.
 *
 * CFB has no preseason (`season_type` only ever holds regular or postseason
 * there) and one postseason entry — its January is a month of bowls, not four
 * rounds. The NFL has both: four preseason weeks, week 1 being the Hall of Fame
 * game, and four playoff rounds stored 1–4 with the Pro Bowl dropped
 * (`src/lib/espn.ts:418`).
 */
export function seasonWeeks(sport: Sport, minWeek: number): WeekRef[] {
  const out: WeekRef[] = [];
  if (sport === "nfl") {
    for (let w = 1; w <= 4; w++) out.push({ seasonType: "preseason", week: w });
  }
  for (let w = minWeek; w <= LAST_REGULAR[sport]; w++) {
    out.push({ seasonType: "regular", week: w });
  }
  if (sport === "nfl") {
    for (const r of NFL_PLAYOFF_ROUNDS) out.push({ seasonType: "postseason", week: r.week });
  } else {
    out.push({ seasonType: "postseason", week: 1 });
  }
  return out;
}

export const sameWeek = (a: WeekRef, b: WeekRef): boolean =>
  a.week === b.week && a.seasonType === b.seasonType;

/** Position in the ordered calendar, or -1 when the ref is off it. */
export const weekIndex = (weeks: WeekRef[], ref: WeekRef): number =>
  weeks.findIndex((w) => sameWeek(w, ref));

/**
 * The full name of a week: "Preseason Week 2", "Week 3", "Wild Card".
 *
 * Never a bare number for anything but the regular season — the whole defect
 * was a preseason week rendering as "Week 2".
 */
export function weekLabel(ref: WeekRef, sport: Sport): string {
  if (ref.seasonType === "preseason") return `Preseason Week ${ref.week}`;
  if (ref.seasonType === "postseason") {
    return sport === "nfl" ? (nflPlayoffLabel(ref.week) ?? `Round ${ref.week}`) : "Bowls & CFP";
  }
  return `Week ${ref.week}`;
}

/** The same, for a `<select>` option or a chevron's aria-label. */
export function shortWeekLabel(ref: WeekRef, sport: Sport): string {
  if (ref.seasonType === "preseason") return `Pre ${ref.week}`;
  return weekLabel(ref, sport);
}

/** Which run of the calendar a week belongs to — the `<optgroup>` heading. */
export function seasonTypeLabel(t: SeasonType): string {
  return t === "preseason" ? "Preseason" : t === "postseason" ? "Postseason" : "Regular season";
}

/** `?st=` as the slate spells it. Absent for the regular season, which is the default. */
export const stParam = (t: SeasonType): string | null =>
  t === "preseason" ? "pre" : t === "postseason" ? "post" : null;

/** The query string for a week, with any extra params appended in order. */
export function weekQuery(ref: WeekRef, extra: Record<string, string | null> = {}): string {
  const qs = new URLSearchParams();
  qs.set("week", String(ref.week));
  const st = stParam(ref.seasonType);
  if (st) qs.set("st", st);
  for (const [k, v] of Object.entries(extra)) if (v) qs.set(k, v);
  return `?${qs.toString()}`;
}

/**
 * Read a week out of the URL.
 *
 * `?st=` decides the season type and `?week=` the number within it, matching
 * `/slate`. With neither, the caller's `fallback` — normally the live calendar
 * pointer — stands. An out-of-range week clamps to the nearest week that
 * actually exists rather than 404ing, because these links are walked with
 * chevrons and the end of the preseason is a real place to stop.
 */
export function parseWeekRef(
  weekParam: string | undefined | null,
  typeParam: string | undefined | null,
  weeks: WeekRef[],
  fallback: WeekRef,
): WeekRef {
  const seasonType: SeasonType | null =
    typeParam === "pre" ? "preseason" : typeParam === "post" ? "postseason" : typeParam === "reg" ? "regular" : null;
  const n = Number(weekParam);
  const hasWeek = weekParam !== undefined && weekParam !== null && weekParam !== "" && Number.isInteger(n);
  if (seasonType === null && !hasWeek) return fallback;
  // A `?week=` with no `?st=` means the regular season, the way `/slate` reads
  // it — otherwise a bare number would keep inheriting the preseason, which is
  // the defect.
  const type: SeasonType = seasonType ?? "regular";
  const within = weeks.filter((w) => w.seasonType === type);
  if (within.length === 0) return fallback;
  if (!hasWeek) return within[0];
  return within.find((w) => w.week === n) ?? clamp(within, n);
}

const clamp = (within: WeekRef[], n: number): WeekRef =>
  n < within[0].week ? within[0] : within[within.length - 1];

/**
 * Whether a pick'em board can exist for this week.
 *
 * The preseason deliberately has none: `set_group_week_config` (0020, amended
 * 0042) rejects `season_type = 'preseason'` — real games, real lines, real
 * bets, no boards and no model. That rule is invisible in the UI, which is half
 * of why an August group page looked broken rather than out of season.
 */
export const boardRunsIn = (ref: WeekRef): boolean => ref.seasonType !== "preseason";

/** `&st=pre` / `&st=post`, or "" — for appending to a URL that already has a `?`. */
export const stQuery = (ref: WeekRef): string => {
  const st = stParam(ref.seasonType);
  return st ? `&st=${st}` : "";
};

/** The first week of the regular season: where "the first set of games" is. */
export const firstRegular = (weeks: WeekRef[]): WeekRef | null =>
  weeks.find((w) => w.seasonType === "regular") ?? null;
