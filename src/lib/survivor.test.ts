import { describe, expect, it } from "vitest";
import {
  blockReason,
  pickOutcome,
  poolWeeks,
  poolRulesLine,
  survivorStandings,
  type SurvivorGameView,
  type SurvivorPickRowView,
  type SurvivorPool,
} from "./survivor";

const NOW = new Date("2026-10-01T00:00:00Z");
const past = (days: number) => new Date(NOW.getTime() - days * 864e5).toISOString();
const future = (days: number) => new Date(NOW.getTime() + days * 864e5).toISOString();

const pool: SurvivorPool = {
  groupId: "g1",
  seasonId: 2026,
  conference: "SEC",
  strikes: 1,
  reuseTeams: false,
  startWeek: 1,
};

const game = (
  id: number,
  week: number,
  home: number,
  away: number,
  opts: Partial<SurvivorGameView> = {},
): SurvivorGameView => ({
  id,
  week,
  seasonType: "regular",
  status: "final",
  startTs: past(30 - week),
  homeTeamId: home,
  awayTeamId: away,
  homePoints: 0,
  awayPoints: 0,
  ...opts,
});

describe("pickOutcome", () => {
  const g = game(1, 1, 10, 20, { homePoints: 24, awayPoints: 17 });

  it("wins when the picked team outscored the other one", () => {
    expect(pickOutcome({ teamId: 10 }, g)).toBe("won");
    expect(pickOutcome({ teamId: 20 }, g)).toBe("lost");
  });

  it("counts a tie against you", () => {
    expect(pickOutcome({ teamId: 10 }, { ...g, homePoints: 17 })).toBe("tied");
  });

  it("is pending until the game is final", () => {
    expect(pickOutcome({ teamId: 10 }, { ...g, status: "in_progress" })).toBe("pending");
    expect(pickOutcome({ teamId: 10 }, undefined)).toBe("pending");
  });
});

describe("poolWeeks", () => {
  it("closes a week only when every game in it has kicked off", () => {
    const weeks = poolWeeks(
      pool,
      [
        game(1, 1, 10, 20, { startTs: past(3) }),
        game(2, 1, 30, 40, { startTs: past(2) }),
        game(3, 2, 10, 30, { startTs: past(1) }),
        // The Monday nighter keeps week 2 open.
        game(4, 2, 20, 40, { startTs: future(1), status: "scheduled" }),
      ],
      NOW,
    );
    expect(weeks).toEqual([
      { week: 1, seasonType: "regular", closed: true },
      { week: 2, seasonType: "regular", closed: false },
    ]);
  });

  it("ignores weeks before the pool started, and the preseason entirely", () => {
    const weeks = poolWeeks(
      { ...pool, startWeek: 3 },
      [
        game(1, 1, 10, 20),
        game(2, 3, 10, 20),
        game(3, 1, 10, 20, { seasonType: "preseason" }),
      ],
      NOW,
    );
    expect(weeks.map((w) => w.week)).toEqual([3]);
  });
});

describe("survivorStandings", () => {
  const members = [
    { userId: "u1", name: "Ann" },
    { userId: "u2", name: "Bob" },
    { userId: "u3", name: "Cal" },
  ];
  const games = [
    game(101, 1, 10, 20, { homePoints: 30, awayPoints: 3 }), // 10 wins
    game(102, 1, 30, 40, { homePoints: 7, awayPoints: 21 }), // 40 wins
    game(201, 2, 10, 40, { homePoints: 14, awayPoints: 17 }), // 40 wins
  ];
  const pick = (
    userId: string,
    week: number,
    gameId: number,
    teamId: number,
  ): SurvivorPickRowView => ({ userId, week, seasonType: "regular", gameId, teamId });

  it("eliminates on the first strike in a one-strike pool", () => {
    const picks = [
      pick("u1", 1, 101, 10), // won
      pick("u1", 2, 201, 40), // won
      pick("u2", 1, 102, 30), // lost
      // u3 never picked at all
    ];
    const s = survivorStandings(members, picks, games, pool, { week: 2, seasonType: "regular" }, NOW);
    const byName = Object.fromEntries(s.map((e) => [e.name, e]));

    expect(byName.Ann.eliminated).toBe(false);
    expect(byName.Ann.usedTeamIds).toEqual([10, 40]);
    expect(byName.Bob.eliminated).toBe(true);
    expect(byName.Bob.eliminatedIn).toEqual({ week: 1, seasonType: "regular" });
    // A week nobody picked is a strike once it has closed.
    expect(byName.Cal.eliminated).toBe(true);
    expect(byName.Cal.weeks[0].outcome).toBe("missed");
    // Alive first, then by strikes, then by name.
    expect(s[0].name).toBe("Ann");
  });

  it("stops counting strikes once an entrant is out", () => {
    const s = survivorStandings(
      [{ userId: "u2", name: "Bob" }],
      [pick("u2", 1, 102, 30)],
      games,
      pool,
      { week: 2, seasonType: "regular" },
      NOW,
    );
    // Week 2 is also unpicked, but Bob was already out in week 1.
    expect(s[0].strikes).toBe(1);
    expect(s[0].eliminatedIn).toEqual({ week: 1, seasonType: "regular" });
  });

  it("gives a two-strike pool its mulligan", () => {
    const s = survivorStandings(
      [{ userId: "u2", name: "Bob" }],
      [pick("u2", 1, 102, 30), pick("u2", 2, 201, 40)],
      games,
      { ...pool, strikes: 2 },
      { week: 2, seasonType: "regular" },
      NOW,
    );
    expect(s[0].strikes).toBe(1);
    expect(s[0].eliminated).toBe(false);
  });

  it("reports the pick for the week being viewed", () => {
    const s = survivorStandings(
      [{ userId: "u1", name: "Ann" }],
      [pick("u1", 1, 101, 10), pick("u1", 2, 201, 40)],
      games,
      pool,
      { week: 2, seasonType: "regular" },
      NOW,
    );
    expect(s[0].current?.teamId).toBe(40);
  });
});

describe("blockReason", () => {
  const g = game(1, 2, 10, 20, { startTs: future(2), status: "scheduled" });

  it("allows a team in scope that has not kicked off and is unused", () => {
    expect(blockReason(10, "SEC", g, [], pool, NOW)).toBeNull();
  });

  it("separates the three refusals", () => {
    expect(blockReason(10, "Big Ten", g, [], pool, NOW)).toBe("scope");
    expect(blockReason(10, "SEC", { ...g, startTs: past(1) }, [], pool, NOW)).toBe("kicked");
    expect(blockReason(10, "SEC", g, [10], pool, NOW)).toBe("used");
  });

  it("lets a pool that allows repeats repeat", () => {
    expect(blockReason(10, "SEC", g, [10], { ...pool, reuseTeams: true }, NOW)).toBeNull();
  });
});

describe("poolRulesLine", () => {
  it("names the scope and the house rules", () => {
    expect(poolRulesLine(pool, "cfb")).toBe("SEC · one strike and out · each team once");
    expect(poolRulesLine({ ...pool, conference: null, strikes: 2 }, "nfl")).toBe(
      "NFL · 2 strikes and out · each team once",
    );
  });
});
