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
import { statusForBet } from "./live-status";
import {
  byLeagueRules,
  EMPTY_TALLY,
  payoutAt,
  tally,
  type Numeric,
  type Tally,
  type Wager,
  type WagerResult,
} from "./records";
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
  /**
   * Where the game is, for a wager the grader has not settled yet. Null when
   * the wager is settled, when its game has not kicked off, or when the score
   * cannot answer it (a team total, a first half, a future).
   */
  standingState?: StandingState;
  /** How it would grade on the board as it stands. Null with `standingState`. */
  standing?: WagerResult;
  /** American price — what a projected win would actually pay. */
  odds?: Numeric | null;
}

/**
 * Two kinds of not-yet-settled, and they are different facts.
 *
 * `in_progress` is a sweat: the number can still move, and it is what "how are
 * we doing live" is asking about. `final` is a game that is over and a grader
 * that has not run — Sunday morning on an NFL week, or any Saturday night
 * before the settle pass. Both belong in the projection; only the first is
 * live, so only the first wears the dot.
 */
export type StandingState = "in_progress" | "final" | null;

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

/**
 * One slice of a book — a week, a day, a member's day — answered twice.
 *
 * Owner, 2026-09-15, on the first cut of these lists: *"So it only shows when
 * everything is graded? I want live week by week and day by day to see how
 * we're doing live."* Fair: `settled` alone is blank all Saturday afternoon and
 * wrong all Sunday morning, because the grader runs after the games, not during
 * them.
 *
 * `now` is the same three cuts with every unsettled wager graded off the board
 * as it stands. It is the number a phone propped against a TV wants, and it is
 * provisional by construction — which is why `settled` is kept beside it rather
 * than replaced, and why the surfaces render both.
 */
export interface SliceRecord {
  /** Stored results only. The truth, and it does not move. */
  settled: LeagueSplit;
  /** Stored results plus the board. Identical to `settled` when nothing is out. */
  now: LeagueSplit;
  /** Wagers riding on a game being played right now. */
  live: number;
  /** Wagers `now` graded off the board — the live ones plus finals not yet settled. */
  projected: number;
  /** Wagers on a game that has not kicked off. Nothing can say anything yet. */
  upcoming: number;
}

export const EMPTY_SLICE: SliceRecord = {
  settled: { total: EMPTY_TALLY, cfb: EMPTY_TALLY, nfl: EMPTY_TALLY },
  now: { total: EMPTY_TALLY, cfb: EMPTY_TALLY, nfl: EMPTY_TALLY },
  live: 0,
  projected: 0,
  upcoming: 0,
};

/** True for a wager the grader has settled — the only ones `settled` counts. */
const isSettled = (w: WeekWager): boolean => w.result !== null && w.result !== undefined;

/** True once the board can answer for it. Both fields are optional, so this
 *  has to reject `undefined` as well as `null`. */
const hasStanding = (w: WeekWager): boolean =>
  w.standing !== null && w.standing !== undefined;

/**
 * A wager as the board would grade it: the stored row when there is one, else
 * the standing, priced at the wager's own odds through the grader's own
 * formula (`payoutAt`). No odds means no price to grade at, and `tally` falls
 * back to the −110 convention rather than dropping the wager.
 */
function asOfNow<T extends WeekWager>(w: T): T {
  if (isSettled(w) || !w.standing) return w;
  return { ...w, result: w.standing, payoutUnits: payoutAt(w.units, w.odds, w.standing) };
}

/** Both readings of a slice, plus what is still out. */
export function sliceRecord(wagers: readonly WeekWager[]): SliceRecord {
  const open = wagers.filter((w) => !isSettled(w));
  const scored = open.filter(hasStanding);
  return {
    settled: leagueSplit(wagers.filter(isSettled)),
    now: leagueSplit(wagers.map(asOfNow)),
    live: scored.filter((w) => w.standingState === "in_progress").length,
    projected: scored.length,
    upcoming: open.length - scored.length,
  };
}

/**
 * A ledger row's standing off the board, or nulls when nothing can be said.
 *
 * The rule is `settledResult`'s, one step earlier: a stored result always wins,
 * and a score answers only for the types a full-game score can settle — a team
 * total, a first half and a future stay open until somebody enters them, which
 * is by design (`statusForBet` returns null for all three). A game with no
 * score on the board yet is not in progress as far as this is concerned.
 */
export function standingOf(
  bet: { betType: string | null; side: string | null; line: number | null },
  game:
    | { status: string; home_points: number | null; away_points: number | null }
    | undefined
    | null,
): { standingState: StandingState; standing: WagerResult } {
  const none = { standingState: null, standing: null } as const;
  if (!game) return none;
  if (game.status !== "in_progress" && game.status !== "final") return none;
  if (game.home_points === null || game.away_points === null) return none;
  const status = statusForBet(
    { betType: bet.betType ?? "", side: bet.side, line: bet.line },
    game.home_points,
    game.away_points,
  );
  if (!status) return none;
  return {
    standingState: game.status === "in_progress" ? "in_progress" : "final",
    standing: status.state === "winning" ? "win" : status.state === "losing" ? "loss" : "push",
  };
}

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

/* ── Refresh cadence ─────────────────────────────────────────────────────── */

/** The tiers `useLiveRefresh` takes, same shape as the hub's `homeRefreshTier`. */
export interface RefreshTier {
  live: boolean;
  imminent: boolean;
}

/**
 * How hard a page carrying these wagers should poll.
 *
 * A live record that only moves when you pull to refresh is not live, and both
 * surfaces are server components — so the page has to ask for itself again
 * (`LiveRefresh`). Decided by the positions rather than by the calendar, which
 * is the lesson `homeRefreshTier` was rewritten for: a CFB-week check left the
 * hub idling through a live NFL game the owner had money on.
 *
 * `imminent` uses the slate's window — kickoff inside six hours, or up to three
 * hours past a start that has not flipped to in_progress — bounded on both
 * sides so a permanently-stuck scheduled game cannot hold the fast tier open
 * forever.
 *
 * `now` is a parameter, never `Date.now()` inside, so the tier is a pure
 * function of what the page loaded.
 */
export function refreshTier(wagers: readonly WeekWager[], now: number): RefreshTier {
  if (wagers.some((w) => w.standingState === "in_progress")) return { live: true, imminent: true };
  const imminent = wagers.some((w) => {
    /* Settled, or already scored off the board — neither is waiting to start.
       Tested against the standing rather than the state because both fields
       are optional: an absent one is `undefined`, and `!== null` let every
       caller that omits them fall straight through this guard. */
    if (isSettled(w) || hasStanding(w)) return false;
    if (w.startTs === null) return false;
    const dt = Date.parse(w.startTs) - now;
    return Number.isFinite(dt) && dt > -3 * 3600_000 && dt < 6 * 3600_000;
  });
  return { live: false, imminent };
}

/* ── Per member ──────────────────────────────────────────────────────────── */

export interface MemberSlice {
  userId: string;
  name: string;
  record: SliceRecord;
}

/**
 * One slice of a group's book, split per member and ranked the way a sheet
 * reads: most units first, League Rules #5 for the ties.
 *
 * **Ranked on `now`, not on `settled`** — the board as it stands, so a
 * leaderboard read at 4pm on a Saturday moves with the games instead of showing
 * the standings as of last Tuesday. Members with nothing decided even off the
 * board sort last rather than landing mid-table on a units total of zero: an
 * 0-0 is not better than a −1.0u, it is an absence of information. Members with
 * no wagers at all in the slice are absent entirely.
 */
export function memberRecords<T extends WeekWager & { userId: string }>(
  wagers: readonly T[],
  nameById: ReadonlyMap<string, string>,
): MemberSlice[] {
  const byUser = new Map<string, T[]>();
  for (const w of wagers) byUser.set(w.userId, [...(byUser.get(w.userId) ?? []), w]);
  return [...byUser.entries()]
    .map(([userId, list]) => ({
      userId,
      name: nameById.get(userId) ?? "—",
      record: sliceRecord(list),
    }))
    .sort(
      (a, b) =>
        Number(b.record.now.total.decided > 0) - Number(a.record.now.total.decided > 0) ||
        byLeagueRules(a.record.now.total, b.record.now.total) ||
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
