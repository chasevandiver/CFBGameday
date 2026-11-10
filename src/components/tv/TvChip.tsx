import { breakLabel, periodLabel } from "../../lib/kick";
import type { TickerGame } from "../../lib/ticker";
import { leadingSide } from "../ScoreTicker";

/** Status text for a TV chip: clock while live, FINAL, or the kickoff time. */
export function tvStatus(g: TickerGame): string {
  if (g.status === "in_progress") {
    return (
      breakLabel(g.period, g.clock) ??
      `${periodLabel(g.period)}${g.clock ? ` ${g.clock}` : ""}`
    );
  }
  if (g.status === "final") return "FINAL";
  return g.startTs
    ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
        new Date(g.startTs),
      )
    : "";
}

/* Weight and brightness mark the leader, same rule as the in-app ticker. */
const side = (lead: "home" | "away" | null, s: "home" | "away") =>
  lead === null ? "text-chalk" : lead === s ? "text-chalk" : "text-chalk/45";

/** One game as a single line, for the ticker strip. Sized by the parent's font. */
export function TvChip({ g }: { g: TickerGame }) {
  const live = g.status === "in_progress";
  const scored = live || g.status === "final";
  const lead = leadingSide(g);
  return (
    <span className="tv-chip">
      {live && <span aria-label="Live" className="tv-dot live-dot" />}
      {g.sport === "nfl" && <span className="tv-tag">NFL</span>}
      <span className={side(lead, "away")} style={{ fontWeight: lead === "away" ? 700 : 500 }}>
        {g.awayAbbr}
        {scored && <span className="stat"> {g.awayPoints ?? 0}</span>}
      </span>
      <span className={side(lead, "home")} style={{ fontWeight: lead === "home" ? 700 : 500 }}>
        {g.homeAbbr}
        {scored && <span className="stat"> {g.homePoints ?? 0}</span>}
      </span>
      <span className={`tv-status stat ${live ? "text-live" : "text-dim"}`}>{tvStatus(g)}</span>
    </span>
  );
}
