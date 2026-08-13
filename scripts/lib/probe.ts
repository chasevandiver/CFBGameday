/**
 * What does this CFBD key actually grant?
 *
 * `build-preseason.ts --check` answers "has CFBD published the 2026 inputs
 * yet". It cannot answer "will /scoreboard work on Saturday", because the
 * endpoints that need a paid tier are exactly the ones the preseason build
 * never touches. Two of them fail invisibly:
 *
 *   - `/scoreboard` (Tier 1+) is the live layer. Every scoreboard-loop launch
 *     exits through `idleSkip` while the next game is more than
 *     SCOREBOARD_IDLE_DAYS away, so on a season opening Aug 29 the first real
 *     call lands on Aug 27 — two days out, with no plan B.
 *   - `/games/media` is tolerated by sync-games so a partial media feed never
 *     fails the sync — `tv` stays null and the card shows no network. Until
 *     P2-11 a tier rejection took the same path silently; sync-games now logs
 *     the status and records it in `job_runs.detail`, so the failure is visible
 *     without running this probe. The probe still answers it in one call.
 *
 * Hence this probe. It is pure access testing — it deliberately does NOT
 * re-check data readiness, which is `--check`'s job and would double-count
 * calls against the monthly budget.
 *
 * Everything here goes through `src/lib/cfbd.ts`. SPEC §1's hard rule is that
 * exactly one module talks to CFBD, and a diagnostic is not an exemption.
 */

import { CfbdError } from "../../src/lib/cfbd";

/**
 * DENIED and EMPTY are the two answers that matter, and telling them apart is
 * the whole point: a 403 means buy a tier, an empty 200 means wait for CFBD to
 * publish. Collapsing them into "no data" is how you spend $10 on the wrong
 * problem, or wait three weeks for data that was never coming.
 */
export type ProbeStatus = "OK" | "EMPTY" | "DENIED" | "ERROR";

export interface ProbeResult {
  endpoint: string;
  status: ProbeStatus;
  /** HTTP status when the call failed; null when it resolved. */
  httpStatus: number | null;
  rows: number | null;
  required: boolean;
  note: string;
  /** What breaks if this endpoint is DENIED. */
  usedFor: string;
}

/**
 * Turn one probe outcome into a status.
 *
 * **`emptyIsHealthy` is gone (2026-08-13).** Only `/scoreboard` ever set it,
 * and the reason given was false: the flag claimed the board "returns `[]` all
 * week and only fills on a Saturday", but the Aug 12 probe pulled 889 rows on a
 * Wednesday in August. What it actually did was print `ok` for zero rows —
 * masking the one symptom that would say the live layer is dead on a Saturday.
 * A dead board and a quiet board produced the same line in the table, which is
 * the same defect as the backup step that exited 0 with a 20-byte artifact and
 * as the query helpers that dropped `error`.
 *
 * Zero rows now reports `EMPTY`, always and for every endpoint. That is a
 * reporting change, not a gating one: `probeFailures` has never counted EMPTY,
 * so a legitimately empty offseason board still does not turn the run red —
 * the two documents that disagreed about this (`docs/STATUS.md` vs
 * `audit/KICKOFF_READINESS.md:69`) were arguing about a red/green trade that
 * was never on the table. What changes is that the table stops saying `ok`
 * about nothing.
 *
 * A required endpoint coming back empty additionally emits an Actions warning
 * from `probe-cfbd.ts`, so it is visible in the run summary without being a
 * failure. Going red on empty needs one observation of what `/scoreboard` does
 * during a live game — that is still the `observe-scoreboard` dispatch.
 *
 * Pure, so the classification is testable without a network or a key — the
 * same split `watchdogVerdict` and `scoreboardPatch` use.
 */
export function classifyProbe(
  outcome: { rows: number } | { error: unknown },
): { status: ProbeStatus; httpStatus: number | null; rows: number | null } {
  if ("rows" in outcome) {
    return { status: outcome.rows > 0 ? "OK" : "EMPTY", httpStatus: null, rows: outcome.rows };
  }
  const err = outcome.error;
  if (err instanceof CfbdError) {
    // 401 = the key is wrong. 403 = the key is right and the tier is not.
    // Both are "you cannot have this", which is the actionable distinction
    // from a 500 (CFBD is having a bad day, try again).
    const denied = err.status === 401 || err.status === 403;
    return { status: denied ? "DENIED" : "ERROR", httpStatus: err.status, rows: null };
  }
  return { status: "ERROR", httpStatus: null, rows: null };
}

/** Does this set of results mean the run should go red? */
export function probeFailures(results: ProbeResult[]): ProbeResult[] {
  return results.filter((r) => r.required && (r.status === "DENIED" || r.status === "ERROR"));
}

/**
 * Required endpoints that answered with nothing. Not failures — see
 * `classifyProbe` — but the caller surfaces them, because an empty board that
 * nobody mentions is indistinguishable from a healthy one.
 */
export function probeEmpties(results: ProbeResult[]): ProbeResult[] {
  return results.filter((r) => r.required && r.status === "EMPTY");
}

/** Fixed-width table, so a run log diffs cleanly against the last one. */
export function formatProbe(results: ProbeResult[]): string {
  const mark = (s: ProbeStatus) =>
    s === "OK" ? "  ok  " : s === "EMPTY" ? " empty" : s === "DENIED" ? "DENIED" : "ERROR ";
  const lines = [
    "endpoint                      req?   status   http   rows   used for",
    "─".repeat(96),
  ];
  for (const r of results) {
    lines.push(
      `${r.endpoint.padEnd(28)}  ${(r.required ? "yes" : "no ").padEnd(4)}  ${mark(r.status)}   ` +
        `${String(r.httpStatus ?? "–").padStart(4)}   ${String(r.rows ?? "–").padStart(4)}   ${r.usedFor}`,
    );
    if (r.note) lines.push(`${" ".repeat(30)}↳ ${r.note}`);
  }
  return lines.join("\n");
}
