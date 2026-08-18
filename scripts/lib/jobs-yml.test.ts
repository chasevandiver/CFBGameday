import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The scheduler is two bash `case` statements wired to a list of crons, and
 * nothing type-checks the wiring. On 2026-08-13 six crons — the three
 * `notify-picks-due` and three `notify-log-bets` schedules — were declared but
 * never added to the resolve case, so each fell through to `task=unknown` and
 * then to the `Run job` fallthrough's `exit 1`. Six red runs a week, zero push
 * notifications, and the delivery path itself was fine: PUSH-3 and PUSH-9 were
 * verified end to end on a real iPhone. Only the routing was missing.
 *
 * These assertions are the cheap half of that bug. They parse the workflow the
 * same way bash reads it — literal strings, first match wins — and fail if a
 * cron has no task, a task has no command, or two tasks claim one cron.
 */

const YML = readFileSync(join(__dirname, "../../.github/workflows/jobs.yml"), "utf8");
const PUSH_TS = readFileSync(join(__dirname, "../../src/lib/push.ts"), "utf8");

/**
 * The `env:` block on the `run` job — the only environment the scripts see.
 *
 * A GitHub Actions secret is NOT an environment variable. It exists in repo
 * settings and stays there until a workflow maps it, which is how PUSH-11 hid
 * for as long as it did: the VAPID secrets were set, push visibly worked from
 * /admin and the /me test button (both on Vercel, which has its own env), and
 * every scheduled push returned {"skipped": "no vapid keys"} and went green.
 */
function jobEnv(): Set<string> {
  const block = YML.split("\n    env:\n")[1].split("\n    steps:")[0];
  return new Set([...block.matchAll(/^ {6}([A-Z0-9_]+):/gm)].map((m) => m[1]));
}

/** The env vars `pushConfigured()` requires, read off the function itself. */
function pushRequires(): string[] {
  const body = PUSH_TS.split("export function pushConfigured")[1].split("\n}")[0];
  return [...body.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
}

/** Every `- cron: "…"` in the schedule block, in file order. */
function declaredCrons(): string[] {
  return [...YML.matchAll(/^ {4}- cron: "([^"]+)"$/gm)].map((m) => m[1]);
}

/** The `task` choice list under workflow_dispatch. */
function dispatchOptions(): string[] {
  const block = YML.split("workflow_dispatch:")[1].split("\n  schedule:")[0];
  return [...block.matchAll(/^ {10}- ([a-z0-9-]+)$/gm)].map((m) => m[1]);
}

/**
 * The resolve case as an ordered list of (cron patterns → task). Order matters:
 * bash takes the first matching branch, so a duplicated cron string silently
 * shadows every later claim on it.
 */
function resolveBranches(): Array<{ patterns: string[]; task: string }> {
  const body = YML.split('case "${{ github.event.schedule }}" in')[1].split("esac")[0];
  return [...body.matchAll(/^\s*((?:"[^"]*"\|)*"[^"]*")\) echo "task=([^"]+)"/gm)].map((m) => ({
    patterns: [...m[1].matchAll(/"([^"]*)"/g)].map((p) => p[1]),
    task: m[2],
  }));
}

/** Every task name that has a command in the `Run job` case. */
function runnableTasks(): Set<string> {
  const body = YML.split('case "${{ steps.task.outputs.task }}" in')[1].split("\n            *)")[0];
  const names = new Set<string>();
  for (const m of body.matchAll(/^ {12}([a-z0-9|-]+)\)/gm)) {
    for (const n of m[1].split("|")) names.add(n);
  }
  return names;
}

/** What the resolve case would emit for a cron — first match wins, as bash does. */
function resolve(cron: string): string {
  return resolveBranches().find((b) => b.patterns.includes(cron))?.task ?? "unknown";
}

describe("jobs.yml scheduler wiring", () => {
  it("declares crons and dispatch options at all", () => {
    // Guards the parser itself: a regex that silently matches nothing would
    // make every assertion below vacuously true.
    expect(declaredCrons().length).toBeGreaterThan(20);
    expect(dispatchOptions().length).toBeGreaterThan(15);
    expect(runnableTasks().size).toBeGreaterThan(15);
  });

  it("maps every declared cron to a task", () => {
    const orphans = declaredCrons().filter((c) => resolve(c) === "unknown");
    expect(orphans).toEqual([]);
  });

  it("gives every scheduled task a command to run", () => {
    const runnable = runnableTasks();
    const missing = [...new Set(declaredCrons().map(resolve))].filter((t) => !runnable.has(t));
    expect(missing).toEqual([]);
  });

  it("gives every dispatchable task a command to run", () => {
    const runnable = runnableTasks();
    expect(dispatchOptions().filter((t) => !runnable.has(t))).toEqual([]);
  });

  it("lets a typed task reach the runner, and refuses a hostile one", () => {
    // OPS-14: the dropdown has a hard ceiling (the mobile form renders ~12 of
    // 35 options), so `task_override` is the way to reach the rest. Two
    // properties matter and both are easy to lose in an edit.
    const block = YML.split("workflow_dispatch:")[1].split("\n  schedule:")[0];
    expect(block).toContain("task_override:");

    const resolve = YML.split("- name: Resolve task from schedule")[1].split("- name: Run job")[0];
    const script = resolve.split("run: |")[1];

    // Read through env, and never spliced into the script: `${{ inputs.* }}`
    // inside a `run:` body is textual substitution, which for a free-text
    // input is shell injection. The env binding is the safe form, so it is
    // asserted in the step header and forbidden in the body.
    expect(resolve).toContain("TASK_OVERRIDE: ${{ inputs.task_override }}");
    expect(script).not.toContain("inputs.task_override");
    expect(script).toContain("${TASK_OVERRIDE:-$TASK_CHOICE}");
    // …and constrained to the shape a job name can have before it goes on.
    expect(script).toContain("*[!a-z0-9-]*");
  });

  it("keeps the accidental default read-only", () => {
    // `task` is required with no `default:`, so GitHub pre-selects whatever is
    // at the top and a "Run workflow" tap that never opens the dropdown runs
    // it. That used to be `refresh-lines` — a live job that writes snapshots
    // and chains freeze-groups. Reordering this list is a legitimate thing to
    // do (the mobile form only renders ~12 options, so what is reachable is a
    // real constraint); putting something that writes at the top is not.
    expect(dispatchOptions()[0]).toBe("backup");
  });

  it("keeps backfill-games dispatchable and unscheduled", () => {
    // A finished season does not change, so re-pulling three of them on a
    // cron would spend CFBD calls to learn nothing. The property worth
    // pinning is the ABSENCE: if somebody gives this a schedule, they also
    // have to decide its watchdog horizon, and a job with no cadence cannot
    // be late. Dispatchable-and-runnable is covered by the two tests above.
    expect(dispatchOptions()).toContain("backfill-games");
    expect(resolveBranches().some((b) => b.task === "backfill-games")).toBe(false);
  });

  it("never lets two tasks claim the same cron", () => {
    // The P2-10 trap: `0 10 * * 6` is the weather cron, so adding it to the
    // refresh-lines pattern would not give Saturday two jobs — it would take
    // the first branch and silently retire weather.
    const seen = new Map<string, string>();
    const shadowed: string[] = [];
    for (const { patterns, task } of resolveBranches()) {
      for (const p of patterns) {
        const owner = seen.get(p);
        if (owner !== undefined && owner !== task) shadowed.push(`${p}: ${owner} then ${task}`);
        else seen.set(p, task);
      }
    }
    expect(shadowed).toEqual([]);
  });

  it("hands the jobs every key pushConfigured() gates on (PUSH-11)", () => {
    // Derived from push.ts rather than hardcoded, so adding a third required
    // key there fails here instead of silently disabling scheduled push again.
    const required = pushRequires();
    expect(required.length).toBeGreaterThan(1); // parser guard
    const env = jobEnv();
    expect(required.filter((k) => !env.has(k))).toEqual([]);
  });

  it("maps the secrets the data jobs cannot run without", () => {
    const env = jobEnv();
    expect(env.size).toBeGreaterThan(5); // parser guard
    for (const key of [
      "CFBD_API_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]) {
      expect(env.has(key)).toBe(true);
    }
  });

  it("routes the notification crons, which were dead until 2026-08-13", () => {
    expect(resolve("0 15 * * 6")).toBe("notify-picks-due");
    expect(resolve("0 18 * * 6")).toBe("notify-picks-due");
    expect(resolve("0 22 * * 4,5")).toBe("notify-picks-due");
    expect(resolve("45 15 * * 6")).toBe("notify-log-bets");
    expect(resolve("15 19 * * 6")).toBe("notify-log-bets");
    expect(resolve("15 23 * * 6")).toBe("notify-log-bets");
  });

  it("routes the Tuesday Drop cron (R2-B2) — same seam, same net", () => {
    expect(resolve("0 15 * * 1")).toBe("drop");
  });

  /**
   * R3-E2. Landing here in the same commit as the crons is the whole point:
   * a declared cron with no resolve branch is a red run every Tuesday, and
   * this seam has produced SCHED-1, P1-9b and PUSH-11.
   */
  it("routes both Six-Pack crons — generate Tuesday, grade Sun/Mon", () => {
    expect(resolve("0 17 * * 2")).toBe("six-pack");
    expect(resolve("30 14 * * 0,1")).toBe("six-pack");
  });

  /**
   * Q1's escape hatch, and after 2026-08-18 its dated self-execution.
   *
   * `preseason-force` stays reachable by hand and unreachable by cron — the
   * shape asserted for backfill-games above. The daily refresh escalates to
   * the same flag from Aug 22 by owner decision, and that is the assertion
   * worth having: it must be reached through a DATE and a task-name test, not
   * by hoisting --force onto the shared branch, and `preseason-bootstrap`
   * (which writes the append-only tables) must never pick it up.
   */
  it("keeps preseason-force dispatchable and unscheduled", () => {
    expect(dispatchOptions()).toContain("preseason-force");
    expect(resolveBranches().some((b) => b.task === "preseason-force")).toBe(false);
  });

  it("reaches --force only through the task name or the dated escalation", () => {
    const run = YML.split('case "${{ steps.task.outputs.task }}" in')[1].split("\n            *)")[0];
    const block = run.split("preseason-refresh|preseason-bootstrap|preseason-force)")[1];

    // Never hoisted onto the shared invocation: the flag is a variable, set by
    // the two branches below and empty for everyone else.
    expect(run).toContain("build-preseason.ts --check $FORCE");
    expect(run).not.toContain("build-preseason.ts --check --force");

    // On demand…
    expect(block).toContain('if [ "${{ steps.task.outputs.task }}" = "preseason-force" ]; then');
    // …and on the date, for preseason-refresh ONLY. Both halves of that
    // condition matter: without the task-name test the escalation would also
    // fire on a preseason-bootstrap dispatched in late August, which is the
    // one run that writes line_snapshots and predictions.
    expect(block).toContain(
      'elif [ "${{ steps.task.outputs.task }}" = "preseason-refresh" ] && [ "$(date -u +%m)" = "08" ] && [ "$(date -u +%d)" -ge 22 ]',
    );
    expect(block).not.toMatch(/preseason-bootstrap"\s*\]\s*&&\s*\[\s*"\$\(date/);
  });
});
