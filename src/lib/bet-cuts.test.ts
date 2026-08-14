import { describe, expect, it } from "vitest";
import {
  confidenceOf,
  dayOf,
  favouriteOrDog,
  leagueOf,
  marketOf,
  priceOf,
  sideOf,
  stakeOf,
  streaks,
  teamsOf,
  windowOf,
  type StatsBet,
} from "./bet-cuts";
import { tallyBy } from "./records";
import { nflSeasonId } from "./league";

const bet = (over: Partial<StatsBet> = {}): StatsBet => ({
  result: "win",
  units: 1,
  payoutUnits: 0.91,
  clv: null,
  betType: "spread",
  side: "home",
  line: -6.5,
  odds: -110,
  confidence: "bet",
  seasonId: 2026,
  startTs: "2026-09-05T19:30:00Z", // Sat 3:30pm ET → CFB "Afternoon"
  homeTeamId: 10,
  awayTeamId: 11,
  ...over,
});

describe("marketOf", () => {
  it("uses the shared label vocabulary, not a private copy", () => {
    expect(marketOf(bet({ betType: "team_total" }))).toBe("Team total");
    expect(marketOf(bet({ betType: "moneyline" }))).toBe("Moneyline");
  });
  it("passes an unknown type through rather than dropping the bet", () => {
    expect(marketOf(bet({ betType: "exotic" }))).toBe("exotic");
  });
  it("is null when the row has no type", () => {
    expect(marketOf(bet({ betType: null }))).toBeNull();
  });
});

describe("sideOf", () => {
  it("reads Home/Away for team-sided markets", () => {
    expect(sideOf(bet({ betType: "spread", side: "home" }))).toBe("Home");
    expect(sideOf(bet({ betType: "moneyline", side: "away" }))).toBe("Away");
  });
  it("reads Over/Under for total-sided markets", () => {
    expect(sideOf(bet({ betType: "total", side: "over" }))).toBe("Over");
    expect(sideOf(bet({ betType: "team_total", side: "under" }))).toBe("Under");
  });
  it("is null for a market with no side, and for a mismatched side", () => {
    expect(sideOf(bet({ betType: "future", side: "home" }))).toBeNull();
    expect(sideOf(bet({ betType: "total", side: "home" }))).toBeNull();
  });
});

describe("favouriteOrDog", () => {
  // The line is stored home-perspective. These are the two cases the
  // convention test pins: home -6.5 stored as -6.5, away +6.5 stored as -6.5.
  it("home laying points is a favourite", () => {
    expect(favouriteOrDog(bet({ side: "home", line: -6.5 }))).toBe("Favourite");
  });
  it("away taking the same game is an underdog, from the same stored line", () => {
    expect(favouriteOrDog(bet({ side: "away", line: -6.5 }))).toBe("Underdog");
  });
  it("home getting points is an underdog", () => {
    expect(favouriteOrDog(bet({ side: "home", line: 3 }))).toBe("Underdog");
  });
  it("a pick'em is neither", () => {
    expect(favouriteOrDog(bet({ side: "home", line: 0 }))).toBe("Pick'em");
  });
  it("moneylines read the price instead, because there is no spread to read", () => {
    expect(favouriteOrDog(bet({ betType: "moneyline", odds: -240, line: null }))).toBe("Favourite");
    expect(favouriteOrDog(bet({ betType: "moneyline", odds: 175, line: null }))).toBe("Underdog");
  });
  it("refuses to answer for a total — a total has no favourite", () => {
    expect(favouriteOrDog(bet({ betType: "total", side: "over", line: 51.5 }))).toBeNull();
  });
  it("is null rather than a guess when the line is missing", () => {
    expect(favouriteOrDog(bet({ betType: "spread", line: null }))).toBeNull();
  });
});

describe("priceOf", () => {
  it("puts standard juice in one bucket", () => {
    expect(priceOf(bet({ odds: -110 }))).toBe("−100 to −120");
    expect(priceOf(bet({ odds: -120 }))).toBe("−100 to −120");
  });
  it("splits the steeper prices", () => {
    expect(priceOf(bet({ odds: -121 }))).toBe("−121 to −160");
    expect(priceOf(bet({ odds: -161 }))).toBe("Worse than −160");
  });
  it("calls plus money what it is", () => {
    expect(priceOf(bet({ odds: 145 }))).toBe("Plus money");
  });
  it("is null with no price", () => {
    expect(priceOf(bet({ odds: null }))).toBeNull();
  });
});

describe("leagueOf", () => {
  it("reads the season id, which is where the sport lives", () => {
    expect(leagueOf(bet({ seasonId: 2026 }))).toBe("CFB");
    expect(leagueOf(bet({ seasonId: nflSeasonId(2026) }))).toBe("NFL");
  });
});

describe("teamsOf", () => {
  it("backs one side and fades the other", () => {
    expect(teamsOf(bet({ side: "home" }))).toEqual({ backed: 10, faded: 11 });
    expect(teamsOf(bet({ side: "away" }))).toEqual({ backed: 11, faded: 10 });
  });
  it("gives no team for a total — nobody bets the over on a team", () => {
    expect(teamsOf(bet({ betType: "total", side: "over" }))).toEqual({
      backed: null,
      faded: null,
    });
  });
  it("gives no team when the bet has no game", () => {
    expect(teamsOf(bet({ homeTeamId: null, awayTeamId: null }))).toEqual({
      backed: null,
      faded: null,
    });
  });
});

describe("windowOf and dayOf", () => {
  it("uses each league's own broadcast vocabulary", () => {
    // 19:30Z on a Saturday = 3:30pm ET
    expect(windowOf(bet({ startTs: "2026-09-05T19:30:00Z" }))).toBe("Afternoon");
    // 17:00Z Sunday = 1:00pm ET, the NFL early window
    expect(
      windowOf(bet({ seasonId: nflSeasonId(2026), startTs: "2026-09-13T17:00:00Z" })),
    ).toBe("Early window");
  });

  it("is Eastern, not viewer-local — the noon slate is the noon slate everywhere", () => {
    // 00:20Z Friday is Thursday 8:20pm ET: Primetime, and a Thursday.
    const b = bet({ seasonId: nflSeasonId(2026), startTs: "2026-09-11T00:20:00Z" });
    expect(windowOf(b)).toBe("Primetime");
    expect(dayOf(b)).toBe("Thu");
  });

  it("is null for a bet with no kickoff, e.g. a future", () => {
    expect(windowOf(bet({ startTs: null }))).toBeNull();
    expect(dayOf(bet({ startTs: null }))).toBeNull();
  });
});

describe("stakeOf", () => {
  it("keeps the flat unit its own bucket", () => {
    expect(stakeOf(bet({ units: 1 }))).toBe("1u");
    expect(stakeOf(bet({ units: 0.5 }))).toBe("Under 1u");
    expect(stakeOf(bet({ units: 2 }))).toBe("1–2u");
    expect(stakeOf(bet({ units: 5 }))).toBe("Over 3u");
  });
  it("coerces the numeric-as-string case records.ts also defends against", () => {
    expect(stakeOf(bet({ units: "2.5" as unknown as number }))).toBe("2–3u");
  });
  it("is null for a nonsense stake rather than inventing a bucket", () => {
    expect(stakeOf(bet({ units: 0 }))).toBeNull();
  });
});

describe("confidenceOf", () => {
  it("passes the stored tier through", () => {
    expect(confidenceOf(bet({ confidence: "slate" }))).toBe("slate");
    expect(confidenceOf(bet({ confidence: null }))).toBeNull();
  });
});

describe("streaks", () => {
  const w = (result: "win" | "loss" | "push" | "void" | null) => ({ result, units: 1 });

  it("is empty when nothing has graded", () => {
    expect(streaks([w(null), w(null)])).toEqual({
      currentKind: null,
      currentLength: 0,
      longestWin: 0,
      longestLoss: 0,
    });
  });

  it("counts the active run and the longest of each kind", () => {
    // W W W L L W W  → current 2 wins, longest win 3, longest loss 2
    const s = streaks([w("win"), w("win"), w("win"), w("loss"), w("loss"), w("win"), w("win")]);
    expect(s).toEqual({ currentKind: "win", currentLength: 2, longestWin: 3, longestLoss: 2 });
  });

  it("does NOT let a push break a streak — League Rule #4, no action", () => {
    // Three wins around a push is a four-win streak, which is how anyone
    // describing their own week would say it.
    const s = streaks([w("win"), w("win"), w("push"), w("win"), w("win")]);
    expect(s.currentKind).toBe("win");
    expect(s.currentLength).toBe(4);
    expect(s.longestWin).toBe(4);
  });

  it("ignores voids the same way — a void never happened", () => {
    expect(streaks([w("loss"), w("void"), w("loss")]).currentLength).toBe(2);
  });
});

describe("the cuts compose with records.tallyBy", () => {
  it("groups and tallies without a second implementation of the arithmetic", () => {
    const bets = [
      bet({ result: "win", side: "home", payoutUnits: 0.91 }),
      bet({ result: "loss", side: "home", payoutUnits: -1 }),
      bet({ result: "win", side: "away", line: -6.5, payoutUnits: 0.91 }),
    ];
    const byDog = tallyBy(bets, favouriteOrDog);
    expect(byDog.get("Favourite")).toMatchObject({ wins: 1, losses: 1, decided: 2 });
    expect(byDog.get("Underdog")).toMatchObject({ wins: 1, losses: 0, decided: 1 });
  });

  it("collects the not-applicable rows under null, so a page can drop them", () => {
    const byDog = tallyBy([bet({ betType: "total", side: "over" })], favouriteOrDog);
    expect(byDog.has(null)).toBe(true);
  });
});
