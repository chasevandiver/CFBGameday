// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameCard } from "./GameCard";
import type { GameView, TeamView } from "../../lib/slate";

/**
 * CBB-9: a college basketball card has to read as basketball.
 *
 * The card was built for football and most of it is league-neutral — teams,
 * score, odds cells, your bets. What is not: the clock (quarters), the live
 * block (down, distance, a field), the tense treatment (the two-minute
 * warning) and the OT suffix (after four periods). Each of those gets a test
 * here, and the last section pins that a FOOTBALL card rendered by the same
 * component still says what it always said.
 */

vi.mock("../../app/actions/bets", () => ({ voidBet: async () => ({ ok: true }) }));
vi.mock("../../lib/bets-changed", () => ({ betsChanged: () => undefined }));

const team = (over: Partial<TeamView>): TeamView => ({
  id: 200299,
  school: "Long Beach State",
  abbr: "LBSU",
  mascot: "Beach",
  conference: "Big West",
  color: "#000000",
  altColor: null,
  logo: null,
  rank: null,
  pollRank: null,
  poll: null,
  record: "2-1",
  confRecord: null,
  ...over,
});

const home = team({});
const away = team({ id: 200279, school: "Pacific", abbr: "PAC", mascot: "Tigers", conference: "WCC" });

/** Pacific at Long Beach State, 2H 10:00, LBSU 60–53. LBSU −4.5, total 141.5. */
const game = (over: Partial<GameView> = {}): GameView =>
  ({
    id: 401917523,
    sport: "cbb",
    week: 10,
    home,
    away,
    startTs: "2026-11-12T03:00:00Z",
    status: "in_progress",
    homePoints: 60,
    awayPoints: 53,
    period: 2,
    clock: "10:00",
    situation: null,
    lastPlay: "Jack Payne makes 24-foot three point jumper",
    lastScore: null,
    possession: null,
    neutralSite: false,
    tv: "ESPN+",
    weather: null,
    dome: true,
    rivalry: null,
    lines: { spread: -4.5, spreadOpen: -4.5, total: 141.5, totalOpen: 141.5, mlHome: null, mlAway: null },
    prediction: null,
    myPicks: [],
    myBets: [],
    crewPicks: [],
    groupBets: [],
    systems: [],
    hoops: { h: [33, 27], a: [34, 19], run: null, wp: 0.755 },
    tempo: null,
    note: null,
    ...over,
  }) as GameView;

const show = (g: GameView) =>
  render(<GameCard game={g} tz="America/Chicago" starred={[]} onStar={() => undefined} demo />);

afterEach(cleanup);

describe("a live basketball card", () => {
  it("counts halves, not quarters", () => {
    const { container } = show(game());
    expect(container.textContent).toContain("2H · 10:00");
    expect(container.textContent).not.toContain("Q2");
  });

  it("says HALFTIME after the first period, where football would say END Q1", () => {
    const { container } = show(game({ period: 1, clock: "0:00" }));
    expect(container.textContent).toContain("HALFTIME");
    expect(container.textContent).not.toContain("END");
  });

  it("states who is covering and the pace, bet or no bet", () => {
    const { container } = show(game());
    // LBSU −4.5 and up 7: covering by 2.5
    expect(container.textContent).toMatch(/ATS\s*LBSU\s*-4\.5\s*by 2\.5/);
    // 113 points in 30 minutes is a 151 pace against 141.5
    expect(container.textContent).toMatch(/Pace\s*151\s*\/\s*141\.5/);
  });

  it("names the dog when the favourite is not covering", () => {
    const { container } = show(game({ homePoints: 56 }));
    expect(container.textContent).toMatch(/ATS\s*PAC\s*\+4\.5\s*by 1\.5/);
  });

  it("holds the pace cell open before there is a pace, so nothing shifts when it arrives", () => {
    const { container } = show(game({ period: 1, clock: "17:30", homePoints: 6, awayPoints: 2 }));
    expect(container.textContent).toMatch(/Pace\s*–\s*\/\s*141\.5/);
  });

  it("shows a run only once it is one", () => {
    const small = show(game({ hoops: { h: [33, 27], a: [34, 19], run: { side: "home", pts: 5 }, wp: null } }));
    expect(small.container.textContent).not.toContain("run");
    cleanup();
    const { container } = show(
      game({ hoops: { h: [33, 27], a: [34, 19], run: { side: "home", pts: 11 }, wp: null } }),
    );
    expect(container.textContent).toContain("LBSU 11-0 run");
  });

  it("shows the last play and no football furniture", () => {
    const { container } = show(game());
    expect(container.textContent).toContain("Jack Payne makes 24-foot three point jumper");
    expect(container.querySelector(".field-strip")).toBeNull();
    expect(container.textContent).not.toMatch(/\d(st|nd|rd|th) &/);
  });

  it("takes its live win probability from ESPN and says so", () => {
    const { container } = show(game());
    expect(container.textContent).toContain("ESPN win prob");
    cleanup();
    // no number from ESPN, no bar — never football's model on a basketball score
    const none = show(game({ hoops: { h: [33, 27], a: [34, 19], run: null, wp: null } }));
    expect(none.container.textContent).not.toContain("win prob");
  });

  it("marks the last four minutes of the second half as the tense stretch", () => {
    const { container } = show(game({ clock: "3:40" }));
    expect(container.querySelector(".u2m")).not.toBeNull();
    cleanup();
    expect(show(game({ clock: "10:00" })).container.querySelector(".u2m")).toBeNull();
  });
});

describe("a basketball final", () => {
  it("says OT after two periods", () => {
    const { container } = show(
      game({ status: "final", period: 3, clock: null, homePoints: 76, awayPoints: 80, lastPlay: null }),
    );
    expect(container.textContent).toContain("Final / OT");
  });

  it("does not say OT for a game that ended in regulation", () => {
    const { container } = show(game({ status: "final", period: 2, clock: null, lastPlay: null }));
    expect(container.textContent).toContain("Final");
    expect(container.textContent).not.toContain("/ ");
  });
});

describe("a pregame basketball card", () => {
  const pre = (over: Partial<GameView> = {}) =>
    game({
      status: "scheduled",
      homePoints: null,
      awayPoints: null,
      period: null,
      clock: null,
      lastPlay: null,
      hoops: null,
      tempo: 69.5,
      prediction: {
        spread: -6.1,
        total: 143.3,
        homeScore: 74.7,
        awayScore: 68.6,
        homeWinProb: 0.71,
        coverProb: null,
        vegasSpread: -4.5,
        edge: -1.6,
        edgeFlag: null,
        consensus: false,
        frozen: true,
      },
      ...over,
    });

  it("prints the model's score and pace", () => {
    const { container } = show(pre());
    expect(container.textContent).toMatch(/Proj:\s*PAC 69, LBSU 75/);
    expect(container.textContent).toMatch(/70\s*poss/);
    expect(container.textContent).toContain("Model: LBSU -6.1");
  });

  it("calls the feed's top tier what the feed calls it", () => {
    const base = pre().prediction!;
    const { container } = show(pre({ prediction: { ...base, edge: -5.2, edgeFlag: "BIG_EDGE" } }));
    expect(container.textContent).toContain("Best bet");
    expect(container.textContent).not.toContain("Big Edge");
  });

  it("carries the event banner", () => {
    show(pre({ note: "Maui Invitational" }));
    expect(screen.getByText("Maui Invitational")).toBeTruthy();
  });

  it("leaves the projection line out when the model has no score", () => {
    const base = pre().prediction!;
    const { container } = show(pre({ prediction: { ...base, homeScore: null, awayScore: null } }));
    expect(container.textContent).not.toContain("Proj:");
  });
});

describe("a football card through the same component", () => {
  const football = (over: Partial<GameView> = {}) =>
    game({
      sport: "cfb",
      period: 2,
      clock: "0:00",
      hoops: undefined,
      situation: null,
      ...over,
    });

  it("still calls Q2 0:00 halftime and Q1 0:00 the end of the quarter", () => {
    expect(show(football()).container.textContent).toContain("HALFTIME");
    cleanup();
    expect(show(football({ period: 1 })).container.textContent).toContain("END Q1");
  });

  it("is not given basketball's cover-and-pace row", () => {
    const { container } = show(football({ clock: "8:00" }));
    expect(container.textContent).not.toContain("Pace");
    expect(container.textContent).not.toMatch(/ATS\s*LBSU/);
    expect(container.textContent).toContain("Q2 · 8:00");
  });

  it("reads an absent sport as football, as every fixture before 0086 is", () => {
    const { container } = show(football({ sport: undefined, clock: "8:00" }));
    expect(container.textContent).toContain("Q2 · 8:00");
  });
});
