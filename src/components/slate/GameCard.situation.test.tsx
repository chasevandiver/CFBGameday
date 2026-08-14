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
