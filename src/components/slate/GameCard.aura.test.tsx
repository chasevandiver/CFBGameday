// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameCard } from "./GameCard";
import type { GameView } from "../../lib/slate";

vi.mock("../../app/actions/bets", () => ({
  voidBet: vi.fn(async () => ({ ok: true })),
}));

afterEach(cleanup);

/* The aura is the thing carrying "is your money good", so the rules about when
   it moves are worth pinning: motion means money, and a score only lifts the
   glow on a card you have something riding on. Both are enforced in two places
   (globals.css and the component) and this covers the component half. */

const team = (id: number, school: string, abbr: string, color: string) => ({
  id,
  school,
  abbr,
  mascot: null,
  conference: "Big Ten",
  color,
  altColor: null,
  logo: null,
  rank: null,
  pollRank: null,
  poll: null,
  record: "7-2",
  confRecord: "4-2",
});

const baseGame = {
  id: 1,
  week: 11,
  seasonType: "regular",
  startTs: new Date("2026-11-14T18:00:00Z").toISOString(),
  status: "in_progress",
  period: 3,
  clock: "8:42",
  tv: "FOX",
  venue: null,
  neutralSite: false,
  dome: false,
  home: team(130, "Michigan", "MICH", "#00274c"),
  away: team(194, "Ohio State", "OSU", "#bb0000"),
  homePoints: 24,
  awayPoints: 21,
  lines: { spread: 3.5, spreadOpen: 2.5, total: 44.5, totalOpen: 45.5, mlHome: 150, mlAway: -175 },
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
} as unknown as GameView;

/** A live game with a spread pick on it — tintFor() resolves this to a verdict. */
const withPosition = (over: Partial<GameView> = {}): GameView =>
  ({
    ...baseGame,
    myPicks: [{ market: "spread", side: "away", line: -3.5 }],
    ...over,
  }) as GameView;

/** The same live game with nothing riding on it — tintFor() resolves to teams. */
const noPosition = (over: Partial<GameView> = {}): GameView =>
  ({ ...baseGame, ...over }) as GameView;

const renderCard = (game: GameView) =>
  render(<GameCard game={game} tz="America/Chicago" starred={[]} onStar={() => {}} />);

const wrap = (c: HTMLElement) => c.querySelector(".glass-wrap") as HTMLElement;

describe("the card aura", () => {
  it("only a game you have a position on gets the drifting tint", () => {
    const { container } = renderCard(withPosition());
    expect(wrap(container).dataset.tint).toBe("position");

    cleanup();
    const { container: plain } = renderCard(noPosition());
    expect(wrap(plain).dataset.tint).toBe("teams");
  });

  it("does not flare before anything has happened", () => {
    const { container } = renderCard(withPosition());
    expect(wrap(container).hasAttribute("data-flare")).toBe(false);
  });

  it("flares when the score ticks on a card you have money on", () => {
    const { container, rerender } = renderCard(withPosition());
    expect(wrap(container).hasAttribute("data-flare")).toBe(false);

    rerender(
      <GameCard
        game={withPosition({ awayPoints: 28 })}
        tz="America/Chicago"
        starred={[]}
        onStar={() => {}}
      />,
    );
    expect(wrap(container).dataset.flare).toBe("1");
  });

  it("does NOT flare when the score ticks on a game you have nothing on", () => {
    const { container, rerender } = renderCard(noPosition());
    rerender(
      <GameCard
        game={noPosition({ awayPoints: 28 })}
        tz="America/Chicago"
        starred={[]}
        onStar={() => {}}
      />,
    );
    // the money cue must not leak onto a team-tinted card
    expect(wrap(container).hasAttribute("data-flare")).toBe(false);
    expect(wrap(container).dataset.tint).toBe("teams");
  });

  it("settles back to rest after the flare window", async () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = renderCard(withPosition());
      rerender(
        <GameCard
          game={withPosition({ awayPoints: 28 })}
          tz="America/Chicago"
          starred={[]}
          onStar={() => {}}
        />,
      );
      expect(wrap(container).dataset.flare).toBe("1");

      const { act } = await import("react");
      act(() => {
        vi.advanceTimersByTime(1700);
      });
      expect(wrap(container).hasAttribute("data-flare")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
