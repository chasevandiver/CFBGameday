import { describe, expect, it } from "vitest";
import {
  atsRecord,
  atsResult,
  fieldPosition,
  fmtMoneyline,
  fmtSpread,
  gradeModel,
  isRedZone,
  modelPicks,
  ouResult,
  ouRecord,
  parseSituation,
  pickHero,
  probSurge,
  spreadMove,
  spreadMoveRead,
  modelSideOf,
  upsetAlert,
  headlinePick,
  lineForSide,
  pickSideLabel,
  betSideLabel,
  pickableSlots,
  teamHeadline,
  watchability,
  weekModelRecord,
  type GameView,
  type TeamView,
  playAge,
  PLAY_AGE_FLOOR_S,
} from "./slate";

describe("probSurge", () => {
  it("announces nothing under the threshold — the ordinary clock drip", () => {
    expect(probSurge(0.5, 0.579)).toBeNull();
    expect(probSurge(0.5, 0.421)).toBeNull();
  });
  it("fires exactly at the threshold, toward whoever gained", () => {
    // 0/0.08 keeps the delta float-exact; 0.5±0.08 lands at 0.0799…
    expect(probSurge(0, 0.08)).toBe("home");
    expect(probSurge(0.08, 0)).toBe("away");
    expect(probSurge(0.5, 0.6)).toBe("home");
    expect(probSurge(0.5, 0.4)).toBe("away");
  });
  it("is symmetric and honors a custom threshold", () => {
    expect(probSurge(0.3, 0.5, 0.2)).toBe("home");
    expect(probSurge(0.5, 0.3, 0.2)).toBe("away");
    expect(probSurge(0.5, 0.6, 0.2)).toBeNull();
  });
});

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
  confRecord: null,
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
  lastScore: null,
  crewPicks: [],
  groupBets: [],
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

  // ESPN's downDistanceText drops the abbreviation at midfield, and only there
  // — "2nd & 10 at 50". Observed live 2026-08-14 on IND@NE.
  it("parses a token-less midfield spot", () => {
    expect(parseSituation("2nd & 10 at 50")).toEqual({
      down: 2,
      distance: 10,
      sideToken: null,
      yardLine: 50,
    });
  });

  it("parses ESPN's long form the same way as CFBD's", () => {
    expect(parseSituation("3rd & Goal at ARI 6")).toEqual({
      down: 3,
      distance: "Goal",
      sideToken: "ARI",
      yardLine: 6,
    });
  });

  it("returns null for non-play strings", () => {
    expect(parseSituation("Halftime")).toBeNull();
    expect(parseSituation("End of 3rd Quarter")).toBeNull();
    expect(parseSituation(null)).toBeNull();
    expect(parseSituation("")).toBeNull();
  });

  // The short form carries no spot, so there is nothing to place on the field.
  it("returns null for a down-and-distance with no spot", () => {
    expect(parseSituation("2nd & 10")).toBeNull();
  });
});

describe("fieldPosition", () => {
  const live = (overrides: Partial<GameView>) =>
    game({
      status: "in_progress",
      home: { ...team(1), abbr: "HOME" },
      away: { ...team(2), abbr: "AWAY" },
      ...overrides,
    });

  // x runs 0 = away goal line → 100 = home goal line, and the offense drives
  // toward the defender's end.
  it("places the ball on the home team's side of the field", () => {
    expect(fieldPosition(live({ possession: "away", situation: "1st & 10 at HOME 25" }))).toEqual({
      x: 75,
      dir: "right",
    });
  });

  it("places the ball on the away team's side of the field", () => {
    expect(fieldPosition(live({ possession: "home", situation: "2nd & 7 at AWAY 31" }))).toEqual({
      x: 31,
      dir: "left",
    });
  });

  it("puts a token-less midfield spot on the 50", () => {
    expect(fieldPosition(live({ possession: "away", situation: "2nd & 10 at 50" }))).toEqual({
      x: 50,
      dir: "right",
    });
  });

  it("fails closed on ambiguity, missing possession, or non-live games", () => {
    // a token-less spot anywhere but the 50 could belong to either side
    expect(fieldPosition(live({ possession: "away", situation: "2nd & 10 at 30" }))).toBeNull();
    expect(fieldPosition(live({ possession: "away", situation: "2nd & 10 at XYZ 30" }))).toBeNull();
    expect(fieldPosition(live({ possession: null, situation: "2nd & 10 at HOME 30" }))).toBeNull();
    expect(
      fieldPosition(live({ status: "final", possession: "away", situation: "2nd & 10 at HOME 30" })),
    ).toBeNull();
    // the short form ESPN used to be stored with: no spot, no strip
    expect(fieldPosition(live({ possession: "away", situation: "2nd & 10" }))).toBeNull();
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
    // midfield has no side token — and is never the red zone anyway
    expect(isRedZone(live({ possession: "away", situation: "2nd & 6 at 50" }))).toBe(false);
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
    // number to be near, so it is the headline when present.
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
    expect(pickSideLabel("spread", "home", 0, "UGA", "BAMA")).toBe("UGA PK");
  });

  it("says PK on a stringly-typed zero too, on both sides (UX-24)", () => {
    // fmtSpread tests `spread === 0`, so a line arriving as "0" printed a bare
    // "0" on the home side. The away side hid the bug: lineForSide negates it
    // and -"0" is numeric -0, which does equal 0. Three call sites pass a
    // PickRow field straight through, so the coercion lives in pickSideLabel.
    const zero = "0" as unknown as number;
    expect(pickSideLabel("spread", "home", zero, "UGA", "BAMA")).toBe("UGA PK");
    expect(pickSideLabel("spread", "away", zero, "UGA", "BAMA")).toBe("BAMA PK");
    expect(pickSideLabel("spread", "home", "-6.5" as unknown as number, "UGA", "BAMA")).toBe(
      "UGA -6.5",
    );
    expect(pickSideLabel("total", "over", "51.5" as unknown as number, "UGA", "BAMA")).toBe(
      "Over 51.5",
    );
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

describe("betSideLabel", () => {
  // bets.line_taken is stored home-perspective, same as picks.line_at_pick.
  // Every away ticket therefore reads with the opposite sign to the stored
  // number, which is the bug this function exists to stop being rewritten.
  it("flips the sign for an away spread ticket", () => {
    expect(betSideLabel("spread", "home", -6.5, "UGA", "BAMA")).toBe("UGA -6.5");
    expect(betSideLabel("spread", "away", -6.5, "UGA", "BAMA")).toBe("BAMA +6.5");
  });

  it("leaves a total alone — both sides hold the same number", () => {
    expect(betSideLabel("total", "over", 51.5, "UGA", "BAMA")).toBe("O 51.5");
    expect(betSideLabel("total", "under", 51.5, "UGA", "BAMA")).toBe("U 51.5");
  });

  it("names the team for a moneyline and takes no number", () => {
    expect(betSideLabel("moneyline", "away", null, "UGA", "BAMA")).toBe("BAMA ML");
  });

  it("says the type rather than inventing a format it cannot price", () => {
    expect(betSideLabel("first_half", "home", null, "UGA", "BAMA")).toBe("UGA first_half");
  });
});

describe("pickableSlots", () => {
  const priced = (over: Partial<GameView["lines"]> = {}) =>
    game({ lines: { spread: -3, spreadOpen: -3, total: 51.5, totalOpen: 51.5, mlHome: -150, mlAway: 130, ...over } });

  it("counts picks, not games — four games on spreads and totals is eight", () => {
    // The bug this replaces read "8 of 4" once somebody made them all.
    const games = [priced(), priced(), priced(), priced()];
    expect(pickableSlots(games, ["spread", "total"])).toBe(8);
    expect(pickableSlots(games, ["spread"])).toBe(4);
    expect(pickableSlots(games, ["spread", "total", "straight_up"])).toBe(12);
  });

  it("does not count a priced market with no posted line", () => {
    // Those buttons render disabled, so promising them overstates the board.
    const games = [priced(), priced({ total: null })];
    expect(pickableSlots(games, ["spread", "total"])).toBe(3);
  });

  it("always counts straight-up, which needs no number", () => {
    const games = [priced({ spread: null, total: null })];
    expect(pickableSlots(games, ["spread", "total", "straight_up"])).toBe(1);
  });

  it("is zero for an empty board", () => {
    expect(pickableSlots([], ["spread", "total"])).toBe(0);
  });
});

/* NFL-20: the game header truncated NFL team names, because `school` means
   something different in each feed — "Georgia" from CFBD, "Jacksonville
   Jaguars" from ESPN. */
describe("teamHeadline", () => {
  const t = (over: Partial<TeamView>): TeamView => ({ ...team(1), ...over });

  it("shortens an NFL team to its nickname", () => {
    expect(teamHeadline(t({ school: "Jacksonville Jaguars", mascot: "Jaguars" }), "nfl")).toBe(
      "Jaguars",
    );
    expect(teamHeadline(t({ school: "Kansas City Chiefs", mascot: "Chiefs" }), "nfl")).toBe(
      "Chiefs",
    );
  });

  /* CFB deliberately keeps the school. The mascot there is a DIFFERENT word,
     not a shorter form of the same one — "Bulldogs" is not what anyone is
     scanning a slate for. */
  it("leaves a CFB team on its school name, mascot or no mascot", () => {
    expect(teamHeadline(t({ school: "Georgia", mascot: "Bulldogs" }), "cfb")).toBe("Georgia");
    expect(teamHeadline(t({ school: "Middle Tennessee", mascot: null }), "cfb")).toBe(
      "Middle Tennessee",
    );
  });

  /* Every NFL row has a mascot today (nfl-sync-reference writes ESPN's `name`),
     but a null must degrade to the full name rather than to blank. */
  it("falls back to the full name when an NFL row has no nickname", () => {
    expect(teamHeadline(t({ school: "Las Vegas Raiders", mascot: null }), "nfl")).toBe(
      "Las Vegas Raiders",
    );
  });
});


describe("playAge — how old the play on the card is (LIVE-4)", () => {
  const t = Date.parse("2026-08-21T01:00:00Z");
  const at = (secondsAgo: number) => new Date(t - secondsAgo * 1000).toISOString();

  it("says nothing about a play that just happened", () => {
    // A play from nine seconds ago IS the current play. Stamping every card
    // with an age would be noise on every card on the slate.
    expect(playAge(at(9), t)).toBeNull();
    expect(playAge(at(PLAY_AGE_FLOOR_S - 1), t)).toBeNull();
  });

  it("speaks up exactly at the floor", () => {
    expect(playAge(at(PLAY_AGE_FLOOR_S), t)).toBe("1m");
  });

  it("counts whole minutes, because seconds would be false precision", () => {
    expect(playAge(at(150), t)).toBe("2m");
    expect(playAge(at(179), t)).toBe("2m");
    expect(playAge(at(180), t)).toBe("3m");
    expect(playAge(at(20 * 60), t)).toBe("20m");
  });

  it("stops counting past an hour, where the number stops being the point", () => {
    expect(playAge(at(59 * 60), t)).toBe("59m");
    expect(playAge(at(60 * 60), t)).toBe("60m+");
    expect(playAge(at(6 * 3600), t)).toBe("60m+");
  });

  it("invents no age for a play it never watched arrive", () => {
    // Null is the honest answer for every row written before 0078, and for a
    // play kept through a timeout that has no stamp of its own.
    expect(playAge(null, t)).toBeNull();
    expect(playAge(undefined, t)).toBeNull();
    expect(playAge("not a timestamp", t)).toBeNull();
  });

  it("shows nothing rather than a negative age when the clocks disagree", () => {
    // The stamp is written by a server; the reader's clock can be behind it.
    expect(playAge(at(-30), t)).toBeNull();
  });
});
