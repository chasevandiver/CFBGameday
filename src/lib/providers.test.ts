import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGGREGATE_PROVIDERS, CANONICAL_PROVIDERS, normalizeProvider } from "./providers";
import { consensusFromSnapshots } from "./consensus";

describe("normalizeProvider", () => {
  it("collapses the spelling that was actually splitting a book in two", () => {
    // 82 games in line_snapshots carried both, from CFBD and from ESPN.
    expect(normalizeProvider("Draft Kings")).toBe("DraftKings");
    expect(normalizeProvider("DraftKings")).toBe("DraftKings");
  });

  it("catches spellings nobody has seen yet, which is the point of squashing", () => {
    // A rename list only fixes the variants already observed. This defect
    // survived two audits precisely because it looked like a one-off.
    for (const spelling of ["DRAFTKINGS", "draft-kings", "draft  kings", " draftkings "]) {
      expect(normalizeProvider(spelling)).toBe("DraftKings");
    }
    expect(normalizeProvider("espn bet")).toBe("ESPN Bet");
  });

  it("keeps regional books apart instead of merging them", () => {
    // They hang different numbers, and they never co-occur on a game (0 of
    // 9,496 checked), so merging would invent a double-count rather than
    // remove one.
    expect(normalizeProvider("Caesars (Pennsylvania)")).toBe("Caesars (Pennsylvania)");
    expect(normalizeProvider("Caesars Sportsbook (Colorado)")).toBe("Caesars Sportsbook (Colorado)");
    expect(normalizeProvider("Caesars")).toBe("Caesars");
    expect(new Set(CANONICAL_PROVIDERS).size).toBe(CANONICAL_PROVIDERS.length);
  });

  it("passes an unknown book through as the feed spells it", () => {
    // Storing a guess would be worse than storing the feed's own name.
    expect(normalizeProvider("Some New Book")).toBe("Some New Book");
    expect(normalizeProvider("  Some   New Book  ")).toBe("Some New Book");
  });

  it("is idempotent, so normalising twice is safe", () => {
    for (const name of [...CANONICAL_PROVIDERS, "Some New Book", "Draft Kings"]) {
      expect(normalizeProvider(normalizeProvider(name))).toBe(normalizeProvider(name));
    }
  });
});

describe("the defect this exists to stop", () => {
  const snap = (provider: string, spread: number) => ({
    provider,
    captured_at: "2026-08-18T00:00:00Z",
    spread,
  });

  it("double-counts a book when one name becomes two", () => {
    // The real shape from game 401762521: the same book at -6.0 and -6.5 under
    // two spellings, against one other book. Split, DraftKings gets 2/3 of the
    // weight; normalised, it gets 1/2 — which is what a consensus of two books
    // means.
    const split = consensusFromSnapshots([
      snap("Draft Kings", -6.0),
      snap("DraftKings", -6.5),
      snap("Bovada", -3.0),
    ]);
    const fixed = consensusFromSnapshots(
      [snap("Draft Kings", -6.0), snap("DraftKings", -6.5), snap("Bovada", -3.0)].map((s) => ({
        ...s,
        provider: normalizeProvider(s.provider),
      })),
    );
    expect(split.spread).not.toBe(fixed.spread);
    expect(split.spread).toBe(-5.0);
    expect(fixed.spread).toBe(-4.5);
  });
});

describe("every writer of line_snapshots normalises", () => {
  // The invariant belongs to the table, not to whichever feed filled it. DQ-14
  // prescribed a fix in the ESPN parser alone, which would have left the CFBD
  // three quarters of the defect in place and closed the row.
  const WRITERS = [
    "scripts/refresh-lines.ts",
    "scripts/nfl-refresh-lines.ts",
    "scripts/build-preseason.ts",
    "scripts/lib/backfill.ts",
  ];

  for (const file of WRITERS) {
    it(`${file} writes provider through normalizeProvider`, () => {
      const src = readFileSync(join(__dirname, "../..", file), "utf8");
      expect(src).toMatch(/provider:\s*normalizeProvider\(/);
      expect(src).not.toMatch(/provider:\s*(?:l|g)\.(?:odds!\.)?provider\s*,/);
    });
  }
});

describe("AGGREGATE_PROVIDERS", () => {
  it("names the blend CFBD returns beside the books", () => {
    // Naming it is all this does for now — DQ-15 owes the decision about
    // whether the mean should exclude it.
    expect(AGGREGATE_PROVIDERS.has("consensus")).toBe(true);
    expect(AGGREGATE_PROVIDERS.has("DraftKings")).toBe(false);
  });
});
