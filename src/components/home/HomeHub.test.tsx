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
