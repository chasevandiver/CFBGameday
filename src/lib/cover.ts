/**
 * Cover state: one implementation of "did this side beat the number".
 *
 * The signed cover margin existed in four places character-for-character —
 * `grade.ts` (settlement), `live-status.ts` (the live chips), `jobs-core.ts`
 * (the bet grader) and a home-perspective variant in `slate.ts` — which is
 * exactly the shape `pickSideLabel` was in before it drifted five ways. The
 * bad-beat detector needed a fifth, so it became this instead.
 *
 * Convention, everywhere in this codebase: `line` is home-perspective (negative
 * = home favored), `margin` is `home − away`.
 */

/**
 * Signed cover margin from one side's perspective: positive covers, negative
 * doesn't, zero is a push. A home backer on −3 needs `margin + (−3) > 0`.
 */
export function coverMargin(
  side: "home" | "away",
  line: number,
  homePoints: number,
  awayPoints: number,
): number {
  const margin = homePoints - awayPoints;
  return side === "home" ? margin + line : -margin - line;
}

/** Which side of the spread is covering at this score. */
export function spreadCoverSide(
  line: number,
  homePoints: number,
  awayPoints: number,
): "home" | "away" | "push" {
  const cm = coverMargin("home", line, homePoints, awayPoints);
  return cm > 0 ? "home" : cm < 0 ? "away" : "push";
}

/** Which side of the total is winning at this score. */
export function totalCoverSide(
  total: number,
  homePoints: number,
  awayPoints: number,
): "over" | "under" | "push" {
  const scored = homePoints + awayPoints;
  return scored > total ? "over" : scored < total ? "under" : "push";
}

/**
 * How a flip reads: "cover flipped to UNC" / "Over cashed late".
 *
 * One implementation, because the recap and the group board both say it and
 * this codebase has already learned what happens when two screens format the
 * same fact separately.
 */
export function flipHeadline(
  f: { market: "spread" | "total"; to_side: string; line: number },
  homeAbbr: string,
  awayAbbr: string,
): string {
  if (f.market === "total") {
    if (f.to_side === "push") return `Total landed on ${f.line}`;
    return f.to_side === "over" ? `Over ${f.line} cashed` : `Under ${f.line} cashed`;
  }
  if (f.to_side === "push") return "Landed on the number";
  const team = f.to_side === "home" ? homeAbbr : awayAbbr;
  return `Cover flipped to ${team}`;
}

/** "0:38 · 4th", or just the quarter when the feed gave us no clock. */
export function flipWhen(period: number | null, clock: string | null): string {
  const q = period === null ? "" : period > 4 ? `OT${period > 5 ? period - 4 : ""}` : `Q${period}`;
  if (!clock) return q || "late";
  return q ? `${clock} · ${q}` : clock;
}

/**
 * `games.current_clock` is CFBD's string ("12:34"), not seconds, so anything
 * asking "inside two minutes?" has to parse it. Null for a missing or
 * unparseable clock — callers treat that as "unknown", never as zero.
 */
export function clockToSeconds(clock: string | null | undefined): number | null {
  if (!clock) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!m) return null;
  const mins = Number(m[1]);
  const secs = Number(m[2]);
  if (secs > 59) return null;
  return mins * 60 + secs;
}
