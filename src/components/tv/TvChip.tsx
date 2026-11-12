import { breakLabel, overtimeSuffix, periodLabel } from "../../lib/kick";
import { BasketballIcon } from "../nav-icons";
import type { TickerGame, TickerMine } from "../../lib/ticker";
import { leadingSide } from "../ScoreTicker";

/** Status text for a TV chip: clock while live, FINAL, or the kickoff time. */
export function tvStatus(g: TickerGame, opts: { short?: boolean } = {}): string {
  if (g.status === "in_progress") {
    // The sport decides the vocabulary (TV-20): basketball is 1H / 2H / OT
    // and its halftime follows period 1, where football's follows Q2.
    const brk = breakLabel(g.period, g.clock, g.sport);
    // The corner box has no room for HALFTIME beside a line; HALF says it.
    if (brk === "HALFTIME" && opts.short) return "HALF";
    return brk ?? `${periodLabel(g.period, g.sport)}${g.clock ? ` ${g.clock}` : ""}`;
  }
  if (g.status === "final") return `FINAL${overtimeSuffix(g.period, g.sport).replace(" / ", "/")}`;
  return g.startTs
    ? new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(g.startTs))
    : "";
}

/**
 * The number on the chip (TV-3): the viewer's own ticket when they have one
 * ("ALA -3.5", "O 54.5"), else the market spread written favourite-first the
 * way a broadcast bug sets it. Consensus spreads are home-perspective, so a
 * positive number means the visitors are laying it.
 */
export function tvLine(g: TickerGame): { text: string; mine: boolean } | null {
  if (g.stake) return { text: g.stake.label, mine: true };
  const m = marketSpread(g);
  return m === null ? null : { text: m, mine: false };
}

/** The market spread, favourite first ("ALA -3.5", "PK"); null when unknown. */
export function marketSpread(g: TickerGame): string | null {
  const s = g.spread;
  if (s === null || s === undefined) return null;
  if (s === 0) return "PK";
  return s < 0 ? `${g.homeAbbr} ${s}` : `${g.awayAbbr} -${s}`;
}

/* A verdict only once the score can give one; "on" (pregame, or a bet type a
   score can't grade) colours nothing. */
const GRADED: Partial<Record<TickerMine, string>> = {
  covering: "tv-v-covering",
  losing: "tv-v-losing",
  push: "tv-v-push",
};
const WORDS: Record<TickerMine, string> = {
  covering: "You're covering.",
  losing: "You're not covering.",
  push: "You're on the number.",
  on: "You have action on this game.",
};

/**
 * Colour for one team's name and score. The team the viewer is on takes the
 * verdict colour (green covering, gold push, red not); every other team keeps
 * the ticker's rule of bright leader, dimmed trailer.
 */
export function teamClass(g: TickerGame, s: "home" | "away"): string {
  const verdict = g.mine ? GRADED[g.mine] : undefined;
  if (verdict && g.stake?.side === s) return verdict;
  const lead = leadingSide(g);
  return lead !== null && lead !== s ? "text-chalk/45" : "text-chalk";
}

/** A totals ticket has no team to colour, so its line takes the verdict. */
export function lineClass(g: TickerGame, mine: boolean): string {
  const verdict = g.mine ? GRADED[g.mine] : undefined;
  const total = g.stake?.side === "over" || g.stake?.side === "under";
  if (verdict && total) return verdict;
  return mine ? "text-chalk" : "tv-line-market";
}

export function VerdictWords({ g }: { g: TickerGame }) {
  return g.mine ? <span className="sr-only">{WORDS[g.mine]}</span> : null;
}

/** One game as a single line, for the ticker strip. Sized by the parent's font. */
export function TvChip({ g }: { g: TickerGame }) {
  const live = g.status === "in_progress";
  const scored = live || g.status === "final";
  const lead = leadingSide(g);
  const line = tvLine(g);
  const team = (abbr: string, pts: number | null, s: "home" | "away") => (
    <span className={teamClass(g, s)} style={{ fontWeight: lead === s ? 700 : 500 }}>
      {abbr}
      {scored && <span className="stat"> {pts ?? 0}</span>}
    </span>
  );
  return (
    <span className="tv-chip">
      {live && <span aria-label="Live" className="tv-dot live-dot" />}
      <SportTag g={g} className="tv-tag" />
      {team(g.awayAbbr, g.awayPoints, "away")}
      {team(g.homeAbbr, g.homePoints, "home")}
      {line && <span className={`tv-line stat ${lineClass(g, line.mine)}`}>{line.text}</span>}
      <span className={`tv-status stat ${live ? "text-live" : "text-dim"}`}>{tvStatus(g)}</span>
      <VerdictWords g={g} />
    </span>
  );
}

/**
 * What league a chip is, when it is not the default (college football).
 *
 * The NFL says so in letters, as it always has. College basketball is a ball
 * (TV-20): the strip is read from a couch, and "ILL 61 PUR 58" in a row of
 * football scores needs to say it is a different game before the numbers do.
 * Sized in `em` so it scales with whichever surface's type it sits in, and
 * named for assistive tech since the glyph is the whole label.
 */
export function SportTag({ g, className }: { g: TickerGame; className: string }) {
  if (g.sport === "nfl") return <span className={className}>NFL</span>;
  if (g.sport === "cbb")
    return (
      <span className={`${className} tv-hoop`} role="img" aria-label="College basketball">
        <BasketballIcon size="1em" aria-hidden />
      </span>
    );
  return null;
}
