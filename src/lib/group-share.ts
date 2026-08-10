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
import type { ShareContext, SharePick } from "./share-text";
import type { GameView } from "./slate";

/** Calendar day in `tz`, as a sortable key — the unit "today" is measured in. */
const dayKeyIn = (d: Date, tz: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);

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
  /** The viewer's own picks for the week being shared. */
  myWeekPicks: PickRow[];
  gameById: Map<number, GameView>;
  /** Every graded pick the viewer has in this group, across seasons. */
  lifetime: Array<Pick<PickRow, "result" | "units" | "clv">>;
  tz?: string;
  now?: Date;
}): Omit<ShareContext, "justPlaced"> {
  const today = dayKeyIn(now, tz);
  const kicksToday = (p: PickRow): boolean => {
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
