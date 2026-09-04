import { describe, expect, it } from "vitest";
import {
  calibration,
  closingTotal,
  consensusOf,
  dayOf,
  edgeBandOf,
  formatRecord3,
  gradeReceipt,
  leanFavDogOf,
  leanSideOf,
  openerMoveOf,
  ouLeanOf,
  rowsFor,
  siteOf,
  spreadSizeOf,
  STALE_CLOSE_MS,
  tallyModel,
  tallyModelBy,
  tierMatchupOf,
  totalSizeOf,
  weekOf,
  WEEK_CUT,
  windowOf,
  type ModelReceipt,
} from "./model-stats";

const P4 = { school: "Georgia", conference: "SEC", classification: "fbs" };
const G5 = { school: "Toledo", conference: "MAC", classification: "fbs" };
const FCS = { school: "Mercer", conference: "SoCon", classification: "fcs" };

/** A final game the model priced at home −7 against a market of −3. */
function receipt(over: Partial<ModelReceipt> = {}): ModelReceipt {
  return {
    gameId: 1,
    seasonId: 2026,
    week: 3,
    seasonType: "regular",
    modelVersion: "2026.6.0",
    startTs: "2026-09-12T19:30:00Z", // Sat 3:30pm ET
    status: "final",
    homePoints: 31,
    awayPoints: 17,
    neutralSite: false,
    conferenceGame: true,
    home: P4,
    away: P4,
    spread: -7,
    total: 52,
    homeWinProb: 0.7,
    vegasSpread: -3,
    openSpread: -2.5,
    closeSpread: -4,
    closeTotal: 49.5,
    edge: -4,
    edgeFlag: "EDGE",
    consensusFlag: true,
    clv: 1,
    ...over,
  };
}

describe("gradeReceipt", () => {
  it("grades the lean against the freeze line and the model's side against the close", () => {
    const g = gradeReceipt(receipt());
    expect(g.final).toBe(true);
    expect(g.margin).toBe(14);
    expect(g.lean).toBe("home"); // edge −4: model likes home more than the market
    expect(g.ats).toBe("win"); // home −3, won by 14
    expect(g.atsClose).toBe("win"); // model −7 vs close −4 still sides home; home −4 covers
    expect(g.su).toBe(true);
  });

  it("a home lean that fails to cover is a loss; landing on the number is a push", () => {
    expect(gradeReceipt(receipt({ homePoints: 20, awayPoints: 18 })).ats).toBe("loss");
    expect(gradeReceipt(receipt({ homePoints: 20, awayPoints: 17 })).ats).toBe("push");
  });

  it("an away lean is graded from the away side", () => {
    // Model −1 against a market of −3: the model likes the away side.
    const g = gradeReceipt(receipt({ spread: -1, edge: 2, homePoints: 21, awayPoints: 20 }));
    expect(g.lean).toBe("away");
    expect(g.ats).toBe("win"); // away +3, lost by 1
    expect(g.su).toBe(true); // model still favoured home (0.7) and home won
  });

  it("the model's favourite is read from the win probability, not the lean", () => {
    const g = gradeReceipt(receipt({ homeWinProb: 0.45, homePoints: 31, awayPoints: 17 }));
    expect(g.su).toBe(false);
  });

  it("has no ATS result without a lean or a market line", () => {
    expect(gradeReceipt(receipt({ edge: 0 })).ats).toBeNull();
    expect(gradeReceipt(receipt({ edge: null, vegasSpread: null })).ats).toBeNull();
    expect(gradeReceipt(receipt({ closeSpread: null })).atsClose).toBeNull();
  });

  it("grades the model total against the closing total on the final score", () => {
    // 52 vs close 49.5 → over lean; 31+17 = 48 → under hit → loss
    const g = gradeReceipt(receipt());
    expect(g.ouLean).toBe("over");
    expect(g.ou).toBe("loss");
    expect(gradeReceipt(receipt({ homePoints: 35, awayPoints: 17 })).ou).toBe("win");
    expect(gradeReceipt(receipt({ total: 45, homePoints: 35, awayPoints: 17 })).ou).toBe("loss");
    expect(gradeReceipt(receipt({ closeTotal: 48 })).ou).toBe("push");
  });

  it("has no total record when no total was priced or no close was captured", () => {
    expect(gradeReceipt(receipt({ total: null })).ouLean).toBeNull();
    expect(gradeReceipt(receipt({ closeTotal: null })).ou).toBeNull();
    expect(gradeReceipt(receipt({ total: 49.5 })).ouLean).toBeNull();
  });

  it("measures error home-perspective: positive bias means home beat the number", () => {
    // Model says home by 7; home won by 14 → +7.
    const g = gradeReceipt(receipt());
    expect(g.signedError).toBe(7);
    expect(g.absError).toBe(7);
    expect(g.totalAbsError).toBe(4); // 48 scored vs 52 priced
  });

  it("grades nothing until the game is final", () => {
    const g = gradeReceipt(receipt({ status: "in_progress" }));
    expect(g.final).toBe(false);
    expect(g.ats).toBeNull();
    expect(g.su).toBeNull();
    expect(g.absError).toBeNull();
    // ...but the lean itself is known from the freeze
    expect(g.lean).toBe("home");
    expect(gradeReceipt(receipt({ status: "final", homePoints: null })).final).toBe(false);
  });
});

describe("tallyModel", () => {
  const graded = [
    gradeReceipt(receipt()), // ATS win, SU win, O/U loss, clv +1, err +7
    gradeReceipt(receipt({ homePoints: 20, awayPoints: 18, clv: -0.5 })), // ATS loss, SU win, err −5
    gradeReceipt(receipt({ homePoints: 20, awayPoints: 17, clv: null })), // push, err −4
    gradeReceipt(receipt({ status: "scheduled", homePoints: null, awayPoints: null })),
  ];

  it("counts final games only and keeps pushes as a third outcome", () => {
    const t = tallyModel(graded);
    expect(t.n).toBe(3);
    expect(t.ats).toEqual({ wins: 1, losses: 1, pushes: 1 });
    expect(t.atsPct).toBe(0.5);
    expect(t.atsSe).toBeCloseTo(Math.sqrt(0.25 / 2));
    expect(formatRecord3(t.ats)).toBe("1-1-1");
  });

  it("summarises SU, CLV, MAE and bias over the same games", () => {
    const t = tallyModel(graded);
    expect(t.su).toEqual({ wins: 3, n: 3 });
    expect(t.suPct).toBe(1);
    expect(t.clv.n).toBe(2);
    expect(t.clv.avg).toBeCloseTo(0.25);
    expect(t.mae).toBeCloseTo((7 + 5 + 4) / 3);
    expect(t.bias).toBeCloseTo((7 - 5 - 4) / 3);
  });

  it("is empty, not NaN, with nothing final", () => {
    const t = tallyModel([graded[3]]);
    expect(t.n).toBe(0);
    expect(t.atsPct).toBeNull();
    expect(t.atsSe).toBeNull();
    expect(t.mae).toBeNull();
    expect(t.ouPct).toBeNull();
    expect(t.clv.avg).toBeNull();
  });
});

describe("cuts", () => {
  const g = gradeReceipt(receipt());

  it("names the week, and folds the postseason into one bucket", () => {
    expect(weekOf(g)).toBe("Week 3");
    expect(weekOf(gradeReceipt(receipt({ seasonType: "postseason", week: 1 })))).toBe("Postseason");
  });

  it("uses the backtest's disjoint edge bands, with an unflagged band under 2", () => {
    const at = (edge: number | null) => edgeBandOf(gradeReceipt(receipt({ edge })));
    expect(at(0.5)).toBe("Under 2");
    expect(at(-1.9)).toBe("Under 2");
    expect(at(2)).toBe("2–3");
    expect(at(-3)).toBe("3–4");
    expect(at(4)).toBe("4–6");
    expect(at(-6)).toBe("6–10");
    expect(at(10)).toBe("10+");
    expect(at(null)).toBeNull();
  });

  it("reads the lean's side and which side of the market it sits on", () => {
    expect(leanSideOf(g)).toBe("Home");
    expect(leanFavDogOf(g)).toBe("Favourite"); // home −3 is the favourite; lean home
    const away = gradeReceipt(receipt({ spread: -1, edge: 2 }));
    expect(leanSideOf(away)).toBe("Away");
    expect(leanFavDogOf(away)).toBe("Underdog");
    expect(leanFavDogOf(gradeReceipt(receipt({ vegasSpread: 0, edge: -7 })))).toBe("Pick'em");
    expect(leanFavDogOf(gradeReceipt(receipt({ edge: 0 })))).toBeNull();
  });

  it("bands the market spread by its size, not its sign", () => {
    const at = (vegasSpread: number | null) => spreadSizeOf(gradeReceipt(receipt({ vegasSpread })));
    expect(at(0)).toBe("PK–3");
    expect(at(-3)).toBe("PK–3");
    expect(at(3.5)).toBe("3.5–7");
    expect(at(-14)).toBe("7.5–14");
    expect(at(-21)).toBe("14.5–21");
    expect(at(-24.5)).toBe("21+");
    expect(at(null)).toBeNull();
  });

  it("labels the tier matchup from the teams' conferences", () => {
    expect(tierMatchupOf(g)).toBe("P4 vs P4");
    expect(tierMatchupOf(gradeReceipt(receipt({ away: G5 })))).toBe("cross-tier");
    expect(tierMatchupOf(gradeReceipt(receipt({ home: G5, away: G5 })))).toBe("G5 vs G5");
    expect(tierMatchupOf(gradeReceipt(receipt({ away: FCS })))).toBe("FBS vs FCS");
    expect(tierMatchupOf(gradeReceipt(receipt({ away: { ...G5, conference: null } })))).toBeNull();
  });

  it("reads site, systems, day and window", () => {
    expect(siteOf(g)).toBe("Home field");
    expect(siteOf(gradeReceipt(receipt({ neutralSite: true })))).toBe("Neutral site");
    expect(consensusOf(g)).toBe("With the systems");
    expect(consensusOf(gradeReceipt(receipt({ consensusFlag: false })))).toBe("On its own");
    expect(dayOf(g)).toBe("Sat");
    expect(windowOf(g)).toBe("Afternoon");
    expect(dayOf(gradeReceipt(receipt({ startTs: null })))).toBeNull();
  });

  it("describes the opener-to-freeze move relative to the model's number", () => {
    // Model −7. Opened −2.5, froze −3: the market came toward the model.
    expect(openerMoveOf(g)).toBe("Came toward the model");
    expect(openerMoveOf(gradeReceipt(receipt({ openSpread: -3.5 })))).toBe("Moved away");
    expect(openerMoveOf(gradeReceipt(receipt({ openSpread: -3 })))).toBe("Held");
    expect(openerMoveOf(gradeReceipt(receipt({ openSpread: null })))).toBeNull();
  });

  it("cuts totals by lean and by the size of the closing number", () => {
    expect(ouLeanOf(g)).toBe("Over");
    expect(totalSizeOf(g)).toBe("45–55");
    expect(totalSizeOf(gradeReceipt(receipt({ closeTotal: 66, total: 60 })))).toBe("65+");
    expect(totalSizeOf(gradeReceipt(receipt({ total: null })))).toBeNull();
  });
});

describe("tallyModelBy and rowsFor", () => {
  const graded = [
    gradeReceipt(receipt({ week: 2 })),
    gradeReceipt(receipt({ week: 10 })),
    gradeReceipt(receipt({ week: 2, homePoints: 20, awayPoints: 18 })),
    gradeReceipt(receipt({ week: 4, status: "scheduled", homePoints: null, awayPoints: null })),
  ];

  it("skips receipts a cut cannot place", () => {
    const by = tallyModelBy(graded, (r) => (r.week === 2 ? "two" : null));
    expect([...by.keys()]).toEqual(["two"]);
    expect(by.get("two")?.ats).toEqual({ wins: 1, losses: 1, pushes: 0 });
  });

  it("orders week rows numerically and drops buckets with nothing final", () => {
    const rows = rowsFor(graded, WEEK_CUT);
    expect(rows.map(([k]) => k)).toEqual(["Week 2", "Week 10"]);
  });

  it("falls back to largest bucket first when the spec has no order", () => {
    const rows = rowsFor(graded, { label: "x", cut: (r) => (r.week === 2 ? "b" : "a") });
    expect(rows.map(([k]) => k)).toEqual(["b", "a"]);
  });
});

describe("calibration", () => {
  it("bands final games by the favourite's probability and compares to the hit rate", () => {
    const rows = calibration([
      gradeReceipt(receipt({ homeWinProb: 0.72 })), // fav won
      gradeReceipt(receipt({ homeWinProb: 0.28, homePoints: 31, awayPoints: 17 })), // away fav lost
      gradeReceipt(receipt({ homeWinProb: 0.95 })),
      gradeReceipt(receipt({ homeWinProb: 0.55, status: "scheduled", homePoints: null, awayPoints: null })),
    ]);
    expect(rows).toEqual([
      { label: "70–80%", n: 2, predicted: 0.72, actual: 0.5 },
      { label: "90–100%", n: 1, predicted: 0.95, actual: 1 },
    ]);
  });
});

describe("closingTotal", () => {
  const kick = "2026-09-12T19:30:00Z";

  it("keeps a total captured inside the six-hour window before kickoff", () => {
    expect(closingTotal(49.5, "2026-09-12T18:00:00Z", kick)).toBe(49.5);
  });

  it("nulls a stale, post-kick or unknown close rather than grading against it", () => {
    const stale = new Date(Date.parse(kick) - STALE_CLOSE_MS - 60_000).toISOString();
    expect(closingTotal(49.5, stale, kick)).toBeNull();
    expect(closingTotal(49.5, "2026-09-12T20:00:00Z", kick)).toBeNull();
    expect(closingTotal(49.5, null, kick)).toBeNull();
    expect(closingTotal(49.5, "2026-09-12T18:00:00Z", null)).toBeNull();
    expect(closingTotal(null, "2026-09-12T18:00:00Z", kick)).toBeNull();
  });
});
