import { describe, expect, it } from "vitest";
import { productDate, productDateOffset, streakFold } from "./streak";

const p = (day: string, result: "win" | "loss" | "void" | null) => ({ day, result });

describe("streakFold", () => {
  it("wins extend, a loss resets, best survives the reset", () => {
    const s = streakFold([
      p("2026-09-01", "win"),
      p("2026-09-02", "win"),
      p("2026-09-03", "win"),
      p("2026-09-04", "loss"),
      p("2026-09-05", "win"),
    ]);
    expect(s).toEqual({ current: 1, best: 3, wins: 4, losses: 1 });
  });

  it("void and pending days pass through — a run is broken by a wrong answer only", () => {
    const s = streakFold([
      p("2026-09-01", "win"),
      p("2026-09-02", "void"),
      p("2026-09-03", null),
      p("2026-09-04", "win"),
    ]);
    expect(s.current).toBe(2);
    expect(s.best).toBe(2);
  });

  it("folds chronologically whatever order the rows arrive in", () => {
    const s = streakFold([
      p("2026-09-03", "loss"),
      p("2026-09-01", "win"),
      p("2026-09-02", "win"),
    ]);
    expect(s.current).toBe(0);
    expect(s.best).toBe(2);
  });

  it("empty history is all zeros", () => {
    expect(streakFold([])).toEqual({ current: 0, best: 0, wins: 0, losses: 0 });
  });
});

describe("productDate", () => {
  it("is the product timezone's calendar day, not UTC's", () => {
    expect(productDate(new Date("2026-09-06T02:30:00Z"))).toBe("2026-09-05");
  });
  it("offsets by whole days", () => {
    expect(productDateOffset(new Date("2026-09-06T02:30:00Z"), 1)).toBe("2026-09-06");
    expect(productDateOffset(new Date("2026-09-06T02:30:00Z"), -1)).toBe("2026-09-04");
  });
});
