import { describe, expect, it } from "vitest";
import {
  atsResult,
  fmtMoneyline,
  fmtSpread,
  gradeModel,
  modelPicks,
  ouResult,
  pickHero,
  spreadMove,
  weekModelRecord,
  type GameView,
  type TeamView,
} from "./slate";

const team = (id: number, rank: number | null = null): TeamView => ({
  id,
  school: `Team ${id}`,
  abbr: `T${id}`,
  mascot: null,
  conference: "SEC",
  color: null,
  altColor: null,
  logo: null,
  rank,
  record: null,
});

const game = (overrides: Partial<GameView> = {}): GameView => ({
  id: 1,
  week: 1,
  startTs: "2026-09-05T16:00:00Z",
  status: "final",
  period: null,
  clock: null,
  tv: null,
  neutralSite: false,
  homePoints: 30,
  awayPoints: 20,
  home: team(1),
  away: team(2),
  lines: {
    spread: -6.5,
    spreadOpen: -7,
    total: 48.5,
    totalOpen: 48.5,
    mlHome: -260,
    mlAway: 210,
  },
  spreadHistory: [],
  prediction: null,
  myPick: null,
  weather: null,
  dome: false,
  ...overrides,
});

const prediction = (overrides = {}) => ({
  spread: -9,
  total: 52.5,
  homeScore: 31,
  awayScore: 22,
  homeWinProb: 0.72,
  vegasSpread: -6.5,
  edge: -2.5,
  edgeFlag: "EDGE" as const,
  consensus: false,
  ...overrides,
});

describe("atsResult", () => {
  it("home covers when margin beats the spread", () => {
    // -6.5 favorite wins by 10
    expect(atsResult(game())).toBe("home");
  });

  it("away covers when the favorite wins but not by enough", () => {
    expect(atsResult(game({ homePoints: 24, awayPoints: 20 }))).toBe("away");
  });

  it("pushes on the number", () => {
    expect(atsResult(game({ lines: { ...game().lines, spread: -10 } }))).toBe("push");
  });

  it("null before final or without a line", () => {
    expect(atsResult(game({ status: "in_progress" }))).toBeNull();
    expect(atsResult(game({ lines: { ...game().lines, spread: null } }))).toBeNull();
  });
});

describe("ouResult", () => {
  it("over / under / push", () => {
    expect(ouResult(game())).toBe("over"); // 50 vs 48.5
    expect(ouResult(game({ homePoints: 20, awayPoints: 21 }))).toBe("under");
    expect(ouResult(game({ lines: { ...game().lines, total: 50 } }))).toBe("push");
  });
});

describe("modelPicks", () => {
  it("negative edge → home ATS side; model total above market → over", () => {
    const g = game({ prediction: prediction() });
    expect(modelPicks(g)).toEqual({ winner: "home", atsSide: "home", ouLean: "over" });
  });

  it("positive edge → away side; no lean when totals equal", () => {
    const g = game({ prediction: prediction({ edge: 3, total: 48.5, homeWinProb: 0.4 }) });
    expect(modelPicks(g)).toEqual({ winner: "away", atsSide: "away", ouLean: null });
  });

  it("no prediction → no picks", () => {
    expect(modelPicks(game())).toEqual({ winner: null, atsSide: null, ouLean: null });
  });
});

describe("gradeModel", () => {
  it("grades winner, ats, and total against the final", () => {
    // model: home ATS at -6.5, over 48.5, home to win. Actual 30-20: all hit.
    const g = game({ prediction: prediction() });
    expect(gradeModel(g)).toEqual({ winner: true, ats: true, total: true });
  });

  it("misses grade false; pushes grade null", () => {
    const g = game({
      homePoints: 24,
      awayPoints: 20, // home wins, doesn't cover; total 44 under
      prediction: prediction(),
    });
    expect(gradeModel(g)).toEqual({ winner: true, ats: false, total: false });

    const push = game({
      homePoints: 27,
      awayPoints: 20, // margin 7
      prediction: prediction({ vegasSpread: -7 }),
    });
    expect(gradeModel(push).ats).toBeNull();
  });

  it("ungraded before final", () => {
    const g = game({ status: "scheduled", homePoints: null, awayPoints: null, prediction: prediction() });
    expect(gradeModel(g)).toEqual({ winner: null, ats: null, total: null });
  });
});

describe("weekModelRecord", () => {
  it("tallies ATS wins, losses, and pushes across the slate", () => {
    const games = [
      game({ id: 1, prediction: prediction() }), // home ATS, home covers → W
      game({ id: 2, homePoints: 24, awayPoints: 20, prediction: prediction() }), // → L
      game({ id: 3, homePoints: 27, awayPoints: 20, prediction: prediction({ vegasSpread: -7 }) }), // push
      game({ id: 4, status: "scheduled", homePoints: null, awayPoints: null, prediction: prediction() }),
      game({ id: 5 }), // no prediction — skipped
    ];
    expect(weekModelRecord(games)).toEqual({ wins: 1, losses: 1, pushes: 1 });
  });
});

describe("pickHero", () => {
  it("prefers the ranked matchup over a closer unranked spread", () => {
    const ranked = game({
      id: 10,
      status: "scheduled",
      home: team(1, 3),
      away: team(2, 7),
      lines: { ...game().lines, spread: -6.5 },
    });
    const close = game({
      id: 11,
      status: "scheduled",
      lines: { ...game().lines, spread: -1 },
    });
    expect(pickHero([close, ranked])?.id).toBe(10);
  });

  it("never picks postponed games; null on empty", () => {
    expect(pickHero([])).toBeNull();
    const dead = game({ status: "postponed", home: team(1, 1), away: team(2, 2) });
    const alive = game({ id: 12, status: "scheduled" });
    expect(pickHero([dead, alive])?.id).toBe(12);
  });
});

describe("formatting & movement", () => {
  it("fmtSpread handles PK, signs, and null", () => {
    expect(fmtSpread(0)).toBe("PK");
    expect(fmtSpread(-6.5)).toBe("-6.5");
    expect(fmtSpread(3)).toBe("+3");
    expect(fmtSpread(null)).toBe("–");
  });

  it("fmtMoneyline signs positive odds", () => {
    expect(fmtMoneyline(210)).toBe("+210");
    expect(fmtMoneyline(-260)).toBe("-260");
  });

  it("spreadMove is signed vs open and null when flat", () => {
    expect(spreadMove(game())).toBeCloseTo(0.5); // -6.5 vs open -7
    expect(spreadMove(game({ lines: { ...game().lines, spreadOpen: -6.5 } }))).toBeNull();
  });
});
