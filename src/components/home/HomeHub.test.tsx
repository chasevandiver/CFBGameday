// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HomeDashboard } from "./HomeHub";
import { demoGames, demoHomeData } from "../../lib/demo-data";
import { buildPositions, type HomeBet, type HomeData } from "../../lib/home";
import { EMPTY_TALLY } from "../../lib/records";

afterEach(cleanup);

/**
 * The hub's assembly moved out of `app/page.tsx` so that `/demo` could render
 * it against sample data. The page is a server component behind a database, so
 * nothing else can execute this layout — these cover the two branches it has
 * and the empty states, which is what the move put at risk.
 */
const NOW = Date.parse("2026-11-14T18:00:00Z");

const empty = (over: Partial<HomeData> = {}): HomeData => ({
  seasonId: 2026,
  week: 12,
  seasonType: "regular",
  fetchedAt: new Date(NOW).toISOString(),
  firstKick: null,
  liveCount: 0,
  picksDue: 0,
  weekGameCount: 58,
  positions: [],
  openBetCount: 0,
  openBetUnits: 0,
  weekPickCount: 0,
  groups: [],
  progress: [],
  bets: EMPTY_TALLY,
  picks: EMPTY_TALLY,
  pickGroupCount: 0,
  curve: [],
  today: { kind: "quiet" },
  ...over,
});

describe("HomeDashboard", () => {
  it("gives a signed-out visitor the week and a way in, and none of the sections", () => {
    render(<HomeDashboard data={empty()} signedIn={false} />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Week 12");
    expect(screen.getByText("This is where your Saturday lives.")).toBeDefined();
    expect(screen.queryByText("Your bets")).toBeNull();
    expect(screen.queryByText("Pool picks")).toBeNull();
  });

  it("renders all four sections signed in", () => {
    render(<HomeDashboard data={demoHomeData(NOW)} signedIn />);

    for (const title of ["Your bets", "Pool picks", "Your groups", "Your season"]) {
      expect(screen.getByText(title), title).toBeDefined();
    }
    expect(screen.queryByText("This is where your Saturday lives.")).toBeNull();
  });

  it("counts open bets and picks in the section heads", () => {
    render(<HomeDashboard data={demoHomeData(NOW)} signedIn />);
    expect(screen.getByText("3 open · 3.0u")).toBeDefined();
    expect(screen.getByText("5 in")).toBeDefined();
  });

  it("gives every empty section somewhere to go instead of a blank column", () => {
    render(<HomeDashboard data={empty()} signedIn />);

    expect(screen.getByText("No money on this week yet.")).toBeDefined();
    // No pool board at all reads differently from a board you haven't filled.
    expect(screen.getByText("No pool board this week.")).toBeDefined();
    expect(screen.getByText("You’re not in a group yet.")).toBeDefined();
    expect(screen.getByText("Nothing has graded yet.")).toBeDefined();
  });

  it("tells someone with a board that they haven't picked yet", () => {
    render(
      <HomeDashboard
        data={empty({ progress: [{ name: "Saturday Boys", slug: "saturday-boys", made: 0, target: 8 }] })}
        signedIn
      />,
    );
    expect(screen.getByText("You haven’t made your picks yet.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Make picks" }).getAttribute("href")).toBe(
      "/groups/saturday-boys/picks",
    );
  });

  it("keeps the primary action pointed wherever the page says", () => {
    const { unmount } = render(<HomeDashboard data={empty()} signedIn />);
    expect(screen.getByRole("link", { name: /Go to the slate/ }).getAttribute("href")).toBe("/slate");
    unmount();

    render(<HomeDashboard data={empty()} signedIn slateHref="/demo/slate" />);
    expect(screen.getByRole("link", { name: /Go to the slate/ }).getAttribute("href")).toBe(
      "/demo/slate",
    );
  });

  it("names the pool on a pick only when there is more than one to name", () => {
    // Two pick'em groups in the demo data, so the pool label earns its space.
    render(<HomeDashboard data={demoHomeData(NOW)} signedIn />);
    expect(screen.getAllByText("Saturday Boys").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Work Pool").length).toBeGreaterThan(0);
  });
});

describe("TodayCard (R2-B1)", () => {
  it("renders nothing on a quiet day — the hub grows no filler", () => {
    render(<HomeDashboard data={empty({ today: { kind: "quiet" } })} signedIn />);
    expect(screen.queryByText(/Live now|Tuesday Drop|weekend, graded/)).toBeNull();
  });

  it("leads with live football", () => {
    render(
      <HomeDashboard
        data={empty({ today: { kind: "live", liveCount: 3 } })}
        signedIn
      />,
    );
    expect(screen.getByText("Live now")).toBeDefined();
    expect(screen.getByText(/3 games playing/)).toBeDefined();
  });

  it("Wednesday's board block counts what is still owed", () => {
    render(
      <HomeDashboard
        data={empty({
          today: {
            kind: "board",
            due: [{ name: "Crew", slug: "crew", made: 2, target: 5 }],
          },
        })}
        signedIn
      />,
    );
    expect(screen.getByText(/3 picks still open across 1 pool/)).toBeDefined();
  });

  it("goes inert on the demo — a strip, not a dead link", () => {
    render(
      <HomeDashboard
        data={empty({ today: { kind: "results" } })}
        signedIn
        demo
        slateHref="/demo/slate"
      />,
    );
    const label = screen.getByText("The weekend, graded");
    expect(label.closest("a")).toBeNull();
  });
});


describe("the hub's Groups card (2026-08-21)", () => {
  /**
   * Owner call, twice over. The arcade held the first card under the live
   * banner while the pool — the thing with a deadline on it — was a section
   * most of a screen further down; and the picks-due count spent a few hours
   * as a "9+" on the Groups nav tab, which the owner read as "confusing." A
   * number floating over an icon cannot say what it is counting. A card can.
   */
  it("leads with Groups, and puts Games below", () => {
    render(<HomeDashboard data={empty()} signedIn />);
    const links = screen.getAllByRole("link");
    const groups = links.findIndex((l) => l.getAttribute("href") === "/groups");
    const games = links.findIndex((l) => l.getAttribute("href") === "/games");
    expect(groups).toBeGreaterThanOrEqual(0);
    expect(games).toBeGreaterThan(groups);
  });

  it("says how many picks are owed, in words rather than a floating number", () => {
    render(<HomeDashboard data={empty({ picksDue: 3 })} signedIn />);
    expect(screen.getByText("3 picks still to make")).toBeTruthy();
  });

  it("counts one pick singular, because a card has room to be right", () => {
    render(<HomeDashboard data={empty({ picksDue: 1 })} signedIn />);
    expect(screen.getByText("1 pick still to make")).toBeTruthy();
  });

  it("says nothing about picks when none are owed", () => {
    render(<HomeDashboard data={empty({ picksDue: 0 })} signedIn />);
    expect(screen.queryByText(/still to make/)).toBeNull();
  });

  it("leads with the groups SECTION, standings and all — not a bare link row", () => {
    /* Owner correction: "I wanted it to have the same format as the current
       group section so it'd have your groups you're in, plus your standing in
       the group/record." A card that names the destination and nothing about
       it is a worse tab. */
    render(<HomeDashboard data={demoHomeData(NOW)} signedIn />);
    const heading = screen.getByText("Your groups");
    expect(heading).toBeTruthy();
    // The section appears once, not twice — it was hoisted, not copied.
    expect(screen.getAllByText("Your groups")).toHaveLength(1);
  });
});

/**
 * A settled game is one line, not a scoreboard.
 *
 * The full row spends ~120px on team rails, a cover strip and an aura built for
 * a game still in doubt. On a Saturday with positions across eight openers plus
 * the NFL card that pushes everything still in play below the fold — the hub
 * stops answering "what have I got riding" exactly when it has the most to say.
 */
describe("a final game collapses to one line", () => {
  /** IOWA 17 @ WISCONSIN 13, final, from the same fixtures /demo renders. */
  const finalGame = () => demoGames(NOW).find((g) => g.id === 9102)!;

  const withBets = (bets: HomeBet[]): HomeData =>
    empty({ positions: buildPositions([finalGame()], [], bets) });

  const bet = (id: number, betType: string, side: string, line: number | null, result: HomeBet["result"]): HomeBet =>
    ({ id, gameId: 9102, betType, side, line, result }) as HomeBet;

  it("gives the grader's word for spread, total AND moneyline", () => {
    // The point of the whole row. A final score settles a spread and a total on
    // its own, but the stored `result` is the only thing that can speak for a
    // moneyline priced at real odds — or for a wager that was voided.
    render(
      <HomeDashboard
        data={withBets([
          bet(1, "spread", "away", 3.5, "win"),
          bet(2, "total", "over", 34.5, "loss"),
          bet(3, "moneyline", "away", null, "win"),
        ])}
        signedIn
      />,
    );
    expect(screen.getAllByText("Won").length).toBe(2);
    expect(screen.getByText("Lost")).toBeDefined();
    // And the markets are still distinguishable, not three identical verdicts.
    expect(screen.getByText(/IOWA ML/)).toBeDefined();
    expect(screen.getByText(/O 34\.5|O 34½/)).toBeDefined();
  });

  it("says Push and Void rather than collapsing both to a non-answer", () => {
    // A push tied the number; a void never happened. Same neutral styling, and
    // "Push" on a canceled game is simply wrong.
    render(
      <HomeDashboard
        data={withBets([bet(1, "spread", "away", 3.5, "push"), bet(2, "total", "over", 34.5, "void")])}
        signedIn
      />,
    );
    expect(screen.getByText("Push")).toBeDefined();
    expect(screen.getByText("Void")).toBeDefined();
  });

  it("shows the matchup and the final score on one line", () => {
    const { container } = render(
      <HomeDashboard data={withBets([bet(1, "spread", "away", 3.5, "win")])} signedIn />,
    );
    // Split across nested spans so the loser can be dimmed, which is why this
    // reads textContent rather than asking getByText for a whole string.
    // The settled block's summary line also carries `stat tabular-nums`, so
    // this finds the one that is actually the scoreline.
    const line = [...container.querySelectorAll("span.stat")].find((el) =>
      el.textContent?.includes("IOWA"),
    );
    const text = line?.textContent?.replace(/\s+/g, " ") ?? "";
    expect(text).toContain("IOWA 17");
    expect(text).toContain("WIS 13");
    expect(screen.getAllByText("Final").length).toBeGreaterThan(0);
  });

  it("dims the loser, so the score is scannable without reading both numbers", () => {
    const { container } = render(
      <HomeDashboard data={withBets([bet(1, "spread", "away", 3.5, "win")])} signedIn />,
    );
    const scoreLine = [...container.querySelectorAll("span.stat")].find((el) =>
      el.textContent?.includes("IOWA"),
    );
    const spans = [...(scoreLine?.children ?? [])];
    const wis = spans.find((el) => el.textContent?.includes("WIS"));
    const iowa = spans.find((el) => el.textContent?.includes("IOWA"));
    // Wisconsin lost 13-17.
    expect(wis?.className).toContain("text-dim");
    expect(iowa?.className).not.toContain("text-dim");
  });

  it("carries both team marks, so the row is glanceable as crests not words", () => {
    // TeamMark renders the logo and falls back to a colour-filled monogram when
    // one is null — which is why the abbreviation stays beside it rather than
    // being replaced by it, and why this asserts on the mark's own wrapper
    // rather than on an <img> that a fixture team may not have.
    const { container } = render(
      <HomeDashboard data={withBets([bet(1, "spread", "away", 3.5, "win")])} signedIn />,
    );
    const marks = container.querySelectorAll('span[style*="width: 20px"]');
    expect(marks.length).toBeGreaterThanOrEqual(2);
  });

  it("turns the glow up once there is a verdict to glow about", () => {
    // 0.1 is the tall card's setting, tuned for a row that already spells the
    // verdict out in a cover strip and two team rails. This row is mostly
    // verdict, so a scrolled column of results should read as colour first.
    const { container } = render(
      <HomeDashboard data={withBets([bet(1, "spread", "away", 3.5, "win")])} signedIn />,
    );
    // The hub has other .glass-wrap cards; take the one that is this game's row.
    const wrap = [...container.querySelectorAll<HTMLElement>(".glass-wrap")].find((el) =>
      el.textContent?.includes("IOWA"),
    );
    expect(wrap, "no glass-wrap contained the final row").toBeDefined();
    expect(wrap?.getAttribute("style")).toContain("0.35");
  });

  it("drops the line-move readout, which measures a board that has stopped", () => {
    // `heldVsNow` compares your number to the current one. After a final there
    // is no "now" — the closing number is CLV and it lives on /receipts.
    const { container } = render(
      <HomeDashboard data={withBets([bet(1, "spread", "away", 3.5, "win")])} signedIn />,
    );
    expect(container.textContent).not.toMatch(/vs now/i);
  });

  it("still gives a live game the full row", () => {
    // The collapse is for settled games only — a game in doubt keeps its rails,
    // its cover strip and its aura, which is the whole reason they exist.
    const live = demoGames(NOW).find((g) => g.status === "in_progress")!;
    const data = empty({
      positions: buildPositions([live], [], [
        { id: 9, gameId: live.id, betType: "spread", side: "away", line: 3, result: null },
      ]),
    });
    const { container } = render(<HomeDashboard data={data} signedIn />);
    expect(container.querySelectorAll(".glass-aura").length).toBeGreaterThan(0);
    expect(screen.queryByText("Final")).toBeNull();
  });
});

describe("the settled block folds the results away", () => {
  const finalGame = () => demoGames(NOW).find((g) => g.id === 9102)!;
  const liveGame = () => demoGames(NOW).find((g) => g.status === "in_progress")!;

  it("puts settled games inside a closed disclosure and leaves live ones out of it", () => {
    // The whole point: the one thing still in doubt must not be pushed off the
    // screen by games that already happened.
    const data = empty({
      positions: buildPositions(
        [finalGame(), liveGame()],
        [],
        [
          { id: 1, gameId: 9102, betType: "spread", side: "away", line: 3.5, result: "win" },
          { id: 2, gameId: liveGame().id, betType: "spread", side: "away", line: 3, result: null },
        ] as HomeBet[],
      ),
    });
    const { container } = render(<HomeDashboard data={data} signedIn />);
    const details = container.querySelector("details");
    expect(details, "no settled disclosure rendered").toBeTruthy();
    expect(details?.hasAttribute("open"), "settled block should default closed").toBe(false);
    expect(details?.textContent).toContain("IOWA");
    // The live game's row is a sibling of the disclosure, not inside it.
    expect(details?.textContent).not.toContain(liveGame().away.abbr);
  });

  it("leads the fold with the record, which is Monday's whole question", () => {
    const data = empty({
      positions: buildPositions([finalGame()], [], [
        { id: 1, gameId: 9102, betType: "spread", side: "away", line: 3.5, result: "win" },
        { id: 2, gameId: 9102, betType: "total", side: "over", line: 34.5, result: "loss" },
      ] as HomeBet[]),
    });
    render(<HomeDashboard data={data} signedIn />);
    expect(screen.getByText("Settled")).toBeDefined();
    expect(screen.getByText("1-1")).toBeDefined();
  });

  it("counts the finals instead of a record while the grader is still working", () => {
    // "0-0" over two ungraded finals is a claim the data does not support.
    const data = empty({
      positions: buildPositions([finalGame()], [], [
        { id: 1, gameId: 9102, betType: "spread", side: "away", line: 3.5, result: null },
      ] as HomeBet[]),
    });
    render(<HomeDashboard data={data} signedIn />);
    expect(screen.getByText("1 final")).toBeDefined();
  });

  it("renders no disclosure at all on a Saturday with nothing settled yet", () => {
    // The common case must be untouched — no empty fold, no chevron to explain.
    const data = empty({
      positions: buildPositions([liveGame()], [], [
        { id: 1, gameId: liveGame().id, betType: "spread", side: "away", line: 3, result: null },
      ] as HomeBet[]),
    });
    const { container } = render(<HomeDashboard data={data} signedIn />);
    expect(container.querySelector("details")).toBeNull();
  });
});
