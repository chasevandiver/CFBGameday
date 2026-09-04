/**
 * Recover the market half of a frozen receipt from the snapshot log (FREEZE-3).
 *
 * On 2026-09-03 the Thursday freeze read its line snapshots in one request
 * and PostgREST's 1,000-row ceiling truncated it (see `page-all.ts`). 71 of
 * the 91 Week 1 receipts were stamped with `vegas_spread = null` although
 * every one of those games had book lines on file since August. Owner
 * decision, 2026-09-04: fix the read and backfill the market fields.
 *
 * ## What this changes, and what it never touches
 *
 * `predictions` is append-only by design — "no retroactive edits, ever"
 * (SPEC §2.5). This is not the model changing its mind. The model's number
 * (`spread`, `total`, `home_win_prob`, the ratings behind them) is left
 * exactly as frozen. What is written is the **market context the freeze
 * should have recorded and could not see**: the consensus line at freeze
 * time, the opener, and the three derived fields that are pure functions of
 * model-vs-market (`edge`, `edge_flag`, `cover_prob`) — plus `clv` where the
 * Sunday grader has already stored a close, since it keys "ungraded" on
 * `close_spread` and will not revisit those rows.
 *
 * Every number is recomputed with the freeze's own functions
 * (`consensusFromSnapshots` with the freeze timestamp as the cutoff,
 * `paramsForWeek`, `normalCdf`, `modelClv`), so a recovered receipt is what
 * the freeze would have written had the read not been cut off. Two known
 * differences, both below the display precision: the freeze computed `edge`
 * and `cover_prob` from the unrounded model margin and this recomputes from
 * the stored one-decimal `spread`, so `edge` can differ by ≤ 0.05 before its
 * own rounding and `cover_prob` in the fourth decimal.
 *
 * Pure. The script `scripts/recover-freeze-lines.ts` does the reading and
 * writing, and stamps `adjustments.line_recovered` so the Receipts page can
 * say which rows were recovered.
 */

import { modelClv, roundClv } from "./clv";
import { consensusFromSnapshots, type SnapshotLike } from "./consensus";
import { DEFAULT_PARAMS, normalCdf, paramsForWeek, type ModelParams } from "../model/ratings";

export interface RecoveryInput {
  /** The frozen model spread, home perspective, as stored. */
  modelSpread: number;
  week: number;
  /** `predictions.created_at`: only snapshots captured before it count. */
  frozenAt: string;
  /** `predictions.close_spread` if the grader already wrote one, else null. */
  closeSpread: number | null;
  snapshots: SnapshotLike[];
}

export interface RecoveredLine {
  vegas_spread: number;
  open_spread: number | null;
  edge: number;
  edge_flag: "EDGE" | "BIG_EDGE" | null;
  cover_prob: number;
  /** Null when no close is stored yet — the grader fills it Sunday. */
  clv: number | null;
}

/** Null when the snapshot log has no pre-freeze spread for the game either. */
export function recoverFreezeLine(
  inp: RecoveryInput,
  base: ModelParams = DEFAULT_PARAMS,
): RecoveredLine | null {
  const market = consensusFromSnapshots(inp.snapshots, inp.frozenAt);
  if (market.spread === null) return null;
  const p = paramsForWeek(inp.week, base);
  const vegas = market.spread;
  // Same arithmetic as priceGame(): edge in the Vegas convention, flag on its
  // size, P(home covers) from the model margin under the week's sigma.
  const edge = Math.round((inp.modelSpread - vegas) * 10) / 10;
  const abs = Math.abs(edge);
  const edge_flag = abs >= p.bigEdgeThreshold ? "BIG_EDGE" : abs >= p.edgeThreshold ? "EDGE" : null;
  const margin = -inp.modelSpread;
  const cover_prob = Math.round((1 - normalCdf(-vegas, margin, p.marginSigma)) * 10000) / 10000;
  const rawClv = inp.closeSpread === null ? null : modelClv(edge, vegas, inp.closeSpread);
  return {
    vegas_spread: vegas,
    open_spread: market.open,
    edge,
    edge_flag,
    cover_prob,
    clv: rawClv === null ? null : roundClv(rawClv),
  };
}

/** The marker stamped into `predictions.adjustments` on a recovered row. */
export const LINE_RECOVERED_KEY = "line_recovered";

export interface LineRecoveredMarker {
  at: string;
  /** The tracker ID that explains why. */
  reason: "FREEZE-3";
  from: "line_snapshots";
}

/** Read the marker off a row's `adjustments`, tolerating any shape. */
export function lineRecoveredMarker(adjustments: unknown): LineRecoveredMarker | null {
  if (!adjustments || typeof adjustments !== "object") return null;
  const m = (adjustments as Record<string, unknown>)[LINE_RECOVERED_KEY];
  if (!m || typeof m !== "object") return null;
  const at = (m as { at?: unknown }).at;
  return typeof at === "string" ? (m as LineRecoveredMarker) : null;
}
