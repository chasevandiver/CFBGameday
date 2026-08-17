/**
 * P4/G5 tier classification.
 *
 * Born in `scripts/lib/tiers.ts` for the signed-error-by-slice diagnostics
 * (audit 03:M-3); moved here when `/edges` grew its soft-market tags (F11),
 * because the dependency runs scripts → src and never the other way (see
 * src/lib/void.ts for the precedent). The build-time pool re-levelling
 * (`recenterTierGap`) stays in scripts — nothing in the app reads it.
 *
 * Diagnostic-only: nothing in the model or the pricing path reads a tier —
 * this exists so the backtest can SEE a cross-classification lean, and so the
 * edges page can LABEL a structurally soft market. Pooled MAE/σ/NLL are
 * structurally blind to a cross-tier lean (they are symmetric, and cross-tier
 * games are a minority of the sample).
 *
 * The mapping is by conference NAME as CFBD spells it on /games, per season:
 *  - 2023: ACC, Big 12, Big Ten, Pac-12, SEC are power conferences.
 *  - 2024+: the Pac-12's two leftover teams (Oregon State, Washington State)
 *    play a G5-shaped schedule and are priced like G5 by the market, so the
 *    Pac-12 classifies G5 from 2024 on. That is a diagnostic judgment call,
 *    recorded here; two teams cannot swing the cross-tier aggregate either way.
 *  - Independents: Notre Dame is P4 (schedule and market treatment); every
 *    other independent (UConn, UMass, Army pre-AAC) is G5.
 */

const P4_CONFERENCES = new Set(["ACC", "Big 12", "Big Ten", "SEC"]);
const P4_INDEPENDENTS = new Set(["Notre Dame"]);

export type Tier = "P4" | "G5" | "FCS" | "unknown";

export function tierOf(
  conference: string | null | undefined,
  school: string,
  season: number,
  /** false = the team had no FBS rating (an FCS opponent in the replay) */
  isFbs = true,
): Tier {
  if (!isFbs) return "FCS";
  if (conference === undefined || conference === null) {
    // /games spells it "FBS Independents"; team rows say "FBS Independents"
    // too, so a bare null means the cached payload predates the field.
    return "unknown";
  }
  if (conference === "Pac-12" && season <= 2023) return "P4";
  if (P4_CONFERENCES.has(conference)) return "P4";
  if (conference === "FBS Independents") {
    return P4_INDEPENDENTS.has(school) ? "P4" : "G5";
  }
  return "G5";
}

/** Label for a game between two FBS tiers, order-independent. */
export function tierMatchup(home: Tier, away: Tier): string {
  if (home === "unknown" || away === "unknown") return "unknown";
  if (home === "FCS" || away === "FCS") return "FBS vs FCS";
  if (home === away) return `${home} vs ${home}`;
  return "cross-tier";
}
