import { describe, expect, it } from "vitest";
import { buildQuestions, SIX } from "./six-pack";

/** A candidate game as the job assembles it (marquee shape + its numbers). */
const cand = (id: number, over: Partial<{ spread: number | null; total: number | null; start_ts: string }> = {}) => ({
  id,
  home_team_id: id * 10,
  away_team_id: id * 10 + 1,
  start_ts: `2026-09-05T1${id}:00:00Z`,
  spread: -6.5,
  total: 51.5,
  ...over,
});

const slate = (n: number) => Array.from({ length: n }, (_, i) => cand(i + 1));

describe("buildQuestions", () => {
  it("builds exactly six from a full slate", () => {
    const qs = buildQuestions(slate(8));
    expect(qs).toHaveLength(SIX);
    expect(qs.map((q) => q.idx)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("is deterministic — a repair run rebuilds the same shape", () => {
    const games = slate(8);
    expect(buildQuestions(games)).toEqual(buildQuestions([...games].reverse()));
  });

  it("keeps at least four questions bound to a game, so the slate can lock", () => {
    // The RPC refuses an entry on a slate with nothing to lock against; the
    // generator is what guarantees that never happens.
    const bound = buildQuestions(slate(8)).filter((q) => q.game_id !== null);
    expect(bound.length).toBeGreaterThanOrEqual(4);
  });

  it("every question offers at least two distinct choices", () => {
    for (const q of buildQuestions(slate(8))) {
      expect(q.choices.length).toBeGreaterThanOrEqual(2);
      expect(new Set(q.choices).size).toBe(q.choices.length);
    }
  });

  it("freezes the spread and total onto the questions that need them", () => {
    const qs = buildQuestions(slate(8));
    const cover = qs.find((q) => q.kind === "cover");
    const total = qs.find((q) => q.kind === "total");
    expect(cover?.line).toBe(-6.5);
    expect(total?.line).toBe(51.5);
  });

  it("never asks a cover or total at a null line — it skips the kind instead", () => {
    const qs = buildQuestions(slate(8).map((g) => ({ ...g, spread: null, total: null })));
    expect(qs.some((q) => q.kind === "cover" || q.kind === "total")).toBe(false);
    for (const q of qs) {
      if (q.kind === "cover" || q.kind === "total") expect(q.line).not.toBeNull();
    }
  });

  it("closes with a slate-wide question whose choices are its own games", () => {
    const qs = buildQuestions(slate(8));
    const hg = qs.find((q) => q.kind === "high_game");
    expect(hg).toBeDefined();
    const named = new Set(qs.map((q) => q.game_id).filter((id) => id !== null).map(String));
    // The closure rule: every candidate it offers is a game this slate names.
    for (const choice of hg!.choices) expect(named.has(choice)).toBe(true);
  });

  it("returns fewer than six rather than inventing questions from a thin slate", () => {
    // The caller writes nothing unless it gets six — a half-slate is repaired
    // on a later run, never padded with unaskable questions.
    const qs = buildQuestions(slate(1));
    expect(qs.length).toBeLessThan(SIX);
  });

  it("returns nothing at all for an empty slate", () => {
    expect(buildQuestions([])).toEqual([]);
  });
});
