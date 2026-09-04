/**
 * What the manual bet form should suggest once a game, a market and a side
 * are chosen (owner request 2026-09-04: "if I do a live game or one that
 * happened, I want to be able to just click whatever the closing line is for
 * that bet unless I want to change it").
 *
 * The slate's slip fills itself from the odds cell you tapped; the manual
 * form exists for everything the slip cannot reach — a game that has already
 * kicked off, a text that arrived after the fact — and until now it asked for
 * the number cold. The suggestion is the same consensus the slate card shows
 * (`line_consensus`): for a game that has started or finished that IS the
 * closing number as far as the site knows it, for a scheduled game it is the
 * current one, and the label says which. Everything suggested stays editable;
 * the sign is carried separately from the magnitude because a phone's decimal
 * keypad has no minus key, which is why "-6.5" could not be typed at all.
 */

import { lineForSide } from "./slate";

export interface BetFormLines {
  /** Home-perspective consensus spread, as stored. */
  spread: number | null;
  total: number | null;
  mlHome: number | null;
  mlAway: number | null;
  /** games.status — decides whether the suggestion is "closing" or "current". */
  status: string;
}

export type Sign = "-" | "+";

export interface Prefill {
  /** Sign and magnitude of the suggested line; magnitude "" means no suggestion. */
  lineSign: Sign;
  lineMag: string;
  oddsSign: Sign;
  oddsMag: string;
  /** Where the number came from, for the label — null when nothing was suggested. */
  source: "closing" | "current" | null;
}

export const NO_PREFILL: Prefill = {
  lineSign: "-",
  lineMag: "",
  oddsSign: "-",
  oddsMag: "110",
  source: null,
};

/** Split a signed number into the two fields. */
export function splitSigned(n: number): { sign: Sign; mag: string } {
  return { sign: n < 0 ? "-" : "+", mag: String(Math.abs(n)) };
}

/** Rejoin them the way the action reads them: `Number("+6.5")` is 6.5. */
export function joinSigned(sign: Sign, mag: string): string {
  if (mag.trim() === "") return "";
  return `${sign}${mag.trim()}`;
}

/** "Closing" once the game has started; the site captures nothing after kickoff. */
export const lineSource = (status: string): "closing" | "current" =>
  status === "in_progress" || status === "final" ? "closing" : "current";

export function prefillFor(lines: BetFormLines | null, betType: string, side: string): Prefill {
  if (!lines) return NO_PREFILL;
  const source = lineSource(lines.status);
  if (betType === "spread" && (side === "home" || side === "away") && lines.spread !== null) {
    const { sign, mag } = splitSigned(lineForSide(side, lines.spread) ?? 0);
    return { lineSign: sign, lineMag: mag, oddsSign: "-", oddsMag: "110", source };
  }
  if (betType === "total" && (side === "over" || side === "under") && lines.total !== null) {
    return { lineSign: "+", lineMag: String(lines.total), oddsSign: "-", oddsMag: "110", source };
  }
  if (betType === "moneyline" && (side === "home" || side === "away")) {
    const ml = side === "home" ? lines.mlHome : lines.mlAway;
    if (ml !== null) {
      const { sign, mag } = splitSigned(ml);
      return { lineSign: "-", lineMag: "", oddsSign: sign, oddsMag: mag, source };
    }
  }
  // team_total, first_half, future: no captured number to suggest — the
  // grader captures no closing line for these either (jobs-core).
  return NO_PREFILL;
}
