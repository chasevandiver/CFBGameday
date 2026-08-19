import { describe, expect, it, vi } from "vitest";
import { DEFAULT_WINDOW, makeWindow } from "./window";
import {
  CoverageError,
  FEED_REQUIREMENTS,
  assertFeedCoverage,
  coverageComplaints,
  coverageVerdict,
  loadCoverageManifest,
  narrowestWorkingWindow,
  type CoverageManifest,
  type CoverageRow,
  type FeedKey,
} from "./coverage";

const rows = (feed: FeedKey, spec: Record<number, CoverageRow["verdict"]>): CoverageRow[] =>
  Object.entries(spec).map(([season, verdict]) => ({
    season: Number(season),
    feed,
    verdict,
    rows: verdict === "OK" ? 130 : verdict === "THIN" ? 12 : 0,
  }));

const manifest = (probedAt: string | null, rs: CoverageRow[]): CoverageManifest => ({
  probedAt,
  note: "",
  rows: rs,
});

describe("coverageVerdict", () => {
  it("keeps DENIED and EMPTY apart — the distinction probe.ts exists to preserve", () => {
    // A 403 means buy a tier; an empty 200 means the season was never collected.
    expect(coverageVerdict({ status: "DENIED", rows: null }, 100)).toBe("DENIED");
    expect(coverageVerdict({ status: "EMPTY", rows: 0 }, 100)).toBe("EMPTY");
    expect(coverageVerdict({ status: "ERROR", rows: null }, 100)).toBe("ERROR");
  });

  it("adds THIN, which present-but-unusable needs and the access probe has no word for", () => {
    expect(coverageVerdict({ status: "OK", rows: 130 }, 100)).toBe("OK");
    expect(coverageVerdict({ status: "OK", rows: 42 }, 100)).toBe("THIN");
    expect(coverageVerdict({ status: "OK", rows: 100 }, 100)).toBe("OK");
  });
});

describe("coverageComplaints", () => {
  it("reports a scored season with no manifest row as UNPROBED, not as fine", () => {
    const c = coverageComplaints("tune-hfa", [2016, 2017], manifest(null, []));
    expect(c).toHaveLength(1);
    expect(c[0].verdict).toBe("UNPROBED");
    expect(c[0].seasons).toEqual([2016, 2017]);
  });

  it("is silent when every required feed clears", () => {
    const m = manifest("2026-08-18", rows("ratings/sp", { 2024: "OK", 2025: "OK" }));
    expect(coverageComplaints("tune-hfa", [2024, 2025], m)).toEqual([]);
  });

  it("checks every feed an experiment declares", () => {
    expect(FEED_REQUIREMENTS["tune-churn"]).toContain("player/returning");
    const m = manifest("2026-08-18", [
      ...rows("ratings/sp", { 2016: "OK", 2024: "OK" }),
      ...rows("talent", { 2016: "OK", 2024: "OK" }),
      ...rows("player/returning", { 2016: "EMPTY", 2024: "OK" }),
    ]);
    const c = coverageComplaints("tune-churn", [2016, 2024], m);
    expect(c).toEqual([{ feed: "player/returning", seasons: [2016], verdict: "EMPTY" }]);
  });
});

describe("narrowestWorkingWindow", () => {
  it("returns the suffix that clears, since coverage dies at the old end", () => {
    const m = manifest("2026-08-18", [
      ...rows("ratings/sp", { 2016: "OK", 2017: "OK", 2018: "OK" }),
      ...rows("talent", { 2016: "EMPTY", 2017: "OK", 2018: "OK" }),
      ...rows("player/returning", { 2016: "EMPTY", 2017: "OK", 2018: "OK" }),
    ]);
    expect(narrowestWorkingWindow("tune-churn", [2016, 2017, 2018], m)).toEqual([2017, 2018]);
  });
});

describe("assertFeedCoverage", () => {
  it("warns but does not throw when nothing has been probed yet", () => {
    // The probe costs ~78 calls and one dispatch; blocking every backtest run
    // behind it would make the honest thing the annoying thing.
    const log = vi.fn();
    expect(() =>
      assertFeedCoverage("tune-churn", { scored: [2016], label: "t" }, manifest(null, []), log),
    ).not.toThrow();
    expect(log.mock.calls[0][0]).toContain("UNVERIFIED");
    expect(log.mock.calls[0][0]).toContain("probe:history");
  });

  it("throws once a probe has established the feed really is missing", () => {
    const m = manifest("2026-08-18", [
      ...rows("ratings/sp", { 2016: "OK", 2024: "OK", 2025: "OK" }),
      ...rows("talent", { 2016: "OK", 2024: "OK", 2025: "OK" }),
      ...rows("player/returning", { 2016: "EMPTY", 2024: "OK", 2025: "OK" }),
    ]);
    try {
      assertFeedCoverage(
        "tune-churn",
        { scored: [2016, 2024, 2025], label: "2015-2025/warmup1/covid-chain" },
        m,
        () => {},
      );
      throw new Error("expected a refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(CoverageError);
      const message = (err as Error).message;
      expect(message).toContain("player/returning is EMPTY for 2016");
      // An error that names the fix is a redirect rather than a stop.
      expect(message).toContain("--seasons=2023-2025");
      expect(message).toContain("incomparable");
    }
  });

  it("passes cleanly on a fully covered window", () => {
    const m = manifest("2026-08-18", rows("ratings/sp", { 2024: "OK", 2025: "OK" }));
    expect(() =>
      assertFeedCoverage("report", { scored: [2024, 2025], label: "t" }, m, () => {}),
    ).not.toThrow();
  });
});

/**
 * The tests above exercise the reasoning on synthetic manifests. These pin the
 * COMMITTED one, because that file is the reviewed fact the gate actually
 * consults — and a re-probe rewrites it wholesale. Without this, a future
 * `--write` that silently degraded a feed would flip tuners from "refuses" to
 * "runs" (or the reverse) with nothing in the diff review to catch it.
 */
describe("the committed manifest", () => {
  const m = loadCoverageManifest();
  const window = makeWindow(
    Array.from({ length: DEFAULT_WINDOW.to - DEFAULT_WINDOW.from + 1 }, (_, i) => DEFAULT_WINDOW.from + i),
  );

  it("has been probed, so the gate is a gate", () => {
    // probedAt null is the warn-only state. Shipping it committed would mean
    // every tuner keeps printing numbers over windows nobody has verified.
    expect(m.probedAt).not.toBeNull();
    // 78 original rows + 13 recruiting/teams (2013-2025, run 32278795011).
    // That re-probe reproduced all 78 pre-existing verdicts and row counts
    // exactly — the diff was purely additive, which is what made it safe to
    // commit without re-litigating the earlier rows.
    expect(m.rows).toHaveLength(91);
  });

  it("still has the row the whole 2015 window rests on", () => {
    // A 2015 season seeds its priors from 2014 SP+. If this ever comes back
    // THIN or EMPTY the default window is unseedable, and the failure would
    // otherwise show up as a quietly worse model rather than as an error.
    const sp2014 = m.rows.find((r) => r.season === 2014 && r.feed === "ratings/sp");
    expect(sp2014?.verdict).toBe("OK");
  });

  it("blocks exactly one tuner on the default window, and names its fix", () => {
    // Reviewed 2026-08-19 against run 32208194660. `ratings/elo@wk1` is thin
    // 2015-2021, which is a real CFBD gap and confines --tune-anchors to the
    // recent end. Everything else clears, INCLUDING --tune-epa: advanced stats
    // are thin for 2020 alone and 2020 is chain-only, so it is never scored.
    const blocked = Object.keys(FEED_REQUIREMENTS).filter((experiment) => {
      try {
        assertFeedCoverage(experiment, window, m, () => {});
        return false;
      } catch {
        return true;
      }
    });
    expect(blocked).toEqual(["tune-anchors"]);
    expect(() => assertFeedCoverage("tune-anchors", window, m, () => {})).toThrow(
      /--seasons=2021-2025/,
    );
  });

  it("carries no UNPROBED gap for any feed a tuner declares", () => {
    // A missing row reads as UNPROBED, which only WARNS. A manifest that has
    // been probed but is missing rows is therefore the one state that looks
    // covered and is not.
    for (const experiment of Object.keys(FEED_REQUIREMENTS)) {
      const unprobed = coverageComplaints(experiment, window.scored, m).filter(
        (c) => c.verdict === "UNPROBED",
      );
      expect(unprobed, `${experiment} has unprobed feeds`).toEqual([]);
    }
  });
});
