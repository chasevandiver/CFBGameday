// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameCard } from "./GameCard";
import type { GameView, TeamView } from "../../lib/slate";

/**
 * NFL-21: a final card has to say what happened to your money.
 *
 * The reported symptom was an NFL final with no Won / Lost / Pushed anywhere on
 * it. Two independent causes, and each gets a test that was checked failing
 * against the shipped code first:
 *
 *   1. `FinalFooter` builds chips from `myPicks`, ATS, O/U and the model, and
 *      never reads `myBets`. `PregameFooter` does have settled-bet chips, but
 *      a final never renders that footer — the `final` half of its
 *      `settled = live || final` condition is unreachable.
 *
 *   2. The cover strip — the big word across the top — was gated on
 *      `live && a pick`. A bet never produced one, and a final never did.
 *
 * The NFL made both worse rather than causing either: grading runs Mon/Tue/Fri
 * there, so `bet.result` is null all weekend and the recomputed-from-score
 * fallback is the only thing that can answer.
 */

vi.mock("../../app/actions/bets", () => ({ voidBet: async () => ({ ok: true }) }));
vi.mock("../../lib/bets-changed", () => ({ betsChanged: () => undefined }));

const team = (over: Partial<TeamView>): TeamView => ({
  id: 1,
  school: "Kansas City Chiefs",
  abbr: "KC",
  mascot: "Chiefs",
  conference: "AFC West",
  color: "#E31837",
  altColor: null,
  logo: null,
  rank: null,
  pollRank: null,
  poll: null,
  record: null,
  confRecord: null,
  ...over,
});

const home = team({ id: 1, school: "Kansas City Chiefs", abbr: "KC", mascot: "Chiefs" });
const away = team({ id: 2, school: "Jacksonville Jaguars", abbr: "JAX", mascot: "Jaguars" });

/** A finished game: KC 27, JAX 20. KC -3 covers, the total of 47 goes over 44.5. */
const finalGame = (over: Partial<GameView> = {}): GameView =>
  ({
    id: 401,
    home,
    away,
    startTs: "2026-09-13T17:00:00Z",
    status: "final",
    homePoints: 27,
    awayPoints: 20,
    period: 4,
    clock: "0:00",
    situation: null,
    lastPlay: null,
    possession: null,
    neutralSite: false,
    conferenceGame: true,
    tv: "CBS",
    weather: null,
    lines: { spread: -3, spreadOpen: -3, total: 44.5, moneylineHome: null, moneylineAway: null, history: [] },
    prediction: null,
    myPicks: [],
    myBets: [],
    crewPicks: [],
    groupBets: [],
    systems: [],
    rivalry: null,
    ...over,
  }) as unknown as GameView;

afterEach(cleanup);

const draw = (game: GameView) =>
  render(<GameCard game={game} tz="America/Chicago" starred={[]} onStar={() => {}} demo />);

describe("a final card, when you had a bet on it", () => {
  const winningBet = { id: 900, betType: "spread", side: "home", line: -3, result: null };

  it("says WON across the top", () => {
    draw(finalGame({ myBets: [winningBet] }));
    expect(screen.getByText("Won")).toBeTruthy();
  });

  /* Scoped to the strip rather than to the card. "KC -3" also appears on the
     ATS chip, which has always rendered — so an unscoped query passes against
     the pre-fix code and proves nothing. Checked: this fails without the fix,
     the loose version did not. */
  it("names the bet the verdict is about, in the strip itself", () => {
    const { container } = draw(finalGame({ myBets: [winningBet] }));
    expect(container.querySelector(".cover-pick")?.textContent).toBe("KC -3");
  });

  it("says LOST when it lost", () => {
    draw(finalGame({ myBets: [{ ...winningBet, side: "away", line: 3 }] }));
    expect(screen.getByText("Lost")).toBeTruthy();
  });

  it("says PUSH on the number", () => {
    // KC by exactly 7, laying 7.
    draw(
      finalGame({
        homePoints: 27,
        awayPoints: 20,
        myBets: [{ ...winningBet, line: -7 }],
      }),
    );
    expect(screen.getByText("Push")).toBeTruthy();
  });

  /* The NFL case specifically: nfl-grade runs Mon/Tue/Fri, so a Sunday final
     has `result: null` all afternoon. Recomputing from the score is the only
     thing that can answer, and it is what makes the card readable at the
     whistle rather than two days later. */
  it("answers from the score while the grader has not run yet", () => {
    draw(finalGame({ myBets: [{ ...winningBet, result: null }] }));
    expect(screen.getByText("Won")).toBeTruthy();
  });

  /* And the other direction: the grader settles types a score cannot, so when
     it HAS spoken its word is final. A hand-settled first-half bet has no
     score-derived answer at all. */
  it("prefers the grader's word to the score", () => {
    draw(
      finalGame({
        myBets: [{ id: 901, betType: "first_half", side: "home", line: -1.5, result: "loss" }],
      }),
    );
    expect(screen.getByText("Lost")).toBeTruthy();
  });

  it("shows a chip for each settled bet, not just the headline one", () => {
    draw(
      finalGame({
        myBets: [
          winningBet,
          { id: 901, betType: "total", side: "under", line: 44.5, result: null },
        ],
      }),
    );
    expect(screen.getAllByText("KC -3").length).toBeGreaterThan(0);
    // The total chip is the one only NFL-21 can produce — nothing else on a
    // final card renders the viewer's own O/U ticket.
    expect(screen.getAllByText("U 44.5").length).toBeGreaterThan(0);
  });

  /* A voided bet never happened (League Rule #4). It must not colour the top of
     the card green or red. */
  it("says nothing for a voided bet", () => {
    draw(finalGame({ myBets: [{ ...winningBet, result: "void" }] }));
    expect(screen.queryByText("Won")).toBeNull();
    expect(screen.queryByText("Lost")).toBeNull();
  });

  /* An ungraded exotic at the top of the list must not silence a graded spread
     underneath it. */
  it("skips a wager nothing can settle and reports the one that can", () => {
    draw(
      finalGame({
        myBets: [
          { id: 899, betType: "future", side: null, line: null, result: null },
          winningBet,
        ],
      }),
    );
    expect(screen.getByText("Won")).toBeTruthy();
  });
});

describe("a final card with a pick but no bet", () => {
  it("still reports the pick", () => {
    draw(
      finalGame({
        myPicks: [{ market: "spread", side: "home", line: -3 }],
      }),
    );
    expect(screen.getByText("Won")).toBeTruthy();
  });
});

describe("a final card you had nothing on", () => {
  /* The strip is a verdict about the viewer. With no position there is no
     verdict, and the card keeps its team-colour edge exactly as before. */
  it("shows no verdict word", () => {
    draw(finalGame());
    expect(screen.queryByText("Won")).toBeNull();
    expect(screen.queryByText("Lost")).toBeNull();
    expect(screen.queryByText("Push")).toBeNull();
  });
});

describe("a live card is unchanged", () => {
  /* The strip has always been present-tense for a live pick, and NFL-21 must
     not have quietly turned it past-tense. */
  it("still says Covering, not Won", () => {
    draw(
      finalGame({
        status: "in_progress",
        clock: "8:42",
        period: 3,
        myPicks: [{ market: "spread", side: "home", line: -3 }],
      }),
    );
    expect(screen.getByText("Covering")).toBeTruthy();
    expect(screen.queryByText("Won")).toBeNull();
  });
});
