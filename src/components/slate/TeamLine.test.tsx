// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TeamScoreLine } from "./TeamLine";
import type { TeamView } from "../../lib/slate";

afterEach(cleanup);

/**
 * The scoreboard row is shared by the slate's game card and the home hub, and
 * `GameCard` has no tests of its own — so these cover the construction both
 * screens now depend on. The rules being pinned: a score shows only when the
 * game has one, the losing side of a final fades, and the record stands in
 * before kickoff.
 */
const team = (over: Partial<TeamView> = {}): TeamView => ({
  id: 1,
  school: "Memphis",
  abbr: "MEM",
  mascot: null,
  conference: "American",
  color: "#00498f",
  altColor: null,
  logo: null,
  rank: null,
  pollRank: null,
  poll: null,
  record: "8-1",
  confRecord: "5-1",
  ...over,
});

describe("TeamScoreLine", () => {
  it("shows the score when the game has one, and hides the record", () => {
    render(<TeamScoreLine team={team()} score={24} showScore />);
    expect(screen.getByText("24")).toBeTruthy();
    expect(screen.queryByText("8-1")).toBeNull();
  });

  it("shows the record before kickoff, and no score", () => {
    render(<TeamScoreLine team={team()} score={null} showScore={false} />);
    expect(screen.getByText("8-1")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
  });

  /** A live game that hasn't scored is 0-0, not blank. */
  it("renders a null score as zero once the game is showing scores", () => {
    render(<TeamScoreLine team={team()} score={null} showScore />);
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("fades the losing side and dims its number", () => {
    const { container } = render(<TeamScoreLine team={team()} score={17} showScore dimmed />);
    expect(container.querySelector(".opacity-45")).toBeTruthy();
    expect(screen.getByText("17").className).toContain("text-dim");
  });

  it("leaves the winning side at full strength", () => {
    const { container } = render(<TeamScoreLine team={team()} score={24} showScore />);
    expect(container.querySelector(".opacity-45")).toBeNull();
    expect(screen.getByText("24").className).toContain("text-chalk");
  });

  /** The rank is a claim about a poll, so it names its source (see RankPip). */
  it("renders a top-25 rank as a superscript and titles its source", () => {
    render(<TeamScoreLine team={team({ pollRank: 4, poll: "AP", rank: 9 })} score={0} showScore />);
    const sup = screen.getByText("4");
    expect(sup.tagName).toBe("SUP");
    expect(sup.getAttribute("title")).toBe("AP rank");
  });

  it("omits a rank outside the top 25", () => {
    render(<TeamScoreLine team={team({ pollRank: null, rank: 61 })} score={0} showScore />);
    expect(screen.queryByText("61")).toBeNull();
  });

  it("carries the team colour on the rail so the row is tinted", () => {
    const { container } = render(<TeamScoreLine team={team()} score={3} showScore />);
    const row = container.querySelector(".trow") as HTMLElement;
    expect(row.style.getPropertyValue("--tc")).toBe("#00498f");
    expect(container.querySelector(".trail")).toBeTruthy();
  });

  it("falls back to a neutral rail for a team with no colour", () => {
    const { container } = render(<TeamScoreLine team={team({ color: null })} score={3} showScore />);
    const row = container.querySelector(".trow") as HTMLElement;
    expect(row.style.getPropertyValue("--tc")).toBe("var(--push)");
  });

  /** The card passes its star button and animated score through these. */
  it("renders the trailing and right slots the card supplies", () => {
    render(
      <TeamScoreLine
        team={team()}
        score={24}
        showScore
        trailing={<button>star</button>}
        right={<span>odds</span>}
      />,
    );
    expect(screen.getByRole("button", { name: "star" })).toBeTruthy();
    expect(screen.getByText("odds")).toBeTruthy();
    // the supplied slot replaces the default score entirely
    expect(screen.queryByText("24")).toBeNull();
  });

  it("lets the right slot render before kickoff too, for the odds cells", () => {
    render(<TeamScoreLine team={team()} score={null} showScore={false} right={<span>odds</span>} />);
    expect(screen.getByText("odds")).toBeTruthy();
  });
});
