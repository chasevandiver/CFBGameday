import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FEED_REQUIREMENTS } from "./coverage";

/**
 * `backtest.yml` is the honesty gate: it runs on every PR that touches the
 * model and puts a calibration report in front of whoever reviews it. That only
 * works if the PR report is comparable to the last one — which means the season
 * window must be dispatch-only.
 *
 * These assertions are cheap and the failure they prevent is not: a window flag
 * that leaked into the `pull_request` path would silently re-baseline every
 * model PR against a different corpus, and nothing else in the repo would
 * notice.
 */
const YML = readFileSync(join(__dirname, "../../.github/workflows/backtest.yml"), "utf8");
const BACKTEST = readFileSync(join(__dirname, "../backtest.ts"), "utf8");

describe("backtest.yml window wiring", () => {
  it("offers the window only as a workflow_dispatch input", () => {
    const dispatch = YML.slice(YML.indexOf("workflow_dispatch:"), YML.indexOf("pull_request:"));
    expect(dispatch).toContain("seasons:");
    expect(dispatch).toContain("covid:");
  });

  it("never passes a window on the pull_request path", () => {
    // `inputs` is empty on a pull_request run, so the only way a window could
    // reach a PR report is a hardcoded flag in the run step.
    const runStep = YML.slice(YML.indexOf("- name: Run backtest"));
    expect(runStep).not.toMatch(/--seasons=\d/);
    expect(runStep).not.toMatch(/--covid=(chain|score|drop)\b(?!.*inputs)/);
    // The flags reach the command only through the inputs.
    expect(runStep).toContain("${{ inputs.seasons }}");
  });

  it("lists every tuner the script accepts, so none is reachable only by editing the workflow", () => {
    // This list had already drifted once: four tuners existed in backtest.ts
    // and were missing from the dropdown.
    const flags = [...BACKTEST.matchAll(/--(?:tune|diagnose)[a-z-]*/g)]
      .map((m) => m[0].replace(/^--/, ""))
      // `tune` is the tune checkbox, not an experiment; `diagnose-edges` has
      // its own always-on step further down the workflow, so it is deliberately
      // absent from the dropdown rather than missing from it.
      .filter((f) => f !== "tune" && f !== "diagnose-edges");
    const dropdown = YML.slice(YML.indexOf("experiment:"), YML.indexOf("seasons:"));
    for (const flag of new Set(flags)) {
      if (!FEED_REQUIREMENTS[flag]) continue;
      expect(dropdown, `${flag} missing from the experiment dropdown`).toContain(`- ${flag}`);
    }
  });

  it("gives the wide window enough time to finish", () => {
    // A grid tuner replays every season at every grid point, so eleven seasons
    // is ~4x the compute of three. A timeout that kills the run mid-grid
    // produces no number at all.
    const timeout = Number(YML.match(/timeout-minutes:\s*(\d+)/)?.[1]);
    expect(timeout).toBeGreaterThanOrEqual(60);
  });
});

describe("every experiment declares the feeds it consumes", () => {
  it("has a FEED_REQUIREMENTS row for each tuner in the dropdown", () => {
    // Without a row, assertFeedCoverage silently checks nothing, which is the
    // exact silent-degradation failure the coverage machinery exists to stop.
    const dropdown = YML.slice(YML.indexOf("experiment:"), YML.indexOf("seasons:"));
    const listed = [...dropdown.matchAll(/^\s+- ((?:tune|diagnose)[a-z-]*)$/gm)].map((m) => m[1]);
    expect(listed.length).toBeGreaterThan(10);
    for (const experiment of listed) {
      expect(FEED_REQUIREMENTS[experiment], `${experiment} has no declared feeds`).toBeDefined();
    }
  });
});
