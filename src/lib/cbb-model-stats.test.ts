import { describe, expect, it } from "vitest";
import {
  buildCbbModelStats,
  confidenceTier,
  hitPct,
  isCbbModelStats,
  modelHitFor,
  wlText,
  dayOf,
  yesterdayOf,
  type FeedGradedRecord,
  type FeedIndex,
} from "./cbb-model-stats";

/** The feed's index.json summary as published on 2026-11-12, trimmed. */
const INDEX: FeedIndex = {
  season_label: "2026-27",
  generated_at: "2026-11-12T06:41:51-05:00",
  model: { version: "4.1.0" },
  files: { season: "season-2027.json" },
  summary: {
    ats: { w: 163, l: 119, p: 0 },
    su: { correct: 258, total: 317 },
    by_confidence: {
      high: { w: 10, l: 10, p: 0 },
      medium: { w: 153, l: 109, p: 0 },
      low: { w: 0, l: 0, p: 0 },
    },
    value_plays: { w: 65, l: 65, p: 0 },
    best_bets: { w: 42, l: 38, p: 0 },
    clv: { n: 226, avg: -0.05, beat_close_pct: 26.5 },
    calibration: { ats_by_edge: { "0-2": { w: 63, l: 28 }, "7+": { w: 9, l: 17 } } },
  },
};

const rec = (slate_date: string, ats: "W" | "L" | "P" | null): FeedGradedRecord => ({
  slate_date,
  result: ats === null ? null : { ats },
});

const RECORDS = [
  rec("2026-11-10", "W"),
  rec("2026-11-10", "L"),
  rec("2026-11-11", "W"),
  rec("2026-11-11", "W"),
  rec("2026-11-11", "P"),
  rec("2026-11-11", "L"),
  rec("2026-11-12", null), // tonight: nothing graded
];

const stats = buildCbbModelStats(INDEX, RECORDS);

describe("buildCbbModelStats", () => {
  it("carries the feed's season record as stated", () => {
    expect(stats.ats).toEqual({ w: 163, l: 119, p: 0 });
    expect(stats.bestBets).toEqual({ w: 42, l: 38, p: 0 });
    expect(stats.byConfidence.medium).toEqual({ w: 153, l: 109, p: 0 });
    expect(stats.byEdge).toEqual([
      { bucket: "0-2", w: 63, l: 28, p: 0 },
      { bucket: "7+", w: 9, l: 17, p: 0 },
    ]);
    expect(stats.clv).toEqual({ n: 226, avg: -0.05, beatClosePct: 26.5 });
    expect(isCbbModelStats(stats)).toBe(true);
  });

  it("tallies each day from the season file, newest first, skipping the ungraded", () => {
    expect(stats.days).toEqual([
      { date: "2026-11-11", w: 2, l: 1, p: 1 },
      { date: "2026-11-10", w: 1, l: 1, p: 0 },
    ]);
  });

  it("keeps a fortnight", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      rec(`2026-12-${String(i + 1).padStart(2, "0")}`, "W"),
    );
    const s = buildCbbModelStats(INDEX, many);
    expect(s.days).toHaveLength(14);
    expect(s.days[0].date).toBe("2026-12-30");
  });

  it("survives a feed with no summary blocks", () => {
    const s = buildCbbModelStats({ ...INDEX, summary: {} }, []);
    expect(s.ats).toEqual({ w: 0, l: 0, p: 0 });
    expect(s.clv).toBeNull();
    expect(s.days).toEqual([]);
    expect(hitPct(s.ats)).toBeNull();
  });
});

describe("hitPct / wlText", () => {
  it("is wins over decided games, with pushes out of the denominator", () => {
    expect(hitPct({ w: 163, l: 119, p: 0 })).toBe(57.8);
    expect(hitPct({ w: 2, l: 1, p: 5 })).toBe(66.7);
    expect(hitPct({ w: 0, l: 0, p: 3 })).toBeNull();
  });

  it("prints pushes only when there are some", () => {
    expect(wlText({ w: 42, l: 38, p: 0 })).toBe("42-38");
    expect(wlText({ w: 2, l: 1, p: 1 })).toBe("2-1-1");
  });
});

describe("confidenceTier", () => {
  it("uses the feed's own cut points", () => {
    expect(confidenceTier(70)).toBe("high");
    expect(confidenceTier(69.9)).toBe("medium");
    expect(confidenceTier(40)).toBe("medium");
    expect(confidenceTier(39.9)).toBe("low");
    expect(confidenceTier(null)).toBeNull();
  });
});

describe("modelHitFor — the most specific tier a game qualifies as", () => {
  it("reads a best bet off the best-bet record, whatever its confidence", () => {
    const hit = modelHitFor(stats, { edge: -5.2, edgeFlag: "BIG_EDGE", confidence: 80 })!;
    expect(hit.label).toBe("Best bet");
    expect(hit.record).toEqual({ w: 42, l: 38, p: 0 });
    expect(hit.pct).toBe(52.5);
  });

  it("reads a value play off the value record", () => {
    expect(modelHitFor(stats, { edge: 6.6, edgeFlag: "EDGE", confidence: 55 })!.label).toBe("Value play");
  });

  it("falls back to the confidence tier for an unflagged pick", () => {
    const hit = modelHitFor(stats, { edge: 1.6, edgeFlag: null, confidence: 55 })!;
    expect(hit.label).toBe("Medium confidence");
    expect(hit.pct).toBe(58.4);
  });

  it("gives a rate of null, not zero, for a tier with nothing decided", () => {
    const hit = modelHitFor(stats, { edge: 1.6, edgeFlag: null, confidence: 20 })!;
    expect(hit.label).toBe("Low confidence");
    expect(hit.pct).toBeNull();
  });

  it("is silent where the model would not bet", () => {
    // inside half a point of the line: the feed's no-bet rule
    expect(modelHitFor(stats, { edge: 0.5, edgeFlag: null, confidence: 90 })).toBeNull();
    expect(modelHitFor(stats, { edge: -0.3, edgeFlag: null, confidence: 90 })).toBeNull();
    // no line at all
    expect(modelHitFor(stats, { edge: null, edgeFlag: null, confidence: 90 })).toBeNull();
    // no stats row yet
    expect(modelHitFor(null, { edge: 5, edgeFlag: "BIG_EDGE", confidence: 90 })).toBeNull();
  });
});

describe("yesterdayOf", () => {
  it("is the last graded day before the board in view", () => {
    expect(yesterdayOf(stats, "2026-11-12")?.date).toBe("2026-11-11");
    // stepping back a day moves it back too
    expect(yesterdayOf(stats, "2026-11-11")?.date).toBe("2026-11-10");
    expect(yesterdayOf(stats, "2026-11-10")).toBeNull();
    expect(yesterdayOf(null, "2026-11-12")).toBeNull();
  });
});

describe("dayOf", () => {
  it("is the record for that date alone, and null before anything on it is graded", () => {
    const stats = buildCbbModelStats(
      { season_label: "2026-27", generated_at: "x", model: { version: "4.1.0" }, files: { season: "s.json" }, summary: {} },
      [
        { slate_date: "2026-11-13", result: { ats: "W" } },
        { slate_date: "2026-11-14", result: { ats: "W" } },
        { slate_date: "2026-11-14", result: { ats: "L" } },
        // still being played: no result yet, so it is not in the tally
        { slate_date: "2026-11-14", result: null },
      ],
    );
    expect(dayOf(stats, "2026-11-14")).toEqual({ date: "2026-11-14", w: 1, l: 1, p: 0 });
    expect(dayOf(stats, "2026-11-15")).toBeNull();
    expect(dayOf(null, "2026-11-14")).toBeNull();
  });
});
