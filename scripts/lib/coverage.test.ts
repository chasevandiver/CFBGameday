import { describe, expect, it, vi } from "vitest";
import {
  CoverageError,
  FEED_REQUIREMENTS,
  assertFeedCoverage,
  coverageComplaints,
  coverageVerdict,
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
