import { describe, expect, it } from "vitest";
import { DWELL_MS, jumbotronRank, nextFeatured, nextKickoffBoard, urgentNow } from "./jumbotron";
import type { GameView, TeamView } from "./slate";

const team = (id: number): TeamView => ({
  id,
  school: `Team ${id}`,
  abbr: `T${id}`,
  mascot: null,
  conference: "SEC",
  color: null,
  altColor: null,
  logo: null,
  rank: null,
  pollRank: null,
  poll: null,
  record: null,
  confRecord: null,
});

const game = (overrides: Partial<GameView> = {}): GameView => ({
  id: 1,
  week: 1,
  startTs: "2026-09-05T16:00:00Z",
  status: "in_progress",
  period: 2,
  clock: "8:00",
  tv: null,
  neutralSite: false,
  homePoints: 14,
  awayPoints: 10,
  home: team(1),
  away: team(2),
  lines: { spread: -3, spreadOpen: -3, total: 48.5, totalOpen: 48.5, mlHome: -150, mlAway: 130 },
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

// A red-zone situation string `isRedZone` parses, possession pinned.
const redZone = (overrides: Partial<GameView> = {}) =>
  game({ situation: "1st & Goal at T1 5", possession: "away", ...overrides });

describe("jumbotronRank", () => {
  it("only live games rank at all", () => {
    expect(jumbotronRank(game({ status: "scheduled" }))).toBe(-Infinity);
    expect(jumbotronRank(game({ status: "final" }))).toBe(-Infinity);
  });

  it("a tight red-zone game outranks a blowout", () => {
    const tightRz = redZone({ id: 1, homePoints: 21, awayPoints: 17, period: 4, clock: "7:00" });
    const blowout = game({ id: 2, homePoints: 45, awayPoints: 3, period: 4, clock: "7:00" });
    expect(jumbotronRank(tightRz)).toBeGreaterThan(jumbotronRank(blowout));
  });

  it("a one-score game inside two minutes outranks the same game with time left", () => {
    const closing = game({ id: 1, period: 4, clock: "1:30", homePoints: 24, awayPoints: 21 });
    const earlier = game({ id: 1, period: 4, clock: "9:30", homePoints: 24, awayPoints: 21 });
    expect(jumbotronRank(closing)).toBeGreaterThan(jumbotronRank(earlier));
  });
});

describe("urgentNow", () => {
  it("closing (one-score, under two) and red zone qualify; ordinary drives don't", () => {
    expect(urgentNow(game({ period: 4, clock: "1:00", homePoints: 20, awayPoints: 17 }))).toBe(
      "closing",
    );
    expect(urgentNow(redZone())).toBe("redzone");
    expect(urgentNow(game())).toBeNull();
  });
  it("a 20-point game under two minutes is not urgent", () => {
    expect(urgentNow(game({ period: 4, clock: "1:00", homePoints: 40, awayPoints: 17 }))).toBeNull();
  });
});

describe("nextFeatured", () => {
  it("no live games, no feature", () => {
    expect(nextFeatured(null, [game({ status: "final" })], 0)).toEqual({ id: null, reason: null });
  });

  it("first call features the top-ranked game", () => {
    const a = game({ id: 1, homePoints: 30, awayPoints: 3 }); // blowout
    const b = game({ id: 2, homePoints: 21, awayPoints: 20 }); // tight
    expect(nextFeatured(null, [a, b], 0).id).toBe(2);
  });

  it("the incumbent holds through the dwell, then the board advances", () => {
    const a = game({ id: 1, homePoints: 21, awayPoints: 20 });
    const b = game({ id: 2, homePoints: 14, awayPoints: 13 });
    expect(nextFeatured(1, [a, b], DWELL_MS - 1)).toEqual({ id: 1, reason: null });
    const after = nextFeatured(1, [a, b], DWELL_MS + 1);
    expect(after).toEqual({ id: 2, reason: "rotation" });
  });

  it("an urgent game jumps the queue mid-dwell", () => {
    const boring = game({ id: 1, homePoints: 30, awayPoints: 3 });
    const rz = redZone({ id: 2, homePoints: 14, awayPoints: 13 });
    expect(nextFeatured(1, [boring, rz], 1_000)).toEqual({ id: 2, reason: "redzone" });
  });

  it("the urgent incumbent is not re-featured — no flapping", () => {
    const rz = redZone({ id: 2, homePoints: 14, awayPoints: 13 });
    expect(nextFeatured(2, [rz], 1_000)).toEqual({ id: 2, reason: null });
  });

  it("a single live game holds forever", () => {
    const only = game({ id: 7 });
    expect(nextFeatured(7, [only], DWELL_MS * 3)).toEqual({ id: 7, reason: null });
  });

  it("rotation cycles through every live game and wraps", () => {
    const games = [1, 2, 3].map((id) => game({ id, homePoints: 10 + id, awayPoints: 10 }));
    const seen = new Set<number>();
    let cur: number | null = null;
    for (let i = 0; i < 3; i++) {
      cur = nextFeatured(cur, games, DWELL_MS + 1).id;
      seen.add(cur as number);
    }
    expect(seen.size).toBe(3);
  });
});

describe("nextKickoffBoard", () => {
  const now = "2026-09-05T15:00:00Z";
  it("soonest future kickoffs, capped, live and past games excluded", () => {
    const games = [
      game({ id: 1, status: "scheduled", startTs: "2026-09-05T20:00:00Z" }),
      game({ id: 2, status: "scheduled", startTs: "2026-09-05T16:00:00Z" }),
      game({ id: 3, status: "scheduled", startTs: "2026-09-05T14:00:00Z" }), // already past
      game({ id: 4, status: "in_progress" }),
      game({ id: 5, status: "scheduled", startTs: null }),
    ];
    const board = nextKickoffBoard(games, now, 2);
    expect(board.map((g) => g.id)).toEqual([2, 1]);
  });
});
