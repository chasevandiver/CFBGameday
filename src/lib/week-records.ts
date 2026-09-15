/**
 * Week-by-week records, across both leagues at once.
 *
 * Owner request, 2026-09-15: *"In the ledger and on the betting groups, I need
 * to see the records week by week total, and also in cfb and nfl individually.
 * I also want to be able to sort by day for that specific week too."*
 *
 * ## Why a week here is not a `WeekRef`
 *
 * `lib/group-weeks.ts` owns the *league* week — the number on a calendar, one
 * league at a time, which is what a sheet or a board is keyed to. GRP-12 is the
 * scar: CFB week 3 and NFL week 2 are the same weekend, so neither number can
 * label a row that has to carry both.
 *
 * So the bucket here is the **weekend**, anchored on Tuesday, which is exactly
 * how both leagues already run: Thursday night, Friday, Saturday, Sunday, and
 * the Monday nighter that closes it. A Labor Day Monday lands with the
 * Thursday–Saturday games it was played alongside rather than opening the next
 * week, and the NFL's Tue→Mon week is reproduced exactly. That is also the only
 * definition under which "sort by day" means anything: Thu · Sat · Sun · Mon in
 * one row is a week of football, and a CFB-only week cannot show you Sunday.
 *
 * ## What this module does and does not do
 *
 * It **buckets**; it does not tally. The arithmetic stays in `records.ts` — the
 * module that exists because six surfaces once disagreed about what a record
 * is — so every number these buckets feed is `tally()`'s. `leagueSplit` is the
 * one convenience: the same three cuts (both, CFB, NFL) the owner asked for,
 * folded through that one function three times.
 *
 * Pure and database-free, like `records.ts` and `group-weeks.ts`. The caller
 * supplies each wager's kickoff — a bet has no week of its own; its game does.
 */

import { dayKey, dayTabLabel } from "./kick";
import { weekLabel, type WeekRef } from "./group-weeks";
import { sportOfSeasonId, type Sport } from "./league";
import { byLeagueRules, tally, type Tally, type Wager } from "./records";
import type { SeasonType } from "./season";
import { nflPlayoffLabel } from "./week-range";

/**
 * A wager with the game context a week needs.
 *
 * `startTs` is the kickoff and it is what places the wager, not `placed_at`: a
 * Tuesday-night bet on Saturday's game belongs to Saturday's week, which is the
 * week whose record it will decide. Null for a future or a freeform row — those
 * are in no week at all and are dropped rather than guessed at.
 */
export interface WeekWager extends Wager {
  seasonId: number;
  startTs: string | null;
  /** The game's own league week, for the label. Null when unknown. */
  week: number | null;
  /** The game's `season_type`, as stored. Anything unrecognised reads regular. */
  seasonType: string | null;
}

/** One slice of wagers, three ways: both leagues, then each on its own. */
export interface LeagueSplit {
  total: Tally;
  cfb: Tally;
  nfl: Tally;
}

/** The three cuts, all through `tally` — never a second arithmetic. */
export function leagueSplit<T extends Wager & { seasonId: number }>(
  wagers: readonly T[],
): LeagueSplit {
  return {
    total: tally(wagers),
    cfb: tally(wagers.filter((w) => sportOfSeasonId(w.seasonId) === "cfb")),
    nfl: tally(wagers.filter((w) => sportOfSeasonId(w.seasonId) === "nfl")),
  };
}

/** Graded-but-not-void is what a record counts; everything else is still open. */
export const pendingCount = (wagers: readonly Wager[]): number =>
  wagers.filter((w) => w.result === null || w.result === undefined).length;

export interface DayBucket<T> {
  /** Local date, `YYYY-MM-DD`. */
  key: string;
  /** "Sat" — weekday alone, because a football week holds each one once. */
  label: string;
  wagers: T[];
}

export interface WeekBucket<T> {
  /** The Tuesday the week opened, `YYYY-MM-DD` — the sort key and the React key. */
  key: string;
  /** "Week 3", "NFL Preseason Week 2", "CFB Wk 3 · NFL Wk 2". */
  label: string;
  /** "Sep 10–14" — the days that actually carry wagers, not the whole window. */
  range: string;
  wagers: T[];
  /** Chronological, and only the days something was bet on. */
  days: DayBucket<T>[];
}

/** Tuesday. The day both leagues' weeks turn over. */
const WEEK_ANCHOR_DOW = 2;

/**
 * The Tuesday that opened the week containing `iso`, as a local date key.
 *
 * Resolved to a local calendar date first, then walked back in UTC — a naive
 * date has no DST to fall into, which a `setDate` on a zoned Date does.
 */
export function footballWeekKey(iso: string, tz: string): string {
  const [y, m, d] = dayKey(iso, tz).split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() - WEEK_ANCHOR_DOW + 7) % 7));
  return at.toISOString().slice(0, 10);
}

/**
 * Wagers into weeks, newest week first, each with its days oldest first.
 *
 * Wagers with no kickoff are dropped — see `WeekWager.startTs`. Count them with
 * `undatedCount` if the surface wants to say so, which it should: a ledger that
 * silently loses three futures is a ledger whose totals do not add up.
 */
export function weekBuckets<T extends WeekWager>(wagers: readonly T[], tz: string): WeekBucket<T>[] {
  const weeks = new Map<string, Map<string, T[]>>();
  for (const w of wagers) {
    if (w.startTs === null) continue;
    const wk = footballWeekKey(w.startTs, tz);
    const day = dayKey(w.startTs, tz);
    const days = weeks.get(wk) ?? new Map<string, T[]>();
    days.set(day, [...(days.get(day) ?? []), w]);
    weeks.set(wk, days);
  }

  return [...weeks.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, dayMap]) => {
      const days = [...dayMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dk, list]) => ({
          key: dk,
          label: dayTabLabel(list[0].startTs as string, tz),
          wagers: list,
        }));
      const flat = days.flatMap((d) => d.wagers);
      return {
        key,
        label: weekBucketLabel(flat),
        range: rangeLabel(days[0].key, days[days.length - 1].key),
        wagers: flat,
        days,
      };
    });
}

/** How many wagers a surface is about to leave out of every week below. */
export const undatedCount = (wagers: readonly WeekWager[]): number =>
  wagers.filter((w) => w.startTs === null).length;

/* ── Per member ──────────────────────────────────────────────────────────── */

export interface MemberSplit {
  userId: string;
  name: string;
  split: LeagueSplit;
  pending: number;
}

/**
 * One slice of a group's book, split per member and ranked the way a sheet
 * reads: most units first, League Rules #5 for the ties.
 *
 * Members with nothing decided in the slice sort last rather than landing
 * mid-table on a units total of zero — an 0-0 is not better than a −1.0u, it is
 * an absence of information, and a week list that opened with the people who
 * had no action in it would be answering the wrong question. Members with no
 * wagers at all in the slice are absent entirely.
 */
export function memberSplits<T extends WeekWager & { userId: string }>(
  wagers: readonly T[],
  nameById: ReadonlyMap<string, string>,
): MemberSplit[] {
  const byUser = new Map<string, T[]>();
  for (const w of wagers) byUser.set(w.userId, [...(byUser.get(w.userId) ?? []), w]);
  return [...byUser.entries()]
    .map(([userId, list]) => ({
      userId,
      name: nameById.get(userId) ?? "—",
      split: leagueSplit(list),
      pending: pendingCount(list),
    }))
    .sort(
      (a, b) =>
        Number(b.split.total.decided > 0) - Number(a.split.total.decided > 0) ||
        byLeagueRules(a.split.total, b.split.total) ||
        a.name.localeCompare(b.name),
    );
}

/* ── Labels ──────────────────────────────────────────────────────────────── */

const asSeasonType = (v: string | null): SeasonType =>
  v === "preseason" ? "preseason" : v === "postseason" ? "postseason" : "regular";

/**
 * The league week most of this bucket's wagers sat on, or null when the league
 * is absent from it.
 *
 * Modal rather than first: a rescheduled game keeps its own `week`, and one
 * makeup carried over from Week 2 must not rename the week everything else was
 * played in. Ties break on the lower week, so the answer is stable.
 */
function modalWeek(wagers: readonly WeekWager[], sport: Sport): WeekRef | null {
  const counts = new Map<string, { ref: WeekRef; n: number }>();
  for (const w of wagers) {
    if (w.week === null || sportOfSeasonId(w.seasonId) !== sport) continue;
    const ref: WeekRef = { seasonType: asSeasonType(w.seasonType), week: w.week };
    const k = `${ref.seasonType}:${ref.week}`;
    const hit = counts.get(k);
    if (hit) hit.n += 1;
    else counts.set(k, { ref, n: 1 });
  }
  let best: { ref: WeekRef; n: number } | null = null;
  for (const c of counts.values()) {
    if (best === null || c.n > best.n || (c.n === best.n && c.ref.week < best.ref.week)) best = c;
  }
  return best?.ref ?? null;
}

/** "Wk 3" / "Pre 2" / "Wild Card" — the short form, for when both leagues show. */
function shortToken(ref: WeekRef, sport: Sport): string {
  if (ref.seasonType === "preseason") return `Pre ${ref.week}`;
  if (ref.seasonType === "postseason") {
    return sport === "nfl" ? (nflPlayoffLabel(ref.week) ?? `Rd ${ref.week}`) : "Bowls";
  }
  return `Wk ${ref.week}`;
}

/**
 * What to call a week.
 *
 * One league in it, and the league's own name for the week is the whole answer
 * ("Week 3"), NFL-prefixed so an NFL-only week is not mistaken for a Saturday.
 * Both leagues in it, and neither number can stand alone — GRP-12's lesson — so
 * both are named: "CFB Wk 3 · NFL Wk 2".
 */
export function weekBucketLabel(wagers: readonly WeekWager[]): string {
  const cfb = modalWeek(wagers, "cfb");
  const nfl = modalWeek(wagers, "nfl");
  if (cfb && nfl) return `CFB ${shortToken(cfb, "cfb")} · NFL ${shortToken(nfl, "nfl")}`;
  if (cfb) return weekLabel(cfb, "cfb");
  if (nfl) return `NFL ${weekLabel(nfl, "nfl")}`;
  return "Week";
}

const monthDay = (key: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(
    new Date(`${key}T12:00:00Z`),
  );

/** "Sep 13", "Sep 10–14", "Sep 28 – Oct 1". */
export function rangeLabel(first: string, last: string): string {
  if (first === last) return monthDay(first);
  if (first.slice(0, 7) === last.slice(0, 7)) return `${monthDay(first)}–${Number(last.slice(8))}`;
  return `${monthDay(first)} – ${monthDay(last)}`;
}
