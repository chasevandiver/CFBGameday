import { describe, expect, it } from "vitest";
import {
  classPointsByTeam,
  rosterClassPoints,
  scaleToTalentPoints,
} from "./recruiting-talent";

describe("classPointsByTeam", () => {
  it("keeps ranked classes and drops null points", () => {
    const m = classPointsByTeam([
      { year: 2026, team: "Georgia", points: 310.2 },
      { year: 2026, team: "New Kid U", points: null },
    ]);
    expect(m.get("Georgia")).toBe(310.2);
    expect(m.has("New Kid U")).toBe(false);
  });
});

describe("rosterClassPoints", () => {
  const byYear = new Map<number, Map<string, number>>([
    [2023, new Map([["Georgia", 300], ["Toledo", 150]])],
    [2024, new Map([["Georgia", 320], ["Toledo", 160]])],
    [2025, new Map([["Georgia", 280]])],
    [2026, new Map([["Georgia", 300], ["Lone Class Tech", 200]])],
  ]);

  it("sums the trailing four classes when all are present", () => {
    // Georgia has 4 classes: mean(300,320,280,300) × 4 = 1200.
    expect(rosterClassPoints(byYear, 2026).get("Georgia")).toBe(1200);
  });

  it("scales a partial history by the mean, not the sum", () => {
    // Toledo has 2 of 4 classes; mean(150,160) × 4 = 620 — missing classes
    // must not read as classes of zero recruits.
    expect(rosterClassPoints(byYear, 2026).get("Toledo")).toBe(620);
  });

  it("refuses a single-class roster estimate", () => {
    expect(rosterClassPoints(byYear, 2026).has("Lone Class Tech")).toBe(false);
  });

  it("windows on the season asked for", () => {
    // For season 2024 the window is 2021–2024: Georgia has 2023+2024 only.
    expect(rosterClassPoints(byYear, 2024).get("Georgia")).toBe(1240);
  });
});

describe("scaleToTalentPoints", () => {
  const idsByName = new Map(
    Array.from({ length: 30 }, (_, i) => [`Team ${i}`, i] as const),
  );
  const pool = new Set(Array.from({ length: 30 }, (_, i) => i));

  it("z-scores over the pool and clamps to ±18 on the composite's scale", () => {
    const points = new Map(
      Array.from({ length: 30 }, (_, i) => [`Team ${i}`, i === 0 ? 10_000 : 1000 + i] as const),
    );
    const scaled = scaleToTalentPoints(points, idsByName, pool);
    expect(scaled.size).toBe(30);
    expect(scaled.get(0)).toBe(18); // the runaway class clamps
    // The rest sit below the mean by construction, so strictly negative.
    expect(scaled.get(1)!).toBeLessThan(0);
    expect(Math.min(...scaled.values())).toBeGreaterThanOrEqual(-18);
  });

  it("only scores teams matched into the pool", () => {
    const points = new Map<string, number>([
      ...Array.from({ length: 25 }, (_, i) => [`Team ${i}`, 1000 + i] as const),
      ["FCS Straggler", 400],
    ]);
    const scaled = scaleToTalentPoints(points, idsByName, pool);
    expect(scaled.size).toBe(25);
  });

  it("returns empty rather than a baseline built on nothing", () => {
    const few = new Map<string, number>([["Team 1", 900]]);
    expect(scaleToTalentPoints(few, idsByName, pool).size).toBe(0);
    // Degenerate spread: everyone identical says nothing about anyone.
    const flat = new Map(
      Array.from({ length: 30 }, (_, i) => [`Team ${i}`, 1000] as const),
    );
    expect(scaleToTalentPoints(flat, idsByName, pool).size).toBe(0);
  });
});
