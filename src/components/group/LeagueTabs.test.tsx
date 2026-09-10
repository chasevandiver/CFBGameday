// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LeagueTabs } from "./LeagueTabs";

afterEach(cleanup);

/**
 * GRP-12. A betting group's home is one league's week at a time, and these
 * tabs are the only way across. What they must get right: the NFL link says
 * so in the URL, the CFB link is the bare route (CFB is the default league
 * everywhere), a param worth keeping survives the switch, and a one-league
 * group gets no tabs at all.
 */
describe("LeagueTabs", () => {
  it("links each league, NFL by ?league=nfl and CFB as the bare route", () => {
    render(<LeagueTabs base="/groups/crew" league="cfb" leagues={["cfb", "nfl"]} />);
    expect(screen.getByRole("link", { name: "CFB" }).getAttribute("href")).toBe("/groups/crew");
    expect(screen.getByRole("link", { name: "NFL" }).getAttribute("href")).toBe("/groups/crew?league=nfl");
  });

  it("marks the league in view as the current page", () => {
    render(<LeagueTabs base="/groups/crew" league="nfl" leagues={["cfb", "nfl"]} />);
    expect(screen.getByRole("link", { name: "NFL" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "CFB" }).hasAttribute("aria-current")).toBe(false);
  });

  it("carries the params it is told to across the switch, and drops empty ones", () => {
    render(
      <LeagueTabs
        base="/groups/crew"
        league="cfb"
        leagues={["cfb", "nfl"]}
        extra={{ for: "u-jeff", week: null }}
      />,
    );
    expect(screen.getByRole("link", { name: "NFL" }).getAttribute("href")).toBe("/groups/crew?league=nfl&for=u-jeff");
    expect(screen.getByRole("link", { name: "CFB" }).getAttribute("href")).toBe("/groups/crew?for=u-jeff");
  });

  it("renders nothing for a one-league group", () => {
    const { container } = render(<LeagueTabs base="/groups/crew" league="cfb" leagues={["cfb"]} />);
    expect(container.innerHTML).toBe("");
  });
});
