/**
 * College basketball's own arithmetic — pure and client-safe.
 *
 * Everything here exists because the product was built around football and a
 * basketball game does not fit the same nouns: it has halves rather than
 * quarters, no possession arrow worth drawing, no down and distance, and a
 * calendar that runs by the DAY rather than by the week.
 *
 * ## A CBB "week" is a day
 *
 * `games.week` is `integer not null` and every loader, realtime channel and
 * poll in the app is keyed on `(season_id, week)`. Rather than fork all of
 * that for one league, a basketball game stores the DAY it is played on in
 * `week`: the number of days since November 1 of the season's start year, on
 * ESPN's own scoreboard date (US/Eastern, and the date the cbbmodel feed calls
 * `slate_date`). Day 0 is Nov 1; the 2026-27 opener (Nov 2) is day 1.
 *
 * That makes `fetchSlateView(season, week)` return exactly one day's board
 * with no change, `fetchCurrentSlate` roll the pointer from day to day the way
 * it rolls CFB from week to week, and a realtime room cover one night's games.
 * The number is never shown — `cbbDateOfDay` turns it back into a date for
 * every label — and `season_type` is always `regular`, so a March day that
 * mixes conference tournaments with the NCAA field is still one bucket.
 */

import { cbbSeasonId, seasonYearOf } from "./league";

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` → UTC midnight ms, or NaN for anything else. */
function dateMs(date: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
}

/** Nov 1 of the season's start year — day 0. */
export function cbbDayZero(seasonId: number): string {
  return `${seasonYearOf(seasonId)}-11-01`;
}

/** Days since Nov 1 for a `YYYY-MM-DD` board date. Null when unparseable. */
export function cbbDayIndex(seasonId: number, date: string): number | null {
  const ms = dateMs(date);
  if (!Number.isFinite(ms)) return null;
  return Math.round((ms - dateMs(cbbDayZero(seasonId))) / DAY_MS);
}

/** The inverse: the board date a stored day index stands for. */
export function cbbDateOfDay(seasonId: number, day: number): string {
  return new Date(dateMs(cbbDayZero(seasonId)) + day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Nov 1 through mid-April. The national title game is around day 156; the
 * headroom covers a late calendar without admitting a number that is clearly
 * not a day of the season.
 */
export const CBB_MAX_DAY = 180;

export function isValidCbbDay(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 0 && (n as number) <= CBB_MAX_DAY;
}

/**
 * The season being played right now, from the clock alone: a season opens in
 * July (ESPN's own boundary), so before July it is the one that started the
 * previous autumn. For labels that have a day index and no season row to
 * read; anything with a database handle should ask `seasons` instead.
 */
export function currentCbbSeasonId(now: Date = new Date()): number {
  const y = now.getUTCFullYear();
  return cbbSeasonId(now.getUTCMonth() >= 6 ? y : y - 1);
}

/** Today's board date in US/Eastern — the day ESPN and the feed are on. */
export function easternDate(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is the only reason it is used.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** `2026-11-12` → `20261112`, the form ESPN's `dates=` parameter takes. */
export function espnDateParam(date: string): string {
  return date.replaceAll("-", "");
}

/** "Thu, Nov 12" for a board date. Formatted in UTC because the date IS the
 *  value — running it through a viewer's zone would move it a day west. */
export function cbbDayLabel(date: string): string {
  const ms = dateMs(date);
  if (!Number.isFinite(ms)) return date;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(ms));
}

/* ---- the clock ----------------------------------------------------------- */

export const CBB_HALF_MIN = 20;
export const CBB_OT_MIN = 5;
export const CBB_REGULATION_MIN = 40;

/** 1H, 2H, OT, 2OT. Period 3 is the first overtime. */
export function cbbPeriodLabel(period: number | null): string {
  if (period === null || period < 1) return "";
  if (period <= 2) return `${period}H`;
  return period === 3 ? "OT" : `${period - 2}OT`;
}

function isZeroClock(clock: string): boolean {
  return /^0+:00(\.0+)?$/.test(clock.trim());
}

/**
 * The break a game is sitting in, or null while it is being played.
 *
 * ESPN reports halftime as period 1 with an expired clock (verified against
 * the live feed, USC at Cal, 2026-11-11: `STATUS_HALFTIME`, period 1, 0:00),
 * so the stored period and clock are enough and no status column is needed —
 * the same derivation `breakLabel` makes for football.
 */
export function cbbBreakLabel(period: number | null, clock: string | null): string | null {
  if (period === null || period < 1 || !clock || !isZeroClock(clock)) return null;
  return period === 1 ? "HALFTIME" : `END ${cbbPeriodLabel(period)}`;
}

/** "12:34" or "34.5" (ESPN drops the minutes under a minute) → seconds. */
export function clockSeconds(clock: string | null): number | null {
  if (!clock) return null;
  const t = clock.trim();
  const mmss = /^(\d+):(\d\d)(?:\.\d+)?$/.exec(t);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  const ss = /^(\d+(?:\.\d+)?)$/.exec(t);
  return ss ? Math.floor(Number(ss[1])) : null;
}

/** Minutes of basketball played so far, overtime included. Null when unknown. */
export function cbbElapsedMinutes(period: number | null, clock: string | null): number | null {
  if (period === null || period < 1) return null;
  const left = clockSeconds(clock);
  if (left === null) return null;
  const length = period <= 2 ? CBB_HALF_MIN : CBB_OT_MIN;
  const before = period <= 2 ? (period - 1) * CBB_HALF_MIN : CBB_REGULATION_MIN + (period - 3) * CBB_OT_MIN;
  // A clock above the period's length is a feed glitch; clamp, never negative.
  return before + Math.max(0, length - Math.min(left / 60, length));
}

/** Last four minutes of the second half or any overtime — the card's tense
 *  treatment, the equivalent of football's two-minute warning. */
export function cbbCrunchTime(period: number | null, clock: string | null): boolean {
  if (period === null || period < 2 || !clock || isZeroClock(clock)) return false;
  const left = clockSeconds(clock);
  return left !== null && left < 4 * 60;
}

/**
 * The final total this game is on pace for, over regulation.
 *
 * Straight-line: points so far ÷ minutes played × 40. It is deliberately the
 * naive number a fan computes in their head, not a model — the card prints it
 * beside the market total so "148 pace against 141.5" reads at a glance, and a
 * cleverer estimate (late fouling inflates the last two minutes) would be a
 * number nobody could check.
 *
 * Null for the first four minutes, where one made three is a 20-point swing in
 * the projection, and in overtime, where "pace over regulation" has stopped
 * meaning anything and the real total is already on the scoreboard.
 */
export const PACE_MIN_ELAPSED = 4;

export function cbbPace(
  homePoints: number | null,
  awayPoints: number | null,
  period: number | null,
  clock: string | null,
): number | null {
  if (homePoints === null || awayPoints === null || period === null || period > 2) return null;
  const elapsed = cbbElapsedMinutes(period, clock);
  if (elapsed === null || elapsed < PACE_MIN_ELAPSED) return null;
  return Math.round(((homePoints + awayPoints) / elapsed) * CBB_REGULATION_MIN);
}

/* ---- runs ----------------------------------------------------------------- */

/** Unanswered points: the side on the run and how many. */
export interface CbbRun {
  side: "home" | "away";
  pts: number;
}

/**
 * Advance the run across one observed score change.
 *
 * The writer sees scores every 30 seconds, not every basket, so this is built
 * from deltas: one side scoring extends its run or starts a new one. When BOTH
 * sides scored inside one tick the order is unknowable from the scores alone —
 * `lastScorer` is ESPN's last play, when that play was a basket — and without
 * it the run is cleared rather than guessed. A run that is cleared wrongly
 * costs a chip; a run that is invented prints "12-0 run" over a 12-10 stretch.
 */
export function nextRun(
  prev: CbbRun | null,
  delta: { home: number; away: number },
  lastScorer: { side: "home" | "away"; pts: number } | null = null,
): CbbRun | null {
  const { home: dh, away: da } = delta;
  // Points never come off the board; a negative delta is a stat correction.
  if (dh < 0 || da < 0) return null;
  if (dh === 0 && da === 0) return prev;
  if (dh > 0 && da > 0) {
    return lastScorer && lastScorer.pts > 0 ? { side: lastScorer.side, pts: lastScorer.pts } : null;
  }
  const side = dh > 0 ? "home" : "away";
  const pts = dh > 0 ? dh : da;
  return prev && prev.side === side ? { side, pts: prev.pts + pts } : { side, pts };
}

/** A run worth a chip. Seven is the smallest run a broadcast calls a run. */
export const RUN_MIN = 7;

export function runLabel(run: CbbRun | null | undefined): string | null {
  return run && run.pts >= RUN_MIN ? `${run.pts}-0 run` : null;
}

/* ---- the stored live block ------------------------------------------------ */

/**
 * `games.hoops` (jsonb, 0084): the basketball-only live state that has no
 * column of its own. Written by the same two writers as the score, diffed the
 * same way, null on every football row.
 */
export interface CbbLive {
  /** Points by period, home then away: halves first, then each overtime. */
  h: number[];
  a: number[];
  /** Unanswered points, or null when nobody is on one. */
  run: CbbRun | null;
  /** ESPN's live home win probability, 0–1; null when the feed has none. */
  wp: number | null;
}

export function isCbbLive(v: unknown): v is CbbLive {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.h) && Array.isArray(o.a);
}

/** Halftime score from the stored line score, for first-half bets. */
export function cbbHalftime(live: CbbLive | null): { home: number; away: number } | null {
  if (!live || live.h.length < 1 || live.a.length < 1) return null;
  const home = live.h[0];
  const away = live.a[0];
  return Number.isFinite(home) && Number.isFinite(away) ? { home, away } : null;
}

/* ---- fouls and the bonus --------------------------------------------------- */

/** Men's college basketball: one-and-one at 7 team fouls in a half, two shots at 10. */
export const BONUS_AT = 7;
export const DOUBLE_BONUS_AT = 10;

export type BonusState = "bonus" | "double" | null;

/** What a team is shooting, given the fouls its OPPONENT has committed this half. */
export function bonusFor(opponentFouls: number): BonusState {
  return opponentFouls >= DOUBLE_BONUS_AT ? "double" : opponentFouls >= BONUS_AT ? "bonus" : null;
}

/**
 * The half whose foul count is live. Overtime is an extension of the second
 * half under NCAA rules — fouls carry over — so every period from 2 on reads
 * the second-half bucket.
 */
export function foulHalf(period: number | null): 1 | 2 {
  return period !== null && period >= 2 ? 2 : 1;
}

/* ---- tip windows ----------------------------------------------------------- */

export type CbbTipSlot = "Afternoon" | "Evening" | "Late";

/**
 * The night's three windows, on Eastern time like the schedule itself: the
 * noon-to-four games, the 6–9 heart of the card, and the West Coast late
 * tips. Coarser than football's four slots because a basketball night has no
 * 3:30 window to name.
 */
export function cbbTipSlot(iso: string): CbbTipSlot {
  const h = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(new Date(iso)),
  );
  // Intl prints midnight as 24 under hour12:false in some engines; a 12:00 AM
  // ET tip is the end of the late window, not the start of the afternoon.
  if (h >= 21 || h < 5 || h === 24) return "Late";
  return h < 17 ? "Afternoon" : "Evening";
}

/* ---- the live read: cover and pace against the market ---------------------- */

export interface HoopsRead {
  /** Who is covering the market spread at this score, and by how much. */
  cover: { side: "home" | "away" | "push"; by: number } | null;
  /** Projected regulation total (see `cbbPace`), or null when it says nothing. */
  pace: number | null;
  /** The market total it is read against. */
  total: number | null;
  /** Pace minus the market total; positive is running over. */
  paceVsTotal: number | null;
}

/**
 * The two things a basketball bettor checks every time they pick the phone
 * up: is the favourite covering, and is this game going over.
 *
 * Football's card answers the first with the cover strip, but only for a
 * position you hold. Basketball states both for every lined game, bet or not,
 * because that IS the scoreboard for this audience — and because a spread in
 * a 150-point game is live from the opening tip in a way a football spread is
 * not. Lines are home-perspective (negative = home favoured), as everywhere.
 */
export function hoopsRead(g: {
  homePoints: number | null;
  awayPoints: number | null;
  period: number | null;
  clock: string | null;
  lines: { spread: number | null; total: number | null };
}): HoopsRead {
  const { homePoints: h, awayPoints: a } = g;
  let cover: HoopsRead["cover"] = null;
  if (g.lines.spread !== null && h !== null && a !== null) {
    // Same arithmetic as cover.ts's coverMargin for the home side; restated
    // here only so this module stays free of imports and client-safe.
    const cm = h - a + g.lines.spread;
    cover = { side: cm > 0 ? "home" : cm < 0 ? "away" : "push", by: Math.abs(Math.round(cm * 10) / 10) };
  }
  const pace = cbbPace(h, a, g.period, g.clock);
  const total = g.lines.total;
  return {
    cover,
    pace,
    total,
    paceVsTotal: pace !== null && total !== null ? Math.round((pace - total) * 10) / 10 : null,
  };
}
