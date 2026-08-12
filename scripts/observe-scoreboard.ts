/**
 * Watch `/scoreboard` through a live window and report whether it actually
 * moves. See scripts/lib/observe.ts for what this is answering and why the
 * access probe could not.
 *
 * Read-only: it never writes `games`, so it can run beside the real
 * scoreboard-loop without racing it. The only write is metering — every CFBD
 * call goes into api_call_log like any other job, because an unmetered
 * diagnostic polling every 30s would quietly corrupt the budget the loop
 * throttles off.
 *
 *   npx tsx scripts/observe-scoreboard.ts --minutes 70 --interval 30
 *   npx tsx scripts/observe-scoreboard.ts --out board.jsonl   # keep raw samples
 *
 * Cost: minutes×60/interval calls (70/30s = 140), capped by --max-calls.
 *
 * Exit codes are the point of running it in CI: 1 on STALE or UNKNOWN_STATUS
 * (the live layer is broken and would have been silent about it), 0 on OK, and
 * 0 with a loud notice on NO_LIVE_GAMES — a mistimed run is a mistimed run,
 * not a fault, but it is never evidence that the feed works.
 */

import { appendFileSync } from "node:fs";
import { cfbd, cfbdCallCount } from "../src/lib/cfbd";
import { createServiceClient } from "../src/lib/supabase/service";
import { formatObservation, observe, relevant, type BoardSample } from "./lib/observe";
import { logCfbdCalls } from "./lib/jobs-core";

function argNum(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  const v = i > -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function argStr(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const minutes = argNum("--minutes", 60);
  const intervalMs = argNum("--interval", 30) * 1000;
  const maxCalls = argNum("--max-calls", 300);
  const out = argStr("--out");
  const meter = !process.argv.includes("--no-meter");

  const db = meter ? createServiceClient() : null;
  const deadline = Date.now() + minutes * 60_000;
  const samples: BoardSample[] = [];

  console.log(
    `observing /scoreboard for ${minutes} min every ${intervalMs / 1000}s ` +
      `(max ${maxCalls} calls)${out ? `, raw samples → ${out}` : ""}\n`,
  );

  try {
    while (Date.now() < deadline && cfbdCallCount() < maxCalls) {
      const at = Date.now();
      try {
        const board = await cfbd.scoreboard();
        const games = relevant(board, at);
        samples.push({ at, games });
        if (out) appendFileSync(out, `${JSON.stringify({ at, games })}\n`);

        const liveNow = games.filter((g) => g.status === "in_progress").length;
        const running = observe(samples);
        const changes = running.games.reduce((n, g) => n + g.changes.length, 0);
        console.log(
          `[${new Date(at).toISOString().slice(11, 19)}] board ${board.length} → watching ` +
            `${games.length}, live ${liveNow}, changes so far ${changes}`,
        );
      } catch (err) {
        // One bad poll must not cost the window — this is the one chance to
        // observe a given kickoff, and there is no replaying it.
        console.error("  poll failed:", err instanceof Error ? err.message : err);
      }
      if (Date.now() + intervalMs > deadline) break;
      await sleep(intervalMs);
    }
  } finally {
    // Meter whatever was spent even if the loop died — the budget does not
    // care why we stopped.
    if (db) await logCfbdCalls(db, "observe-scoreboard", cfbdCallCount());
  }

  const result = observe(samples);
  console.log(`\n${formatObservation(result)}`);
  console.log(`\n${cfbdCallCount()} CFBD calls${meter ? " (metered)" : " (NOT metered)"}`);

  if (result.verdict === "STALE" || result.verdict === "UNKNOWN_STATUS") {
    console.error(`::error::/scoreboard liveness check failed: ${result.verdict}`);
    process.exit(1);
  }
  if (result.verdict === "NO_LIVE_GAMES") {
    console.log("::notice::no live game observed — this run is inconclusive, not a pass");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
