import { describe, expect, it } from "vitest";
import {
  atsRecord,
  atsResult,
  fmtMoneyline,
  fmtSpread,
  gradeModel,
  isRedZone,
  modelPicks,
  ouResult,
  ouRecord,
  parseSituation,
  pickHero,
  spreadMove,
  spreadMoveRead,
  modelSideOf,
  upsetAlert,
  headlinePick,
  lineForSide,
  pickSideLabel,
  watchability,
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
  pollRank: null,
  poll: null,
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
  situation: null,
  lastPlay: null,
  crewPicks: [],
  possession: null,
  prediction: null,
  myPicks: [],
  myBets: [],
  weather: null,
  dome: false,
  rivalry: null,
  systems: [],
  ...overrides,
});

// frozen: true — weekModelRecord only grades receipts rows (audit #12)
const prediction = (overrides = {}) => ({
  spread: -9,
  total: 52.5,
  homeScore: 31,
  awayScore: 22,
  homeWinProb: 0.72,
  coverProb: null,
  vegasSpread: -6.5,
  edge: -2.5,
  edgeFlag: "EDGE" as const,
  consensus: false,
  frozen: true,
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
      // unfrozen prices never count toward the report card (audit #12)
      game({ id: 6, prediction: prediction({ frozen: false }) }),
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

describe("atsRecord / ouRecord", () => {
  it("covers from the team's perspective, home or road", () => {
    // -6.5 home favorite wins by 10 → home team covers, road opponent doesn't
    expect(atsRecord([{ teamIsHome: true, margin: 10, closingSpread: -6.5 }])).toEqual({
      w: 1,
      l: 0,
      p: 0,
    });
    expect(atsRecord([{ teamIsHome: false, margin: 10, closingSpread: -6.5 }])).toEqual({
      w: 0,
      l: 1,
      p: 0,
    });
  });

  it("pushes on the number; games without a closing line are skipped", () => {
    expect(
      atsRecord([
        { teamIsHome: true, margin: 7, closingSpread: -7 },
        { teamIsHome: true, margin: 3, closingSpread: null },
      ]),
    ).toEqual({ w: 0, l: 0, p: 1 });
  });

  it("ouRecord tallies over/under/push and skips missing totals", () => {
    expect(
      ouRecord([
        { totalPoints: 50, closingTotal: 48.5 },
        { totalPoints: 41, closingTotal: 44.5 },
        { totalPoints: 45, closingTotal: 45 },
        { totalPoints: 60, closingTotal: null },
      ]),
    ).toEqual({ o: 1, u: 1, p: 1 });
  });
});

describe("modelSideOf", () => {
  // Replaced stakeForPrediction: the backtest can't support a unit size, so
  // the lean is surfaced and the stake is not (see the function's comment).
  it("negative edge → the model leans home", () => {
    expect(modelSideOf({ edge: -3, edgeFlag: "EDGE" })).toBe("home");
  });

  it("positive edge → the model leans away", () => {
    expect(modelSideOf({ edge: 3, edgeFlag: "BIG_EDGE" })).toBe("away");
  });

  it("null when the game carries no flag", () => {
    expect(modelSideOf({ edge: -4, edgeFlag: null })).toBeNull();
  });

  it("null on an exactly-zero edge, which has no side", () => {
    expect(modelSideOf({ edge: 0, edgeFlag: "EDGE" })).toBeNull();
    expect(modelSideOf({ edge: null, edgeFlag: "EDGE" })).toBeNull();
  });
});

describe("parseSituation", () => {
  it("parses a normal down-and-distance", () => {
    expect(parseSituation("2nd & 10 at OSU 34")).toEqual({
      down: 2,
      distance: 10,
      sideToken: "OSU",
      yardLine: 34,
    });
  });

  it("parses goal-to-go", () => {
    expect(parseSituation("1st & Goal at MICH 8")).toEqual({
      down: 1,
      distance: "Goal",
      sideToken: "MICH",
      yardLine: 8,
    });
  });

  it("returns null for non-play strings", () => {
    expect(parseSituation("Halftime")).toBeNull();
    expect(parseSituation("End of 3rd Quarter")).toBeNull();
    expect(parseSituation(null)).toBeNull();
    expect(parseSituation("")).toBeNull();
  });
});

describe("isRedZone", () => {
  const live = (overrides: Partial<GameView>) =>
    game({
      status: "in_progress",
      home: { ...team(1), abbr: "HOME" },
      away: { ...team(2), abbr: "AWAY" },
      ...overrides,
    });

  it("inside the defense's 20 with possession known", () => {
    expect(isRedZone(live({ possession: "away", situation: "2nd & 6 at HOME 14" }))).toBe(true);
  });

  it("goal-to-go always counts", () => {
    expect(isRedZone(live({ possession: "home", situation: "1st & Goal at AWAY 4" }))).toBe(true);
  });

  it("own side of the field is not the red zone", () => {
    expect(isRedZone(live({ possession: "away", situation: "2nd & 6 at AWAY 14" }))).toBe(false);
  });

  it("fails closed on ambiguity, missing possession, or non-live games", () => {
    expect(isRedZone(live({ possession: "away", situation: "2nd & 6 at XYZ 14" }))).toBe(false);
    expect(isRedZone(live({ possession: null, situation: "2nd & 6 at HOME 14" }))).toBe(false);
    expect(
      isRedZone(live({ status: "final", possession: "away", situation: "2nd & 6 at HOME 14" })),
    ).toBe(false);
    expect(isRedZone(live({ possession: "away", situation: "2nd & 6 at HOME 34" }))).toBe(false);
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

describe("spreadMoveRead", () => {
  it("neutral for small moves, colored vs the model side for 1.5+", () => {
    // fixture opens -7 → now -6.5: a half-point drift stays neutral
    const small = game({ status: "scheduled", prediction: prediction() });
    expect(spreadMoveRead(small)).toEqual({ delta: 0.5, vsModel: null });

    const g = game({
      status: "scheduled",
      lines: { ...game().lines, spread: -8, spreadOpen: -6 },
      prediction: prediction({ edge: -2.5 }), // model likes home
    });
    // spread dropped toward home by 2 → toward the model's side
    expect(spreadMoveRead(g)).toEqual({ delta: -2, vsModel: "toward" });

    const away = game({
      status: "scheduled",
      lines: { ...game().lines, spread: -4, spreadOpen: -6 },
      prediction: prediction({ edge: -2.5 }),
    });
    expect(spreadMoveRead(away)).toEqual({ delta: 2, vsModel: "away" });
  });
});

describe("watchability", () => {
  it("ranked close games beat unranked blowouts; dead games are null", () => {
    const marquee = game({
      status: "scheduled",
      home: team(1, 2),
      away: team(2, 5),
      lines: { ...game().lines, spread: -2.5, total: 62 },
    });
    const dud = game({
      status: "scheduled",
      lines: { ...game().lines, spread: -24, total: 41 },
    });
    expect(watchability(marquee)!).toBeGreaterThan(watchability(dud)!);
    expect(watchability(marquee)!).toBeGreaterThanOrEqual(80);
    expect(watchability(game({ status: "postponed" }))).toBeNull();
  });

  it("a rivalry lifts a game without outranking a marquee matchup", () => {
    const plain = game({
      status: "scheduled",
      lines: { ...game().lines, spread: -10, total: 45 },
    });
    const rivalry = game({
      ...plain,
      rivalry: { name: "Iron Bowl", trophy: null },
    });
    const marquee = game({
      status: "scheduled",
      home: team(1, 2),
      away: team(2, 5),
      lines: { ...game().lines, spread: -2.5, total: 62 },
    });

    // two unranked teams in a double-digit spread are worth watching *because*
    // it's a rivalry — but not more than #2 vs #5 in a one-score game
    expect(watchability(rivalry)!).toBeGreaterThan(watchability(plain)!);
    expect(watchability(rivalry)!).toBeLessThan(watchability(marquee)!);
  });
});

describe("upsetAlert", () => {
  it("fires for a top-10 team trailing an unranked team in the 2nd half", () => {
    const g = game({
      status: "in_progress",
      period: 3,
      home: team(1, null),
      away: team(2, 4),
      homePoints: 24,
      awayPoints: 17,
    });
    expect(upsetAlert(g)).toBe(true);
    expect(upsetAlert({ ...g, period: 2 })).toBe(false);
    expect(upsetAlert({ ...g, homePoints: 10 })).toBe(false);
  });
});

describe("headlinePick", () => {
  it("leads with the spread when there is one", () => {
    // A card has one cover strip and one aura. The spread is the market with a
    // number to be near, so it is the only one with a bubble tier.
    const picks = [
      { market: "total" as const, side: "over", line: 51.5 },
      { market: "spread" as const, side: "home", line: -3 },
    ];
    expect(headlinePick(picks)?.market).toBe("spread");
  });

  it("falls back to the first pick made when no spread is in play", () => {
    const picks = [
      { market: "straight_up" as const, side: "home", line: null },
      { market: "total" as const, side: "under", line: 44 },
    ];
    expect(headlinePick(picks)?.market).toBe("straight_up");
  });

  it("is null with nothing picked", () => {
    expect(headlinePick([])).toBeNull();
  });
});

describe("lineForSide", () => {
  // Spreads are stored home-perspective — make_pick snapshots the raw
  // consensus, and spreadClv and the grader both read it that way. Every
  // display path printed the stored number raw, so an away pick showed the
  // sign inverted: a bettor holding +6.5 saw "-6.5" beside their own name.
  it("leaves a home backer's number alone", () => {
    expect(lineForSide("home", -6.5)).toBe(-6.5);
    expect(lineForSide("home", 3)).toBe(3);
  });

  it("mirrors it for an away backer", () => {
    // Home -6.5 means the away side is +6.5, which is what they hold.
    expect(lineForSide("away", -6.5)).toBe(6.5);
    expect(lineForSide("away", 3)).toBe(-3);
  });

  it("never produces -0, which renders as a minus sign on a pick'em", () => {
    expect(Object.is(lineForSide("away", 0), -0)).toBe(false);
    expect(lineForSide("away", 0)).toBe(0);
  });

  it("passes a null straight through", () => {
    expect(lineForSide("away", null)).toBeNull();
  });
});

describe("pickSideLabel", () => {
  // The one formatter five call sites used to own a copy of. Each of them had
  // to remember to run the stored line through lineForSide first; this is the
  // regression that kept coming back.
  it("mirrors the number for an away spread backer", () => {
    expect(pickSideLabel("spread", "away", -6.5, "UGA", "BAMA")).toBe("BAMA +6.5");
    expect(pickSideLabel("spread", "home", -6.5, "UGA", "BAMA")).toBe("UGA -6.5");
  });

  it("says PK on a pick'em rather than +0", () => {
    expect(pickSideLabel("spread", "away", 0, "UGA", "BAMA")).toBe("BAMA PK");
  });

  it("words straight-up long by default and short when compact", () => {
    expect(pickSideLabel("straight_up", "home", null, "UGA", "BAMA")).toBe("UGA to win");
    expect(pickSideLabel("straight_up", "home", null, "UGA", "BAMA", { compact: true })).toBe(
      "UGA ML",
    );
  });

  it("leaves a total side-agnostic — both sides hold the same number", () => {
    expect(pickSideLabel("total", "over", 51.5, "UGA", "BAMA")).toBe("Over 51.5");
    expect(pickSideLabel("total", "under", 51.5, "UGA", "BAMA")).toBe("Under 51.5");
    expect(pickSideLabel("total", "over", 51.5, "UGA", "BAMA", { compact: true })).toBe("O 51.5");
  });

  it("renders a missing line as a dash rather than inventing one", () => {
    expect(pickSideLabel("spread", "home", null, "UGA", "BAMA")).toBe("UGA –");
  });
});
