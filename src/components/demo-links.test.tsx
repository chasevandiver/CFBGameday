// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeDashboard } from "./home/HomeHub";
import { GameCard } from "./slate/GameCard";
import { demoHomeData, demoSlateData } from "../lib/demo-data";

vi.mock("../app/actions/bets", () => ({
  voidBet: vi.fn(async () => ({ ok: true })),
}));

afterEach(cleanup);

/**
 * The demo must not offer a way out that doesn't exist.
 *
 * Every href these components render points at a real route, and on `/demo`
 * all of them are dead ends: the game ids are invented, so `/game/:id` is a
 * page for a game that never happened, and `/ledger` and `/groups` signed out
 * are the sign-in card the demo was built to avoid. The rule is one line —
 * on the demo, the only link is the one that stays inside the demo.
 */
const hrefs = (el: HTMLElement) =>
  [...el.querySelectorAll("a")].map((a) => a.getAttribute("href"));

const NOW = Date.parse("2026-11-14T18:00:00Z");
const liveGame = () => demoSlateData(NOW).games.find((g) => g.status === "in_progress")!;

describe("the demo has no dead ends", () => {
  it("leaves the hub with exactly one link: its own slate", () => {
    const { container } = render(
      <HomeDashboard data={demoHomeData(NOW)} signedIn demo slateHref="/demo/slate" />,
    );
    expect(hrefs(container)).toEqual(["/demo/slate"]);
  });

  it("still links out everywhere off the demo", () => {
    const { container } = render(<HomeDashboard data={demoHomeData(NOW)} signedIn />);
    const out = hrefs(container);
    expect(out).toContain("/ledger");
    expect(out).toContain("/groups");
    expect(out.some((h) => h?.startsWith("/game/"))).toBe(true);
    expect(out.some((h) => h?.startsWith("/groups/"))).toBe(true);
  });

  it("stops a slate card being a link on the demo, and leaves it one otherwise", () => {
    const props = { tz: "America/Chicago", starred: [], onStar: () => {} };
    const { container } = render(<GameCard game={liveGame()} {...props} demo />);
    expect(hrefs(container)).toEqual([]);

    cleanup();
    const { container: real } = render(<GameCard game={liveGame()} {...props} />);
    expect(hrefs(real)).toEqual([`/game/${liveGame().id}`]);
  });
});
