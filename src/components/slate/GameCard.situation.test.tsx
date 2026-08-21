// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameCard } from "./GameCard";
import type { GameView } from "../../lib/slate";

vi.mock("../../app/actions/bets", () => ({
  voidBet: vi.fn(async () => ({ ok: true })),
}));

afterEach(cleanup);

/**
 * The live situation block: down and distance, the field strip, and the last
 * play. What matters here is the dead-ball state, because that is the one the
 * card used to drop on the floor — ESPN publishes a down and distance only
 * while a snap is pending, so the whole stretch after a touchdown (the PAT,
 * the kickoff), the end of a quarter, and timeouts between possessions all
 * arrive as `situation: null, possession: null` with a real `lastPlay`.
 */

const team = (id: number, school: string, abbr: string) => ({
  id,
  school,
  abbr,
  mascot: null,
  conference: "AFC North",
  color: "#fb4f14",
  altColor: null,
  logo: null,
  rank: null,
  pollRank: null,
  poll: null,
  record: null,
  confRecord: null,
});

const live = (over: Partial<GameView> = {}): GameView =>
  ({
    id: 401873272,
    week: 2,
    seasonType: "preseason",
    startTs: new Date("2026-08-13T23:00:00Z").toISOString(),
    status: "in_progress",
    period: 3,
    clock: "8:42",
    tv: "NFL Net",
    venue: null,
    neutralSite: false,
    dome: false,
    home: team(4, "Cincinnati Bengals", "CIN"),
    away: team(8, "Detroit Lions", "DET"),
    homePoints: 13,
    awayPoints: 6,
    lines: { spread: -7, spreadOpen: -3.5, total: 38.5, totalOpen: 38.5, mlHome: -278, mlAway: 225 },
    prediction: null,
    myPicks: [],
    myBets: [],
    crewPicks: [],
    groupBets: [],
    situation: null,
    lastPlay: null,
    possession: null,
    weather: null,
    rivalry: null,
    systems: [],
    ...over,
  }) as unknown as GameView;

const renderCard = (game: GameView) =>
  render(<GameCard game={game} tz="America/Chicago" starred={[]} onStar={() => {}} />);

describe("the live situation block", () => {
  it("shows the down, the spot and the last play mid-drive", () => {
    renderCard(
      live({
        situation: "3rd & 15 at DET 24",
        possession: "away",
        lastPlay: "L.Altmyer pass incomplete deep left to T.Black.",
      }),
    );
    expect(screen.getByText(/3rd/)).toBeTruthy();
    expect(screen.getByText(/at DET/)).toBeTruthy();
    expect(screen.getByText(/pass incomplete deep left/)).toBeTruthy();
  });

  /* The reported bug. A touchdown puts the game in a dead-ball state with no
     down and distance and no possession, and the guard required one of those
     to render anything — so the play that just scored, the one play on the
     card anybody wants to read, was the one guaranteed not to appear. */
  it("still shows the last play when the touchdown has cleared the down and distance", () => {
    renderCard(
      live({
        situation: null,
        possession: null,
        lastPlay: "J.Burrow pass short right to J.Chase for 12 yards, TOUCHDOWN.",
      }),
    );
    expect(screen.getByText(/TOUCHDOWN/)).toBeTruthy();
  });

  it("renders nothing at all when there is no situation and no play", () => {
    const { container } = renderCard(live());
    expect(container.querySelector(".last-play")).toBeNull();
    expect(container.querySelector(".field-strip")).toBeNull();
  });

  it("draws the field strip only when the spot resolves to a team", () => {
    const { container } = renderCard(
      live({ situation: "1st & 10 at CIN 46", possession: "home", lastPlay: "Kickoff touchback" }),
    );
    expect(container.querySelector(".field-strip")).toBeTruthy();

    cleanup();
    // short form, no spot — the down still reads, the strip cannot be drawn
    const { container: noSpot } = renderCard(
      live({ situation: "1st & 10", possession: "home", lastPlay: "Kickoff touchback" }),
    );
    expect(noSpot.querySelector(".field-strip")).toBeNull();
    expect(screen.getByText(/1st & 10/)).toBeTruthy();
  });
});

/**
 * NFL-18: the scoring play persists.
 *
 * `lastPlay` is whatever ESPN published a moment ago. After a touchdown that is
 * the extra point within ~30s and the kickoff a few after, so a reader glancing
 * down a minute later got a kickoff where the touchdown had been. Once a game
 * has a score, this line shows the score and keeps showing it.
 */
describe("the last score outlives the plays after it", () => {
  it("shows the score, not the kickoff that replaced it", () => {
    renderCard(
      live({
        lastPlay: "Bell kickoff 65 yards from CIN 35",
        lastScore: {
          text: "Rivera 8 yd pass from Nakamura (Bell KICK)",
          abbr: "CIN",
          period: 3,
          clock: "11:20",
        },
      }),
    );
    expect(screen.getByText(/8 yd pass from Nakamura/)).toBeTruthy();
    expect(screen.queryByText(/kickoff 65 yards/)).toBeNull();
  });

  it("labels the line with the team that scored", () => {
    renderCard(
      live({
        lastPlay: null,
        lastScore: { text: "Ward 34 yd field goal", abbr: "PIT", period: 2, clock: "0:04" },
      }),
    );
    expect(screen.getByText("PIT")).toBeTruthy();
  });

  it("falls back to the live play before anybody has scored", () => {
    // A scoreless first quarter still has plays worth reading, and a card with
    // an empty line where the play used to be is a regression, not a feature.
    renderCard(live({ lastPlay: "Henderson rush for 12 yds", lastScore: null }));
    expect(screen.getByText(/Henderson rush/)).toBeTruthy();
    expect(screen.getByText("Last")).toBeTruthy();
  });

  it("keeps the live down and distance alongside the remembered score", () => {
    // The point of putting the score on this line is that the situation row
    // above is still current — if that stopped rendering, the card would be
    // showing only stale information.
    renderCard(
      live({
        situation: "3rd & 7 at PIT 42",
        lastScore: { text: "Rivera 8 yd pass", abbr: "CIN", period: 3, clock: "11:20" },
      }),
    );
    expect(screen.getByText(/3rd/)).toBeTruthy();
    expect(screen.getByText(/Rivera 8 yd pass/)).toBeTruthy();
  });
});


describe("the break between periods (2026-08-21)", () => {
  /**
   * Owner question the night of the preseason rehearsal: "is there anything
   * stating halftime when a game goes to half?" There was not. ESPN sends
   * STATUS_HALFTIME, the parser keeps only `type.state`, and the card rendered
   * the ordinary live treatment — `Q2 · 0:00`, in the two-minute-warning
   * styling, with a last-play age climbing past ten minutes. Three separate
   * signals all saying "something urgent is happening" through the quietest
   * stretch of the game.
   */
  it("says HALFTIME instead of Q2 · 0:00", () => {
    renderCard(live({ period: 2, clock: "0:00", lastPlay: "Kickoff returned to the 22." }));
    expect(screen.getByText("HALFTIME")).toBeTruthy();
    expect(screen.queryByText(/Q2 · 0:00/)).toBeNull();
  });

  it("names the gap between quarters too", () => {
    renderCard(live({ period: 1, clock: "0:00" }));
    expect(screen.getByText("END Q1")).toBeTruthy();
  });

  it("drops the two-minute-warning treatment at halftime", () => {
    const { container } = renderCard(live({ period: 2, clock: "0:00" }));
    expect(container.querySelector(".u2m")).toBeNull();
  });

  it("keeps the warning treatment with a second still on the clock", () => {
    const { container } = renderCard(live({ period: 2, clock: "0:01" }));
    expect(container.querySelector(".u2m")).toBeTruthy();
  });

  it("still shows the period and clock while the game is being played", () => {
    renderCard(live({ period: 3, clock: "8:42" }));
    expect(screen.getByText(/Q3/)).toBeTruthy();
    expect(screen.queryByText(/HALFTIME|END Q/)).toBeNull();
  });

  it("hides the last-play age during the break, where old is normal", () => {
    // LIVE-4's badge means "this card may be stale". At halftime the play IS
    // twelve minutes old and nothing is wrong, so the number would be an
    // alarm about the game working correctly.
    renderCard(
      live({
        period: 2,
        clock: "0:00",
        lastPlay: "Kickoff returned to the 22.",
        lastPlayAt: new Date(Date.now() - 12 * 60_000).toISOString(),
      }),
    );
    expect(screen.getByText("HALFTIME")).toBeTruthy();
    expect(screen.queryByText(/^\d+m$/)).toBeNull();
  });
});


describe("the bottom line hands back from score to play (LIVE-7)", () => {
  /**
   * Owner report, 2026-08-21: "scoring plays are still getting stuck on the
   * slate cards and not the most recent plays." NFL-18 made the score win
   * permanently — right about the touchdown (ESPN swaps in the PAT within
   * thirty seconds), wrong for the rest of the game, where a whole drive could
   * pass with the card still showing a field goal from ten minutes earlier.
   *
   * These render the real component, because the pure rule passing is not the
   * same as the card asking it.
   */
  const scored = (secondsAgo: number, over: Partial<GameView> = {}) =>
    live({
      lastScore: {
        text: "Woody Marks 20 Yd Rush",
        abbr: "HOU",
        period: 1,
        clock: "10:06",
        at: new Date(Date.now() - secondsAgo * 1000).toISOString(),
      },
      ...over,
    } as Partial<GameView>);

  it("still shows a fresh touchdown over the extra point that follows it", async () => {
    renderCard(
      scored(30, {
        lastPlay: "K.Fairbairn extra point is GOOD.",
        lastPlayAt: new Date().toISOString(),
      }),
    );
    expect(await screen.findByText(/Woody Marks 20 Yd Rush/)).toBeTruthy();
    expect(screen.queryByText(/extra point/)).toBeNull();
  });

  it("shows the current play once the score has had its two minutes", async () => {
    renderCard(
      scored(600, {
        lastPlay: "C.Stroud pass short right to W.Marks for 6 yards",
        lastPlayAt: new Date().toISOString(),
      }),
    );
    // findBy* because the swap happens on the tick after mount, deliberately:
    // the server and the browser cannot agree on `now`.
    expect(await screen.findByText(/C.Stroud pass short right/)).toBeTruthy();
    expect(screen.queryByText(/Woody Marks/)).toBeNull();
  });

  it("labels the line for whichever it is showing", async () => {
    const { unmount } = renderCard(
      scored(600, { lastPlay: "Rush for 3 yards", lastPlayAt: new Date().toISOString() }),
    );
    expect(await screen.findByText("Last")).toBeTruthy();
    unmount();
    renderCard(scored(10, { lastPlay: "Rush for 3 yards", lastPlayAt: new Date().toISOString() }));
    expect(await screen.findByText("HOU")).toBeTruthy();
  });
});


describe("the header row keeps the clock whole (2026-08-21)", () => {
  /**
   * Owner screenshot from the 375px pass: "the game of the week tag smushes
   * the time left in the game." The row is a flex fight between the clock and
   * the network list, and the clock was losing — "Q1 · 1:13" broke onto two
   * lines because the TV string was `shrink-0` and a four-network game
   * ("ESPN/KTRK (ABC)/Fox 5 Vegas") took the width it wanted.
   *
   * The tag is gone by owner call, and the clock no longer yields to anything.
   */
  it("no longer renders the Game of the Week chip", () => {
    render(
      <GameCard
        game={live({ period: 1, clock: "1:13" })}
        tz="America/Chicago"
        starred={[]}
        onStar={() => {}}
        featured
      />,
    );
    expect(screen.queryByText(/game of the week/i)).toBeNull();
  });

  it("keeps the featured ring, which is what marks the game now", () => {
    const { container } = render(
      <GameCard
        game={live()}
        tz="America/Chicago"
        starred={[]}
        onStar={() => {}}
        featured
      />,
    );
    expect(container.querySelector(".ring-accent\\/40")).toBeTruthy();
  });

  it("never lets the live clock wrap or shrink", () => {
    renderCard(live({ period: 1, clock: "1:13", tv: "ESPN/KTRK (ABC)/Fox 5 Vegas" }));
    const clock = screen.getByText(/Q1/);
    expect(clock.className).toContain("whitespace-nowrap");
    expect(clock.className).toContain("shrink-0");
  });

  it("makes the network list the thing that gives instead", () => {
    renderCard(live({ tv: "ESPN/KTRK (ABC)/Fox 5 Vegas" }));
    const tv = screen.getByText("ESPN/KTRK (ABC)/Fox 5 Vegas");
    // truncates with an ellipsis rather than pushing the clock around
    expect(tv.className).toContain("truncate");
  });
});


describe("the pool layer reads like the sheet (POOL-3c)", () => {
  /**
   * Owner request, 2026-08-21, with a screenshot: "get rid of the tags for the
   * group pickem picks and list them like we have the bet groups. So it should
   * say (group name) 'You USC -37 & Over' then list if anyone else is on the
   * same side or what the other pickems are in that group."
   *
   * A pool pick and a bet are the same shape of fact, and the card was telling
   * them two different ways — chips in the tag row for yours, a count for
   * everyone else's. These tests moved with the block: they previously pinned
   * an intermediate shape (names joined under a side label), which answered
   * the letter of "list who picked what" without the form the owner meant.
   */
  const pooled = (over: Partial<GameView> = {}) =>
    live({ situation: null, possession: null, lastPlay: null, ...over } as Partial<GameView>);

  const renderPool = (game: GameView) =>
    render(
      <GameCard
        game={game}
        tz="America/Chicago"
        starred={[]}
        onStar={() => {}}
        poolName="Test Group"
      />,
    );

  it("names the pool, the way the sheet names a betting group", () => {
    renderPool(
      pooled({ crewPicks: [{ name: "Dave", side: "home", record: null, picks: [{ market: "spread", side: "home" }] }] } as Partial<GameView>),
    );
    expect(screen.getByText("Test Group")).toBeTruthy();
  });

  it("collapses your own picks into one You row joined by &", () => {
    // "USC -37" and "Over" are one decision about one game, not two rows.
    renderPool(
      pooled({
        myPicks: [
          { market: "spread", side: "home", line: -7 },
          { market: "total", side: "over", line: 51.5 },
        ],
      } as Partial<GameView>),
    );
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByText(/&/)).toBeTruthy();
  });

  it("lists all of a member's picks, joined — Dave USC & Over", () => {
    /* Owner question, 2026-08-21: "is it going to have all of the picks listed
       so it would say Dave USC & Over and Ann SJSU & Under?" It was not: the
       loader kept one row per mate per game and dropped the rest, so Dave's
       total vanished and the card disagreed with the board about what he had
       picked. */
    renderPool(
      pooled({
        crewPicks: [
          {
            name: "Dave",
            side: "home",
            record: null,
            picks: [
              { market: "spread", side: "home" },
              { market: "total", side: "over" },
            ],
          },
          {
            name: "Ann",
            side: "away",
            record: null,
            picks: [
              { market: "spread", side: "away" },
              { market: "total", side: "under" },
            ],
          },
        ],
      } as Partial<GameView>),
    );
    expect(screen.getByText("CIN & Over")).toBeTruthy();
    expect(screen.getByText("DET & Under")).toBeTruthy();
  });

  it("counts a member as with you when ANY of their picks matches", () => {
    // Same team, other total: with you on the thing you are both watching.
    renderPool(
      pooled({
        myPicks: [{ market: "spread", side: "home", line: -7 }],
        crewPicks: [
          {
            name: "Dave",
            side: "home",
            record: null,
            picks: [
              { market: "spread", side: "home" },
              { market: "total", side: "under" },
            ],
          },
        ],
      } as Partial<GameView>),
    );
    expect(screen.getByText("1 with you")).toBeTruthy();
  });

  it("lists every other picker with the side they took", () => {
    renderPool(
      pooled({
        crewPicks: [
          { name: "Dave", side: "home", record: "12-8", picks: [{ market: "spread", side: "home" }] },
          { name: "Ann", side: "away", record: null, picks: [{ market: "spread", side: "away" }] },
        ],
      } as Partial<GameView>),
    );
    expect(screen.getByText("Dave")).toBeTruthy();
    expect(screen.getByText("Ann")).toBeTruthy();
    // Their record rides along, like the sheet's does.
    expect(screen.getByText("12-8")).toBeTruthy();
  });

  it("counts who is with you when you have a pick", () => {
    renderPool(
      pooled({
        myPicks: [{ market: "spread", side: "home", line: -7 }],
        crewPicks: [
          { name: "Dave", side: "home", record: null, picks: [{ market: "spread", side: "home" }] },
          { name: "Ann", side: "away", record: null, picks: [{ market: "spread", side: "away" }] },
        ],
      } as Partial<GameView>),
    );
    expect(screen.getByText("1 with you")).toBeTruthy();
  });

  it("says so when you are first in", () => {
    renderPool(
      pooled({ myPicks: [{ market: "spread", side: "home", line: -7 }] } as Partial<GameView>),
    );
    expect(screen.getByText("Nobody else in yet")).toBeTruthy();
  });

  it("renders nothing when the pool has nothing on this game", () => {
    // Also the shape of a hide-until-kickoff group before kickoff: RLS hands
    // over no crew picks and the viewer has none of their own.
    const { container } = renderPool(pooled({ myPicks: [], crewPicks: [] } as Partial<GameView>));
    expect(container.textContent).not.toContain("Pool");
  });
});
