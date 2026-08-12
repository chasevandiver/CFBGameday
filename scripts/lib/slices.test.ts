import { describe, expect, it } from "vitest";
import type { ReplayPrediction } from "./replay";
import {
  favSignedEdge,
  g5SignedBias,
  g5SignedEdge,
  isCrossTier,
  sliceReport,
  stat,
} from "./slices";
import { recenterTierGap, tierGapOf, tierMatchup, tierOf, type Tier } from "./tiers";

const pred = (over: Partial<ReplayPrediction>): ReplayPrediction => ({
  season: 2024,
  week: 1,
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
  actualTotal: 50,
  vegasOpen: null,
  bookCount: 1,
  bookSpread: null,
  mlHome: null,
  mlAway: null,
  neutralSite: false,
  conferenceGame: false,
  startDate: "2024-08-31T16:00:00.000Z",
  homeId: 1,
  awayId: 2,
  homeTeam: "Home U",
  awayTeam: "Away U",
  homeConference: "SEC",
  awayConference: "MAC",
  homeFbs: true,
  awayFbs: true,
  ...over,
});

describe("tierOf", () => {
  it("maps the four power conferences to P4 and the rest to G5", () => {
    expect(tierOf("SEC", "Georgia", 2025)).toBe("P4");
    expect(tierOf("Big Ten", "Michigan State", 2025)).toBe("P4");
    expect(tierOf("MAC", "Toledo", 2025)).toBe("G5");
    expect(tierOf("Conference USA", "Sam Houston", 2025)).toBe("G5");
  });

  it("treats the Pac-12 as P4 through 2023 and G5 after", () => {
    expect(tierOf("Pac-12", "Washington", 2023)).toBe("P4");
    expect(tierOf("Pac-12", "Washington State", 2024)).toBe("G5");
    expect(tierOf("Pac-12", "Washington State", 2026)).toBe("G5");
  });

  it("splits independents: Notre Dame P4, everyone else G5", () => {
    expect(tierOf("FBS Independents", "Notre Dame", 2025)).toBe("P4");
    expect(tierOf("FBS Independents", "UConn", 2025)).toBe("G5");
  });

  it("returns FCS for non-FBS and unknown for a missing conference", () => {
    expect(tierOf("Big Sky", "Idaho", 2025, false)).toBe("FCS");
    expect(tierOf(null, "Mystery U", 2025)).toBe("unknown");
  });
});

describe("tierMatchup", () => {
  it("labels pairs order-independently and FCS/unknown first", () => {
    expect(tierMatchup("P4", "G5")).toBe("cross-tier");
    expect(tierMatchup("G5", "P4")).toBe("cross-tier");
    expect(tierMatchup("P4", "P4")).toBe("P4 vs P4");
    expect(tierMatchup("G5", "FCS")).toBe("FBS vs FCS");
    expect(tierMatchup("unknown", "P4")).toBe("unknown");
  });
});

describe("g5SignedEdge — the sign convention the whole diagnosis hangs on", () => {
  // Worked example from the 2026 slate: Toledo (MAC) @ Michigan State (B1G).
  // Model: Toledo −10 (margin −10 home-perspective, model spread +10).
  // Market: MSU −10.5. edge = 10 − (−10.5) = +20.5, and the G5 is away,
  // so G5-signed = +20.5: we favour Toledo by 20.5 vs the market.
  it("keeps the raw edge sign when the G5 side is away", () => {
    const p = pred({
      homeConference: "Big Ten",
      awayConference: "MAC",
      margin: -10,
      vegasSpread: -10.5,
      edge: 10 - -10.5,
    });
    expect(g5SignedEdge(p)).toBeCloseTo(20.5);
  });

  it("flips the edge sign when the G5 side is home", () => {
    // G5 hosts P4, market P4 −7 (vegasSpread +7 home-perspective is wrong —
    // away favourite means home spread is +7). Model likes the G5 home side
    // 3 more than the market: model margin −4 → model spread +4 →
    // edge = 4 − 7 = −3 (negative = likes home). G5-signed must be +3.
    const p = pred({
      homeConference: "Sun Belt",
      awayConference: "SEC",
      margin: -4,
      vegasSpread: 7,
      edge: 4 - 7,
    });
    expect(g5SignedEdge(p)).toBeCloseTo(3);
  });

  it("is null off cross-tier games and games without a line", () => {
    expect(g5SignedEdge(pred({ homeConference: "SEC", awayConference: "ACC", edge: 2 }))).toBeNull();
    expect(g5SignedEdge(pred({ edge: null }))).toBeNull();
  });
});

describe("g5SignedBias", () => {
  it("is positive when the G5 side beats our number", () => {
    // P4 home predicted +20, wins by only 10 → home-signed bias −10 →
    // the away G5 outperformed: G5-signed +10.
    const p = pred({ margin: 20, actualMargin: 10 });
    expect(g5SignedBias(p)).toBeCloseTo(10);
    // G5 home predicted −5, loses by 12 → home-signed −7 → G5-signed −7.
    const q = pred({
      homeConference: "MAC",
      awayConference: "SEC",
      margin: -5,
      actualMargin: -12,
    });
    expect(g5SignedBias(q)).toBeCloseTo(-7);
  });
});

describe("favSignedEdge", () => {
  it("signs toward the market favourite on either side", () => {
    // Home favourite (vegas −14), we like home less → edge > 0 → fav-signed < 0.
    const homefav = pred({ margin: 10, vegasSpread: -14, edge: -10 - -14 });
    expect(favSignedEdge(homefav)).toBeCloseTo(-4);
    // Away favourite (vegas +14), we like away less: model margin −10 →
    // model spread +10, edge = 10 − 14 = −4 → toward home = toward the dog →
    // fav-signed −4.
    const awayfav = pred({ margin: -10, vegasSpread: 14, edge: 10 - 14 });
    expect(favSignedEdge(awayfav)).toBeCloseTo(-4);
  });

  it("skips pick'em lines", () => {
    expect(favSignedEdge(pred({ vegasSpread: 0, edge: 3 }))).toBeNull();
  });
});

describe("recenterTierGap", () => {
  const tiers = new Map<number, Tier>([
    [1, "P4"],
    [2, "P4"],
    [3, "G5"],
    [4, "G5"],
    [5, "G5"],
    [9, "unknown"],
  ]);
  const priors = new Map([
    [1, 10],
    [2, 6],
    [3, -4],
    [4, -8],
    [5, -6],
    [9, 0],
  ]);

  it("hits the target gap exactly and keeps the overall mean fixed", () => {
    // gap now: mean(10,6) − mean(−4,−8,−6) = 8 − (−6) = 14. Target 20.
    const out = recenterTierGap(priors, tiers, 20);
    expect(tierGapOf(out, tiers)).toBeCloseTo(20);
    const meanOf = (m: Map<number, number>, ids: number[]) =>
      ids.reduce((a, id) => a + (m.get(id) as number), 0) / ids.length;
    // membership-weighted zero-sum over the shifted teams
    const before = meanOf(priors, [1, 2, 3, 4, 5]);
    const after = meanOf(out, [1, 2, 3, 4, 5]);
    expect(after).toBeCloseTo(before);
  });

  it("never reorders teams inside a pool and leaves unclassified teams alone", () => {
    const out = recenterTierGap(priors, tiers, 20);
    expect((out.get(1) as number) - (out.get(2) as number)).toBeCloseTo(4);
    expect((out.get(3) as number) - (out.get(4) as number)).toBeCloseTo(4);
    expect(out.get(9)).toBe(0);
  });

  it("is a no-op when a pool is empty", () => {
    const onlyP4 = new Map<number, Tier>([[1, "P4"]]);
    const p = new Map([[1, 10]]);
    expect(recenterTierGap(p, onlyP4, 20)).toEqual(p);
    expect(tierGapOf(p, onlyP4)).toBeNull();
  });
});

describe("stat", () => {
  it("computes mean/SE/t and returns null on empty", () => {
    expect(stat("x", [])).toBeNull();
    const s = stat("x", [9, 10, 11])!;
    expect(s.mean).toBeCloseTo(10);
    expect(s.se).toBeCloseTo(1 / Math.sqrt(3));
    expect(s.t).toBeCloseTo(10 * Math.sqrt(3));
  });
});

describe("sliceReport", () => {
  it("flags a one-directional cross-tier lean that pooled bias cannot see", () => {
    // 12 cross-tier games, all with the model favouring the G5 by ~10 vs the
    // market, arranged so half are G5-home and half G5-away — the HOME-signed
    // mean edge is ~0 (which is exactly how the real bug hid).
    const preds: ReplayPrediction[] = [];
    for (let i = 0; i < 6; i++) {
      // P4 hosts G5: model home −5 (margin +5), market home −15.x →
      // edge = −5 − (−15.x) = +10.x toward the away G5.
      preds.push(
        pred({
          gameId: i,
          homeConference: "Big Ten",
          awayConference: "MAC",
          margin: 5,
          vegasSpread: -15 - i / 10,
          edge: -5 - (-15 - i / 10),
          actualMargin: 12,
        }),
      );
      preds.push(
        pred({
          gameId: 100 + i,
          homeConference: "MAC",
          awayConference: "Big Ten",
          margin: 3,
          vegasSpread: 7 + i / 10, // market: away P4 favoured
          edge: -3 - (7 + i / 10),
          actualMargin: -6,
        }),
      );
    }
    const out = sliceReport(preds);
    expect(out).toContain("cross-tier (G5-signed)");
    // both orientations lean G5 by ≥10, so the G5-signed mean is ~+10.2 at
    // tiny SD → flagged
    const crossRow = out.split("\n").find((l) => l.startsWith("cross-tier (G5-signed)"))!;
    expect(crossRow).toContain("+10.2");
    expect(crossRow).toContain("← systematic");
    expect(isCrossTier(preds[0])).toBe(true);
  });
});
