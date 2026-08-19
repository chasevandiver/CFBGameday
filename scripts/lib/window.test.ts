import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WINDOW,
  LEGACY_WINDOW,
  SeasonWindowError,
  makeWindow,
  metricsOf,
  parseSeasonWindow,
  perSeasonTable,
  splitWindow,
} from "./window";
import { COVID_SEASON, eraFlip, eraOf, erasIn, latestEraIn } from "./eras";

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("parseSeasonWindow", () => {
  it("defaults to the wide window, scoring neither the bootstrap nor COVID", () => {
    const w = parseSeasonWindow([]);
    expect(w.all).toEqual(range(DEFAULT_WINDOW.from, DEFAULT_WINDOW.to));
    expect(w.warmup).toEqual([2015]);
    expect(w.chainOnly).toEqual([COVID_SEASON]);
    expect(w.scored).toEqual([2016, 2017, 2018, 2019, 2021, 2022, 2023, 2024, 2025]);
    // 2020 is REPLAYED — the prior chain into 2021 must not step across a
    // two-year gap the chain has no term for.
    expect(w.all).toContain(COVID_SEASON);
  });

  it("reaches the pre-2026-08-18 reference window, reproducing its old split", () => {
    const w = parseSeasonWindow(["--seasons=2023-2025"]);
    expect(w.all).toEqual([2023, 2024, 2025]);
    // Exactly what `SEASONS.slice(1)` produced, which is what every figure
    // recorded before the widening was computed on.
    expect(w.scored).toEqual([2024, 2025]);
    expect(w.label).toContain(`${LEGACY_WINDOW.from}-${LEGACY_WINDOW.to}`);
  });

  it("accepts an explicit list and a space-separated value", () => {
    expect(parseSeasonWindow(["--seasons=2015,2016,2019"]).all).toEqual([2015, 2016, 2019]);
    expect(parseSeasonWindow(["--seasons", "2021-2023"]).all).toEqual([2021, 2022, 2023]);
  });

  it("carries warmup and covid mode into the label", () => {
    const w = parseSeasonWindow(["--seasons=2015-2025", "--warmup=2", "--covid=score"]);
    expect(w.warmup).toEqual([2015, 2016]);
    expect(w.scored).toContain(COVID_SEASON);
    expect(w.label).toBe("2015-2025/warmup2/covid-score");
  });

  it("drops 2020 from the replay entirely only when asked", () => {
    const w = parseSeasonWindow(["--seasons=2015-2025", "--covid=drop"]);
    expect(w.all).not.toContain(COVID_SEASON);
    expect(w.chainOnly).toEqual([]);
  });

  it("refuses rather than repairs", () => {
    // Descending: ranges run oldest-to-newest because the prior chain does.
    expect(() => parseSeasonWindow(["--seasons=2025-2015"])).toThrow(SeasonWindowError);
    // Before the archive backfill verified coverage.
    expect(() => parseSeasonWindow(["--seasons=1998-2025"])).toThrow(SeasonWindowError);
    // A single season scores nothing: its priors come from SP+.
    expect(() => parseSeasonWindow(["--seasons=2024"])).toThrow(SeasonWindowError);
    expect(() => parseSeasonWindow(["--seasons=20x4-2025"])).toThrow(SeasonWindowError);
    expect(() => parseSeasonWindow(["--covid=maybe"])).toThrow(SeasonWindowError);
    expect(() => parseSeasonWindow(["--warmup=1.5"])).toThrow(SeasonWindowError);
    // Warm-up plus chain-only consumes the whole window, so nothing is scored.
    expect(() => parseSeasonWindow(["--seasons=2015,2020"])).toThrow(SeasonWindowError);
  });

  it("treats an empty --seasons as an error, not as zero (04:DQ-13)", () => {
    // Number("") is 0, which is how a fitted parameter once disabled itself
    // silently. The guard checks the text, not the parse.
    expect(() => parseSeasonWindow(["--seasons="])).toThrow(SeasonWindowError);
  });

  it("rejects a warmup that would score the SP+-seeded bootstrap", () => {
    expect(() => makeWindow([2023, 2024, 2025], { warmup: 0 })).toThrow(SeasonWindowError);
  });
});

describe("splitWindow", () => {
  it("partitions the wide window by season, newest held out", () => {
    const { fit, holdout } = splitWindow(parseSeasonWindow([]), 2);
    expect(holdout).toEqual([2024, 2025]);
    expect(fit).toEqual([2016, 2017, 2018, 2019, 2021, 2022, 2023]);
    expect(fit.some((s) => holdout.includes(s))).toBe(false);
  });

  it("refuses a holdout the reference window cannot afford", () => {
    // Two scored seasons cannot be partitioned into a fit set and a holdout;
    // this is precisely why only --tune-ensemble had one before the widening.
    expect(() => splitWindow(parseSeasonWindow(["--seasons=2023-2025"]), 2)).toThrow(
      SeasonWindowError,
    );
  });
});

describe("eras", () => {
  it("pins the boundaries to the rule changes that motivate them", () => {
    expect(eraOf(2015)?.id).toBe("E1");
    expect(eraOf(2017)?.id).toBe("E1");
    // Portal opens Oct 2018.
    expect(eraOf(2018)?.id).toBe("E2");
    expect(eraOf(2019)?.id).toBe("E2");
    // 2020 is a hole, not an era.
    expect(eraOf(2020)).toBeNull();
    // One-time transfer + NIL both 2021.
    expect(eraOf(2021)?.id).toBe("E3");
    expect(eraOf(2023)?.id).toBe("E3");
    // Realignment complete, twelve-team playoff.
    expect(eraOf(2024)?.id).toBe("E4");
  });

  it("reports only the eras a window reaches", () => {
    expect(erasIn([2024, 2025]).map((g) => g.era.id)).toEqual(["E4"]);
    expect(erasIn([2016, 2024]).map((g) => g.era.id)).toEqual(["E1", "E4"]);
    expect(latestEraIn([2016, 2024])?.id).toBe("E4");
  });

  it("flags eras that want different values as a flip", () => {
    expect(eraFlip([{ era: "E1", argmin: 5 }, { era: "E4", argmin: 6 }], 1).agree).toBe(true);
    const wide = eraFlip([{ era: "E1", argmin: 3 }, { era: "E4", argmin: 8 }], 1);
    expect(wide.agree).toBe(false);
    expect(wide.spread).toBe(5);
  });
});

describe("perSeasonTable", () => {
  const row = (season: number, err: number) => ({
    season,
    margin: 0,
    actualMargin: err,
    favWinProb: 0.6,
    favoriteWon: true,
  });

  it("prints excluded seasons as marked rows rather than dropping them", () => {
    const w = parseSeasonWindow(["--seasons=2015-2025"]);
    const table = perSeasonTable([row(2015, 4), row(2020, 9), row(2024, 2)], w);
    // A season that vanishes is indistinguishable from one never loaded.
    expect(table).toContain("2015    not scored (warm-up, SP+ priors)");
    expect(table).toContain("2020    not scored (COVID, chained only)");
    // ...and the unscored numbers are still shown, so 2020's HFA anomaly is
    // visible as a diagnostic rather than merely asserted.
    expect(table).toContain("[unscored:");
    expect(table).toContain(w.label);
  });

  it("computes bias as actual minus model, positive meaning home under-predicted", () => {
    const m = metricsOf([row(2024, 4), row(2024, 2)]);
    expect(m?.bias).toBe(3);
    expect(m?.mae).toBe(3);
    expect(m?.n).toBe(2);
  });
});

describe("--no-admit is measurement scaffolding, not an option anyone should ship", () => {
  it("is absent from the workflow's headline report", () => {
    // The default must always admit: a frozen FBS pool is simply wrong on any
    // window wider than the one it was frozen at. The flag exists so the fix
    // can be measured against its own absence, and the headline report is not
    // where that belongs.
    const yml = readFileSync(join(__dirname, "../../.github/workflows/backtest.yml"), "utf8");
    const from = yml.indexOf("- name: Run backtest");
    const headline = yml.slice(from, yml.indexOf("- name:", from + 10));
    expect(headline).not.toContain("--no-admit");
    // It appears exactly once, in its own labelled isolation step.
    expect([...yml.matchAll(/--no-admit/g)]).toHaveLength(1);
  });
});
