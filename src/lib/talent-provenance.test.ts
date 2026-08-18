import { describe, expect, it } from "vitest";
import { talentProvenance } from "./talent-provenance";

describe("talentProvenance", () => {
  it("reports a forced build with the season it fell back to", () => {
    const rows = Array.from({ length: 138 }, () => ({
      detail: { talent_source: 2025, talent_stale: true },
    }));
    expect(talentProvenance(rows)).toEqual({ stale: true, source: 2025, teams: 138 });
  });

  it("is silent when the build had the current talent file", () => {
    const rows = [{ detail: { talent_source: 2026, talent_stale: false } }];
    expect(talentProvenance(rows)).toEqual({ stale: false, source: null, teams: 0 });
  });

  it("does not claim freshness for rows written before the stamp existed", () => {
    // The whole point: production's 2026.2.0 components carry neither field.
    // Absence must read as "unknown" and render nothing, not as "fresh".
    const rows = [{ detail: { proxies: ["ol_share=0.5"] } }, { detail: null }, { detail: 7 }];
    expect(talentProvenance(rows)).toEqual({ stale: false, source: null, teams: 0 });
  });

  it("counts a partial stamp rather than rounding it to all or nothing", () => {
    // A half-applied upsert is worth seeing as 2-of-3, not as "stale".
    const rows = [
      { detail: { talent_stale: true, talent_source: 2025 } },
      { detail: { talent_stale: true, talent_source: 2025 } },
      { detail: { talent_stale: false, talent_source: 2026 } },
    ];
    expect(talentProvenance(rows)).toEqual({ stale: true, source: 2025, teams: 2 });
  });

  it("treats a truthy-but-not-true stamp as unstamped", () => {
    // jsonb round-trips strings; "true" is not true, and guessing which the
    // writer meant is how a note ends up lying in both directions.
    expect(talentProvenance([{ detail: { talent_stale: "true" } }]).stale).toBe(false);
  });

  it("survives a stale row with no source on it", () => {
    expect(talentProvenance([{ detail: { talent_stale: true } }])).toEqual({
      stale: true,
      source: null,
      teams: 1,
    });
  });

  it("is empty on no rows", () => {
    expect(talentProvenance([])).toEqual({ stale: false, source: null, teams: 0 });
  });
});
