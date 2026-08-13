/**
 * CFBD access probe — what does this key's tier actually grant?
 *
 * Read-only. Makes one narrow call per endpoint the product depends on and
 * reports OK / EMPTY / DENIED / ERROR for each, then exits non-zero if any
 * REQUIRED endpoint is denied. See scripts/lib/probe.ts for why this exists
 * alongside `build-preseason.ts --check` rather than inside it.
 *
 *   npx tsx scripts/probe-cfbd.ts
 *
 * Cost: 11 CFBD calls, metered into api_call_log like every other job.
 *
 * Historical endpoints are probed against SEASON−1, not SEASON. Authorization
 * does not vary by year, but *data* does: /stats/game/advanced for 2026 is
 * legitimately empty in August, so probing the current season would report
 * "EMPTY" for an endpoint that works fine and leave you no wiser. Against a
 * completed season, EMPTY means something is actually wrong.
 */

import { cfbd, cfbdCallCount } from "../src/lib/cfbd";
import { createServiceClient } from "../src/lib/supabase/service";
import { SEASON } from "./lib/ingest";
import { logCfbdCalls } from "./lib/jobs-core";
import {
  classifyProbe,
  formatProbe,
  probeEmpties,
  probeFailures,
  type ProbeResult,
} from "./lib/probe";

/** Completed season, so "no rows" is a real signal rather than "not yet". */
const PAST = SEASON - 1;

interface ProbeSpec {
  endpoint: string;
  required: boolean;
  usedFor: string;
  note?: string;
  run: () => Promise<unknown[]>;
}

const PROBES: ProbeSpec[] = [
  // ---- the two that fail invisibly -----------------------------------------
  {
    endpoint: "/scoreboard",
    required: true,
    usedFor: "live scores, cover-flip detection",
    // Empty used to be scored `ok` here on the stated grounds that the board
    // "returns [] all week". It does not — the Aug 12 probe pulled 889 rows on
    // a Wednesday — so zero rows now reports EMPTY like every other endpoint
    // and raises a warning below. It still does not fail the run: going red on
    // empty needs one observation of a live game (observe-scoreboard).
    note: "Tier 1+. Never exercised in the offseason: scoreboard-loop exits via idleSkip until ~2 days before the opener.",
    run: () => cfbd.scoreboard(),
  },
  {
    endpoint: "/games/media",
    required: true,
    usedFor: "TV network on every card",
    note: "Optional by design: a failure leaves tv null rather than failing the sync. Since P2-11 sync-games logs the HTTP status and records it in job_runs.detail, so a denial is visible on /admin — but this probe still answers it faster.",
    run: () => cfbd.gameMedia(PAST, { week: 1 }),
  },

  // ---- the core the product cannot open without ----------------------------
  {
    endpoint: "/games",
    required: true,
    usedFor: "schedule, scores, replay",
    run: () => cfbd.games(PAST, { week: 1 }),
  },
  {
    endpoint: "/lines",
    required: true,
    usedFor: "spreads, totals, CLV — the whole betting layer",
    run: () => cfbd.lines(PAST, { week: 1 }),
  },
  {
    endpoint: "/ratings/sp",
    required: true,
    usedFor: "bootstrap prior, consensus flag",
    run: () => cfbd.spRatings(PAST),
  },
  {
    endpoint: "/ratings/fpi",
    required: true,
    usedFor: "consensus flag",
    run: () => cfbd.fpiRatings(PAST),
  },
  {
    endpoint: "/ratings/elo",
    required: true,
    usedFor: "consensus flag",
    run: () => cfbd.eloRatings(PAST, 2),
  },
  {
    endpoint: "/rankings",
    required: true,
    usedFor: "AP / Coaches / CFP chips",
    run: () => cfbd.rankings(PAST, { week: 2 }),
  },
  {
    endpoint: "/teams",
    required: true,
    usedFor: "reference data, colours, logos",
    run: () => cfbd.teams(PAST),
  },
  {
    endpoint: "/venues",
    required: true,
    usedFor: "weather coordinates",
    run: () => cfbd.venues(),
  },

  // ---- optional ------------------------------------------------------------
  {
    endpoint: "/stats/game/advanced",
    required: false,
    usedFor: "--tune-epa only (epaWeight is 0 — rejected)",
    note: "Tier 1+. replay.ts tolerates its absence by design; probed so the tolerance is a known state rather than an assumption.",
    run: () => cfbd.advancedGameStats(PAST, { week: 1 }),
  },
];

async function main() {
  console.log(
    `CFBD access probe — key tier vs the endpoints this product needs.\n` +
      `Historical probes run against ${PAST} (a completed season) so EMPTY means broken, not "not published yet".\n` +
      `Data readiness for ${SEASON} is a different question — that is build-preseason.ts --check.\n`,
  );

  const results: ProbeResult[] = [];
  for (const p of PROBES) {
    let outcome: { rows: number } | { error: unknown };
    try {
      outcome = { rows: (await p.run()).length };
    } catch (error) {
      outcome = { error };
    }
    const { status, httpStatus, rows } = classifyProbe(outcome);
    // The standing note explains why the endpoint is worth probing; the error
    // explains what just happened. On the two rows that carry both, the second
    // is the one you need — so append, never replace.
    const failure =
      "error" in outcome
        ? outcome.error instanceof Error
          ? outcome.error.message
          : String(outcome.error)
        : "";
    results.push({
      endpoint: p.endpoint,
      status,
      httpStatus,
      rows,
      required: p.required,
      usedFor: p.usedFor,
      note: [p.note, failure].filter(Boolean).join("  —  "),
    });
  }

  console.log(formatProbe(results));

  // Meter the probe's own calls. `build-preseason` meters itself the same way
  // as of 2026-08-13; the backtest path is still unmetered (audit 07/OPS-14a),
  // because `backtest.yml` carries only a CFBD key and adding Supabase secrets
  // to a workflow that fires on every model PR is a wider change than the count
  // is worth.
  try {
    await logCfbdCalls(createServiceClient(), "cfbd-probe", cfbdCallCount());
  } catch {
    // Runs fine with only a CFBD key; the meter is a bonus, not a dependency.
  }

  // A required endpoint answering with nothing is not a failure — it can be the
  // truth in the offseason — but it must not pass silently either, which is
  // exactly what `emptyIsHealthy` used to do for /scoreboard. Warn, don't red.
  for (const e of probeEmpties(results)) {
    console.log(
      `::warning::${e.endpoint} returned 0 rows — ${e.usedFor}. ` +
        `Correct in the offseason; on a game day it means the live layer is not answering.`,
    );
  }

  const failures = probeFailures(results);
  console.log(`\n${cfbdCallCount()} CFBD calls spent.`);
  if (failures.length === 0) {
    console.log("All required endpoints reachable — the tier covers this product.");
    return;
  }
  for (const f of failures) {
    console.log(
      `::error::${f.endpoint} ${f.status}${f.httpStatus ? ` (HTTP ${f.httpStatus})` : ""} — ${f.usedFor}`,
    );
  }
  console.log(
    "\nA DENIED required endpoint is a tier problem, not a data problem. " +
      "Check the plan at collegefootballdata.com/key before assuming a code fix.",
  );
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
