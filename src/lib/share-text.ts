/**
 * Plain-text renderings of a member's picks, for the iOS share sheet.
 *
 * Plain means plain. This lands in iMessage, where markdown is literal
 * asterisks and a leading `#` or `-` reads as a typo, and where the font is
 * proportional so no amount of padding will make columns line up. So: no
 * markup, no attempted alignment, one fact per line, and an em dash where a
 * separator is wanted.
 *
 * Pure and separate from the button so the exact strings can be pinned by
 * tests rather than eyeballed in a share sheet.
 */

import type { PickMarket } from "./grade";
import type { Tally } from "./records";
import { formatRecord } from "./records";
import { fmtSpread, fmtTotal, pickSideLabel } from "./slate";

export type ShareMode = "just-placed" | "today" | "day-record" | "lifetime";

export const SHARE_MODES: Array<{ key: ShareMode; label: string }> = [
  { key: "just-placed", label: "Just placed" },
  { key: "today", label: "All of today's picks" },
  { key: "day-record", label: "Record for the day" },
  { key: "lifetime", label: "Lifetime record" },
];

export interface SharePick {
  /** `${gameId}:${market}` — identifies a pick without leaking a row id. */
  key: string;
  market: PickMarket;
  side: string;
  /** Null for straight_up. */
  line: number | null;
  homeAbbr: string;
  awayAbbr: string;
  /**
   * Pre-formatted line, used verbatim when present. Ledger bets carry a
   * freeform description ("OSU win total o10.5") rather than a game and a
   * side, and there is no honest way to reconstruct one from the other.
   */
  text?: string;
  /** ISO kickoff, for ordering. Null when the game has no time yet. */
  kickTs?: string | null;
  /** Rendered kickoff, e.g. "SAT 2:30 PM CT". Absent = don't group by time. */
  kickLabel?: string | null;
}

export interface ShareContext {
  groupName: string;
  userName: string;
  week: number;
  /** Local day label, e.g. "Sat Sep 12". */
  day: string;
  today: SharePick[];
  justPlaced: SharePick[];
  dayRecord: Tally;
  weekRecord: Tally;
  lifetimeRecord: Tally;
}

const HEADER = "THE CFB SLATE";

/** "UGA -6.5 vs BAMA" · "Over 51.5 — UGA/BAMA" · "UGA to win vs BAMA" */
export function formatPick(p: SharePick): string {
  if (p.text) return p.text;
  const label = pickSideLabel(p.market, p.side, p.line, p.homeAbbr, p.awayAbbr);
  // A total names neither team, so the matchup goes after it rather than an
  // opponent going after a side that has none.
  if (p.market === "total") return `${label} — ${p.awayAbbr}/${p.homeAbbr}`;
  const opponent = p.side === "home" ? p.awayAbbr : p.homeAbbr;
  return `${label} vs ${opponent}`;
}

/**
 * Picks in kickoff order, grouped under the time they kick.
 *
 * A slip of eight is unreadable as a flat list — the person reading it in
 * iMessage is trying to work out what they can still watch, and that question
 * is answered by the clock, not by the order the picks were tapped. Games
 * without a kickoff sink to the bottom under their own heading rather than
 * being dropped or silently sorted first.
 *
 * Returns a single unlabelled group when nothing carries a kickoff, which is
 * the ledger's case — a freeform bet has no game to get a time from.
 */
export function groupByKickoff(
  picks: SharePick[],
): Array<{ label: string | null; picks: SharePick[] }> {
  if (!picks.some((p) => p.kickLabel)) return [{ label: null, picks }];
  const sorted = [...picks].sort((a, b) => {
    // Unscheduled last; among the rest, earliest first. Ties keep input order,
    // which is the order the picks were made.
    const at = a.kickTs ?? null;
    const bt = b.kickTs ?? null;
    if (at === bt) return 0;
    if (at === null) return 1;
    if (bt === null) return -1;
    return at.localeCompare(bt);
  });
  const out: Array<{ label: string | null; picks: SharePick[] }> = [];
  for (const p of sorted) {
    const label = p.kickLabel ?? "KICKOFF TBD";
    const last = out[out.length - 1];
    if (last && last.label === label) last.picks.push(p);
    else out.push({ label, picks: [p] });
  }
  return out;
}

const recordLine = (label: string, t: Tally): string =>
  `${label}: ${t.decided > 0 ? formatRecord(t) : "no action yet"}`;

/**
 * A betting group's sheet, as a text message with something to tap.
 *
 * The whole point of texting a sheet is that somebody reads it and gets on.
 * So the CTA is not decoration: it is a link back to the slate with this
 * group in view, where every game on the sheet carries a Tail button that
 * fills a slip at the number available right now. One link rather than one per
 * bet — a message with eight URLs in it is a message nobody taps.
 */
export interface SheetShare {
  groupName: string;
  userName: string;
  week: number;
  day: string;
  lines: SharePick[];
  /** Absolute URL to the slate with this group in view. Null = no CTA. */
  tailUrl: string | null;
}

export function bettingSheetText(s: SheetShare): string {
  const head = [`${HEADER} — ${s.groupName.toUpperCase()}`, `Week ${s.week} · ${s.day}`, ""];
  if (s.lines.length === 0) {
    return [...head, "Nothing on the sheet yet."].join("\n");
  }
  const body = groupByKickoff(s.lines).flatMap((g, i) =>
    g.label === null
      ? g.picks.map(formatPick)
      : [...(i > 0 ? [""] : []), g.label, ...g.picks.map(formatPick)],
  );
  const foot = [
    "",
    `${s.lines.length} ${s.lines.length === 1 ? "bet" : "bets"} on the sheet`,
  ];
  if (s.tailUrl) foot.push(`Tail any of them: ${s.tailUrl}`);
  return [...head, ...body, ...foot].join("\n");
}

/**
 * A slip of bets, as a text message.
 *
 * Separate from `shareText` because a bet slip is not a pick'em week: there is
 * no group, no lifetime record and no −110 convention, and the thing being
 * shared is a stake list. Same kickoff grouping, though — a slip is exactly the
 * case that made the flat list unreadable.
 */
export function betSlipText(
  bets: SharePick[],
  { day, week, totalUnits }: { day: string; week: number; totalUnits: number },
): string {
  const head = [`${HEADER} — BET SLIP`, `Week ${week} · ${day}`, ""];
  if (bets.length === 0) return [...head, "Nothing on the slip."].join("\n");
  const body = groupByKickoff(bets).flatMap((g, i) =>
    g.label === null
      ? g.picks.map(formatPick)
      : [...(i > 0 ? [""] : []), g.label, ...g.picks.map(formatPick)],
  );
  const unitLabel = Number.isInteger(totalUnits) ? String(totalUnits) : totalUnits.toFixed(1);
  return [
    ...head,
    ...body,
    "",
    `${bets.length} ${bets.length === 1 ? "bet" : "bets"} · ${unitLabel}u`,
  ].join("\n");
}

/**
 * The week's board itself, as rows — the games, the lines, the totals.
 *
 * The shape is the one this crew has always mailed around: an Excel
 * copy-paste of cells, one game a row, the HOME team's spread and the total
 * beside the matchup. So the body is TAB-separated — pasted into an email it
 * reads as columns, pasted into Excel or Sheets it lands as actual cells —
 * with no kickoff groupings, no market blurb, no chrome between the reader
 * and the rows. (The first version narrated each game in a sentence under a
 * kickoff heading; owner verdict 2026-08-28: "clunky and cumbersome. We
 * usually do match up, spread of home team and total next to it.")
 *
 * The spread column is the home number AS STORED — negative means the home
 * team lays it — because "spread of the home team" is the convention this
 * table has carried for years and a favourite-named rendering is exactly the
 * clutter that got rejected.
 */
export interface BoardShareGame {
  awaySchool: string;
  homeSchool: string;
  /** Consensus spread from the HOME side, the way the slate stores it. */
  spread: number | null;
  total: number | null;
  /** ISO kickoff, for row order. Null = TBD, sorted last. */
  kickTs: string | null;
}

export interface BoardShare {
  groupName: string;
  /** "Week 1", "Bowls & CFP" — group-weeks' own label. */
  weekLabel: string;
  markets: PickMarket[];
  /** 0 = the group sets no minimum. */
  minPicks: number;
  games: BoardShareGame[];
  /** Absolute URL to the picks board. Null = no CTA line. */
  boardUrl: string | null;
}

export function boardShareText(b: BoardShare): string {
  const title = `${b.groupName} — ${b.weekLabel}${
    b.minPicks > 0 ? ` · minimum ${b.minPicks} picks` : ""
  }`;
  if (b.games.length === 0) {
    return [title, "", "No games on the board yet."].join("\n");
  }

  // Kickoff order, TBD last — the row order the weekend plays in, without
  // burning rows on time headings.
  const sorted = [...b.games].sort((a, z) => {
    if (a.kickTs === z.kickTs) return 0;
    if (a.kickTs === null) return 1;
    if (z.kickTs === null) return -1;
    return a.kickTs.localeCompare(z.kickTs);
  });

  const spreads = b.markets.includes("spread");
  const totals = b.markets.includes("total");
  const cells = (g: BoardShareGame): string[] => [
    `${g.awaySchool} at ${g.homeSchool}`,
    ...(spreads ? [g.spread === null ? "–" : fmtSpread(g.spread)] : []),
    ...(totals ? [fmtTotal(g.total)] : []),
  ];

  const header = ["Game", ...(spreads ? ["Home line"] : []), ...(totals ? ["O/U"] : [])];
  const body =
    // A winners-only board is one column, and a one-column table with a
    // header row is a list wearing a hat.
    header.length > 1
      ? [header.join("\t"), ...sorted.map((g) => cells(g).join("\t"))]
      : sorted.map((g) => cells(g).join("\t"));

  const foot = b.boardUrl ? ["", `Make your picks: ${b.boardUrl}`] : [];
  return [title, "", ...body, ...foot].join("\n");
}

export function shareText(mode: ShareMode, c: ShareContext): string {
  const head = `${HEADER} — ${c.groupName}`;

  if (mode === "day-record") {
    return [
      head,
      `${c.userName} · ${c.day}`,
      "",
      recordLine("Today", c.dayRecord),
      recordLine(`Week ${c.week}`, c.weekRecord),
    ].join("\n");
  }

  if (mode === "lifetime") {
    const t = c.lifetimeRecord;
    const lines = [head, c.userName, "", recordLine("Lifetime", t)];
    // Units and ROI are only meaningful once something has been priced; a
    // straight-up-only pool never grades either, and "+0.0u · 0% ROI" would
    // read as a result rather than as an absence.
    if (t.staked > 0) {
      lines.push(`Units: ${t.units >= 0 ? "+" : ""}${t.units.toFixed(1)}`);
      if (t.roi !== null) lines.push(`ROI: ${(t.roi * 100).toFixed(1)}%`);
    }
    if (t.avgClv !== null) {
      lines.push(`Avg CLV: ${t.avgClv > 0 ? "+" : ""}${t.avgClv.toFixed(2)}`);
    }
    return lines.join("\n");
  }

  const picks = mode === "just-placed" ? c.justPlaced : c.today;
  if (picks.length === 0) {
    return [
      head,
      `${c.userName} · ${c.day}`,
      "",
      mode === "just-placed" ? "No picks placed yet." : "No picks today.",
    ].join("\n");
  }

  const body = groupByKickoff(picks).flatMap((g, i) =>
    g.label === null
      ? g.picks.map(formatPick)
      : [...(i > 0 ? [""] : []), g.label, ...g.picks.map(formatPick)],
  );

  return [
    head,
    `${c.userName} · Week ${c.week}`,
    "",
    ...body,
    "",
    `${picks.length} ${picks.length === 1 ? "pick" : "picks"} · ${c.day}`,
  ].join("\n");
}
