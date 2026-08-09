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
import { fmtSpread, fmtTotal, lineForSide } from "./slate";

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
  const team = p.side === "home" ? p.homeAbbr : p.awayAbbr;
  const opponent = p.side === "home" ? p.awayAbbr : p.homeAbbr;
  if (p.market === "straight_up") return `${team} to win vs ${opponent}`;
  if (p.market === "spread")
    return `${team} ${fmtSpread(lineForSide(p.side, p.line))} vs ${opponent}`;
  const side = p.side === "over" ? "Over" : "Under";
  return `${side} ${fmtTotal(p.line)} — ${p.awayAbbr}/${p.homeAbbr}`;
}

const recordLine = (label: string, t: Tally): string =>
  `${label}: ${t.decided > 0 ? formatRecord(t) : "no action yet"}`;

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

  return [
    head,
    `${c.userName} · Week ${c.week}`,
    "",
    ...picks.map(formatPick),
    "",
    `${picks.length} ${picks.length === 1 ? "pick" : "picks"} · ${c.day}`,
  ].join("\n");
}
