import { describe, expect, it } from "vitest";
import { gradeAts, ols } from "./backtest";
import type { ReplayPrediction } from "./lib/replay";

const pred = (over: Partial<ReplayPrediction>): ReplayPrediction => ({
  season: 2024,
  week: 5,
  gameId: 1,
  margin: 0,
  homeWinProb: 0.5,
  vegasSpread: null,
  edge: null,
  actualMargin: 0,
  favoriteWon: null,
  favWinProb: 0.5,
  projectedTotal: 57,
  vegasTotal: null,
  actualTotal: 57,
  vegasOpen: null,
  bookCount: 0,
  bookSpread: null,
  mlHome: null,
  mlAway: null,
  neutralSite: false,
  conferenceGame: true,
  startDate: "2024-09-28T16:00:00.000Z",
  homeId: 1,
  awayId: 2,
  ...over,
});

describe("gradeAts", () => {
  it("counts a true push as a push, not a win or a loss", () => {
    // line home -7, home wins by exactly 7 → push
    const p = pred({ margin: 10, vegasSpread: -7, actualMargin: 7 });
    expect(gradeAts([p], (x) => x.vegasSpread)).toEqual({ wins: 0, losses: 0, pushes: 1 });
  });

  it("scores the model's side against the line it was graded on", () => {
    // model likes home by 10, line is home -7 → model side is home
    const covered = pred({ margin: 10, vegasSpread: -7, actualMargin: 14 }); // home covers
    const failed = pred({ margin: 10, vegasSpread: -7, actualMargin: 3 }); // home doesn't
    expect(gradeAts([covered], (x) => x.vegasSpread).wins).toBe(1);
    expect(gradeAts([failed], (x) => x.vegasSpread).losses).toBe(1);
  });

  it("takes the away side when the model is below the line", () => {
    // model has home by only 2, line is home -7 → model likes away +7
    const awayCovers = pred({ margin: 2, vegasSpread: -7, actualMargin: 3 });
    expect(gradeAts([awayCovers], (x) => x.vegasSpread).wins).toBe(1);
  });

  it("skips predictions with no line for the chosen grader", () => {
    const noOpener = pred({ margin: 10, vegasSpread: -7, vegasOpen: null, actualMargin: 14 });
    expect(gradeAts([noOpener], (x) => x.vegasOpen)).toEqual({ wins: 0, losses: 0, pushes: 0 });
  });

  it("can grade the same game against two different lines — the whole point", () => {
    // opener had home -3; it closed at -7. Home won by 5: covers the opener,
    // fails the close. Betting early and betting late are different wagers.
    const p = pred({ margin: 10, vegasOpen: -3, vegasSpread: -7, actualMargin: 5 });
    expect(gradeAts([p], (x) => x.vegasOpen).wins).toBe(1);
    expect(gradeAts([p], (x) => x.vegasSpread).losses).toBe(1);
  });
});

describe("ols", () => {
  it("recovers known coefficients from a noiseless fit", () => {
    // y = 2 + 3·x1 − 1·x2
    const x1 = [1, 2, 3, 4, 5, 6];
    const x2 = [2, 1, 4, 3, 6, 5];
    const y = x1.map((v, i) => 2 + 3 * v - 1 * x2[i]);
    const { beta } = ols(y, [x1, x2]);
    expect(beta[0]).toBeCloseTo(2, 6);
    expect(beta[1]).toBeCloseTo(3, 6);
    expect(beta[2]).toBeCloseTo(-1, 6);
  });

  it("gives a near-zero coefficient to a regressor carrying no information", () => {
    // y tracks x1 exactly; x2 is unrelated. The encompassing regression's job
    // is to report b≈0 for a variable that adds nothing — which is exactly the
    // verdict we're asking it for on our model vs the market.
    const x1 = [1, 2, 3, 4, 5, 6, 7, 8];
    const x2 = [5, 3, 8, 1, 7, 2, 6, 4];
    const y = x1.map((v) => 10 + 2 * v);
    const { beta } = ols(y, [x1, x2]);
    expect(beta[1]).toBeCloseTo(2, 6);
    expect(Math.abs(beta[2])).toBeLessThan(1e-6);
  });

  it("reports standard errors that shrink as noise shrinks", () => {
    const x1 = Array.from({ length: 60 }, (_, i) => i);
    const x2 = Array.from({ length: 60 }, (_, i) => (i * 7) % 13);
    const noisy = x1.map((v, i) => 3 * v + ((i % 5) - 2) * 4);
    const clean = x1.map((v, i) => 3 * v + ((i % 5) - 2) * 0.1);
    expect(ols(clean, [x1, x2]).se[1]).toBeLessThan(ols(noisy, [x1, x2]).se[1]);
  });
});
