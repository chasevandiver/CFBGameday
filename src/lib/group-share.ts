/**
 * The share sheet's view of one member's week in one group.
 *
 * Built in one place because three screens offer the same share — the group
 * hub, the pick board and the week page — and a share sheet that says
 * something slightly different depending on which button you found is worse
 * than one that is hard to find.
 *
 * Pure: the caller does the querying, this does the shaping.
 */

import type { PickRow } from "./db-types";
import { DEFAULT_TZ, kickHeading } from "./kick";
import { pickKey } from "./session-picks";
import { tally } from "./records";
import type { SheetShare, ShareContext, SharePick } from "./share-text";
import { betSideLabel, type GameView } from "./slate";

/** Calendar day in `tz`, as a sortable key — the unit "today" is measured in. */
const dayKeyIn = (d: Date, tz: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);

/**
 * The slice of a pick this module needs.
 *
 * Wider than it looks: the four fields the body reads directly are
 * game_id/line_at_pick/market/side, but `tally()` reads result, units and clv
 * off the same rows for the day and week records. Grepping for `p.` finds the
 * first four and misses the last three — the type is what actually caught it.
 */
export type MyWeekPick = Pick<
  PickRow,
  "game_id" | "line_at_pick" | "market" | "side" | "result" | "units" | "clv"
>;

export function buildGroupShareContext({
  groupName,
  userName,
  week,
  myWeekPicks,
  gameById,
  lifetime,
  tz = DEFAULT_TZ,
  now = new Date(),
}: {
  groupName: string;
  userName: string;
  week: number;
  /**
   * The viewer's own picks for the week being shared. Narrowed to the four
   * columns this function reads (09:P-10) — the caller used to hand over whole
   * rows for the entire crew and filter them down here.
   */
  myWeekPicks: MyWeekPick[];
  gameById: Map<number, GameView>;
  /** Every graded pick the viewer has in this group, across seasons. */
  lifetime: Array<Pick<PickRow, "result" | "units" | "clv">>;
  tz?: string;
  now?: Date;
}): Omit<ShareContext, "justPlaced"> {
  const today = dayKeyIn(now, tz);
  const kicksToday = (p: MyWeekPick): boolean => {
    const ts = gameById.get(p.game_id)?.startTs ?? null;
    return ts !== null && dayKeyIn(new Date(ts), tz) === today;
  };

  const todayRows = myWeekPicks.filter(kicksToday);
  const todayPicks: SharePick[] = todayRows.map((p) => {
    const g = gameById.get(p.game_id)!;
    return {
      key: pickKey(p.game_id, p.market),
      market: p.market,
      side: p.side,
      line: p.line_at_pick === null ? null : Number(p.line_at_pick),
      homeAbbr: g.home.abbr,
      awayAbbr: g.away.abbr,
      kickTs: g.startTs,
      kickLabel: g.startTs === null ? null : kickHeading(g.startTs, tz),
    };
  });

  return {
    groupName,
    userName,
    week,
    day: new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(now),
    today: todayPicks,
    dayRecord: tally(todayRows),
    weekRecord: tally(myWeekPicks),
    lifetimeRecord: tally(lifetime),
  };
}

/**
 * A betting group's week, ready to text.
 *
 * Every position on the sheet, not just the viewer's — that is what makes it a
 * sheet rather than a brag — and each line names who put it up so the reader
 * knows whose call they'd be taking. The tail link carries the group slug so
 * the slate opens with this sheet in view rather than whichever group the
 * reader last looked at.
 */
export function buildSheetShareContext({
  groupName,
  userName,
  week,
  games,
  slug,
  siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? null,
  tz = DEFAULT_TZ,
  now = new Date(),
}: {
  groupName: string;
  userName: string;
  week: number;
  /** Games carrying at least one group position, kickoff order. */
  games: GameView[];
  slug: string;
  siteUrl?: string | null;
  tz?: string;
  now?: Date;
}): SheetShare {
  const lines: SharePick[] = games.flatMap((g) =>
    g.groupBets.map((b) => {
      const side = betSideLabel(b.betType, b.side, b.line, g.home.abbr, g.away.abbr);
      // "Jeff — UGA -6.5 (2u) vs BAMA". The name leads because on a sheet the
      // question is always whose bet it is.
      return {
        key: String(b.betId),
        market: "spread" as const,
        side: b.side ?? "home",
        line: b.line,
        homeAbbr: g.home.abbr,
        awayAbbr: g.away.abbr,
        text: `${b.name} — ${side}${b.units === 1 ? "" : ` (${b.units}u)`} · ${g.away.abbr}/${g.home.abbr}`,
        kickTs: g.startTs,
        kickLabel: g.startTs === null ? null : kickHeading(g.startTs, tz),
      };
    }),
  );

  return {
    groupName,
    userName,
    week,
    day: new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(now),
    lines,
    tailUrl: siteUrl === null ? null : `${siteUrl.replace(/\/$/, "")}/slate?g=${slug}`,
  };
}
