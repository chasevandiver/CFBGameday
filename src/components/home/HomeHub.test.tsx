// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HomeDashboard } from "./HomeHub";
import { demoHomeData } from "../../lib/demo-data";
import type { HomeData } from "../../lib/home";
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
  firstKick: null,
  liveCount: 0,
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
